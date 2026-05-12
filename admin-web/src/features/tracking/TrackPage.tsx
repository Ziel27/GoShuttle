import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { API_BASE_URL } from '@/lib/config';

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
  destinationLocation: { latitude: number; longitude: number } | null;
  shuttleLabel: string | null;
  shuttlePlate: string | null;
  locationUpdatedAt: string | null;
  etaMinutes: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for Shuttle',
  claimed: 'Shuttle Claimed',
  dispatched: 'Shuttle En Route',
  queued: 'In Queue',
  bumped: 'Re-queued',
  expired: 'Ride Complete',
  cancelled: 'Cancelled',
  completed: 'Ride Complete',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  dispatched: { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e', border: '#bbf7d0' },
  pending:    { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b', border: '#fde68a' },
  queued:     { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b', border: '#fde68a' },
  bumped:     { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b', border: '#fde68a' },
  cancelled:  { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444', border: '#fecaca' },
  expired:    { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8', border: '#e2e8f0' },
  completed:  { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8', border: '#e2e8f0' },
};

// SVG icon strings for Leaflet divIcons
const BUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
  <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
</svg>`;

const USER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/>
</svg>`;

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
  <circle cx="12" cy="10" r="3"/>
</svg>`;

const FLAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>
</svg>`;

const makePrimaryMarkerHtml = (color: string, svg: string, pulse: boolean) => `
  <div style="position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;">
    ${pulse ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.25;animation:trackPulse 2s ease-out infinite;"></div>` : ''}
    <div style="
      width:46px;height:46px;border-radius:50%;
      background:${color};
      display:flex;align-items:center;justify-content:center;
      border:3px solid white;
      box-shadow:0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06);
      position:relative;z-index:1;
    ">${svg}</div>
  </div>`;

const makePinHtml = (color: string, svg: string) => `
  <div style="display:flex;flex-direction:column;align-items:center;">
    <div style="
      width:36px;height:36px;border-radius:50%;
      background:${color};
      display:flex;align-items:center;justify-content:center;
      border:2.5px solid white;
      box-shadow:0 3px 10px rgba(0,0,0,0.22);
    ">${svg}</div>
    <div style="width:2px;height:8px;background:${color};opacity:0.7;border-radius:1px;"></div>
  </div>`;

const makeShuttleIcon = (live: boolean) => L.divIcon({
  html: makePrimaryMarkerHtml('#1d4ed8', BUS_SVG, live),
  iconSize: [52, 52],
  iconAnchor: [26, 26],
  className: '',
});

const makePassengerIcon = () => L.divIcon({
  html: makePrimaryMarkerHtml('#7c3aed', USER_SVG, true),
  iconSize: [52, 52],
  iconAnchor: [26, 26],
  className: '',
});

const pickupPinIcon = L.divIcon({
  html: makePinHtml('#7c3aed', PIN_SVG),
  iconSize: [36, 48],
  iconAnchor: [18, 48],
  className: '',
});

const destinationPinIcon = L.divIcon({
  html: makePinHtml('#16a34a', FLAG_SVG),
  iconSize: [36, 48],
  iconAnchor: [18, 48],
  className: '',
});

// Inline SVG icons for the UI panel
const IconBus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>
    <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
    <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
  </svg>
);

const IconUser = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/>
  </svg>
);

const IconMapPin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const IconFlag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
    <line x1="4" x2="4" y1="22" y2="15"/>
  </svg>
);

const IconClock = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);

const IconNavigation = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
  </svg>
);

const IconTag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
    <path d="M7 7h.01"/>
  </svg>
);

const IconStickyNote = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/>
    <path d="M15 3v6h6"/><line x1="10" x2="16" y1="16" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/>
  </svg>
);

const IconCheckCircle = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
  </svg>
);

const IconSearch = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);

const IconMap = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>
  </svg>
);

const IconHourglass = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/>
    <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
  </svg>
);

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
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const hasInitialFocus = useRef(false);
  const userInteracting = useRef(false);

  // Inject keyframe animations into the document
  useEffect(() => {
    const styleId = 'track-page-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes trackPulse {
        0% { transform: scale(1); opacity: 0.25; }
        70% { transform: scale(2); opacity: 0; }
        100% { transform: scale(2); opacity: 0; }
      }
      @keyframes liveDot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(styleId)?.remove(); };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoom: 16,
      center: [14.5995, 120.9842],
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: '' })
      .addAttribution('© <a href="https://openstreetmap.org/copyright" style="color:#94a3b8;">OpenStreetMap</a>')
      .addTo(map);

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
      destinationMarkerRef.current = null;
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

      const isDriverMode = json.mode === 'driver';
      const hasRealShuttle = isDriverMode && json.shuttleLabel !== null;

      // Primary marker (shuttle or passenger)
      if (json.location) {
        const { latitude, longitude } = json.location;
        const latlng: L.LatLngExpression = [latitude, longitude];

        const icon = isDriverMode
          ? makeShuttleIcon(hasRealShuttle)
          : makePassengerIcon();

        if (!primaryMarkerRef.current) {
          primaryMarkerRef.current = L.marker(latlng, { icon }).addTo(mapRef.current);
        } else {
          primaryMarkerRef.current.setLatLng(latlng).setIcon(icon);
        }
      }

      // Pickup pin
      if (isDriverMode && hasRealShuttle && json.pickupLocation) {
        const { latitude, longitude } = json.pickupLocation;
        const latlng: L.LatLngExpression = [latitude, longitude];
        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = L.marker(latlng, { icon: pickupPinIcon }).addTo(mapRef.current!);
          pickupMarkerRef.current.bindTooltip('Pickup point', { permanent: false, direction: 'top', className: 'track-tooltip' });
        } else {
          pickupMarkerRef.current.setLatLng(latlng);
        }
      } else if (pickupMarkerRef.current) {
        pickupMarkerRef.current.remove();
        pickupMarkerRef.current = null;
      }

      // Destination pin
      if (json.destinationLocation) {
        const { latitude, longitude } = json.destinationLocation;
        const latlng: L.LatLngExpression = [latitude, longitude];
        if (!destinationMarkerRef.current) {
          destinationMarkerRef.current = L.marker(latlng, { icon: destinationPinIcon }).addTo(mapRef.current!);
          destinationMarkerRef.current.bindTooltip(
            json.destinationLabel ? `Drop-off: ${json.destinationLabel}` : 'Drop-off point',
            { permanent: false, direction: 'top' }
          );
        } else {
          destinationMarkerRef.current.setLatLng(latlng);
        }
      } else if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove();
        destinationMarkerRef.current = null;
      }

      // Map focus
      if (!hasInitialFocus.current && json.location) {
        hasInitialFocus.current = true;
        const points: L.LatLngExpression[] = [[json.location.latitude, json.location.longitude]];
        if (json.pickupLocation) points.push([json.pickupLocation.latitude, json.pickupLocation.longitude]);
        if (json.destinationLocation) points.push([json.destinationLocation.latitude, json.destinationLocation.longitude]);

        if (points.length > 1) {
          mapRef.current!.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 17 });
        } else {
          mapRef.current!.setView([json.location.latitude, json.location.longitude], 16);
        }
      } else if (!userInteracting.current && json.location) {
        mapRef.current!.panTo([json.location.latitude, json.location.longitude], { animate: true, duration: 0.5 });
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
  const statusStyle = STATUS_COLORS[data?.status ?? ''] ?? { bg: '#f8fafc', text: '#475569', dot: '#94a3b8', border: '#e2e8f0' };
  const hasEta = typeof data?.etaMinutes === 'number' && data.etaMinutes !== null && !isTerminal;

  // Brand colors — driver mode = blue, passenger mode = purple
  const brandColor = isDriverMode ? '#1d4ed8' : '#7c3aed';
  const brandLight = isDriverMode ? '#dbeafe' : '#ede9fe';
  const brandDark  = isDriverMode ? '#1e3a8a' : '#5b21b6';

  // ── Completed screen ──────────────────────────────────────────────────────
  if (completed) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', fontFamily: "'Outfit Variable', system-ui, sans-serif",
        background: '#f8fafc', padding: 32, textAlign: 'center',
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: 44,
          background: '#f0fdf4', border: '2px solid #bbf7d0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#16a34a', marginBottom: 24,
        }}>
          <IconCheckCircle />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 8, letterSpacing: -0.3 }}>
          Ride Complete
        </div>
        <div style={{ fontSize: 15, color: '#64748b', maxWidth: 300, lineHeight: 1.65 }}>
          The passenger has been dropped off. This tracking link is no longer active.
        </div>
        <div style={{
          marginTop: 40, display: 'flex', alignItems: 'center', gap: 8,
          color: '#cbd5e1', fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/>
          </svg>
          POWERED BY GOSHUTTLE
        </div>
      </div>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', fontFamily: "'Outfit Variable', system-ui, sans-serif",
        background: '#f8fafc', padding: 32, textAlign: 'center',
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: 44,
          background: '#fef2f2', border: '2px solid #fecaca',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#dc2626', marginBottom: 24,
        }}>
          <IconSearch />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Link Not Found</div>
        <div style={{ fontSize: 14, color: '#64748b', maxWidth: 300, lineHeight: 1.65 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100dvh',
      fontFamily: "'Outfit Variable', system-ui, sans-serif",
      background: '#f1f5f9', overflow: 'hidden',
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: `linear-gradient(135deg, ${brandDark} 0%, ${brandColor} 100%)`,
        color: 'white',
        boxShadow: '0 2px 16px rgba(0,0,0,0.22)',
        zIndex: 20, gap: 12, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white',
          }}>
            {isDriverMode ? <IconBus /> : <IconUser />}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
              {isDriverMode
                ? (hasRealShuttle ? 'Live Shuttle Tracking' : 'Awaiting Dispatch')
                : 'Passenger Location'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>
              {isDriverMode
                ? (hasRealShuttle ? 'Updates every 5 seconds' : 'Waiting for shuttle assignment')
                : 'Pickup location shared'}
            </div>
          </div>
        </div>

        {!isTerminal && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 99, padding: '5px 11px',
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#4ade80',
              animation: 'liveDot 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>LIVE</span>
          </div>
        )}
      </div>

      {/* ── Map ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(248,250,252,0.92)', zIndex: 10,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 26, margin: '0 auto 16px',
                background: '#e2e8f0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#64748b',
              }}>
                <IconMap />
              </div>
              <div style={{ color: '#475569', fontWeight: 600, fontSize: 14 }}>Loading tracking data…</div>
            </div>
          </div>
        )}

        {/* No location pill */}
        {data && !data.location && !loading && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'white', borderRadius: 99, padding: '7px 16px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)', zIndex: 10,
            fontSize: 13, color: '#64748b', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 7,
            border: '1px solid #e2e8f0',
          }}>
            <span style={{ color: '#94a3b8' }}><IconHourglass /></span>
            {isDriverMode ? 'Waiting for shuttle assignment…' : 'Location unavailable'}
          </div>
        )}

        {/* Map legend — top left */}
        {data && !loading && (data.pickupLocation || data.destinationLocation) && (
          <div style={{
            position: 'absolute', top: 12, left: 12, zIndex: 10,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {isDriverMode && hasRealShuttle && data.pickupLocation && (
              <div style={{
                background: 'rgba(255,255,255,0.96)', borderRadius: 99, padding: '5px 12px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.12)', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, color: '#7c3aed',
                border: '1px solid rgba(124,58,237,0.15)',
                backdropFilter: 'blur(6px)',
              }}>
                <span style={{ opacity: 0.8 }}><IconMapPin /></span> Pickup point
              </div>
            )}
            {data.destinationLocation && (
              <div style={{
                background: 'rgba(255,255,255,0.96)', borderRadius: 99, padding: '5px 12px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.12)', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, color: '#15803d',
                border: '1px solid rgba(21,128,61,0.15)',
                backdropFilter: 'blur(6px)',
              }}>
                <span style={{ opacity: 0.8 }}><IconFlag /></span>
                {data.destinationLabel || 'Drop-off'}
              </div>
            )}
          </div>
        )}

        {/* Re-center button */}
        {!isFollowing && data?.location && (
          <button
            onClick={recenter}
            style={{
              position: 'absolute', bottom: 16, right: 16, zIndex: 10,
              background: brandColor, color: 'white',
              border: 'none', borderRadius: 12, padding: '10px 16px',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            <IconNavigation /> Re-center
          </button>
        )}

        {/* Last updated chip — bottom left */}
        {lastUpdated && !isTerminal && !loading && (
          <div style={{
            position: 'absolute', bottom: 16, left: 16, zIndex: 10,
            background: 'rgba(255,255,255,0.94)',
            borderRadius: 99, padding: '5px 12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: 11, color: '#64748b',
            backdropFilter: 'blur(6px)',
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: secondsAgo < 6 ? '#22c55e' : '#f59e0b',
            }} />
            {secondsAgo < 5 ? 'Just updated' : `Updated ${secondsAgo}s ago`}
          </div>
        )}
      </div>

      {/* ── Info panel ──────────────────────────────────────────────────────── */}
      {data && !error && (
        <div style={{
          background: 'white',
          borderTop: '1px solid #e2e8f0',
          flexShrink: 0,
          maxHeight: '44vh',
          overflowY: 'auto',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.07)',
        }}>

          {/* ETA Hero */}
          {hasEta && (
            <div style={{
              margin: '14px 16px 0',
              background: `linear-gradient(135deg, ${brandDark} 0%, ${brandColor} 100%)`,
              borderRadius: 14,
              padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 16,
              boxShadow: `0 4px 20px ${brandColor}40`,
            }}>
              <div style={{
                width: 50, height: 50, borderRadius: 12, flexShrink: 0,
                background: 'rgba(255,255,255,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white',
              }}>
                <IconClock />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 700, letterSpacing: 1.2, marginBottom: 3 }}>
                  ESTIMATED ARRIVAL
                </div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'white', lineHeight: 1, letterSpacing: -0.5 }}>
                  ~{data.etaMinutes} min
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
                  Shuttle en route to pickup point
                </div>
              </div>
              <div style={{
                padding: '5px 10px',
                background: 'rgba(255,255,255,0.15)',
                borderRadius: 99,
                fontSize: 10, fontWeight: 700, color: 'white', letterSpacing: 0.8,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#4ade80',
                  animation: 'liveDot 2s ease-in-out infinite',
                }} />
                LIVE
              </div>
            </div>
          )}

          {/* Status + ride info */}
          <div style={{ padding: '12px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: statusStyle.bg,
                color: statusStyle.text,
                border: `1px solid ${statusStyle.border}`,
                borderRadius: 99, padding: '5px 12px', fontSize: 12, fontWeight: 700,
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: statusStyle.dot,
                  animation: isTerminal ? 'none' : 'liveDot 2s ease-in-out infinite',
                  flexShrink: 0,
                }} />
                {STATUS_LABELS[data.status] || data.status}
              </div>

              {/* Fare type badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: data.fareType === 'priority' ? '#fef3c7' : '#f1f5f9',
                color: data.fareType === 'priority' ? '#92400e' : '#475569',
                border: `1px solid ${data.fareType === 'priority' ? '#fde68a' : '#e2e8f0'}`,
                borderRadius: 99, padding: '5px 12px', fontSize: 11, fontWeight: 700,
              }}>
                <IconTag />
                {data.fareType === 'priority' ? 'Priority' : 'Standard'} Fare
              </div>
            </div>
          </div>

          {/* Detail rows */}
          <div style={{ padding: '12px 16px 16px', display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>

            {/* Drop-off */}
            <DetailRow
              icon={<IconFlag />}
              iconBg="#dcfce7"
              iconColor="#15803d"
              label="DROP-OFF"
              value={data.destinationLabel || 'Destination'}
            />

            {/* Pickup point (driver mode only) */}
            {isDriverMode && data.pickupLocation && (
              <DetailRow
                icon={<IconMapPin />}
                iconBg="#ede9fe"
                iconColor="#7c3aed"
                label="PICKUP POINT"
                value={`${data.pickupLocation.latitude.toFixed(5)}, ${data.pickupLocation.longitude.toFixed(5)}`}
              />
            )}

            {/* Passenger(s) */}
            {data.passengerNames.length > 0 && (
              <DetailRow
                icon={<IconUser />}
                iconBg="#f1f5f9"
                iconColor="#334155"
                label={data.passengerNames.length === 1 ? 'PASSENGER' : 'PASSENGERS'}
                value={data.passengerNames.join(', ')}
              />
            )}

            {/* Shuttle info */}
            {isDriverMode && hasRealShuttle && (
              <DetailRow
                icon={<IconBus />}
                iconBg={brandLight}
                iconColor={brandColor}
                label="SHUTTLE"
                value={[
                  data.shuttleLabel ? `Electric ${data.shuttleLabel}` : null,
                  data.shuttlePlate,
                ].filter(Boolean).join(' · ') || 'Assigned shuttle'}
              />
            )}

            {/* Note */}
            {data.note && (
              <DetailRow
                icon={<IconStickyNote />}
                iconBg="#fff7ed"
                iconColor="#c2410c"
                label="NOTE"
                value={data.note}
              />
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '8px 16px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, borderTop: '1px solid #f1f5f9',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/>
            </svg>
            <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700, letterSpacing: 1.5 }}>
              POWERED BY GOSHUTTLE
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

type DetailRowProps = {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
};

const DetailRow = ({ icon, iconBg, iconColor, label, value }: DetailRowProps) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
    <div style={{
      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
      background: iconBg, color: iconColor,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {icon}
    </div>
    <div style={{ paddingTop: 1 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 2, letterSpacing: 0.8 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, lineHeight: 1.4 }}>{value}</div>
    </div>
  </div>
);
