import * as maplibregl from './vendor/maplibre-gl.mjs';
import { MILE_METERS, distanceMeters, circleFeature } from './geometry.js';
import { SITE_LABELS, SITE_COLORS, enrichSensitiveFeatures, deduplicateEmergencyFeatures } from './facilities.js';
import { STATIC_LAYERS } from './static-layers.js';
import { featureDetails } from './feature-details.js';
import { buildRailDisplay, isRail } from './rail-display.js';

const $ = id => document.getElementById(id);
const collection = features => ({type:'FeatureCollection',features});
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const checked = name => document.querySelector(`[data-layer="${name}"]`).checked;
const font = ['Arial','sans-serif'];
const state = {ready:false, center:null, radius:1, sensitive:[], emergency:[], transitStops:[], transitStations:[], transitCountGroups:[], matches:[], popup:null, popupFromAnalysis:false, transitFeed:''};
const layerGroups = {base:[], transitRoutes:[], transitStops:[], landuse:[], parcels:[], buildings:[], buildings3d:[], sensitive:[], emergency:[], imagery:[]};
const landuseColors = {residential:'#e2c77f',commercial:'#c58872',industrial:'#a192b0',institutional:'#789bb2',open_land:'#9bb992',recreation:'#6fa39b',unknown:'#c6c7c1'};
const colors = ['match',['get','category'],...Object.entries(SITE_COLORS).flat(),'#c00'];
let config, heights;
async function read(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}
const map = new maplibregl.Map({container:'map',center:[-111.94,40.68],zoom:10.5,minZoom:3,maxZoom:19,
  maxBounds:[[-179.9,14],[-60,72.5]],renderWorldCopies:false,attributionControl:false,
  style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e9ebec'}}]}});
map.addControl(new maplibregl.NavigationControl(),'top-right');
map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-left');
map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a> · UGRC SGID (modified) · <a href="./attribution.html">Sources</a>'}));
map.on('error', e => { $('error').textContent = `Map layer unavailable: ${e.error?.message || 'loading error'}`; $('error').hidden = false; });
function source(id,data) { map.addSource(id,{type:'geojson',data}); }
function layer(group,id,sourceId,type,paint,extra={}) {
  map.addLayer({id,source:sourceId,type,paint,...extra});
  if(group) layerGroups[group].push(id);
}
function visibility(ids,on) { ids.forEach(id=>map.setLayoutProperty(id,'visibility',on?'visible':'none')); }
function tileURL(name) { return new URL(`./data/${name}/{z}/{x}/{y}.pbf`,import.meta.url).href.replaceAll('%7B','{').replaceAll('%7D','}'); }
function buildingHeight() { return ['case',['>', ['coalesce',['feature-state','height_m'],0],0],['feature-state','height_m'],$('illustrative-height').checked?6:0]; }
function applyLayers() {
  if(!state.ready) return;
  const imagery=checked('imagery');
  if(imagery && !map.getSource('imagery')) {
    map.addSource('imagery',{type:'raster',tileSize:256,maxzoom:16,
      tiles:['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],attribution:'USGS The National Map / USDA historical imagery'});
    map.addLayer({id:'imagery',type:'raster',source:'imagery'},'us-fill');
    layerGroups.imagery.push('imagery');
  }
  for(const name of ['landuse','imagery','transitRoutes','transitStops']) visibility(layerGroups[name],checked(name));
  visibility(layerGroups.parcels,checked('landuse'));
  for(const name of ['sensitive','emergency']) visibility(layerGroups[name],checked('facilities'));
  $('facility-legend').hidden=!checked('facilities');
  applyRadiusAnalysis();
  visibility(layerGroups.base,true);
  // Keep every basemap layer enabled; let optional imagery show through background fills.
  for(const id of ['us-fill','county-fill']) map.setPaintProperty(id,'fill-opacity',imagery?0:1);
  $('landuse-legend').hidden=!checked('landuse');
  visibility(layerGroups.buildings,checked('buildings')&&!checked('buildings3d'));
  visibility(layerGroups.buildings3d,checked('buildings3d'));
  map.setPaintProperty('buildings-3d','fill-extrusion-height',buildingHeight());
  $('height-control').hidden=$('height-note').hidden=!checked('buildings3d');
  $('status').textContent=checked('buildings3d')?'3D buildings · unknown heights are illustrative':!checked('analysis')?'Radius analysis off · explore map layers':state.center?'Selected radius · straight-line distance':'Ready · click the map to choose a location';
}
function applyRadiusAnalysis() {
  const enabled=checked('analysis');
  visibility(['radius-fill','radius-line','center','matches-halo','matches-point','transit-matches-halo','transit-selected-bus','transit-selected-rail'],enabled);
  for(const id of ['radius-tools','results','map-hint']) $(id).hidden=!enabled;
  document.querySelectorAll('#radius-tools button').forEach(button=>button.disabled=!enabled);
  if(!enabled&&state.popupFromAnalysis) state.popup?.remove();
}
function select(center) {
  if(!state.ready||!checked('analysis')) return;
  state.center=center;
  updateQuery();
}
// Shared classification for transit statistics and highlights; normal map collections stay unchanged.
function transitCountGroups(stops, routeFeatures) {
  const tokens=value=>(Array.isArray(value)?value:String(value??'').split(/[,;|\s]+/)).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
  function serviceModes(p) {
    const modes=new Set([...tokens(p.mode),...tokens(p.modes)]);
    for(const type of [...tokens(p.route_type),...tokens(p.route_types)]) {
      if(['0','1','2','12'].includes(type)) modes.add('rail');
      else if(['3','11'].includes(type)) modes.add('bus');
      else modes.add('other');
    }
    return modes;
  }
  const routes=new Map();
  for(const feature of routeFeatures) {
    const p=feature.properties||{}, id=String(p.route_id);
    if(!routes.has(id)) routes.set(id,new Set());
    for(const mode of serviceModes(p)) routes.get(id).add(mode);
  }
  const groups=new Map(), byId=new Map(stops.map(f=>[String(f.properties.stop_id).trim(),f]));
  for(const stop of stops) {
    const p=stop.properties;
    const key=String(p.parent_station||p.canonical_station_id||p.canonical_stop_id||p.station_id||p.stop_id).trim();
    if(!groups.has(key)) groups.set(key,{points:[],stops:[],modes:new Set()});
    const group=groups.get(key);
    group.points.push(stop.geometry.coordinates);
    group.stops.push(stop);
    for(const mode of serviceModes(p)) group.modes.add(mode);
    // Preserve route IDs exactly; their case is not a mode label.
    const routeIds=Array.isArray(p.route_ids)?p.route_ids:String(p.route_ids??p.route_id??'').split(/[,;|]+/);
    for(const id of routeIds) for(const mode of routes.get(String(id).trim())||[]) group.modes.add(mode);
  }
  const railModes=new Set(['rail','light_rail','commuter_rail','tram','trax','subway','metro','monorail']);
  return [...groups].map(([key,group])=>({
    // Prefer an explicit parent location; otherwise any mapped platform may locate the group.
    points:byId.has(key)?[byId.get(key).geometry.coordinates]:group.points,
    stops:group.stops,
    kind:[...group.modes].some(mode=>railModes.has(mode))?'rail':
      group.modes.size&&[...group.modes].every(mode=>['bus','trolleybus'].includes(mode))?'bus':null,
  }));
}
function updateQuery() {
  if(!state.ready||!checked('analysis')) return;
  document.querySelectorAll('[data-radius]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.radius)===state.radius)));
  if(!state.center) return;
  const radiusM=state.radius*MILE_METERS;
  state.matches=[...state.sensitive,...state.emergency].map(f=>({feature:f,distance:distanceMeters(state.center,f.geometry.coordinates)})).filter(x=>x.distance<=radiusM).sort((a,b)=>a.distance-b.distance);
  const sensitive=state.matches.filter(x=>x.feature.properties.category!=='emergency');
  const emergency=state.matches.filter(x=>x.feature.properties.category==='emergency');
  const transitMatches=state.transitCountGroups.filter(group=>group.points.some(point=>distanceMeters(state.center,point)<=radiusM));
  const busCount=transitMatches.filter(group=>group.kind==='bus').length;
  const railCount=transitMatches.filter(group=>group.kind==='rail').length;
  const fire=emergency.filter(x=>x.feature.properties.has_fire_station).length;
  const ems=emergency.filter(x=>x.feature.properties.has_ems).length;
  map.getSource('radius').setData(collection([circleFeature(state.center,state.radius)]));
  map.getSource('center').setData(collection([{type:'Feature',geometry:{type:'Point',coordinates:state.center},properties:{}}]));
  map.getSource('matches').setData(collection(state.matches.map(x=>x.feature)));
  // Highlight only actual stop coordinates inside the circle, even for grouped platforms.
  const transitHighlights=state.transitCountGroups.filter(group=>group.kind).flatMap(group=>
    group.stops.filter(stop=>distanceMeters(state.center,stop.geometry.coordinates)<=radiusM).map(stop=>({
      ...stop,properties:{...stop.properties,analysis_kind:group.kind},
    }))
  );
  map.getSource('transit-matches').setData(collection(transitHighlights));
  $('map-hint').textContent=`${state.radius} mi radius · ${state.matches.length} facility locations · ${busCount} bus stops · ${railCount} rail stops / stations`;
  $('status').textContent='Selected radius · straight-line distance';
  $('results').innerHTML=`<p class="result-meta">${state.center[1].toFixed(4)}° N, ${Math.abs(state.center[0]).toFixed(4)}° W · ${state.radius} mi radius<br>Circle area: ${(Math.PI*state.radius**2).toFixed(2)} mi²</p>
    <div class="counts"><div class="count"><strong id="sensitive-count">${sensitive.length}</strong><span>Sensitive &amp; critical locations</span></div><div class="count"><strong id="emergency-count">${emergency.length}</strong><span>Emergency-response locations</span></div></div>
    <div class="category-counts">${Object.entries(SITE_LABELS).map(([k,v])=>`<div><span><i class="dot" style="background:${SITE_COLORS[k]}"></i>${escapeText(v)}</span><strong>${sensitive.filter(x=>x.feature.properties.category===k).length}</strong></div>`).join('')}<div><span>Fire station roles</span><strong>${fire}</strong></div><div><span>EMS facility roles</span><strong>${ems}</strong></div></div>
    <div class="category-counts"><div><span><i class="dot" style="background:transparent;border:2px solid #008ad0"></i>Bus stops</span><strong id="bus-stop-count">${busCount}</strong></div><div><span><i class="dot" style="background:transparent;border:2px solid #9b40bd"></i>Rail stops / stations</span><strong id="rail-stop-count">${railCount}</strong></div></div>
    <p class="note">Transit counts use only static GTFS. Bus-only stops count as bus; stops served by rail count as rail. Parent or canonical station IDs are counted once when provided; otherwise each stop ID counts once. The current prepared data has no station-grouping IDs, so distinct platform IDs remain separate. Transit counts are excluded from facility totals.</p>
    <p class="note">Fire and EMS roles may share a location. Counts use the archived county dataset, including matching facilities whose base layer is hidden.</p>
    <details ${state.matches.length?'open':''}><summary>${state.matches.length} matching locations · nearest first</summary><ul class="result-list">${state.matches.map((x,i)=>`<li><button type="button" data-result="${i}"><strong>${escapeText(x.feature.properties.name||x.feature.properties.subcategory.replaceAll('_',' '))}</strong><small>${escapeText(x.feature.properties.category==='emergency'?x.feature.properties.roles:SITE_LABELS[x.feature.properties.category])} · ${(x.distance/MILE_METERS).toFixed(2)} mi</small></button></li>`).join('')}</ul></details>`;
  $('results').querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',()=>showFacility(state.matches[Number(b.dataset.result)].feature)));
}
function showFeature(feature,kind,anchor,fromAnalysis=false) {
  state.popup?.remove();
  state.popupFromAnalysis=fromAnalysis;
  state.popup=new maplibregl.Popup({closeButton:true,closeOnClick:false,maxWidth:'340px',offset:12})
    .setLngLat(anchor).setHTML(featureDetails(feature,kind,state.transitFeed)).addTo(map);
}
function showFacility(f) {
  if(!checked('analysis')) return;
  showFeature(f,'facility',f.geometry.coordinates,true);
  map.easeTo({center:f.geometry.coordinates,duration:300});
}
function routeDistance(feature,point) {
  const lines=feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[feature.geometry.coordinates];
  let closest=Infinity;
  for(const line of lines) for(let i=1;i<line.length;i++) {
    const a=map.project(line[i-1]),b=map.project(line[i]),dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    closest=Math.min(closest,Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy));
  }
  return closest;
}
function featureAt(point) {
  // One handler: nearest point symbol first, then nearest route, then parcel polygon.
  const points=map.queryRenderedFeatures(point,{layers:['matches-point','emergency','sensitive','transit-stops','transit-stations','transit-selected-bus','transit-selected-rail','transit-matches-halo']});
  if(points.length) {
    points.sort((a,b)=>map.project(a.geometry.coordinates).dist(point)-map.project(b.geometry.coordinates).dist(point));
    const feature=points[0];
    return {feature,kind:['transit-stops','transit-stations','transit-matches'].includes(feature.source)?'stop':'facility'};
  }
  const routes=map.queryRenderedFeatures([[point.x-4,point.y-4],[point.x+4,point.y+4]],{layers:['transit-routes','transit-rail-line','transit-rail-ties']});
  if(routes.length) {
    const feature=routes.sort((a,b)=>routeDistance(a,point)-routeDistance(b,point))[0];
    return {feature,kind:feature.source==='rail-tracks'?'rail':'route'};
  }
  const parcels=map.queryRenderedFeatures(point,{layers:['landuse-fill','parcels']});
  return parcels.length?{feature:parcels[0],kind:'parcel'}:null;
}
function handleMapClick(event) {
  const hit=featureAt(event.point);
  state.popup?.remove();
  select([event.lngLat.lng,event.lngLat.lat]);
  if(hit) showFeature(hit.feature,hit.kind,hit.feature.geometry.type==='Point'?hit.feature.geometry.coordinates:event.lngLat);
}
function clear() {
  state.center=null;state.matches=[];state.popup?.remove();
  for(const id of ['radius','matches','center','transit-matches']) map.getSource(id).setData(collection([]));
  $('results').innerHTML='<p class="empty">Select a point on the map to begin.</p>';
  $('map-hint').textContent='Click anywhere to identify nearby facilities';
  $('status').textContent=checked('analysis')?'Ready · click the map to choose a location':'Radius analysis off · explore map layers';
}
async function initialize() {
  try {
    const mapReady=new Promise(resolve=>map.loaded()?resolve():map.once('load',resolve));
    const loaded=await Promise.all(['map-config.json','us-outline.geojson','county-boundary.geojson','utah-water.geojson','utah-roads.geojson','utah-places.geojson','roads.geojson','water.geojson','places.geojson','sensitive-sites.geojson','emergency-sites.geojson','building-heights.json','transit-routes.geojson','transit-stops.geojson'].map(n=>read(`./data/${n}`)));
    const [cfg,us,county,water,roads,places,countyRoads,countyWater,countyPlaces,sites,emergency,h,transitRoutes,transitStops]=loaded;config=cfg;heights=h;
    state.transitFeed=[...new Set(transitRoutes.features.map(f=>f.properties.feed_version).filter(Boolean))].join(' · ');
    // The prepared stop_id is the canonical identity, shared across routes/modes.
    // Use the same static collection for transit display and radius counts.
    state.transitStops=[...new Map(transitStops.features.filter(f=>
      f.geometry?.type==='Point' && f.properties?.stop_id!=null && String(f.properties.stop_id).trim()!==''
    ).map(f=>[String(f.properties.stop_id).trim(),f])).values()];
    state.transitCountGroups=transitCountGroups(state.transitStops,transitRoutes.features);
    state.transitStations=state.transitStops.filter(f=>
      ['light_rail','commuter_rail'].includes(f.properties.mode) || Number(f.properties.location_type)===1
    );
    state.sensitive=enrichSensitiveFeatures(sites.features);state.emergency=deduplicateEmergencyFeatures(emergency.features);
    await mapReady;
    source('us',us);layer('base','us-fill','us','fill',{'fill-color':'#f6f6f1'});layer('base','us-outline','us','line',{'line-color':'#b8bcb9','line-width':1});
    source('county',county);layer('base','county-fill','county','fill',{'fill-color':'#fafaf5'});
    source('water',water);layer('base','water','water','fill',{'fill-color':'#bbd7df'});
    source('roads',roads);layer('base','roads','roads','line',{'line-color':'#c5c8bf','line-width':['interpolate',['linear'],['zoom'],5,0.4,12,1.3,16,2]});
    source('places',places);layer('base','places','places','symbol',{'text-color':'#59605c','text-halo-color':'#ffffff','text-halo-width':2},{minzoom:6,layout:{'text-field':['get','name'],'text-font':font,'text-size':12}});
    layer(null,'county-boundary','county','line',{'line-color':'#ab3030','line-width':1.5,'line-dasharray':[4,3]});
    map.addSource('parcels',{type:'vector',tiles:[tileURL('parcels')],...config.parcels});
    layer('landuse','landuse-fill','parcels','fill',{'fill-color':['match',['get','group'],...Object.entries(landuseColors).flat(),landuseColors.unknown],'fill-opacity':0.65},{'source-layer':'parcels',minzoom:9});
    layer('parcels','parcels','parcels','line',{'line-color':'#8d897b','line-width':['interpolate',['linear'],['zoom'],12,0.25,17,1],'line-opacity':0.6},{'source-layer':'parcels',layout:{visibility:'none'}});
    // County context must render above the county background and parcel colors.
    source('county-water',countyWater);layer('base','county-water','county-water','fill',{'fill-color':'#bbd7df','fill-opacity':0.9});
    source('county-roads',countyRoads);layer('base','county-roads','county-roads','line',{'line-color':'#737d79','line-opacity':0.8,'line-width':['interpolate',['linear'],['zoom'],9,0.6,14,1.5,18,2.5]});
    source('county-places',countyPlaces);layer('base','county-places','county-places','symbol',{'text-color':'#424a46','text-halo-color':'#ffffff','text-halo-width':2},{minzoom:9,layout:{'text-field':['get','name'],'text-font':font,'text-size':['interpolate',['linear'],['zoom'],9,11,14,14]}});
    for(const id of ['places','county-boundary']) map.moveLayer(id);
    map.addSource('buildings',{type:'vector',tiles:[tileURL('buildings')],promoteId:'id',...config.buildings});
    layer('buildings','buildings','buildings','fill',{'fill-color':'#b4b8b1','fill-outline-color':'#848b83'},{'source-layer':'buildings',layout:{visibility:'none'}});
    layer('buildings3d','buildings-3d','buildings','fill-extrusion',{'fill-extrusion-color':['match',['coalesce',['feature-state','method'],0],2,'#467f9c',1,'#548370','#c9ad79'],'fill-extrusion-height':buildingHeight(),'fill-extrusion-opacity':0.9},{'source-layer':'buildings',layout:{visibility:'none'}});
    for(const [id,r] of Object.entries(heights)) map.setFeatureState({source:'buildings',sourceLayer:'buildings',id},{height_m:r.height_m,method:r.method==='osm_height'?2:1});
    source('transit-routes',collection(transitRoutes.features.filter(f=>!isRail(f))));
    source('rail-tracks',buildRailDisplay(transitRoutes.features));source('transit-stops',collection(state.transitStops));source('transit-stations',collection(state.transitStations));
    const transitColor=['match',['get','mode'],'light_rail','#222222','commuter_rail','#754c86','#286d93'];
    layer('transitRoutes','transit-route-casing','transit-routes','line',{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],9,2,14,5],'line-opacity':0.8});
    const routeColor=['case',['==',['get','mode'],'bus'],['to-color',['concat','#',['coalesce',['get','color'],'']],'#286d93'],transitColor];
    layer('transitRoutes','transit-routes','transit-routes','line',{'line-color':routeColor,'line-width':['interpolate',['linear'],['zoom'],9,1,14,2.5]},{layout:{'line-cap':'round','line-join':'round'}});
    // Shared rail geometry is rendered once; route memberships stay on each segment.
    layer('transitRoutes','transit-rail-casing','rail-tracks','line',{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],9,2,14,5],'line-opacity':0.8});
    layer('transitRoutes','transit-rail-ties','rail-tracks','line',{'line-color':'#222222','line-width':['interpolate',['linear'],['zoom'],9,6,14,9],'line-dasharray':[0.18,1.1]},{layout:{'line-cap':'butt'}});
    layer('transitRoutes','transit-rail-line','rail-tracks','line',{'line-color':'#222222','line-width':['interpolate',['linear'],['zoom'],9,1,14,2.5]},{layout:{'line-cap':'round','line-join':'round'}});
    layer('transitStops','transit-stops','transit-stops','circle',{'circle-color':'#ffffff','circle-radius':3.5,'circle-stroke-color':'#286d93','circle-stroke-width':1.5},{minzoom:11,filter:['==',['get','mode'],'bus']});
    layer('transitStops','transit-stations','transit-stations','circle',{'circle-color':transitColor,'circle-radius':5.5,'circle-stroke-color':'#ffffff','circle-stroke-width':1.5});
    source('sensitive',collection(state.sensitive));source('emergency',collection(state.emergency));
    layer('sensitive','sensitive','sensitive','circle',{'circle-color':colors,'circle-radius':['interpolate',['linear'],['zoom'],9,3,14,6],'circle-stroke-color':'white','circle-stroke-width':1});
    // Draw emergency resources as square markers to distinguish them from sensitive sites.
    const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(2,2,20,20);ctx.strokeStyle='white';ctx.lineWidth=2;ctx.strokeRect(2,2,20,20);ctx.fillStyle='white';ctx.fillRect(10,6,4,12);ctx.fillRect(6,10,12,4);map.addImage('emergency-icon',ctx.getImageData(0,0,24,24));
    layer('emergency','emergency','emergency','symbol',{}, {layout:{'icon-image':'emergency-icon','icon-size':0.75,'icon-allow-overlap':true}});
    for(const id of ['radius','center','matches','transit-matches']) source(id,collection([]));
    layer(null,'radius-fill','radius','fill',{'fill-color':'#c00','fill-opacity':0.045});
    layer(null,'radius-line','radius','line',{'line-color':'#c00','line-width':2,'line-dasharray':[3,2]});
    // Hollow analysis rings preserve the stop symbol and differ from facility highlights.
    layer(null,'transit-matches-halo','transit-matches','circle',{
      'circle-radius':['match',['get','analysis_kind'],'bus',8,10],
      'circle-opacity':0,'circle-stroke-opacity':1,'circle-stroke-width':3,
      'circle-stroke-color':['match',['get','analysis_kind'],'bus','#008ad0','#9b40bd'],
    });
    // Reuse the normal symbol paint for selected stops, including at overview zooms
    // or when the normal transit layer is hidden, just as selected facilities remain visible.
    for(const [kind,id] of [['bus','transit-stops'],['rail','transit-stations']]) {
      const normal=map.getStyle().layers.find(spec=>spec.id===id);
      map.addLayer({...normal,id:`transit-selected-${kind}`,source:'transit-matches',minzoom:0,
        filter:['==',['get','analysis_kind'],kind],layout:{visibility:'visible'}});
    }
    layer(null,'matches-halo','matches','circle',{'circle-radius':10,'circle-color':'#fff7ce','circle-opacity':0.75,'circle-stroke-color':'#cc0000','circle-stroke-width':2});
    layer(null,'matches-point','matches','circle',{'circle-radius':5,'circle-color':colors,'circle-stroke-color':'white','circle-stroke-width':1});
    layer(null,'center','center','circle',{'circle-radius':6,'circle-color':'#c00','circle-stroke-color':'white','circle-stroke-width':2});
    for(const spec of STATIC_LAYERS) {
      const geo=await read(spec.url);source(spec.id,geo);
      map.addLayer({id:spec.id,type:spec.type||'fill',source:spec.id,paint:spec.paint||{'fill-color':'#278579','fill-opacity':0.25},layout:{visibility:spec.visible===false?'none':'visible'}},'radius-fill');
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=spec.visible!==false;input.addEventListener('change',()=>visibility([spec.id],input.checked));label.append(input,document.createTextNode(spec.label));$('extra-layers').append(label);
    }
    $('legend').innerHTML=Object.entries(SITE_LABELS).map(([k,v])=>`<div><i class="dot" style="background:${SITE_COLORS[k]}"></i>${escapeText(v)}</div>`).join('')+'<div><strong>Emergency-response resources</strong></div><div>⊞ Fire Stations</div><div>⊞ EMS Facilities</div><div><i class="dot" style="background:white;border:2px solid #c00"></i>Within selected radius</div>';
    state.ready=true;applyLayers();
    map.on('click',handleMapClick);
    map.on('mousemove',event=>{map.getCanvas().style.cursor=featureAt(event.point)?'pointer':checked('analysis')?'crosshair':'';});
    document.querySelectorAll('[data-radius]').forEach(b=>b.addEventListener('click',()=>{state.radius=Number(b.dataset.radius);updateQuery();}));
    document.querySelectorAll('[data-layer]').forEach(b=>b.addEventListener('change',()=>{if(b.dataset.layer==='buildings3d')map.easeTo({pitch:b.checked?50:0,zoom:b.checked?Math.max(map.getZoom(),14):map.getZoom(),duration:400});if(b.dataset.layer==='buildings'&&b.checked&&map.getZoom()<12)map.easeTo({zoom:13,duration:400});applyLayers();}));
    $('illustrative-height').addEventListener('change',applyLayers);
    $('clear').addEventListener('click',clear);
    $('reset').addEventListener('click',()=>{clear();map.fitBounds(config.bounds,{padding:35,pitch:0,duration:500});});
    $('about').addEventListener('click',()=>$('notes').showModal());
    window.facilityMap={map,state};
  } catch(error) {
    $('status').textContent='Map could not load';$('error').textContent=error.message;$('error').hidden=false;console.error(error);
  }
}
initialize();
