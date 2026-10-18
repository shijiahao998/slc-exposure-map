import { decodeVehicleFeed } from './gtfs-vehicle.js';

// The only realtime endpoint. All browser requests go through this Vercel proxy.
export const LIVE_TRANSIT_URL = 'https://uta-live-proxy.vercel.app/api/vehicle';
export const LIVE_TRANSIT_LAYER = 'live-transit-vehicles';
const REFRESH_MS = 30000;
const MAX_AGE_MS = 180000;
const empty = () => ({type:'FeatureCollection',features:[]});

function routeMode(route) {
  if (route?.mode === 'commuter_rail' || String(route?.route_type) === '2') return 'frontrunner';
  if (['light_rail','rail','tram','streetcar','subway'].includes(route?.mode) || ['0','1','12'].includes(String(route?.route_type))) return 'rail';
  if (route?.mode === 'bus' || ['3','11'].includes(String(route?.route_type))) return 'bus';
  return 'unknown';
}

function installSymbols(map) {
  // Lightweight inline SVG paths drawn into the existing high-DPI marker images.
  const busIcon = new Path2D('M16 11h12a3 3 0 0 1 3 3v15a2 2 0 0 1-2 2v3h-4v-3h-6v3h-4v-3a2 2 0 0 1-2-2V14a3 3 0 0 1 3-3Z M16 15v8h12v-8Z M16 26v2h3v-2Z M25 26v2h3v-2Z');
  const trainIcon = new Path2D('M17 11h10a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3Z M17 15v7h10v-7Z M17 25v2h3v-2Z M24 25v2h3v-2Z');
  const tracks = new Path2D('M18 30l-3 4M26 30l3 4M17 32h10');
  for (const [mode,color] of [['bus','#1679a5'],['rail','#287c4c'],['frontrunner','#783fa1'],['unknown','#646b71']]) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 44;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 3;
    ctx.beginPath();
    if (mode === 'rail') { ctx.moveTo(22,2); ctx.lineTo(42,22); ctx.lineTo(22,42); ctx.lineTo(2,22); ctx.closePath(); }
    else if (mode === 'frontrunner') ctx.rect(4,4,36,36);
    else ctx.arc(22,22,18,0,Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'white';
    if (mode === 'bus') ctx.fill(busIcon,'evenodd');
    else if (mode === 'rail' || mode === 'frontrunner') {
      ctx.fill(trainIcon,'evenodd');
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(tracks);
    } else {
      ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?',22,23);
    }
    map.addImage(`live-vehicle-${mode}`,ctx.getImageData(0,0,44,44),{pixelRatio:2});
  }
}

