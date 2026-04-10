import { useEffect, useMemo, useRef } from 'react';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LocationPickerMapProps = {
  latitude: number | null;
  longitude: number | null;
  geofenceCoordinates?: number[][][];
  onPick: (latitude: number, longitude: number) => void;
};

const DEFAULT_CENTER: [number, number] = [14.5995, 120.9842];

const isValidLngLatPair = (lng: unknown, lat: unknown) =>
  Number.isFinite(Number(lng)) &&
  Number(lng) >= -180 &&
  Number(lng) <= 180 &&
  Number.isFinite(Number(lat)) &&
  Number(lat) >= -90 &&
  Number(lat) <= 90;

const normalizeRing = (coordinates?: number[][][]) => {
  const ring = coordinates?.[0] || [];

  const normalized = ring
    .filter((point) => Array.isArray(point) && point.length === 2 && isValidLngLatPair(point[0], point[1]))
    .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number]);

  if (normalized.length < 3) return [];

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const closed = isClosed ? normalized : [...normalized, first];

  return closed.length >= 4 ? closed : [];
};

/**
 * Ray-casting point-in-polygon test.
 * @param lat - latitude of the test point
 * @param lng - longitude of the test point
 * @param ring - closed ring in [lng, lat] (GeoJSON) order
 */
const isPointInsideRing = (lat: number, lng: number, ring: [number, number][]) => {
  if (ring.length < 4) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1]; // lat
    const yi = ring[i][0]; // lng
    const xj = ring[j][1]; // lat
    const yj = ring[j][0]; // lng

    const intersect = yi > lng !== yj > lng && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
};

export const LocationPickerMap = ({ latitude, longitude, geofenceCoordinates, onPick }: LocationPickerMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const geofenceLayerRef = useRef<L.Polygon | null>(null);
  const onPickRef = useRef(onPick);
  const ringRef = useRef<[number, number][]>([]);

  const ring = useMemo(() => normalizeRing(geofenceCoordinates), [geofenceCoordinates]);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    ringRef.current = ring;
  }, [ring]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView(DEFAULT_CENTER, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      const nextLatitude = event.latlng.lat;
      const nextLongitude = event.latlng.lng;

      // If a geofence exists, only allow picks inside it
      const currentRing = ringRef.current;
      if (currentRing.length >= 4 && !isPointInsideRing(nextLatitude, nextLongitude, currentRing)) {
        return;
      }

      if (!markerRef.current) {
        markerRef.current = L.circleMarker([nextLatitude, nextLongitude], {
          radius: 7,
          color: '#0f172a',
          weight: 2,
          fillColor: '#0ea5e9',
          fillOpacity: 0.85,
        }).addTo(map);
      } else {
        markerRef.current.setLatLng([nextLatitude, nextLongitude]);
      }

      onPickRef.current(nextLatitude, nextLongitude);
    });

    map.whenReady(() => {
      map.invalidateSize();
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      geofenceLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (geofenceLayerRef.current) {
      geofenceLayerRef.current.removeFrom(map);
      geofenceLayerRef.current = null;
    }

    if (!ring.length) return;

    const latLngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
    const layer = L.polygon(latLngs, {
      color: '#334155',
      weight: 2,
      fillColor: '#94a3b8',
      fillOpacity: 0.18,
      interactive: false,
    });

    layer.addTo(map);
    geofenceLayerRef.current = layer;

    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [16, 16], maxZoom: 16 });
    }
  }, [ring]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (markerRef.current) {
        markerRef.current.removeFrom(map);
        markerRef.current = null;
      }
      return;
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!markerRef.current) {
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 7,
        color: '#0f172a',
        weight: 2,
        fillColor: '#0ea5e9',
        fillOpacity: 0.85,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }

    if (!ring.length) {
      map.setView([lat, lng], 16);
    }
  }, [latitude, longitude, ring.length]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-lg border border-slate-300"
      />
      <p className="text-xs text-slate-600">
        Click inside the geofence boundary to choose destination coordinates.
        {ring.length >= 4 ? '' : ' No geofence set — clicks anywhere are allowed.'}
      </p>
    </div>
  );
};
