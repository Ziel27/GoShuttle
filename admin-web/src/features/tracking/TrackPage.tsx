import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { API_BASE_URL } from '@/lib/config';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

type TrackingData = {
  mode: 'driver' | 'passenger';
  status: string;
  destinationLabel: string;
  fareType: string;
  note: string | null;
  expiresAt: string;
  passengerNames: string[];
  location: { latitude: number; longitude: number } | null;
  pickupLocation: { latitude: number; longitude: number } | null;
  shuttleLabel: string | null;
  shuttlePlate: string | null;
  locationUpdatedAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for shuttle',
  claimed: 'Shuttle claimed',
  dispatched: 'Shuttle on the way',
  queued: 'In queue',
  bumped: 'Re-queued',
  expired: 'Ride complete',
  cancelled: 'Cancelled',
  completed: 'Ride complete',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  dispatched: { bg: '#dcfce7', text: '#166534', dot: '#22c55e' },
  pending:    { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  queued:     { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  bumped:     { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' },
  cancelled:  { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' },
  expired:    { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
  completed:  { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
};

const shuttleIcon = L.divIcon({
  html: `<div style="
    background:#1d4ed8;width:46px;height:46px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 3px 14px rgba(0,0,0,0.3);
    font-size:22px;line-height:1;">🚌</div>`,
  iconSize: [46, 46],
  iconAnchor: [23, 23],
  className: '',
});

const passengerIcon = L.divIcon({
  html: `<div style="
    background:#dc2626;width:46px;height:46px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 3px 14px rgba(0,0,0,0.3);
    font-size:22px;line-height:1;">🧍</div>`,
  iconSize: [46, 46],
  iconAnchor: [23, 46],
  className: '',
});

const pickupPinIcon = L.divIcon({
  html: `<div style="
    background:#7c3aed;width:38px;height:38px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.25);
    font-size:18px;line-height:1;opacity:0.85;">📍</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  className: '',
});

export const TrackPage = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<TrackingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [isFollowing, setIsFollowing] = useState(true);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const primaryMarkerRef = useRef<L.Marker | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const hasInitialFocus = useRef(false);
  const userInteracting = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoom: 16,
      center: [14.5995, 120.9842],
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('dragstart', () => {
      userInteracting.current = true;
      setIsFollowing(false);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      primaryMarkerRef.current = null;
      pickupMarkerRef.current = null;
      hasInitialFocus.current = false;
      userInteracting.current = false;
    };
  }, []);

  const recenter = () => {
    if (!mapRef.current || !primaryMarkerRef.current) return;
    userInteracting.current = false;
    setIsFollowing(true);
    const latlng = primaryMarkerRef.current.getLatLng();
    mapRef.current.flyTo(latlng, Math.max(mapRef.current.getZoom(), 16), { animate: true, duration: 0.8 });
  };

  const fetchData = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/track/${token}`);

      if (res.status === 410) {
        setCompleted(true);
        setLoading(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Tracking link not found or has expired.');
        setLoading(false);
        return;
      }

      const json: TrackingData = await res.json();

      if (json.status === 'expired' || json.status === 'cancelled') {
        setCompleted(true);
        setLoading(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        return;
      }

      setData(json);
      setLastUpdated(new Date());
      setSecondsAgo(0);
      setError(null);

      if (!mapRef.current) return;

      // ── Primary marker (shuttle or passenger) ─────────────────────────────
      if (json.location) {
        const { latitude, longitude } = json.location;
        const latlng: L.LatLngExpression = [latitude, longitude];
        const isDriverMode = json.mode === 'driver';

        // In driver mode with a real shuttle location, use shuttle icon.
        // In driver mode but no shuttle assigned yet (showing pickup fallback), use pickup pin.
        // In passenger mode, use person icon.
        const hasRealShuttle = isDriverMode && json.shuttleLabel !== null;
        const icon = isDriverMode
          ? (hasRealShuttle ? shuttleIcon : pickupPinIcon)
          : passengerIcon;

        if (!primaryMarkerRef.current) {
          primaryMarkerRef.current = L.marker(latlng, { icon }).addTo(mapRef.current);
        } else {
          primaryMarkerRef.current.setLatLng(latlng).setIcon(icon);
        }

        // Auto-focus: always on first load; follow continuously unless user panned
        if (!hasInitialFocus.current) {
          mapRef.current.setView(latlng, 16);
          hasInitialFocus.current = true;
        } else if (!userInteracting.current) {
          mapRef.current.panTo(latlng, { animate: true, duration: 0.5 });
        }
      }

      // ── Pickup location pin (secondary, driver mode only) ─────────────────
      if (json.mode === 'driver' && json.pickupLocation && json.location) {
        const { latitude, longitude } = json.pickupLocation;
        const pickupLatlng: L.LatLngExpression = [latitude, longitude];
        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = L.marker(pickupLatlng, { icon: pickupPinIcon }).addTo(mapRef.current!);
          pickupMarkerRef.current.bindTooltip('Pickup point', { permanent: false, direction: 'top' });
        }
      } else if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }

    } catch {
      setError('Could not reach the tracking server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token]);

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  const isDriverMode = data?.mode === 'driver';
  const isTerminal = completed || data?.status === 'expired' || data?.status === 'cancelled';
  const hasRealShuttle = isDriverMode && data?.shuttleLabel !== null;
  const statusStyle = STATUS_COLORS[data?.status ?? ''] ?? { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' };

  const accentColor = isDriverMode ? '#1d4ed8' : '#991b1b';
  const accentLight = isDriverMode ? '#dbeafe' : '#fee2e2';

  if (completed) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', fontFamily: "'Outfit', system-ui, sans-serif",
        background: 'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)', padding: 24, textAlign: 'center',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 40,
          background: '#dcfce7', border: '2px solid #86efac',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 40, marginBottom: 20,
        }}>✅</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#166534', marginBottom: 8 }}>Ride Complete</div>
        <div style={{ fontSize: 15, color: '#4b7a5e', maxWidth: 300, lineHeight: 1.6 }}>
          The passenger has been dropped off. This tracking link is no longer active.
        </div>
        <div style={{ marginTop: 32, color: '#94a3b8', fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>
          POWERED BY GOSHUTTLE
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: "'Outfit', system-ui, sans-serif", background: '#f8fafc' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: accentColor,
        color: 'white',
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
        zIndex: 10, gap: 12, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>
            {isDriverMode ? '🚌' : '📍'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
              {isDriverMode
                ? (hasRealShuttle ? 'Shuttle Tracking' : 'Awaiting Dispatch')
                : 'Passenger Location'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
              {isDriverMode
                ? (hasRealShuttle ? 'Live shuttle position · updates every 5s' : 'Waiting for a shuttle to be assigned')
                : 'Pickup location shared by passenger'}
            </div>
          </div>
        </div>

        {!isTerminal && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 99, padding: '4px 10px', flexShrink: 0,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#4ade80',
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>LIVE</span>
          </div>
        )}
      </div>

      {/* ── Map ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(248,250,252,0.9)', zIndex: 5,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
              <div style={{ color: '#475569', fontWeight: 600, fontSize: 14 }}>Loading tracking data…</div>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(248,250,252,0.95)', zIndex: 5, padding: 24,
          }}>
            <div style={{ textAlign: 'center', maxWidth: 320 }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🔍</div>
              <div style={{ color: '#b91c1c', fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Link Not Found</div>
              <div style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>{error}</div>
            </div>
          </div>
        )}

        {/* No location pill */}
        {data && !data.location && !loading && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'white', borderRadius: 99, padding: '7px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)', zIndex: 5,
            fontSize: 13, color: '#64748b', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>⏳</span>
            {isDriverMode ? 'Waiting for shuttle to be assigned…' : 'Location unavailable'}
          </div>
        )}

        {/* Re-center button */}
        {!isFollowing && data?.location && (
          <button
            onClick={recenter}
            style={{
              position: 'absolute', bottom: 16, right: 16, zIndex: 5,
              background: accentColor, color: 'white',
              border: 'none', borderRadius: 99, padding: '9px 16px',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span>📡</span> Re-center
          </button>
        )}

        {/* Last updated chip - floating over map bottom-left */}
        {lastUpdated && !isTerminal && !loading && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 5,
            background: 'rgba(255,255,255,0.92)',
            borderRadius: 99, padding: '5px 12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: 11, color: '#64748b',
            backdropFilter: 'blur(4px)',
          }}>
            {secondsAgo < 5 ? '● Just updated' : `● ${secondsAgo}s ago`}
          </div>
        )}
      </div>

      {/* ── Info card ──────────────────────────────────────────────────────── */}
      {data && !error && (
        <div style={{
          background: 'white',
          borderTop: '1px solid #e2e8f0',
          flexShrink: 0,
          maxHeight: '42vh',
          overflowY: 'auto',
        }}>
          {/* Status bar */}
          <div style={{
            padding: '10px 16px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: statusStyle.bg, color: statusStyle.text,
              borderRadius: 99, padding: '5px 12px', fontSize: 12, fontWeight: 700,
              letterSpacing: 0.2,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: statusStyle.dot,
                animation: isTerminal ? 'none' : 'pulse 2s infinite',
                display: 'inline-block', flexShrink: 0,
              }} />
              {STATUS_LABELS[data.status] || data.status}
            </span>
          </div>

          {/* Details */}
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Destination */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: accentLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              }}>🏁</div>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2, letterSpacing: 0.3 }}>DESTINATION</div>
                <div style={{ fontSize: 15, color: '#0f172a', fontWeight: 700 }}>{data.destinationLabel}</div>
              </div>
            </div>

            {/* Passenger(s) */}
            {data.passengerNames.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: '#f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                }}>🧍</div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2, letterSpacing: 0.3 }}>
                    {data.passengerNames.length === 1 ? 'PASSENGER' : 'PASSENGERS'}
                  </div>
                  <div style={{ fontSize: 14, color: '#0f172a' }}>{data.passengerNames.join(', ')}</div>
                </div>
              </div>
            )}

            {/* Shuttle info (driver mode, real shuttle only) */}
            {isDriverMode && hasRealShuttle && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: '#dbeafe',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                }}>🚌</div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2, letterSpacing: 0.3 }}>SHUTTLE</div>
                  <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 700 }}>
                    {[data.shuttleLabel, data.shuttlePlate].filter(Boolean).join(' · ')}
                  </div>
                  {data.locationUpdatedAt && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      GPS: {new Date(data.locationUpdatedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Note */}
            {data.note && (
              <div style={{
                padding: '9px 12px',
                background: '#f8fafc', borderRadius: 10, borderLeft: `3px solid ${accentColor}`,
                display: 'flex', gap: 8,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>💬</span>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 2, letterSpacing: 0.3 }}>NOTE</div>
                  <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>{data.note}</div>
                </div>
              </div>
            )}

            {/* Fare type */}
            <div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: data.fareType === 'priority' ? '#fef3c7' : '#f1f5f9',
                color: data.fareType === 'priority' ? '#92400e' : '#475569',
                borderRadius: 99, padding: '4px 11px', fontSize: 12, fontWeight: 700,
              }}>
                {data.fareType === 'priority' ? '⚡ Priority' : '🚗 Standard'}
              </span>
            </div>
          </div>

          {/* Branding footer */}
          <div style={{
            borderTop: '1px solid #f1f5f9',
            padding: '8px 16px',
            textAlign: 'center', color: '#cbd5e1', fontSize: 11, fontWeight: 600, letterSpacing: 0.8,
          }}>
            POWERED BY GOSHUTTLE
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .leaflet-container { font-family: 'Outfit', system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
      `}</style>
    </div>
  );
};
