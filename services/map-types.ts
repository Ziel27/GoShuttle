export type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export type GeoPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type LatLngPoint = {
  latitude: number;
  longitude: number;
};

export const toLatLngPoint = (coordinates: [number, number] | number[]): LatLngPoint | null => {
  const [longitude, latitude] = coordinates;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

export const toGeoPoint = (latitude: number, longitude: number): GeoPoint => ({
  type: 'Point',
  coordinates: [longitude, latitude],
});
