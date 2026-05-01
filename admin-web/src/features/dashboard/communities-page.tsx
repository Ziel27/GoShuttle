import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { GeofenceMap } from '@/features/dashboard/geofence-map';
import { LocationPickerMap } from '@/features/dashboard/location-picker-map';
import {
    archiveFixedDestination,
    archivePhaseGeofence,
    createFixedDestination,
    createPhaseGeofence,
    fetchCommunityById,
    fetchFixedDestinations,
    fetchPhaseGeofences,
    updateCommunity,
    updateFixedDestination,
    updatePhaseGeofence,
} from '@/lib/admin-api';
import { communityIdFromUnknown } from '@/lib/format';
import type { Community } from '@/types/domain';

type FixedDestination = NonNullable<Community['fixedDestinations']>[number];
type PhaseGeofence = NonNullable<Community['phaseGeofences']>[number];

const isValidLatitude = (value: number) => Number.isFinite(value) && value >= -90 && value <= 90;
const isValidLongitude = (value: number) => Number.isFinite(value) && value >= -180 && value <= 180;

/**
 * Ray-casting point-in-polygon test.
 * @param lat - latitude of the test point
 * @param lng - longitude of the test point
 * @param ring - closed ring in [lng, lat] (GeoJSON) order
 */
const isPointInsideRing = (lat: number, lng: number, ring: number[][]) => {
  if (ring.length < 4) return true; // No geofence — allow all

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

const parseLngLat = (point: unknown): [number, number] | null => {
  if (!Array.isArray(point) || point.length !== 2) return null;

  const lng = Number(point[0]);
  const lat = Number(point[1]);

  if (!isValidLongitude(lng) || !isValidLatitude(lat)) return null;
  return [lng, lat];
};

const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(String(value || '').trim());
const DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS = 80;

const parsePickupRadiusMeters = (value: string) => {
  if (!String(value || '').trim()) {
    return DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000) {
    return null;
  }

  return Math.round(parsed);
};

const isPhaseRingInsideCommunityRing = (phaseRing: number[][], communityRing: number[][]) =>
  phaseRing.every((point) => {
    const [lng, lat] = point;
    return isPointInsideRing(lat, lng, communityRing);
  });

const normalizeCoordinates = (value?: number[][][]) => {
  const ring = value?.[0] || [];

  const normalizedRing = ring
    .map((point) => parseLngLat(point))
    .filter((point): point is [number, number] => point !== null);

  if (normalizedRing.length < 3) return [];

  const [firstLng, firstLat] = normalizedRing[0];
  const [lastLng, lastLat] = normalizedRing[normalizedRing.length - 1];
  const isClosed = firstLng === lastLng && firstLat === lastLat;
  const closedRing = isClosed ? normalizedRing : [...normalizedRing, [firstLng, firstLat]];

  if (closedRing.length < 4) return [];

  return [closedRing];
};

export const CommunitiesPage = () => {
  const { user } = useAuth();
  const scopedCommunityId = communityIdFromUnknown(user?.communityId);

  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [communityNameInput, setCommunityNameInput] = useState('');
  const [baseFareInput, setBaseFareInput] = useState('0');
  const [priorityFareMultiplierInput, setPriorityFareMultiplierInput] = useState('1.5');
  const [saving, setSaving] = useState(false);

  const [coordinates, setCoordinates] = useState<number[][][]>([]);
  const [savedCoordinates, setSavedCoordinates] = useState<number[][][]>([]);
  const [destinations, setDestinations] = useState<FixedDestination[]>([]);
  const [destinationName, setDestinationName] = useState('');
  const [destinationLatitude, setDestinationLatitude] = useState('');
  const [destinationLongitude, setDestinationLongitude] = useState('');
  const [destinationPickupRadiusInput, setDestinationPickupRadiusInput] = useState('');
  const [destinationColorInput, setDestinationColorInput] = useState('#94a3b8');
  const [destinationInputMode, setDestinationInputMode] = useState<'manual' | 'map'>('manual');
  const [destinationSaving, setDestinationSaving] = useState(false);
  const [editingDestinationId, setEditingDestinationId] = useState('');
  const [editingDestinationName, setEditingDestinationName] = useState('');
  const [editingDestinationLatitude, setEditingDestinationLatitude] = useState('');
  const [editingDestinationLongitude, setEditingDestinationLongitude] = useState('');
  const [editingDestinationPickupRadiusInput, setEditingDestinationPickupRadiusInput] = useState(String(DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS));
  const [editingDestinationColor, setEditingDestinationColor] = useState('#94a3b8');
  const [destinationUpdating, setDestinationUpdating] = useState(false);
  const [phaseGeofences, setPhaseGeofences] = useState<PhaseGeofence[]>([]);
  const [phaseNameInput, setPhaseNameInput] = useState('');
  const [phaseColorInput, setPhaseColorInput] = useState('#6366f1');
  const [phaseCoordinates, setPhaseCoordinates] = useState<number[][][]>([]);
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState('');
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingPhaseColor, setEditingPhaseColor] = useState('#6366f1');
  const [editingPhaseCoordinates, setEditingPhaseCoordinates] = useState<number[][][]>([]);
  const [phaseUpdating, setPhaseUpdating] = useState(false);
  const fitCreatePhaseCommunityRef = useRef<(() => void) | null>(null);
  const fitEditPhaseCommunityRef = useRef<(() => void) | null>(null);
  const fitGeofenceRef = useRef<(() => void) | null>(null);

  const hasUnsavedGeofenceChanges = useMemo(
    () => JSON.stringify(normalizeCoordinates(coordinates)) !== JSON.stringify(normalizeCoordinates(savedCoordinates)),
    [coordinates, savedCoordinates]
  );

  const loadCommunitySettings = useCallback(async () => {
    if (!scopedCommunityId) {
      setCommunity(null);
      setCoordinates([]);
      setSavedCoordinates([]);
      setDestinations([]);
      setError('Admin account has no community assignment. Ask a platform admin to set your community.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const [communityRow, destinationRows, phaseRows] = await Promise.all([
        fetchCommunityById(scopedCommunityId),
        fetchFixedDestinations(scopedCommunityId),
        fetchPhaseGeofences(scopedCommunityId),
      ]);

      const normalized = normalizeCoordinates(communityRow.boundaries?.coordinates);
      setCommunity(communityRow);
      setCommunityNameInput(communityRow.name || '');
      setBaseFareInput(String(communityRow.baseFare ?? 0));
      setPriorityFareMultiplierInput(String(communityRow.priorityFareMultiplier ?? 1.5));
      setCoordinates(normalized);

      setSavedCoordinates(normalized);
      setDestinations(destinationRows.filter((item) => item.isActive !== false));
      setPhaseGeofences(phaseRows.filter((item) => item.isActive !== false));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load community details');
    } finally {
      setLoading(false);
    }
  }, [scopedCommunityId]);

  useEffect(() => {
    void loadCommunitySettings();
  }, [loadCommunitySettings]);

  const handleSave = async () => {
    if (!community || !scopedCommunityId) return;

    const parsedFare = Number(baseFareInput);
    const normalizedCommunityName = communityNameInput.trim();

    if (!normalizedCommunityName) {
      setError('Community name is required.');
      return;
    }

    if (!Number.isFinite(parsedFare) || parsedFare < 0) {
      setError('Base fare must be a valid non-negative number.');
      return;
    }

    const parsedMultiplier = Number(priorityFareMultiplierInput);
    if (!Number.isFinite(parsedMultiplier) || parsedMultiplier < 1.0 || parsedMultiplier > 10.0) {
      setError('Priority fare multiplier must be between 1.0 and 10.0.');
      return;
    }

    const normalized = normalizeCoordinates(coordinates);

    const normalizedDestinationName = destinationName.trim();
    const parsedDestinationRadius = parsePickupRadiusMeters(destinationPickupRadiusInput);
    const hasPendingDestinationDraft =
      normalizedDestinationName.length > 0 ||
      destinationLatitude.trim().length > 0 ||
      destinationLongitude.trim().length > 0;

    let destinationPayload: { name: string; latitude: number; longitude: number; pickupRadiusMeters: number; color?: string } | null = null;
    if (hasPendingDestinationDraft) {
      if (!normalizedDestinationName) {
        setError('Destination name is required when destination coordinates are provided.');
        return;
      }

      if (!destinationLatitude.trim() || !destinationLongitude.trim()) {
        setError('Latitude and longitude are required to save destination draft.');
        return;
      }

      const latitude = Number(destinationLatitude);
      const longitude = Number(destinationLongitude);
      if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
        setError('Latitude must be between -90 and 90, and longitude between -180 and 180.');
        return;
      }

      if (parsedDestinationRadius === null) {
        setError('Pickup radius must be between 1 and 10000 meters.');
        return;
      }

      destinationPayload = {
        name: normalizedDestinationName,
        latitude,
        longitude,
        pickupRadiusMeters: parsedDestinationRadius,
        color: destinationColorInput,
      };
    }

    setSaving(true);
    setDestinationSaving(Boolean(destinationPayload));
    setError('');
    setNotice('');
    try {
      const updated = await updateCommunity(scopedCommunityId, {
        name: normalizedCommunityName,
        baseFare: parsedFare,
        priorityFareMultiplier: parsedMultiplier,
        ...(normalized.length > 0
          ? {
            boundaries: {
              type: 'Polygon' as const,
              coordinates: normalized,
            },
          }
          : {}),
      });

      const updatedCoordinates = normalizeCoordinates(updated.boundaries?.coordinates || normalized);
      setCommunity(updated);
      setCommunityNameInput(updated.name || normalizedCommunityName);
      setBaseFareInput(String(updated.baseFare ?? parsedFare));
      setPriorityFareMultiplierInput(String(updated.priorityFareMultiplier ?? parsedMultiplier));
      setCoordinates(updatedCoordinates);
      setSavedCoordinates(updatedCoordinates);


      let destinationSaved = false;
      if (destinationPayload) {
        const created = await createFixedDestination(scopedCommunityId, destinationPayload);
        setDestinations((prev) => [...prev, created].sort((a, b) => (a.order || 0) - (b.order || 0)));
        setDestinationName('');
        setDestinationLatitude('');
        setDestinationLongitude('');
        setDestinationPickupRadiusInput('');
        setDestinationColorInput('#94a3b8');
        destinationSaved = true;
      }

      if (destinationSaved) {
        setNotice('Community settings and destination saved.');
      } else if (normalized.length > 0) {
        setNotice('Community settings saved.');
      } else {
        setNotice('Base fare saved. Draw and save a geofence to enforce boundaries.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save community settings');
    } finally {
      setSaving(false);
      setDestinationSaving(false);
    }
  };

  const handleArchiveDestination = async (destinationId: string) => {
    if (!scopedCommunityId) return;
    setError('');
    setNotice('');
    try {
      await archiveFixedDestination(scopedCommunityId, destinationId);
      setDestinations((prev) => prev.filter((item) => item._id !== destinationId));
      if (editingDestinationId === destinationId) {
        setEditingDestinationId('');
      }
      setNotice('Destination archived.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive destination');
    }
  };

  const startEditingDestination = (destination: FixedDestination) => {
    setEditingDestinationId(destination._id);
    setEditingDestinationName(destination.name);
    setEditingDestinationLatitude(String(destination.location.coordinates[1]));
    setEditingDestinationLongitude(String(destination.location.coordinates[0]));
    setEditingDestinationPickupRadiusInput(String(destination.pickupRadiusMeters ?? DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS));
    setEditingDestinationColor(destination.color || '#94a3b8');
    setError('');
    setNotice('');
  };

  const cancelEditingDestination = () => {
    setEditingDestinationId('');
    setEditingDestinationName('');
    setEditingDestinationLatitude('');
    setEditingDestinationLongitude('');
    setEditingDestinationPickupRadiusInput(String(DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS));
    setEditingDestinationColor('#94a3b8');
  };

  const handleUpdateDestination = async () => {
    if (!scopedCommunityId || !editingDestinationId) return;

    const normalizedName = editingDestinationName.trim();
    if (!normalizedName) {
      setError('Destination name is required.');
      return;
    }

    if (!editingDestinationLatitude.trim() || !editingDestinationLongitude.trim()) {
      setError('Latitude and longitude are required.');
      return;
    }

    const latitude = Number(editingDestinationLatitude);
    const longitude = Number(editingDestinationLongitude);
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180.');
      return;
    }

    const parsedRadius = parsePickupRadiusMeters(editingDestinationPickupRadiusInput);
    if (parsedRadius === null) {
      setError('Pickup radius must be between 1 and 10000 meters.');
      return;
    }

    setDestinationUpdating(true);
    setError('');
    setNotice('');
    try {
      const updated = await updateFixedDestination(scopedCommunityId, editingDestinationId, {
        name: normalizedName,
        latitude,
        longitude,
        pickupRadiusMeters: parsedRadius,
        color: editingDestinationColor,
      });

      setDestinations((prev) =>
        prev
          .map((item) => (item._id === updated._id ? updated : item))
          .sort((a, b) => (a.order || 0) - (b.order || 0))
      );
      cancelEditingDestination();
      setNotice('Destination updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update destination');
    } finally {
      setDestinationUpdating(false);
    }
  };

  const normalizedCoordinates = normalizeCoordinates(coordinates);
  const normalizedPhaseCoordinates = normalizeCoordinates(phaseCoordinates);
  const normalizedEditingPhaseCoordinates = normalizeCoordinates(editingPhaseCoordinates);
  const communityRing = normalizedCoordinates[0] || [];
  const createPhaseRing = normalizedPhaseCoordinates[0] || [];
  const editPhaseRing = normalizedEditingPhaseCoordinates[0] || [];
  const isCreatePhaseOutOfBounds =
    communityRing.length >= 4 &&
    createPhaseRing.length >= 4 &&
    !isPhaseRingInsideCommunityRing(createPhaseRing, communityRing);
  const isEditPhaseOutOfBounds =
    communityRing.length >= 4 &&
    editPhaseRing.length >= 4 &&
    !isPhaseRingInsideCommunityRing(editPhaseRing, communityRing);
  const phaseOverlayPolygons = phaseGeofences.map((phase) => ({
    name: phase.name,
    coordinates: phase.boundaries?.coordinates || [],
    color: phase.color || '#6366f1',
  }));
  const fixedDestinationOverlayPoints = destinations.map((dest) => ({
    name: dest.name,
    coordinates: dest.location.coordinates,
    color: dest.color || '#94a3b8',
    radius: dest.pickupRadiusMeters || DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS,
  }));

  const handleCreatePhase = async () => {
    if (!scopedCommunityId) return;
    const normalizedName = phaseNameInput.trim();
    if (!normalizedName) {
      setError('Phase name is required.');
      return;
    }
    if (!isHexColor(phaseColorInput)) {
      setError('Phase color must be a valid hex color (e.g. #22c55e).');
      return;
    }
    if (!normalizedPhaseCoordinates.length) {
      setError('Draw a phase geofence before saving.');
      return;
    }
    if (communityRing.length < 4) {
      setError('Save the community geofence first before adding phase geofences.');
      return;
    }
    if (isCreatePhaseOutOfBounds) {
      setError('Phase geofence must stay strictly inside the community geofence.');
      return;
    }

    setPhaseSaving(true);
    setError('');
    setNotice('');
    try {
      const created = await createPhaseGeofence(scopedCommunityId, {
        name: normalizedName,
        color: phaseColorInput,
        boundaries: {
          type: 'Polygon',
          coordinates: normalizedPhaseCoordinates,
        },
      });
      setPhaseGeofences((prev) => [...prev, created].sort((a, b) => (a.order || 0) - (b.order || 0)));
      setPhaseNameInput('');
      setPhaseColorInput('#6366f1');
      setPhaseCoordinates([]);
      setNotice('Phase geofence added.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add phase geofence');
    } finally {
      setPhaseSaving(false);
    }
  };

  const startEditingPhase = (phase: PhaseGeofence) => {
    setEditingPhaseId(phase._id);
    setEditingPhaseName(phase.name);
    setEditingPhaseColor(phase.color || '#6366f1');
    setEditingPhaseCoordinates(normalizeCoordinates(phase.boundaries?.coordinates || []));
    setError('');
    setNotice('');
  };

  const cancelEditingPhase = () => {
    setEditingPhaseId('');
    setEditingPhaseName('');
    setEditingPhaseColor('#6366f1');
    setEditingPhaseCoordinates([]);
  };

  const handleUpdatePhase = async () => {
    if (!scopedCommunityId || !editingPhaseId) return;
    const normalizedName = editingPhaseName.trim();
    if (!normalizedName) {
      setError('Phase name is required.');
      return;
    }
    if (!isHexColor(editingPhaseColor)) {
      setError('Phase color must be a valid hex color (e.g. #22c55e).');
      return;
    }
    if (!normalizedEditingPhaseCoordinates.length) {
      setError('Phase geofence cannot be empty.');
      return;
    }
    if (communityRing.length < 4) {
      setError('Save the community geofence first before updating phase geofences.');
      return;
    }
    if (isEditPhaseOutOfBounds) {
      setError('Phase geofence must stay strictly inside the community geofence.');
      return;
    }

    setPhaseUpdating(true);
    setError('');
    setNotice('');
    try {
      const updated = await updatePhaseGeofence(scopedCommunityId, editingPhaseId, {
        name: normalizedName,
        color: editingPhaseColor,
        boundaries: {
          type: 'Polygon',
          coordinates: normalizedEditingPhaseCoordinates,
        },
      });
      setPhaseGeofences((prev) =>
        prev.map((item) => (item._id === updated._id ? updated : item)).sort((a, b) => (a.order || 0) - (b.order || 0))
      );
      cancelEditingPhase();
      setNotice('Phase geofence updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update phase geofence');
    } finally {
      setPhaseUpdating(false);
    }
  };

  const handleArchivePhase = async (phaseId: string) => {
    if (!scopedCommunityId) return;
    setError('');
    setNotice('');
    try {
      await archivePhaseGeofence(scopedCommunityId, phaseId);
      setPhaseGeofences((prev) => prev.filter((item) => item._id !== phaseId));
      if (editingPhaseId === phaseId) cancelEditingPhase();
      setNotice('Phase geofence archived.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive phase geofence');
    }
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-slate-900">Community Control</CardTitle>
          <p className="text-sm text-slate-500">
            Manage fare, geofence, and fixed destinations for {community?.name || 'your assigned community'}.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadCommunitySettings()} disabled={loading || saving || destinationSaving || destinationUpdating}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : !community ? (
          <p className="text-sm text-slate-500">No community assignment found for this admin account.</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <Label htmlFor="communityName" className="text-sm font-medium text-slate-900">Community Name</Label>
                <Input
                  id="communityName"
                  value={communityNameInput}
                  onChange={(event) => setCommunityNameInput(event.target.value)}
                  placeholder="Community name"
                  className="mt-2 h-8"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="baseFare" className="text-sm font-medium text-slate-900">Base Fare (₱)</Label>
                <Input
                  id="baseFare"
                  type="number"
                  min="0"
                  step="0.01"
                  value={baseFareInput}
                  onChange={(e) => setBaseFareInput(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>

            {/* Priority Fare Section */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">⚡ Priority Fare</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Passengers can pay extra to skip the waiting queue. Priority requests also displace standard
                  pending pickups when no free slot is available.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 items-end">
                <div className="space-y-2">
                  <Label htmlFor="priorityFareMultiplier" className="text-sm font-medium text-amber-900">
                    Priority Multiplier (×)
                  </Label>
                  <Input
                    id="priorityFareMultiplier"
                    type="number"
                    min="1.0"
                    max="10.0"
                    step="0.1"
                    value={priorityFareMultiplierInput}
                    onChange={(e) => setPriorityFareMultiplierInput(e.target.value)}
                    className="h-8 border-amber-300 focus:border-amber-500"
                  />
                  <p className="text-xs text-amber-600">Range: 1.0 – 10.0</p>
                </div>
                <div className="rounded-lg border border-amber-300 bg-white px-4 py-3">
                  <p className="text-xs text-slate-500">Priority fare preview</p>
                  <p className="text-lg font-bold text-amber-800">
                    ₱{
                      (() => {
                        const base = Number(baseFareInput);
                        const mult = Number(priorityFareMultiplierInput);
                        if (!Number.isFinite(base) || !Number.isFinite(mult) || mult < 1) return '—';
                        return (base * mult).toFixed(2);
                      })()
                    }
                  </p>
                  <p className="text-xs text-slate-400">
                    = ₱{Number(baseFareInput) || 0} × {Number(priorityFareMultiplierInput) || '?'}
                  </p>
                </div>
              </div>
            </div>


            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">Geofence Boundary Map</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fitGeofenceRef.current?.()}
                    disabled={!normalizedCoordinates.length}
                  >
                    Go to Geofence
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCoordinates(savedCoordinates)}
                    disabled={!hasUnsavedGeofenceChanges}
                  >
                    Reset to saved geofence
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200">
                <GeofenceMap
                  coordinates={coordinates}
                  overlayPolygons={phaseOverlayPolygons}
                  overlayPoints={fixedDestinationOverlayPoints}
                  onChange={(nextCoordinates) => setCoordinates(normalizeCoordinates(nextCoordinates))}
                  onMapReady={(controls) => {
                    fitGeofenceRef.current = controls.fitGeofence;
                  }}
                />
              </div>
              {!normalizedCoordinates.length ? (
                <p className="text-xs text-amber-700">
                  No geofence currently saved. Draw a polygon or rectangle and click Save Changes.
                </p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Fixed Destinations</p>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  placeholder="Destination name"
                  value={destinationName}
                  onChange={(e) => setDestinationName(e.target.value)}
                />
                <Input
                  type="color"
                  value={destinationColorInput}
                  onChange={(e) => setDestinationColorInput(e.target.value)}
                  aria-label="Destination color picker"
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  placeholder="Pickup radius (meters)"
                  value={destinationPickupRadiusInput}
                  onChange={(e) => setDestinationPickupRadiusInput(e.target.value)}
                />
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  Passengers can request pickup from within this radius. Fixed destinations may be placed outside the community boundary.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={destinationInputMode === 'map' ? 'default' : 'outline'}
                  onClick={() => setDestinationInputMode('map')}
                >
                  Pick on map
                </Button>
                <Button
                  size="sm"
                  variant={destinationInputMode === 'manual' ? 'default' : 'outline'}
                  onClick={() => setDestinationInputMode('manual')}
                >
                  Coordinates
                </Button>
              </div>

              {destinationInputMode === 'manual' ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Latitude"
                    value={destinationLatitude}
                    onChange={(e) => setDestinationLatitude(e.target.value)}
                  />
                  <Input
                    placeholder="Longitude"
                    value={destinationLongitude}
                    onChange={(e) => setDestinationLongitude(e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <LocationPickerMap
                    latitude={Number.isFinite(Number(destinationLatitude)) ? Number(destinationLatitude) : null}
                    longitude={Number.isFinite(Number(destinationLongitude)) ? Number(destinationLongitude) : null}
                    geofenceCoordinates={normalizeCoordinates(coordinates)}
                    onPick={(latitude, longitude) => {
                      setDestinationLatitude(String(Number(latitude.toFixed(6))));
                      setDestinationLongitude(String(Number(longitude.toFixed(6))));
                    }}
                  />
                  <p className="text-xs text-slate-600">
                    Selected point: {destinationLatitude || '-'}, {destinationLongitude || '-'}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {destinations.length === 0 ? (
                  <p className="text-sm text-slate-500">No fixed destinations yet.</p>
                ) : (
                  destinations.map((destination) => (
                    <div key={destination._id} className="space-y-2 rounded border border-slate-200 bg-white p-3">
                      {editingDestinationId === destination._id ? (
                        <>
                            <div className="grid gap-2 md:grid-cols-5">
                            <Input
                              value={editingDestinationName}
                              onChange={(event) => setEditingDestinationName(event.target.value)}
                              placeholder="Destination name"
                            />
                            <Input
                              type="color"
                              value={editingDestinationColor}
                              onChange={(event) => setEditingDestinationColor(event.target.value)}
                              aria-label="Edit destination color picker"
                            />
                            <Input
                              value={editingDestinationLatitude}
                              onChange={(event) => setEditingDestinationLatitude(event.target.value)}
                              placeholder="Latitude"
                            />
                            <Input
                              value={editingDestinationLongitude}
                              onChange={(event) => setEditingDestinationLongitude(event.target.value)}
                              placeholder="Longitude"
                            />
                            <Input
                              type="number"
                              min="1"
                              max="10000"
                              step="1"
                              value={editingDestinationPickupRadiusInput}
                              onChange={(event) => setEditingDestinationPickupRadiusInput(event.target.value)}
                              placeholder="Pickup radius (m)"
                            />
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={cancelEditingDestination}
                              disabled={destinationUpdating}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={() => void handleUpdateDestination()}
                              disabled={destinationUpdating}
                            >
                              {destinationUpdating ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-start gap-2">
                            <span
                              className="mt-1 inline-block h-3 w-3 rounded-full border border-slate-300 flex-shrink-0"
                              style={{ backgroundColor: destination.color || '#94a3b8' }}
                            />
                            <div>
                              <p className="text-sm font-medium text-slate-900">{destination.name}</p>
                            <p className="text-xs text-slate-500">
                              {destination.location.coordinates[1]}, {destination.location.coordinates[0]}
                            </p>
                            <p className="text-xs text-slate-500">
                              Pickup radius: {destination.pickupRadiusMeters ?? DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS} m
                            </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => startEditingDestination(destination)}>
                              Edit
                            </Button>
                            <Button variant="outline" onClick={() => void handleArchiveDestination(destination._id)}>
                              Archive
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-sm font-medium text-slate-900">Phase Geofences</p>
              <p className="text-xs text-slate-600">
                Draw each phase inside the community geofence. Each phase can use a different color for mobile map display.
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  placeholder="Phase name (e.g. phase_1)"
                  value={phaseNameInput}
                  onChange={(e) => setPhaseNameInput(e.target.value)}
                />
                <Input
                  type="color"
                  value={phaseColorInput}
                  onChange={(e) => setPhaseColorInput(e.target.value)}
                  aria-label="Phase color picker"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <GeofenceMap
                  coordinates={phaseCoordinates}
                  referenceCoordinates={normalizedCoordinates}
                  overlayPolygons={phaseOverlayPolygons}
                  overlayPoints={fixedDestinationOverlayPoints}
                  onChange={(nextCoordinates) => setPhaseCoordinates(normalizeCoordinates(nextCoordinates))}
                  onMapReady={(controls) => {
                    fitCreatePhaseCommunityRef.current = controls.fitReference;
                  }}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fitCreatePhaseCommunityRef.current?.()}
                  disabled={!normalizedCoordinates.length}
                >
                  Go to Community Geofence
                </Button>
              </div>
              {isCreatePhaseOutOfBounds ? (
                <p className="text-xs text-destructive">
                  Phase geofence is outside the community boundary. Move it fully inside before saving.
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button onClick={() => void handleCreatePhase()} disabled={phaseSaving || isCreatePhaseOutOfBounds}>
                  {phaseSaving ? 'Saving phase...' : 'Add Phase Geofence'}
                </Button>
              </div>

              <div className="space-y-2">
                {phaseGeofences.length === 0 ? (
                  <p className="text-sm text-slate-500">No phase geofences yet.</p>
                ) : (
                  phaseGeofences.map((phase) => (
                    <div key={phase._id} className="space-y-2 rounded border border-slate-200 bg-white p-3">
                      {editingPhaseId === phase._id ? (
                        <>
                          <div className="grid gap-2 md:grid-cols-2">
                            <Input
                              value={editingPhaseName}
                              onChange={(event) => setEditingPhaseName(event.target.value)}
                              placeholder="Phase name"
                            />
                            <Input
                              type="color"
                              value={editingPhaseColor}
                              onChange={(event) => setEditingPhaseColor(event.target.value)}
                              aria-label="Edit phase color picker"
                            />
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white p-2">
                            <GeofenceMap
                              coordinates={editingPhaseCoordinates}
                              referenceCoordinates={normalizedCoordinates}
                              overlayPolygons={phaseOverlayPolygons}
                              overlayPoints={fixedDestinationOverlayPoints}
                              onChange={(nextCoordinates) => setEditingPhaseCoordinates(normalizeCoordinates(nextCoordinates))}
                              onMapReady={(controls) => {
                                fitEditPhaseCommunityRef.current = controls.fitReference;
                              }}
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => fitEditPhaseCommunityRef.current?.()}
                              disabled={!normalizedCoordinates.length}
                            >
                              Go to Community Geofence
                            </Button>
                          </div>
                          {isEditPhaseOutOfBounds ? (
                            <p className="text-xs text-destructive">
                              Phase geofence is outside the community boundary. Move it fully inside before saving.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="outline" onClick={cancelEditingPhase} disabled={phaseUpdating}>
                              Cancel
                            </Button>
                            <Button onClick={() => void handleUpdatePhase()} disabled={phaseUpdating || isEditPhaseOutOfBounds}>
                              {phaseUpdating ? 'Saving...' : 'Save'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full border border-slate-300"
                              style={{ backgroundColor: phase.color || '#6366f1' }}
                            />
                            <p className="text-sm font-medium text-slate-900">{phase.name}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={() => startEditingPhase(phase)}>
                              Edit
                            </Button>
                            <Button variant="outline" onClick={() => void handleArchivePhase(phase._id)}>
                              Archive
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || destinationSaving || destinationUpdating || phaseSaving || phaseUpdating}
              className="w-full"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
