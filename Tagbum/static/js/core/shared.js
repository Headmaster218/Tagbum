export const groupCache = new Map();

export const previewState = {
  group: null,
  resourceId: null,
  contextIds: [],
  scale: 1,
  panX: 0,
  panY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0,
  holdTimer: null,
  suppressModalViewClick: false,
  volume: Number(localStorage.getItem("tagbum.previewVolume") || "1"),
  muted: localStorage.getItem("tagbum.previewMuted") === "true",
};

export const taggerState = {
  groups: [],
  index: 0,
  baseOffset: 0,
  total: 0,
  status: "untagged",
  loading: false,
};

export const dateStripState = new WeakMap();
export const MAP_DENSITY_LEVELS = [10, 20, 40, 84, 140, 200];

export const homeState = {
  total: 0,
  pageSize: 72,
  nextOffset: 0,
  loading: false,
  done: false,
  pageNumber: 0,
  lastMonthKey: null,
  requestedDate: "",
  timelineItems: [],
  timelineDragging: false,
  timelineMoved: false,
  timelineStartY: 0,
  timelineScrollTop: 0,
};

export const filterState = {
  total: 0,
  pageSize: 72,
  nextOffset: 0,
  loading: false,
  done: false,
  pageNumber: 0,
  lastMonthKey: null,
  requestedDate: "",
  timelineItems: [],
  timelineDragging: false,
  timelineMoved: false,
  timelineStartY: 0,
  timelineScrollTop: 0,
  tag: "",
  kind: "",
};

export const MAP_TILE_PROVIDERS = {
  osm: {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    darkUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "OpenStreetMap contributors",
    darkAttribution: "OpenStreetMap contributors / CARTO",
    coordinateSystem: "wgs84",
    subdomains: [""],
    darkSubdomains: ["a", "b", "c", "d"],
  },
  amap: {
    name: "Amap",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
    darkUrl: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    attribution: "Amap",
    darkAttribution: "Amap",
    coordinateSystem: "gcj02",
    subdomains: ["1", "2", "3", "4"],
    darkSubdomains: ["1", "2", "3", "4"],
  },
};

export const mapState = {
  centerLat: 30,
  centerLon: 104,
  zoom: 10,
  tileZoom: 10,
  tileProviderKey: "osm",
  tileProvider: MAP_TILE_PROVIDERS.osm,
  rows: 7,
  cols: 12,
  densityIndex: 3,
  densityTarget: 84,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartCenter: null,
  refreshTimer: null,
};

