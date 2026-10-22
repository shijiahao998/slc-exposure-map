export const LIVE_TRAFFIC_URL = 'https://uta-live-proxy.vercel.app/api/traffic/{z}/{x}/{y}.png';
export const TRAFFIC_REFRESH_MS = 600000;
const SOURCE_ID = 'live-traffic';
const LAYER_ID = 'live-traffic-raster';

export function createLiveTraffic({map,toggle,beforeId}) {
  let enabled = false, timer, generation = 0;
  toggle.dataset.refreshMs = String(TRAFFIC_REFRESH_MS);
  toggle.dataset.timerActive = 'false';
  toggle.dataset.refreshCount = '0';

  function refresh() {
    if (!enabled) return;
    // A new URL bypasses previously cached tiles on each refresh and re-enable.
    const template = `${LIVE_TRAFFIC_URL}?refresh=${Date.now()}-${++generation}`;
    if (map.getSource(SOURCE_ID)) map.getSource(SOURCE_ID).setTiles([template]);
    else {
      map.addSource(SOURCE_ID,{
        type:'raster',tiles:[template],tileSize:256,minzoom:0,maxzoom:22,
        attribution:'<a href="https://www.tomtom.com/" target="_blank" rel="noopener">© TomTom</a>',
      });
      // Above the basemap and parcels, below buildings, transit and facilities.
      map.addLayer({id:LAYER_ID,source:SOURCE_ID,type:'raster',
        paint:{'raster-opacity':0.88,'raster-fade-duration':0}},beforeId);
    }
    toggle.dataset.tileTemplate = template;
    toggle.dataset.refreshCount = String(generation);
  }

  function setEnabled(next) {
    if (next === enabled) return;
    enabled = next;
    clearInterval(timer); timer = undefined;
    if (enabled) {
      refresh();
      timer = setInterval(refresh,TRAFFIC_REFRESH_MS);
    } else {
      // Removing the source also cancels pending tiles and releases its cache.
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    }
    toggle.dataset.timerActive = String(enabled);
  }

  window.addEventListener('pagehide',() => setEnabled(false));
  map.on('remove',() => clearInterval(timer));
  return {setEnabled};
}
