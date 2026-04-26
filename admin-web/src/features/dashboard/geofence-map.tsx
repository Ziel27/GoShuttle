import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type GeofenceMapProps = {
  coordinates: number[][][];
  onChange: (coordinates: number[][][]) => void;
  /** Optional read-only polygon shown as a visual guide (e.g. community boundary). */
  referenceCoordinates?: number[][][];
  /** Optional read-only overlays (e.g. saved phase geofences). */
  overlayPolygons?: Array<{
    name?: string;
    coordinates: number[][][];
    color?: string;
  }>;
  /** Exposed so the parent can programmatically fit the map to the geofence. */
  onMapReady?: (controls: { fitGeofence: () => void; fitReference: () => void }) => void;
};

const DEFAULT_CENTER: [number, number] = [14.55, 121.03];

const isValidLngLatPair = (lng: unknown, lat: unknown) =>
  Number.isFinite(Number(lng)) &&
  Number.isFinite(Number(lat)) &&
  Number(lng) >= -180 &&
  Number(lng) <= 180 &&
  Number(lat) >= -90 &&
  Number(lat) <= 90;

const isSamePoint = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

const toClosedRing = (ring: [number, number][]) => {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return isSamePoint(first, last) ? ring : [...ring, first];
};

const normalizeCoordinates = (value: number[][][]) => {
  const ring = value?.[0] || [];

  const normalizedRing = ring
    .filter((point) => Array.isArray(point) && point.length === 2 && isValidLngLatPair(point[0], point[1]))
    .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number]);

  const closedRing = toClosedRing(normalizedRing);
  if (closedRing.length < 4) return [];

  return [closedRing];
};

const serializeCoordinates = (value: number[][][]) => JSON.stringify(normalizeCoordinates(value));

const isLatLngPoint = (value: unknown): value is { lat: number; lng: number } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { lat?: unknown; lng?: unknown };
  return typeof candidate.lat === 'number' && typeof candidate.lng === 'number';
};

const getFirstRing = (latLngs: unknown): unknown[] => {
  if (!Array.isArray(latLngs) || latLngs.length === 0) return [];
  if (isLatLngPoint(latLngs[0])) return latLngs;
  return getFirstRing(latLngs[0]);
};

const ringFromLayer = (layer: L.Polygon): [number, number][] => {
  const ringSource = getFirstRing(layer.getLatLngs());
  const ringPoints: [number, number][] = [];

  for (const point of ringSource) {
    if (isLatLngPoint(point)) {
      if (isValidLngLatPair(point.lng, point.lat)) {
        ringPoints.push([point.lng, point.lat]);
      }
    }
  }

  return toClosedRing(ringPoints);
};

const layerToCoordinates = (layer: L.Layer): number[][][] | null => {
  if (!(layer instanceof L.Polygon)) return null;

  const ring = ringFromLayer(layer);
  if (ring.length < 4) return null;

  return [ring];
};

const isAxisAlignedRectangleRing = (ring: number[][]) => {
  if (ring.length !== 5) return false;

  const lngSet = new Set<number>();
  const latSet = new Set<number>();
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2) return false;
    lngSet.add(point[0]);
    latSet.add(point[1]);
  }

  return lngSet.size === 2 && latSet.size === 2;
};

const createLayerFromCoordinates = (ring: number[][]) => {
  const validRing = ring
    .filter((point) => Array.isArray(point) && point.length === 2 && isValidLngLatPair(point[0], point[1]))
    .map(([lng, lat]) => [Number(lng), Number(lat)] as [number, number]);

  const closedRing = toClosedRing(validRing);
  if (closedRing.length < 4) return null;

  const latLngs = closedRing.map(([lng, lat]) => [lat, lng] as [number, number]);

  if (isAxisAlignedRectangleRing(closedRing)) {
    const bounds = L.latLngBounds(latLngs);
    return L.rectangle(bounds, {
      color: '#0f172a',
      weight: 2,
      fillColor: '#94a3b8',
      fillOpacity: 0.25,
    });
  }

  return L.polygon(latLngs, {
    color: '#0f172a',
    weight: 2,
    fillColor: '#94a3b8',
    fillOpacity: 0.25,
  });
};

