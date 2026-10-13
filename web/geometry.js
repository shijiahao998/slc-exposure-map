// Geographic calculations use metres, spherical great-circle distance, for static point-radius queries.
export const MILE_METERS = 1609.344;
const R = 6371008.8;
const rad = x => (x * Math.PI) / 180;
const deg = x => (x * 180) / Math.PI;

export function distanceMeters(a, b) {
  const dlat = rad(b[1] - a[1]),
    dlon = rad(b[0] - a[0]);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function circleFeature(center, miles, steps = 128) {
  const lat = rad(center[1]),
    lon = rad(center[0]),
    d = (miles * MILE_METERS) / R;
  const points = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const la = Math.asin(
      Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(bearing)
    );
    const lo =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(lat),
        Math.cos(d) - Math.sin(lat) * Math.sin(la)
      );
    points.push([deg(lo), deg(la)]);
  }
  points.push([...points[0]]);
  return {
    type: 'Feature',
    properties: { miles },
    geometry: { type: 'Polygon', coordinates: [points] },
  };
}