export const mapCellState = {
  groups: [],
  selectedId: null,
  bounds: null,
  row: 0,
  col: 0,
  loading: false,
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function formatMonthLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

export function compactDateItems(items, bucketSize = 5) {
  const compact = [];
  for (let index = 0; index < items.length; index += bucketSize) {
    const bucket = items.slice(index, index + bucketSize);
    const start = bucket[0].date;
    const end = bucket[bucket.length - 1].date;
    const count = bucket.reduce((total, item) => total + item.count, 0);
    compact.push({ date: start, end_date: end, count });
  }
  return compact;
}

export function resolveDateBucket(items, value) {
  if (!items.length) return null;
  if (!value) return items[items.length - 1];
  const exact = items.find((item) => item.date === value);
  if (exact) return exact;
  const containing = items.find((item) => item.date <= value && value <= item.end_date);
  if (containing) return containing;
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return items[items.length - 1];
  return items.reduce((nearest, item) => {
    const itemTime = new Date(`${item.date}T00:00:00`).getTime();
    const nearestTime = new Date(`${nearest.date}T00:00:00`).getTime();
    return Math.abs(itemTime - target.getTime()) < Math.abs(nearestTime - target.getTime()) ? item : nearest;
  }, items[0]);
}

export function formatMonthKey(value) {
  if (!value) return "unknown";
  return value.slice(0, 7);
}

export function formatMonthTitle(value) {
  if (!value) return "Unknown";
  const [year, month] = value.split("-");
  return `${year}/${Number(month)}`;
}

export function imageResource(group) {
  return group.resources?.find((item) => item.kind === "image") || null;
}

export function videoResource(group) {
  return group.resources?.find((item) => item.kind === "live")
    || group.resources?.find((item) => item.kind === "video")
    || null;
}

export function imageUrl(resource) {
  return resource?.preview_url || resource?.url;
}

export function downloadResource(group) {
  return imageResource(group) || videoResource(group) || group.resources?.[0] || null;
}

export function kindBadgeMeta(kind) {
  const mapping = {
    image: { letter: "I", label: "Image", className: "kind-image" },
    live: { letter: "L", label: "Live", className: "kind-live" },
    video: { letter: "V", label: "Video", className: "kind-video" },
    edited: { letter: "E", label: "Edited", className: "kind-edited" },
  };
  return mapping[kind] || { letter: String(kind || "?").slice(0, 1).toUpperCase(), label: kind, className: "kind-generic" };
}

export function kindBadgesHtml(kinds) {
  return (kinds || []).map((kind) => {
    const meta = kindBadgeMeta(kind);
    return `<span class="chip resource-kind-badge ${meta.className}" title="${escapeHtml(meta.label)}">${escapeHtml(meta.letter)}</span>`;
  }).join("");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

export function transformGcjLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

export function transformGcjLon(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

export function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return { lon, lat };
  const a = 6378245.0;
  const ee = 0.006693421622965943;
  let dLat = transformGcjLat(lon - 105.0, lat - 35.0);
  let dLon = transformGcjLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lon: lon + dLon, lat: lat + dLat };
}

export function gcj02ToWgs84(lon, lat) {
  if (outOfChina(lon, lat)) return { lon, lat };
  const offset = wgs84ToGcj02(lon, lat);
  return {
    lon: lon * 2 - offset.lon,
    lat: lat * 2 - offset.lat,
  };
}

export function mapDisplayLonLat(lon, lat) {
  return mapState.tileProvider.coordinateSystem === "gcj02" ? wgs84ToGcj02(lon, lat) : { lon, lat };
}

export function providerDisplayLonLat(provider, lon, lat) {
  return provider?.coordinateSystem === "gcj02" ? wgs84ToGcj02(lon, lat) : { lon, lat };
}

export function providerSourceLonLat(provider, lon, lat) {
  return provider?.coordinateSystem === "gcj02" ? gcj02ToWgs84(lon, lat) : { lon, lat };
}

export function providerAttribution(provider, dark = false) {
  return dark ? (provider.darkAttribution || provider.attribution) : provider.attribution;
}

export function tileUrl(provider, zoom, x, y, options = {}) {
  const dark = options.dark && provider.darkUrl;
  const template = dark ? provider.darkUrl : provider.url;
  const subdomains = dark
    ? (provider.darkSubdomains || provider.subdomains || [""])
    : (provider.subdomains || [""]);
  const subdomain = subdomains[Math.abs(x + y) % subdomains.length] || "";
  return template
    .replace("{s}", subdomain)
    .replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

export function clampWorldY(y, zoom) {
  const scale = 256 * 2 ** zoom;
  return clamp(y, 0, scale);
}

export function lonLatToWorld(lon, lat, zoom) {
  const scale = 256 * 2 ** zoom;
  const sinLat = Math.sin((clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
  return {
    x: ((normalizeLon(lon) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

export function worldToLonLat(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lon = normalizeLon((x / scale) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * clampWorldY(y, zoom)) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

export function setMapCenterFromWorld(x, y, zoom) {
  const next = worldToLonLat(x, y, zoom);
  mapState.centerLat = clamp(next.lat, -85.0511, 85.0511);
  mapState.centerLon = normalizeLon(next.lon);
}

export function wrappedWorldDelta(pointX, centerX, zoom) {
  const scale = 256 * 2 ** zoom;
  let delta = pointX - centerX;
  if (delta > scale / 2) delta -= scale;
  if (delta < -scale / 2) delta += scale;
  return delta;
}