type GeomanLayer = L.Layer & { pm?: { enable: (options?: Record<string, unknown>) => void } };
type GeomanMap = L.Map & {
  pm: {
    addControls: (options: Record<string, unknown>) => void;
    setGlobalOptions: (options: Record<string, unknown>) => void;
  };
};

let geomanLoadPromise: Promise<void> | null = null;

const ensureGeomanLoaded = () => {
  if (!geomanLoadPromise) {
    geomanLoadPromise = (async () => {
      (globalThis as { L?: typeof L }).L = L;
      await import('@geoman-io/leaflet-geoman-free');
    })();
  }

  return geomanLoadPromise;
};

const enableLayerEditing = (layer: L.Layer) => {
  const draggableLayer = layer as L.Layer & {
    options?: { interactive?: boolean };
  };

  if (draggableLayer.options) {
    draggableLayer.options.interactive = true;
  }

  const pmLayer = layer as GeomanLayer;
  pmLayer.pm?.enable?.({
    draggable: true,
    snappable: true,
    allowSelfIntersection: false,
  });
};

export const GeofenceMap = ({ coordinates, onChange, referenceCoordinates, overlayPolygons, onMapReady }: GeofenceMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const referenceLayerRef = useRef<L.Polygon | null>(null);
  const overlayLayersRef = useRef<L.Layer[]>([]);
  const lastLocalSerializedRef = useRef('');
  const replacingLayerRef = useRef(false);

  // Track when the map has finished async initialization so the sync effect re-runs
  const [mapReady, setMapReady] = useState(false);

  // Stable ref for onChange to prevent map re-initialization
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const onMapReadyRef = useRef(onMapReady);
  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  const normalizedCoordinates = useMemo(() => normalizeCoordinates(coordinates), [coordinates]);
  const normalizedReferenceCoordinates = useMemo(
    () => normalizeCoordinates(referenceCoordinates || []),
    [referenceCoordinates]
  );
  const normalizedOverlayPolygons = useMemo(
    () =>
      (overlayPolygons || []).map((item) => ({
        name: item.name || '',
        color: item.color || '#6366f1',
        coordinates: normalizeCoordinates(item.coordinates),
      })),
    [overlayPolygons]
  );
  const serializedCoordinates = useMemo(() => serializeCoordinates(normalizedCoordinates), [normalizedCoordinates]);
  const latestSerializedRef = useRef(serializedCoordinates);

  useEffect(() => {
    latestSerializedRef.current = serializedCoordinates;
  }, [serializedCoordinates]);

  const syncLayerToCoordinates = useCallback((layer: L.Layer) => {
    const parsed = layerToCoordinates(layer);
    if (!parsed) return;

    const nextSerialized = serializeCoordinates(parsed);
    if (nextSerialized === latestSerializedRef.current) return;

    lastLocalSerializedRef.current = nextSerialized;
    onChangeRef.current(parsed);
  }, []);

  const endReplacementCycle = useCallback(() => {
    queueMicrotask(() => {
      replacingLayerRef.current = false;
    });
  }, []);

  const bindLayerEvents = useCallback((layer: L.Layer) => {
    enableLayerEditing(layer);

    layer.on('pm:dragend', () => syncLayerToCoordinates(layer));
    layer.on('pm:edit', () => syncLayerToCoordinates(layer));
    layer.on('pm:update', () => syncLayerToCoordinates(layer));
    layer.on('pm:remove', () => {
      if (replacingLayerRef.current) return;
      onChangeRef.current([]);
    });
  }, [syncLayerToCoordinates]);

  // Initialize the map only once
  useEffect(() => {
    let cancelled = false;
    let map: L.Map | null = null;
    let onResize: (() => void) | null = null;

    const init = async () => {
      if (!containerRef.current || mapRef.current) return;

      await ensureGeomanLoaded();
      if (cancelled || !containerRef.current || mapRef.current) return;

      map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView(DEFAULT_CENTER, 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const drawnItems = new L.FeatureGroup();
      drawnItems.addTo(map);

      const pmMap = map as GeomanMap;
      pmMap.pm.setGlobalOptions({
        snappable: true,
        continueDrawing: false,
      });

      pmMap.pm.addControls({
        position: 'topright',
        drawPolygon: true,
        drawRectangle: true,
        drawCircle: false,
        drawCircleMarker: false,
        drawMarker: false,
        drawPolyline: false,
        editMode: true,
        dragMode: true,
        cutPolygon: false,
        removalMode: true,
        rotateMode: false,
      });

      map.on('pm:create', (event) => {
        const createdLayer = (event as { layer?: L.Layer }).layer;
        if (!createdLayer) return;

        replacingLayerRef.current = true;

        // Remove all existing layers except the newly created one
        drawnItems.getLayers().forEach((layer) => {
          if (layer !== createdLayer) {
            drawnItems.removeLayer(layer);
          }
        });

        drawnItems.addLayer(createdLayer);

        // Enable editing on the newly created layer
        enableLayerEditing(createdLayer);

        // Bind events to persist edits/drags/removals
        createdLayer.on('pm:dragend', () => {
          const parsed = layerToCoordinates(createdLayer);
          if (!parsed) return;
          const nextSerialized = serializeCoordinates(parsed);
          if (nextSerialized === latestSerializedRef.current) return;
          lastLocalSerializedRef.current = nextSerialized;
          onChangeRef.current(parsed);
        });
        createdLayer.on('pm:edit', () => {
          const parsed = layerToCoordinates(createdLayer);
          if (!parsed) return;
          const nextSerialized = serializeCoordinates(parsed);
          if (nextSerialized === latestSerializedRef.current) return;
          lastLocalSerializedRef.current = nextSerialized;
          onChangeRef.current(parsed);
        });
        createdLayer.on('pm:update', () => {
          const parsed = layerToCoordinates(createdLayer);
          if (!parsed) return;
          const nextSerialized = serializeCoordinates(parsed);
          if (nextSerialized === latestSerializedRef.current) return;
          lastLocalSerializedRef.current = nextSerialized;
          onChangeRef.current(parsed);
        });
        createdLayer.on('pm:remove', () => {
          if (replacingLayerRef.current) return;
          onChangeRef.current([]);
        });

        // Sync the new shape to state
        const parsed = layerToCoordinates(createdLayer);
        if (parsed) {
          const nextSerialized = serializeCoordinates(parsed);
          lastLocalSerializedRef.current = nextSerialized;
          onChangeRef.current(parsed);
        }

        queueMicrotask(() => {
          replacingLayerRef.current = false;
        });
      });

      mapRef.current = map;
      drawnItemsRef.current = drawnItems;

      map.whenReady(() => {
        map?.invalidateSize();
      });

      if (typeof window !== 'undefined') {
        onResize = () => {
          map?.invalidateSize();
        };
        window.addEventListener('resize', onResize);
      }

      // Expose fit-to-geofence control to parent
      const fitReference = () => {
        const m = mapRef.current;
        const reference = referenceLayerRef.current;
        if (!m || !reference) return;
        const bounds = reference.getBounds();
        if (bounds.isValid()) {
          m.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
        }
      };

      onMapReadyRef.current?.({
        fitGeofence: () => {
          const items = drawnItemsRef.current;
          const m = mapRef.current;
          if (!items || !m) return;
          const layers = items.getLayers();
          if (layers.length === 0) return;
          const bounds = items.getBounds();
          if (bounds.isValid()) {
            m.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
          }
        },
        fitReference,
      });

      // Signal that the map is ready so the sync effect re-runs
      setMapReady(true);
    };

    void init();

    return () => {
      cancelled = true;
      if (onResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
      map?.remove();
      mapRef.current = null;
      drawnItemsRef.current = null;
      referenceLayerRef.current = null;
      overlayLayersRef.current = [];
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external coordinate changes to the map layers.
  // `mapReady` ensures this re-runs after async map init completes.
  useEffect(() => {
    if (!mapReady) return;

    const map = mapRef.current;
    const drawnItems = drawnItemsRef.current;
    if (!map || !drawnItems) return;

    if (serializedCoordinates === lastLocalSerializedRef.current) {
      return;
    }

    replacingLayerRef.current = true;
    drawnItems.clearLayers();

    const firstRing = normalizedCoordinates[0];
    if (!firstRing || firstRing.length < 4) {
      endReplacementCycle();
      return;
    }

    const shapeLayer = createLayerFromCoordinates(firstRing);
    if (!shapeLayer) {
      endReplacementCycle();
      return;
    }

    drawnItems.addLayer(shapeLayer);
    bindLayerEvents(shapeLayer);

    const bounds = shapeLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    }
    endReplacementCycle();
  }, [mapReady, bindLayerEvents, endReplacementCycle, normalizedCoordinates, serializedCoordinates]);

  useEffect(() => {
    if (!mapReady) return;

    const map = mapRef.current;
    if (!map) return;

    if (referenceLayerRef.current) {
      map.removeLayer(referenceLayerRef.current);
      referenceLayerRef.current = null;
    }

    const firstRing = normalizedReferenceCoordinates[0];
    if (!firstRing || firstRing.length < 4) return;

    const latLngs = firstRing.map(([lng, lat]) => [lat, lng] as [number, number]);
    const referenceLayer = L.polygon(latLngs, {
      color: '#000000',
      weight: 2,
      fillColor: '#000000',
      fillOpacity: 0.04,
      interactive: false,
    });
    referenceLayer.addTo(map);
    referenceLayerRef.current = referenceLayer;

    const bounds = referenceLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    }
  }, [mapReady, normalizedReferenceCoordinates]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    overlayLayersRef.current.forEach((layer) => map.removeLayer(layer));
    overlayLayersRef.current = [];

    normalizedOverlayPolygons.forEach((item) => {
      const ring = item.coordinates[0];
      if (!ring || ring.length < 4) return;
      const latLngs = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
      const polygon = L.polygon(latLngs, {
        color: item.color,
        weight: 2,
        fillColor: item.color,
        fillOpacity: 0.12,
        interactive: false,
      });
      polygon.addTo(map);
      overlayLayersRef.current.push(polygon);

      if (item.name) {
        const safeColor = /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#6366f1';
        const label = L.tooltip({
          permanent: true,
          direction: 'top',
          offset: [0, -8],
          className: 'phase-geofence-label',
        })
          .setLatLng(polygon.getBounds().getCenter())
          .setContent(
            `<span class="phase-geofence-label__dot" style="background:${safeColor};"></span>${item.name.replace(/_/g, ' ')}`
          );
        label.addTo(map);
        overlayLayersRef.current.push(label);
      }
    });
  }, [mapReady, normalizedOverlayPolygons]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-[28rem] w-full overflow-hidden rounded-xl border border-slate-300 md:h-[34rem]"
      />
      <p className="text-xs text-slate-600">
        Draw a polygon or rectangle to define the geofence. Only one shape is saved per community.
      </p>
      <style>
        {`.phase-geofence-label {
          background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%);
          border: 1px solid rgba(15,23,42,0.18);
          border-radius: 9999px;
          color: #0f172a;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.2px;
          text-transform: capitalize;
          padding: 4px 10px;
          box-shadow: 0 2px 8px rgba(15,23,42,0.18);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          backdrop-filter: blur(2px);
        }
        .phase-geofence-label:before {
          display: none;
        }
        .phase-geofence-label__dot {
          width: 8px;
          height: 8px;
          border-radius: 9999px;
          display: inline-block;
          border: 1px solid rgba(15,23,42,0.22);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.9);
          flex-shrink: 0;
        }`}
      </style>
    </div>
  );
};
