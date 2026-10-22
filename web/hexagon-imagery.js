// Footprint comes only from the downloaded filenames' standard XYZ coordinates.
const filenames = [
  '15cm_hexagon_utah__10-14-2026__x6202-y12313-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6202-y12314-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6202-y12315-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6203-y12313-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6203-y12314-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6203-y12315-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6204-y12313-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6204-y12314-z15.jpg',
  '15cm_hexagon_utah__10-14-2026__x6204-y12315-z15.jpg',
];
const tiles = filenames.map(filename => filename.match(/__x(\d+)-y(\d+)-z(\d+)\.jpg$/).slice(1).map(Number));
const z = tiles[0][2];
const west = Math.min(...tiles.map(([x]) => x));
const east = Math.max(...tiles.map(([x]) => x)) + 1;
const north = Math.min(...tiles.map(([,y]) => y));
const south = Math.max(...tiles.map(([,y]) => y)) + 1;
const n = 2 ** z;
const longitude = column => column / n * 360 - 180;
const latitude = row => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) * 180 / Math.PI;

export const HEXAGON_IMAGERY = {
  type:'raster',
  tiles:[new URL('./data/hexagon-imagery/{z}/{x}/{y}.jpg',import.meta.url).href.replaceAll('%7B','{').replaceAll('%7D','}')],
  scheme:'xyz',tileSize:512,minzoom:18,maxzoom:19,
  bounds:[longitude(west),latitude(south),longitude(east),latitude(north)],
  attribution:'© 2026 <a href="https://hxgncontent.com" target="_blank" rel="noopener">HxGN Content Program</a>, Hexagon',
};

// Overview tiles combine neighboring images on the same XYZ grid. Zooms below
// the source filenames' z15 have transparent padding outside their coverage.
export const HEXAGON_OVERVIEW = {
  ...HEXAGON_IMAGERY,
  tiles:[new URL('./data/hexagon-imagery/overviews/{z}/{x}/{y}.webp',import.meta.url).href.replaceAll('%7B','{').replaceAll('%7D','}')],
  minzoom:12,maxzoom:17,
};
