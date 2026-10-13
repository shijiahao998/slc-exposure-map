// Display-only rail union. Original GTFS features and bus geometries are untouched.
// Match parallel overlapping segments within 3 m, even with different vertex spacing.
const TOLERANCE = 3;
const CELL = 100;
const EPSILON = 0.01;
const RADIANS = Math.PI / 180;
const SCALE = 6371008.8 * RADIANS;
const X_SCALE = SCALE * Math.cos(40.7 * RADIANS);
const project = ([lon, lat]) => [lon * X_SCALE, lat * SCALE];
const unproject = ([x, y]) => [x / X_SCALE, y / SCALE];
const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const isRail = feature => ['light_rail', 'commuter_rail'].includes(feature.properties?.mode);

export function buildRailDisplay(features) {
  const segments = [], grid = new Map(), routes = new Map();
  function cells(a, b, padding = 0) {
    const keys = [];
    for (let x = Math.floor((Math.min(a[0], b[0]) - padding) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + padding) / CELL); x++) {
      for (let y = Math.floor((Math.min(a[1], b[1]) - padding) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + padding) / CELL); y++) keys.push(`${x},${y}`);
    }
    return keys;
  }
  function addSegment(a, b, route) {
    if (Math.hypot(...subtract(b, a)) < EPSILON) return;
    const index = segments.length;
    segments.push({a, b, spans: [{start: 0, end: 1, route}]});
    for (const key of cells(a, b)) {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    }
  }
  for (const feature of features.filter(isRail)) {
    const p = feature.properties;
    const route = String(p.route_id);
    if (!routes.has(route)) routes.set(route, {
      route_id: p.route_id, short_name: p.short_name, long_name: p.long_name,
      mode: p.mode, color: p.color, route_type: p.route_type,
      service_source: p.service_source, feed_version: p.feed_version,
    });
    const lines = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = project(line[i - 1]), b = project(line[i]);
      const direction = subtract(b, a), length2 = dot(direction, direction);
      if (length2 < EPSILON ** 2) continue;
      const candidates = new Set(cells(a, b, TOLERANCE).flatMap(key => grid.get(key) || []));
      const covered = [];
      for (const index of candidates) {
        const segment = segments[index], vector = subtract(segment.b, segment.a);
        const existingLength2 = dot(vector, vector);
        // A crossing is not shared track: headings must agree within about 5 degrees.
        if (Math.abs(dot(direction, vector)) / Math.sqrt(length2 * existingLength2) < 0.996) continue;
        const parameter = point => dot(subtract(point, segment.a), vector) / existingLength2;
        const start = Math.max(0, Math.min(parameter(a), parameter(b)));
        const end = Math.min(1, Math.max(parameter(a), parameter(b)));
        if ((end - start) * Math.sqrt(existingLength2) < EPSILON) continue;
        const c = interpolate(segment.a, segment.b, start), d = interpolate(segment.a, segment.b, end);
        const distanceToInput = point => Math.abs(direction[0] * (point[1] - a[1]) - direction[1] * (point[0] - a[0])) / Math.sqrt(length2);
        if (Math.max(distanceToInput(c), distanceToInput(d)) > TOLERANCE) continue;
        const t0 = dot(subtract(c, a), direction) / length2, t1 = dot(subtract(d, a), direction) / length2;
        const inputStart = Math.max(0, Math.min(1, t0, t1));
        const inputEnd = Math.min(1, Math.max(0, t0, t1));
        if ((inputEnd - inputStart) * Math.sqrt(length2) < EPSILON) continue;
        segment.spans.push({start, end, route});
        covered.push([inputStart, inputEnd]);
      }
      // Retain only portions not already represented by a physical display segment.
      covered.sort((x, y) => x[0] - y[0]);
      let cursor = 0;
      for (const [start, end] of covered) {
        if (start > cursor) addSegment(interpolate(a, b, cursor), interpolate(a, b, start), route);
        cursor = Math.max(cursor, end);
      }
      if (cursor < 1) addSegment(interpolate(a, b, cursor), b, route);
    }
  }

  // Split at membership changes so a branch never inherits routes from the trunk.
  const groups = new Map();
  for (const segment of segments) {
    const cuts = [...new Set(segment.spans.flatMap(span => [span.start, span.end]))].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1], end = cuts[i], midpoint = (start + end) / 2;
      if ((end - start) * Math.hypot(...subtract(segment.b, segment.a)) < EPSILON) continue;
      const ids = [...new Set(segment.spans.filter(span => span.start <= midpoint && span.end >= midpoint).map(span => span.route))].sort();
      const key = JSON.stringify(ids);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([interpolate(segment.a, segment.b, start), interpolate(segment.a, segment.b, end)]);
    }
  }

  // Join adjacent edges with the same routes to keep cross-ties continuous.
  const output = [];
  const nodeKey = point => point.map(value => value.toFixed(2)).join(',');
  for (const [key, edges] of groups) {
    const nodes = new Map(), used = new Set();
    edges.forEach((edge, index) => edge.forEach(point => {
      const node = nodeKey(point);
      if (!nodes.has(node)) nodes.set(node, []);
      nodes.get(node).push(index);
    }));
    function trace(index, startNode) {
      const coordinates = [];
      let node = startNode;
      while (!used.has(index)) {
        used.add(index);
        const edge = edges[index];
        const [a, b] = nodeKey(edge[0]) === node ? edge : [edge[1], edge[0]];
        if (!coordinates.length) coordinates.push(unproject(a));
        coordinates.push(unproject(b));
        node = nodeKey(b);
        const adjacent = nodes.get(node);
        if (adjacent.length !== 2) break;
        const next = adjacent.find(candidate => !used.has(candidate));
        if (next === undefined) break;
        index = next;
      }
      const members = JSON.parse(key).map(id => routes.get(id));
      output.push({type: 'Feature', geometry: {type: 'LineString', coordinates}, properties: {
        routes_json: JSON.stringify(members), route_count: members.length,
        route_ids: members.map(route => route.route_id).join(', '),
      }});
    }
    for (const [node, adjacent] of nodes) if (adjacent.length !== 2) {
      for (const index of adjacent) if (!used.has(index)) trace(index, node);
    }
    edges.forEach((edge, index) => { if (!used.has(index)) trace(index, nodeKey(edge[0])); });
  }
  return {type: 'FeatureCollection', features: output};
}
