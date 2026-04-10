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
    createFixedDestination,
    fetchCommunityById,
    fetchFixedDestinations,
    updateCommunity,
    updateFixedDestination,
} from '@/lib/admin-api';
import { communityIdFromUnknown } from '@/lib/format';
import type { Community } from '@/types/domain';

type FixedDestination = NonNullable<Community['fixedDestinations']>[number];

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
  const [saving, setSaving] = useState(false);
  const [coordinates, setCoordinates] = useState<number[][][]>([]);
  const [savedCoordinates, setSavedCoordinates] = useState<number[][][]>([]);
  const [destinations, setDestinations] = useState<FixedDestination[]>([]);
  const [destinationName, setDestinationName] = useState('');
  const [destinationLatitude, setDestinationLatitude] = useState('');
  const [destinationLongitude, setDestinationLongitude] = useState('');
  const [destinationInputMode, setDestinationInputMode] = useState<'manual' | 'map'>('manual');
  const [destinationSaving, setDestinationSaving] = useState(false);
  const [editingDestinationId, setEditingDestinationId] = useState('');
  const [editingDestinationName, setEditingDestinationName] = useState('');
  const [editingDestinationLatitude, setEditingDestinationLatitude] = useState('');
  const [editingDestinationLongitude, setEditingDestinationLongitude] = useState('');
  const [destinationUpdating, setDestinationUpdating] = useState(false);
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
      const [communityRow, destinationRows] = await Promise.all([
        fetchCommunityById(scopedCommunityId),
        fetchFixedDestinations(scopedCommunityId),
      ]);

      const normalized = normalizeCoordinates(communityRow.boundaries?.coordinates);
      setCommunity(communityRow);
      setCommunityNameInput(communityRow.name || '');
      setBaseFareInput(String(communityRow.baseFare ?? 0));
      setCoordinates(normalized);
      setSavedCoordinates(normalized);
      setDestinations(destinationRows.filter((item) => item.isActive !== false));
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

    const normalized = normalizeCoordinates(coordinates);

    const normalizedDestinationName = destinationName.trim();
    const hasPendingDestinationDraft =
      normalizedDestinationName.length > 0 ||
      destinationLatitude.trim().length > 0 ||
      destinationLongitude.trim().length > 0;

    let destinationPayload: { name: string; latitude: number; longitude: number } | null = null;
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

      // Validate destination is inside the geofence
      const geofenceRing = normalized[0] || [];
      if (geofenceRing.length >= 4 && !isPointInsideRing(latitude, longitude, geofenceRing)) {
        setError('Destination must be inside the geofence boundary.');
        return;
      }

      destinationPayload = {
        name: normalizedDestinationName,
        latitude,
        longitude,
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
      setCoordinates(updatedCoordinates);
      setSavedCoordinates(updatedCoordinates);

      let destinationSaved = false;
      if (destinationPayload) {
        const created = await createFixedDestination(scopedCommunityId, destinationPayload);
        setDestinations((prev) => [...prev, created].sort((a, b) => (a.order || 0) - (b.order || 0)));
        setDestinationName('');
        setDestinationLatitude('');
        setDestinationLongitude('');
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
    setError('');
    setNotice('');
  };

  const cancelEditingDestination = () => {
    setEditingDestinationId('');
    setEditingDestinationName('');
    setEditingDestinationLatitude('');
    setEditingDestinationLongitude('');
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

    // Validate destination is inside the geofence
    const geofenceRing = normalizedCoordinates[0] || [];
    if (geofenceRing.length >= 4 && !isPointInsideRing(latitude, longitude, geofenceRing)) {
      setError('Destination must be inside the geofence boundary.');
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
              <div className="grid gap-2 md:grid-cols-1">
                <Input
                  placeholder="Destination name"
                  value={destinationName}
                  onChange={(e) => setDestinationName(e.target.value)}
                />
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
                          <div className="grid gap-2 md:grid-cols-3">
                            <Input
                              value={editingDestinationName}
                              onChange={(event) => setEditingDestinationName(event.target.value)}
                              placeholder="Destination name"
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
                          <div>
                            <p className="text-sm font-medium text-slate-900">{destination.name}</p>
                            <p className="text-xs text-slate-500">
                              {destination.location.coordinates[1]}, {destination.location.coordinates[0]}
                            </p>
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

            <Button
              onClick={handleSave}
              disabled={saving || destinationSaving || destinationUpdating}
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