export function createLiveTransit({map,routeFeatures,status,legend,onHide}) {
  // Nonvisual diagnostics let a local browser check observe actual fetch attempts.
  status.dataset.requestCount = '0';
  status.dataset.vehicleCount = '0';
  const routes = new Map(routeFeatures.map(feature => [String(feature.properties.route_id),feature.properties]));
  installSymbols(map);
  map.addSource(LIVE_TRANSIT_LAYER,{type:'geojson',data:empty()});
  map.addLayer({id:LIVE_TRANSIT_LAYER,source:LIVE_TRANSIT_LAYER,type:'symbol',layout:{
    visibility:'none','icon-image':['concat','live-vehicle-',['get','vehicle_mode']],
    'icon-allow-overlap':true,'icon-ignore-placement':true,
  }});
  let enabled = false, generation = 0, timer, request, failures = 0, tripIndex;
  async function staticTrips(signal) {
    if (!tripIndex) {
      const response = await fetch(new URL('./data/live-trip-index.json',import.meta.url),{signal});
      if (!response.ok) throw new Error('Static trip lookup unavailable');
      tripIndex = (await response.json()).trips;
    }
    return tripIndex;
  }
  const fresh = (timestamp,now) => Number.isFinite(timestamp) && timestamp > 0 &&
    now - timestamp * 1000 <= MAX_AGE_MS && timestamp * 1000 - now <= 60000;

  async function poll(session) {
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(),12000);
    let delay = REFRESH_MS;
    try {
      const trips = await staticTrips(controller.signal);
      status.dataset.requestCount = String(Number(status.dataset.requestCount) + 1);
      const response = await fetch(LIVE_TRANSIT_URL,{mode:'cors',credentials:'omit',redirect:'error',signal:controller.signal});
      if (!response.ok) throw new Error(`Vehicle feed returned HTTP ${response.status}`);
      if ((response.headers.get('content-type') || '').includes('text/html')) throw new Error('Vehicle proxy returned HTML instead of protobuf');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 10000000) throw new Error('Vehicle feed too large');
      const feed = decodeVehicleFeed(buffer), now = Date.now();
      const timestamp = feed.header.timestamp || Math.max(0,...feed.entities.map(e => e.vehicle?.timestamp || 0));
      if (!fresh(timestamp,now)) throw new Error('Vehicle feed is not current');
      const features = new Map();
      for (const entity of feed.entities) {
        const v = entity.vehicle;
        if (!v || entity.deleted || !v.position) continue;
        const {longitude:lon,latitude:lat,bearing} = v.position;
        const measured = v.timestamp || timestamp;
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90 || !fresh(measured,now)) continue;
        const trip = v.trip || {}, descriptor = v.descriptor || {};
        const staticTrip = trips[trip.tripId];
        const routeId = trip.routeId || staticTrip?.[0] || '';
        const route = routes.get(String(routeId));
        const id = descriptor.id || entity.id;
        if (!id) continue;
        features.set(id,{type:'Feature',id,geometry:{type:'Point',coordinates:[lon,lat]},properties:{
          vehicle_id:descriptor.id || entity.id,vehicle_label:descriptor.label || '',
          route_id:routeId,route_name:route ? [route.short_name,route.long_name].filter(Boolean).join(' · ') : '',
          vehicle_mode:routeMode(route),trip_id:trip.tripId || '',direction_id:trip.directionId ?? staticTrip?.[1] ?? '',
          bearing:Number.isFinite(bearing) ? bearing : '',feed_timestamp:timestamp,vehicle_timestamp:measured,
          received_timestamp:Math.floor(now / 1000),route_matched:Boolean(route),route_match_method:trip.routeId?'route_id':'trip_id',
        }});
      }
      if (!enabled || session !== generation) return;
      map.getSource(LIVE_TRANSIT_LAYER).setData({type:'FeatureCollection',features:[...features.values()]});
      status.dataset.vehicleCount = String(features.size);
      failures = 0;
      status.textContent = `Live · updated ${new Date(timestamp * 1000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
      status.title = `${features.size} current vehicles · feed updated ${new Date(timestamp * 1000).toLocaleString('en-US')}`;
    } catch (error) {
      if (!enabled || session !== generation) return;
      map.getSource(LIVE_TRANSIT_LAYER).setData(empty());
      status.dataset.vehicleCount = '0';
      onHide();
      status.textContent = 'Live Transit unavailable';
      status.title = error.message;
      // No rapid retry loop: 60 s, 120 s, then up to five minutes during outages.
      failures++;
      delay = Math.min(300000,REFRESH_MS * 2 ** Math.min(failures,4));
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = undefined;
      if (enabled && session === generation) timer = setTimeout(() => poll(session),delay);
    }
  }

  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next; generation++;
    clearTimeout(timer); request?.abort();
    map.setLayoutProperty(LIVE_TRANSIT_LAYER,'visibility',enabled ? 'visible' : 'none');
    status.hidden = legend.hidden = !enabled;
    if (enabled) {
      failures = 0; status.textContent = 'Live Transit · loading…'; status.title = '';
      poll(generation);
    } else {
      map.getSource(LIVE_TRANSIT_LAYER).setData(empty());
      status.dataset.vehicleCount = '0';
      status.textContent = ''; status.title = ''; onHide();
    }
  }
  window.addEventListener('pagehide',() => setEnabled(false));
  return {setEnabled};
}
