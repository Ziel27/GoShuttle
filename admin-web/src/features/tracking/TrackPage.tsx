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

const driverIcon = L.divIcon({
  html: `<div style="
    background:#2563eb;width:44px;height:44px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.25);
    font-size:22px;line-height:1;">🚌</div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  className: '',
});

const passengerIcon = L.divIcon({
  html: `<div style="
    background:#dc2626;width:44px;height:44px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:3px solid white;box-shadow:0 2px 12px rgba(0,0,0,0.25);
    font-size:22px;line-height:1;">📍</div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const hasSetInitialView = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      zoom: 16,
      center: [14.5995, 120.9842],
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      hasSetInitialView.current = false;
    };
  }, []);

  const fetchData = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/track/${token}`);

      if (res.status === 410) {
        setCompleted(true);
        setLoading(false);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
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
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }

      setData(json);
      setLastUpdated(new Date());
      setSecondsAgo(0);
      setError(null);

      if (json.location && mapRef.current) {
        const { latitude, longitude } = json.location;
        const latlng: L.LatLngExpression = [latitude, longitude];
        const icon = json.mode === 'driver' ? driverIcon : passengerIcon;
        if (!markerRef.current) {
          markerRef.current = L.marker(latlng, { icon }).addTo(mapRef.current);
        } else {
          markerRef.current.setLatLng(latlng);
        }
        if (!hasSetInitialView.current) {
          mapRef.current.setView(latlng, 16);
          hasSetInitialView.current = true;
        }
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
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  const isDriverMode = data?.mode === 'driver';
  const isTerminal = completed || data?.status === 'expired' || data?.status === 'cancelled';

  if (completed) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', fontFamily: "'Outfit', sans-serif", background: '#f0fdf4', padding: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#166534', marginBottom: 8 }}>Ride Complete</div>
        <div style={{ fontSize: 15, color: '#4b7a5e', maxWidth: 300, lineHeight: 1.6 }}>
          The passenger has been dropped off. This tracking link is no longer active.
        </div>
        <div style={{ marginTop: 32, color: '#cbd5e1', fontSize: 12 }}>Powered by GoShuttle</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: "'Outfit', sans-serif", background: '#f8fafc' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: isDriverMode ? '#1e40af' : '#991b1b',
        color: 'white',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{isDriverMode ? '🚌' : '📍'}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
              {isDriverMode ? 'Shuttle Tracking' : 'Passenger Location'}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>
              {isDriverMode
                ? 'Live shuttle position — updates every 5s'
                : 'Passenger pickup location'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!isTerminal && (
            <>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#4ade80',
                boxShadow: '0 0 0 2px rgba(74,222,128,0.4)',
                animation: 'pulse 2s infinite',
              }} />
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>LIVE</span>
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(248,250,252,0.85)', zIndex: 5,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
              <div style={{ color: '#475569', fontWeight: 500 }}>Loading tracking data…</div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(248,250,252,0.9)', zIndex: 5, padding: 24,
          }}>
            <div style={{ textAlign: 'center', maxWidth: 320 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
                Link Not Found
              </div>
              <div style={{ color: '#64748b', fontSize: 14 }}>{error}</div>
            </div>
          </div>
        )}

        {data && !data.location && !loading && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'white', borderRadius: 99, padding: '6px 14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 5,
            fontSize: 12, color: '#64748b', whiteSpace: 'nowrap',
          }}>
            {isDriverMode ? '⏳ Waiting for shuttle to be assigned…' : '📍 Location unavailable'}
          </div>
        )}
      </div>

      {/* Info card */}
      {data && !error && (
        <div style={{
          background: 'white',
          borderTop: '1px solid #e2e8f0',
          padding: '14px 16px',
          maxHeight: '38vh',
          overflowY: 'auto',
          boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
        }}>
          {/* Status pill */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: isTerminal ? '#f1f5f9' : isDriverMode ? '#dbeafe' : '#fee2e2',
              color: isTerminal ? '#64748b' : isDriverMode ? '#1e40af' : '#991b1b',
              borderRadius: 99, padding: '4px 10px', fontSize: 12, fontWeight: 600,
            }}>
              <span>{isTerminal ? '⏹' : '●'}</span>
              {STATUS_LABELS[data.status] || data.status}
            </span>
            {lastUpdated && !isTerminal && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {secondsAgo < 5 ? 'Just updated' : `${secondsAgo}s ago`}
              </span>
            )}
          </div>

          {/* Destination */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 15, marginTop: 1 }}>🏁</span>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 1 }}>Destination</div>
              <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>{data.destinationLabel}</div>
            </div>
          </div>

          {/* Passengers */}
          {data.passengerNames.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15, marginTop: 1 }}>👤</span>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 1 }}>
                  {data.passengerNames.length === 1 ? 'Passenger' : 'Passengers'}
                </div>
                <div style={{ fontSize: 14, color: '#1e293b' }}>{data.passengerNames.join(', ')}</div>
              </div>
            </div>
          )}

          {/* Shuttle info (driver mode only) */}
          {isDriverMode && (data.shuttleLabel || data.shuttlePlate) && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15, marginTop: 1 }}>🚌</span>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 1 }}>Shuttle</div>
                <div style={{ fontSize: 14, color: '#1e293b', fontWeight: 600 }}>
                  {[data.shuttleLabel, data.shuttlePlate].filter(Boolean).join(' · ')}
                </div>
                {data.locationUpdatedAt && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Last GPS ping: {new Date(data.locationUpdatedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Note */}
          {data.note && (
            <div style={{
              marginTop: 8, padding: '8px 10px',
              background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #2563eb',
              display: 'flex', gap: 8,
            }}>
              <span style={{ fontSize: 13 }}>💬</span>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>Note</div>
                <div style={{ fontSize: 13, color: '#334155' }}>{data.note}</div>
              </div>
            </div>
          )}

          {/* Fare type */}
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: data.fareType === 'priority' ? '#fef3c7' : '#f1f5f9',
              color: data.fareType === 'priority' ? '#92400e' : '#475569',
              borderRadius: 99, padding: '3px 9px', fontSize: 11, fontWeight: 600,
            }}>
              {data.fareType === 'priority' ? '⚡ Priority' : '🚗 Standard'}
            </span>
          </div>

          {/* Branding */}
          <div style={{ marginTop: 12, textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>
            Powered by GoShuttle
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .leaflet-container { font-family: inherit; }
      `}</style>
    </div>
  );
};
