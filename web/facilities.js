import { distanceMeters } from './geometry.js';
export const SITE_LABELS = {
  crowd: 'Gathering & High-Activity Places',
  care_education: 'Health, Education & Care',
  infrastructure: 'Critical Infrastructure',
  hazmat: 'Fuel & Hazardous-Material Facilities',
};

export const SITE_COLORS = {
  crowd: '#d97724',
  care_education: '#7e57c2',
  infrastructure: '#1d7088',
  hazmat: '#c05621',
};

export const EMERGENCY_LABELS = {
  fire_station: 'Fire Stations',
  ems: 'EMS Facilities',
};

// Enrich Sensitive & Critical Facilities with functional role tags without geographic duplication.
// Hospitals remain in Health, Education & Care (care_education) and carry dual functional role tags.
export function enrichSensitiveFeatures(features = []) {
  const seenCoords = new Map();
  const out = [];
  for (const f of features) {
    if (!f?.geometry?.coordinates) continue;
    const p = { ...(f.properties || {}) };
    const cat = p.category === 'hazardous' ? 'hazmat' : p.category;
    // Transportation is displayed and counted exclusively from static GTFS.
    if (!Object.hasOwn(SITE_LABELS, cat)) continue;
    p.category = cat;
    const sub = p.subcategory || '';

    const roleList = [SITE_LABELS[cat] || 'Sensitive & Critical Facility'];
    if (sub === 'hospital') {
      roleList.push('Critical Medical Function', 'Vulnerable Population Care');
    } else if (sub === 'nursing_home' || sub === 'kindergarten' || sub === 'school') {
      roleList.push('Vulnerable Population / Care & Education');
    } else if (cat === 'infrastructure') {
      roleList.push('Critical Utility Infrastructure');
    } else if (cat === 'hazmat') {
      roleList.push('Fuel / Hazardous-Material Site');

    } else if (cat === 'crowd') {
      roleList.push('Public Gathering / High-Activity Place');
    }

    const [lon, lat] = f.geometry.coordinates;
    const coordKey = `${lon.toFixed(5)},${lat.toFixed(5)}`;
    if (seenCoords.has(coordKey)) {
      const existing = seenCoords.get(coordKey);
      const existingRoles = new Set(existing.properties.role_list || []);
      roleList.forEach(r => existingRoles.add(r));
      existing.properties.role_list = [...existingRoles];
      existing.properties.roles = existing.properties.role_list.join(' · ');
      continue;
    }

    p.facility_group = 'Sensitive & Critical Facilities';
    p.role_list = roleList;
    p.roles = roleList.join(' · ');
    const enriched = {
      type: 'Feature',
      id: f.id || p.id,
      geometry: f.geometry,
      properties: p,
    };
    seenCoords.set(coordKey, enriched);
    out.push(enriched);
  }
  return out;
}

// Deduplicate Emergency-Response Resources (Fire Stations and EMS Facilities) so co-located
// stations appear only once geographically while preserving role tags and source provenance.
export function deduplicateEmergencyFeatures(features = [], mergeDistanceM = 30) {
  const valid = (features || []).filter(
    f => f?.geometry?.coordinates && ['fire_station', 'ems'].includes(f.properties?.subcategory)
  );
  const order = { fire_station: 1, ems: 2 };
  const sorted = [...valid].sort(
    (a, b) => (order[a.properties?.subcategory] || 9) - (order[b.properties?.subcategory] || 9)
  );

  const merged = [];
  for (const f of sorted) {
    const coords = f.geometry.coordinates;
    const p = f.properties || {};
    const sub = p.subcategory;

    let match = null;
    for (const existing of merged) {
      const d = distanceMeters(coords, existing.geometry.coordinates);
      if (d <= mergeDistanceM) {
        match = existing;
        break;
      }
    }

    if (!match) {
      const hasFire = sub === 'fire_station';
      const hasEms = sub === 'ems';
      const roleList = [];
      if (hasFire) roleList.push('Fire Station');
      if (hasEms) roleList.push('EMS Facility');

      merged.push({
        type: 'Feature',
        id: f.id || p.id,
        geometry: f.geometry,
        properties: {
          ...p,
          category: 'emergency',
          facility_group: 'Emergency-Response Resources',
          subcategory: sub,
          primary_subcategory: sub,
          has_fire_station: hasFire,
          has_ems: hasEms,
          role_list: roleList,
          roles: roleList.join(' · '),
          role_count: roleList.length,
          sources_list: [p.source ? `${p.source} (${p.date || 'archived'})` : 'Official catalog'],
          warnings_list: p.warning ? [p.warning] : [],
        },
      });
    } else {
      const mp = match.properties;
      if (sub === 'fire_station' && !mp.has_fire_station) {
        mp.has_fire_station = true;
        mp.role_list.push('Fire Station');
      } else if (sub === 'ems' && !mp.has_ems) {
        mp.has_ems = true;
        mp.role_list.push('EMS Facility');
        mp.ems_name = p.name;
        mp.ems_date = p.date;
        mp.ems_source = p.source;
      }
      mp.roles = mp.role_list.join(' · ');
      mp.role_count = mp.role_list.length;
      const srcEntry = p.source ? `${p.source} (${p.date || 'archived'})` : null;
      if (srcEntry && !mp.sources_list.includes(srcEntry)) mp.sources_list.push(srcEntry);
      if (p.warning && !mp.warnings_list.includes(p.warning)) mp.warnings_list.push(p.warning);
      mp.source = mp.sources_list.join(' · ');
      mp.warning = mp.warnings_list.join(' ');
    }
  }
  return merged;
}

