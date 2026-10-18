const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readable=value=>String(value??'').replaceAll('_',' ');
const present=value=>value!==undefined&&value!==null&&value!=='';
const modes={bus:'Bus',light_rail:'Light rail / TRAX',commuter_rail:'Commuter rail / FrontRunner',other:'Other transit'};
const categories={crowd:'Gathering & High-Activity Places',care_education:'Health, Education & Care',infrastructure:'Critical Infrastructure',hazmat:'Fuel & Hazardous-Material Facilities',emergency:'Emergency-Response Resources'};

// Display existing static attributes only. No population or service calculation.
export function featureDetails(feature,kind,feedVersion='') {
  const p=feature.properties||{};
  let title,rows,note='';
  if(kind==='vehicle') {
    const localTime=value=>Number(value)>0?new Date(Number(value)*1000).toLocaleString('en-US'):'';
    const vehicleModes={bus:'Bus',rail:'TRAX / rail',frontrunner:'FrontRunner',unknown:'Unknown route type'};
    title=p.route_name||`Live UTA vehicle ${p.vehicle_id||''}`;
    rows=[['Route',p.route_name||p.route_id],['Route ID',p.route_id],['Vehicle type',vehicleModes[p.vehicle_mode]],
      ['Vehicle ID',p.vehicle_id],['Vehicle label',p.vehicle_label],['Trip ID',p.trip_id],['Direction ID',p.direction_id],
      ['Bearing',present(p.bearing)?`${Number(p.bearing).toFixed(0)}°`:null],['Vehicle update',localTime(p.vehicle_timestamp)],
      ['Feed update',localTime(p.feed_timestamp)],['Received',localTime(p.received_timestamp)],['Source','UTA Vehicle Positions via Vercel proxy']];
    note='GTFS direction IDs are 0/1 as supplied; they do not specify a compass direction. '+
      (p.route_matched===true||p.route_matched==='true'?`Route details match the existing static GTFS ${p.route_match_method==='trip_id'?'trip-to-route lookup':'route ID'}.`:'This route ID is not in the existing static route layer; its vehicle type is unknown.');
  } else if(kind==='facility') {
    title=p.name||readable(p.subcategory)||'Mapped facility';
    rows=[['Category',categories[p.category]||readable(p.category)],['Subtype',readable(p.primary_subcategory||p.subcategory)],['Roles',p.roles],['Source',p.source],['Source date',p.date],['Feature ID',p.id||feature.id],['Geometry',readable(p.geometry_quality)],['Recorded status',readable(p.operational_status||p.status)],['Co-located EMS',p.ems_name],['EMS source/date',[p.ems_source,p.ems_date].filter(Boolean).join(' · ')],['Availability',p.availability]];
    note=p.warning||'Archived mapped location; current activity, staffing and availability are not verified.';
  } else if(kind==='parcel') {
    title=`Parcel ${p.parcel_id||p.id||feature.id||''}`;
    const population=present(p.population_est)&&Number.isFinite(Number(p.population_est))?`${Number(p.population_est).toLocaleString('en-US',{maximumFractionDigits:1})} (modeled)`:'Not available / not allocated';
    rows=[['Parcel ID',p.parcel_id],['Record ID',p.id||feature.id],['Property-use class',p.property_class||p.prop_class],['Land-use group',readable(p.group||p.class_group)],['Modeled population',population],['Source',p.source||'UGRC SGID / Salt Lake County assessor'],['Parcel snapshot',p.ASOF_DATE||p.asof_date],['Population method',p.pop_method],['Residential coverage',readable(p.residential_coverage)],['Source block group(s)',p.bg_ids],['Source BG 90% MOE (max)',p.source_pop_moe_max]];
    note='Stored parcel estimates are displayed unchanged. Population is modeled from ACS 2020–2024 residential area weighting, not observed occupancy. Source block-group MOE is not parcel-level uncertainty. Property classes are not zoning.';
  } else if(kind==='rail') {
    const routes=JSON.parse(p.routes_json||'[]');
    title=`Rail track · ${routes.length} ${routes.length===1?'route':'routes'}`;
    rows=routes.flatMap((route,index)=>[
      [`Route ${index+1}`,[route.short_name,route.long_name].filter(Boolean).join(' · ')||route.route_id],
      ['Route ID',route.route_id],['Route type',modes[route.mode]||readable(route.mode)],
      ['GTFS route type',route.route_type],['Route color',route.color?`#${String(route.color).replace(/^#/,'')}`:''],
      ['Source',`UTA · ${route.service_source||'Archived GTFS'}`],['Feed version',route.feed_version],
    ]);
    note='All archived GTFS rail routes using this shared segment are listed. Nearly identical track shapes within 3 m are combined for display only; source route data is unchanged.';
  } else if(kind==='route') {
    title=[p.short_name,p.long_name].filter(Boolean).join(' · ')||`Route ${p.route_id||''}`;
    rows=[['Route number',p.short_name],['Route name',p.long_name],['Route type',modes[p.mode]||readable(p.mode)],['GTFS route type',p.route_type],['Route ID',p.route_id],['Shape ID',p.shape_id],['Source',`UTA · ${p.service_source||'Archived GTFS'}`],['Feed version',p.feed_version],['Agency ID',p.agency_id],['Description',p.route_desc]];
    note='Archived scheduled route geometry. This does not indicate current operations or live vehicle positions.';
  } else {
    title=p.name||p.stop_name||`Stop ${p.stop_id||''}`;
    rows=[['Stop / station name',p.name||p.stop_name],['Stop ID',p.stop_id],['Stop code',p.stop_code],['Mode / type',modes[p.mode]||readable(p.mode)],['Served modes',readable(p.modes)],['Routes',p.route_names],['Route IDs',p.route_ids],['Scheduled route count',p.scheduled_routes],['Location type',p.location_type],['Parent station',p.parent_station],['Description',p.stop_desc],['Source',p.source||'UTA archived GTFS'],['Feed version',p.feed_version||feedVersion]];
    note='Archived scheduled stop/station location; no live arrival predictions or service status.';
  }
  return `<section class="feature-details" data-feature-kind="${kind}"><h3>${esc(title)}</h3><dl>${rows.filter(([,v])=>present(v)).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="note">${esc(note)}</p></section>`;
}
