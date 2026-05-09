const groupCache = new Map();

const previewState = {
  group: null,
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
};

const taggerState = {
  groups: [],
  index: 0,
  baseOffset: 0,
  total: 0,
  status: "untagged",
  loading: false,
};

const dateStripState = new WeakMap();

const mapState = {
  centerLat: 30,
  centerLon: 104,
  zoom: 10,
  rows: 7,
  cols: 12,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartCenter: null,
  refreshTimer: null,
};

const mapCellState = {
  groups: [],
  selectedId: null,
  bounds: null,
  row: 0,
  col: 0,
  loading: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatMonthLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function compactDateItems(items, bucketSize = 5) {
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

function cellCenterOffset(strip, cell) {
  return cell.offsetLeft + cell.offsetWidth / 2 - strip.clientWidth / 2;
}

function centerDateCell(strip, cell) {
  const previousBehavior = strip.style.scrollBehavior;
  strip.style.scrollBehavior = "auto";
  strip.scrollLeft = Math.max(0, cellCenterOffset(strip, cell));
  strip.style.scrollBehavior = previousBehavior;
}

function cellAtStripCenter(strip) {
  const cells = [...strip.querySelectorAll("[data-date]")];
  if (!cells.length) return null;
  const center = strip.scrollLeft + strip.clientWidth / 2;
  return cells.reduce((nearest, cell) => {
    const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
    const nearestCenter = nearest.offsetLeft + nearest.offsetWidth / 2;
    return Math.abs(cellCenter - center) < Math.abs(nearestCenter - center) ? cell : nearest;
  }, cells[0]);
}

function updateDateStripFromCenter(strip, updateHidden = true) {
  const cell = cellAtStripCenter(strip);
  if (!cell) return;
  setDateStripSelection(strip, cell.dataset.date, cell.dataset.count, updateHidden, false);
}

function setDateStripSelection(strip, value, count = null, updateHidden = true, recenter = true) {
  const form = strip.closest("form");
  const hidden = form?.querySelector("[data-date-strip-value]");
  const info = form?.querySelector("[data-date-strip-info]");
  if (hidden && updateHidden) hidden.value = value;
  strip.dataset.selectedDate = value;
  strip.querySelectorAll(".date-cell.active").forEach((cell) => cell.classList.remove("active"));
  const cell = strip.querySelector(`[data-date="${CSS.escape(value)}"]`);
  if (cell) {
    cell.classList.add("active");
    if (recenter) centerDateCell(strip, cell);
  }
  const shownCount = count ?? cell?.dataset.count ?? 0;
  const endDate = cell?.dataset.endDate || value;
  if (info) info.textContent = endDate === value ? `${value} · ${shownCount} 张` : `${value} - ${endDate} · ${shownCount} 张`;
}

async function initDateStrips() {
  const strips = [...document.querySelectorAll("[data-date-strip]")];
  await Promise.all(strips.map(initDateStrip));
}

async function initDateStrip(strip) {
  const params = new URLSearchParams();
  if (strip.dataset.tagStatus) params.set("tag_status", strip.dataset.tagStatus);
  const response = await fetch(`/api/dates?${params.toString()}`);
  const payload = await response.json();
  if (!payload.dates.length) {
    strip.innerHTML = `<span class="muted-text">没有可用日期</span>`;
    return;
  }

  const dateItems = compactDateItems(payload.dates, 5);
  strip.innerHTML = dateItems
    .map((item) => {
      const hasImages = item.count > 0;
      const day = Number(item.date.slice(8, 10));
      const monthLabel = day === 1 ? `<span class="month-label">${formatMonthLabel(item.date)}</span>` : "";
      return `<button class="date-cell ${hasImages ? "has-images" : "empty-day"} ${day <= 5 ? "month-start" : ""}" type="button" data-date="${item.date}" data-end-date="${item.end_date}" data-count="${item.count}" title="${item.date} - ${item.end_date} · ${item.count} 张"><span class="tick"></span>${monthLabel}</button>`;
    })
    .join("");

  strip.addEventListener("wheel", (event) => {
    event.preventDefault();
    strip.scrollLeft += event.deltaY || event.deltaX;
    updateDateStripFromCenter(strip, true);
  }, { passive: false });

  let scrollTimer = null;
  strip.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => updateDateStripFromCenter(strip, true), 40);
  });

  dateStripState.set(strip, { dragging: false, moved: false, startX: 0, scrollLeft: 0 });

  strip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const state = dateStripState.get(strip);
    state.dragging = true;
    state.moved = false;
    state.startX = event.clientX;
    state.scrollLeft = strip.scrollLeft;
    strip.setPointerCapture(event.pointerId);
    strip.classList.add("dragging");
  });

  strip.addEventListener("pointermove", (event) => {
    const state = dateStripState.get(strip);
    if (!state?.dragging) return;
    const delta = event.clientX - state.startX;
    if (Math.abs(delta) > 3) state.moved = true;
    strip.scrollLeft = state.scrollLeft - delta;
  });

  strip.addEventListener("pointerup", (event) => {
    const state = dateStripState.get(strip);
    if (!state) return;
    state.dragging = false;
    strip.releasePointerCapture(event.pointerId);
    strip.classList.remove("dragging");
    updateDateStripFromCenter(strip, true);
  });

  strip.addEventListener("pointercancel", () => {
    const state = dateStripState.get(strip);
    if (!state) return;
    state.dragging = false;
    strip.classList.remove("dragging");
  });

  strip.addEventListener("click", (event) => {
    const state = dateStripState.get(strip);
    if (state?.moved) {
      state.moved = false;
      return;
    }
    const cell = event.target.closest("[data-date]");
    if (!cell) return;
    setDateStripSelection(strip, cell.dataset.date, cell.dataset.count, true, true);
  });

  const selected = strip.dataset.selectedDate || payload.max_date;
  setDateStripSelection(strip, selected, null, Boolean(strip.dataset.selectedDate), true);
}

function imageResource(group) {
  return group.resources?.find((item) => item.kind === "image") || null;
}

function videoResource(group) {
  return group.resources?.find((item) => item.kind === "live") || group.resources?.find((item) => item.kind === "video") || null;
}

function imageUrl(resource) {
  return resource?.preview_url || resource?.url;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clampWorldY(y, zoom) {
  const scale = 256 * 2 ** zoom;
  return clamp(y, 0, scale);
}

function lonLatToWorld(lon, lat, zoom) {
  const scale = 256 * 2 ** zoom;
  const sinLat = Math.sin((clamp(lat, -85.0511, 85.0511) * Math.PI) / 180);
  return {
    x: ((normalizeLon(lon) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldToLonLat(x, y, zoom) {
  const scale = 256 * 2 ** zoom;
  const lon = normalizeLon((x / scale) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * clampWorldY(y, zoom)) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

function setMapCenterFromWorld(x, y, zoom) {
  const next = worldToLonLat(x, y, zoom);
  mapState.centerLat = clamp(next.lat, -85.0511, 85.0511);
  mapState.centerLon = normalizeLon(next.lon);
}

function wrappedWorldDelta(pointX, centerX, zoom) {
  const scale = 256 * 2 ** zoom;
  let delta = pointX - centerX;
  if (delta > scale / 2) delta -= scale;
  if (delta < -scale / 2) delta += scale;
  return delta;
}

function mapBounds(map) {
  const width = map.clientWidth;
  const height = map.clientHeight;
  const scale = 256 * 2 ** mapState.zoom;
  const center = lonLatToWorld(mapState.centerLon, mapState.centerLat, mapState.zoom);
  const nw = worldToLonLat(center.x - width / 2, center.y - height / 2, mapState.zoom);
  const se = worldToLonLat(center.x + width / 2, center.y + height / 2, mapState.zoom);
  const coversFullWorld = width >= scale;
  return {
    west: coversFullWorld ? -180 : nw.lon,
    north: nw.lat,
    east: coversFullWorld ? 180 : se.lon,
    south: se.lat,
  };
}

function currentMapRequestParams(extra = {}) {
  const map = document.querySelector("[data-map]");
  if (!map) return null;
  const bounds = mapBounds(map);
  return {
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
    rows: String(mapState.rows),
    cols: String(mapState.cols),
    ...extra,
  };
}

function renderMap() {
  const map = document.querySelector("[data-map]");
  if (!map) return;
  renderMapTiles(map);
  renderMapMarkers(map);
}

function renderMapTiles(map) {
  const tiles = map.querySelector("[data-map-tiles]");
  const width = map.clientWidth;
  const height = map.clientHeight;
  const zoom = mapState.zoom;
  const center = lonLatToWorld(mapState.centerLon, mapState.centerLat, zoom);
  const startX = Math.floor((center.x - width / 2) / 256);
  const endX = Math.floor((center.x + width / 2) / 256);
  const startY = Math.floor((center.y - height / 2) / 256);
  const endY = Math.floor((center.y + height / 2) / 256);
  const maxTile = 2 ** zoom;
  const html = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      const left = x * 256 - center.x + width / 2;
      const top = y * 256 - center.y + height / 2;
      html.push(`<img class="map-tile" src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png" style="left:${left}px;top:${top}px" alt="">`);
    }
  }
  tiles.innerHTML = html.join("");
}

function renderMapMarkersLegacy(map) {
  const markerLayer = map.querySelector("[data-map-markers]");
  const cells = JSON.parse(markerLayer.dataset.cells || "[]");
  const width = map.clientWidth;
  const height = map.clientHeight;
  const center = lonLatToWorld(mapState.centerLon, mapState.centerLat, mapState.zoom);
  markerLayer.innerHTML = cells.map((cell) => {
    const group = cell.group;
    const point = lonLatToWorld(group.longitude, group.latitude, mapState.zoom);
    const left = wrappedWorldDelta(point.x, center.x, mapState.zoom) + width / 2;
    const top = point.y - center.y + height / 2;
    return `
      <button class="map-bubble" type="button" data-map-open="${group.id}" style="left:${left}px;top:${top}px" title="${escapeHtml(group.display_name)} · ${cell.count} 张">
        <span class="map-bubble-thumb">
          ${group.thumbnail_url ? `<img src="${group.thumbnail_url}" alt="${escapeHtml(group.display_name)}">` : `<span class="placeholder">${escapeHtml(group.display_name)}</span>`}
        </span>
        <span class="map-bubble-count">${cell.count}</span>
      </button>
    `;
  }).join("");
}

function renderMapMarkers(map) {
  const markerLayer = map.querySelector("[data-map-markers]");
  const cells = JSON.parse(markerLayer.dataset.cells || "[]");
  const width = map.clientWidth;
  const height = map.clientHeight;
  const center = lonLatToWorld(mapState.centerLon, mapState.centerLat, mapState.zoom);
  markerLayer.innerHTML = cells.map((cell) => {
    const group = cell.group;
    const point = lonLatToWorld(group.longitude, group.latitude, mapState.zoom);
    const left = wrappedWorldDelta(point.x, center.x, mapState.zoom) + width / 2;
    const top = point.y - center.y + height / 2;
    return `
      <button class="map-bubble" type="button" data-map-cell-row="${cell.row}" data-map-cell-col="${cell.col}" style="left:${left}px;top:${top}px" title="${escapeHtml(group.display_name)} · ${cell.count} 张">
        <span class="map-bubble-thumb">
          ${group.thumbnail_url ? `<img src="${group.thumbnail_url}" alt="${escapeHtml(group.display_name)}">` : `<span class="placeholder">${escapeHtml(group.display_name)}</span>`}
        </span>
        <span class="map-bubble-count">${cell.count}</span>
      </button>
    `;
  }).join("");
}

function scheduleMapRefresh(delay = 350) {
  window.clearTimeout(mapState.refreshTimer);
  mapState.refreshTimer = window.setTimeout(refreshMapPhotos, delay);
}

async function refreshMapPhotos() {
  const map = document.querySelector("[data-map]");
  if (!map) return;
  const query = new URLSearchParams(currentMapRequestParams());
  const response = await fetch(`/api/map?${query.toString()}`);
  const cells = await response.json();
  const groups = cells.map((cell) => cell.group);
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  const markerLayer = map.querySelector("[data-map-markers]");
  markerLayer.dataset.cells = JSON.stringify(cells);
  renderMapMarkers(map);
  const count = document.querySelector("[data-map-count]");
  if (count) {
    const photoCount = cells.reduce((total, cell) => total + cell.count, 0);
    count.textContent = cells.length ? `${cells.length} 个位置 · ${photoCount} 张` : "当前视野没有带位置的照片";
  }
}

function ensureMapCellPanel() {
  let panel = document.querySelector(".map-cell-panel");
  if (panel) return panel;
  const map = document.querySelector("[data-map]");
  panel = document.createElement("div");
  panel.className = "map-cell-panel";
  panel.innerHTML = `
    <div class="map-cell-board">
      <section class="map-cell-list">
        <div class="map-cell-head">
          <h2 data-map-cell-title>当前位置</h2>
          <button type="button" data-map-cell-close>关闭</button>
        </div>
        <div class="map-cell-thumbs" data-map-cell-thumbs></div>
      </section>
      <section class="map-cell-detail">
        <button class="map-cell-preview" type="button" data-map-cell-live data-map-cell-open-preview>
          <img data-map-cell-image alt="">
          <video data-map-cell-video muted loop playsinline hidden></video>
          <div class="placeholder" data-map-cell-placeholder hidden>没有可预览资源</div>
        </button>
        <div class="map-cell-tagger">
          <div>
            <h3 data-map-cell-name>未选择照片</h3>
            <p class="muted-text" data-map-cell-date></p>
          </div>
          <form class="inline-form" data-map-cell-quick-form>
            <input name="name" placeholder="新增标签" autocomplete="off">
            <button type="submit">添加</button>
          </form>
          <div class="chips" data-map-cell-tags></div>
          <div>
            <h3>标签库</h3>
            <div class="chips tag-library" data-map-cell-library></div>
          </div>
        </div>
      </section>
    </div>
  `;
  map.appendChild(panel);
  panel.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.querySelector("[data-map-cell-close]").addEventListener("click", closeMapCellPanel);
  panel.querySelector("[data-map-cell-live]").addEventListener("mouseenter", () => setMapCellLive(true));
  panel.querySelector("[data-map-cell-live]").addEventListener("mouseleave", () => setMapCellLive(false));
  return panel;
}

function closeMapCellPanel() {
  setMapCellLive(false);
  const panel = document.querySelector(".map-cell-panel");
  if (panel) panel.classList.remove("open");
}

function selectedMapCellGroup() {
  return mapCellState.groups.find((group) => Number(group.id) === Number(mapCellState.selectedId)) || null;
}

async function openMapCell(row, col) {
  const params = currentMapRequestParams({ row: String(row), col: String(col) });
  if (!params) return;
  mapCellState.loading = true;
  mapCellState.row = Number(row);
  mapCellState.col = Number(col);
  mapCellState.bounds = params;
  const panel = ensureMapCellPanel();
  panel.classList.add("open");
  panel.querySelector("[data-map-cell-title]").textContent = "加载中";
  panel.querySelector("[data-map-cell-thumbs]").innerHTML = "";

  const response = await fetch(`/api/map/cell?${new URLSearchParams(params).toString()}`);
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  mapCellState.groups = groups;
  mapCellState.selectedId = groups[0]?.id || null;
  mapCellState.loading = false;
  await renderMapCellPanel();
}

async function renderMapCellPanel() {
  const panel = ensureMapCellPanel();
  const groups = mapCellState.groups;
  const selected = selectedMapCellGroup();
  panel.querySelector("[data-map-cell-title]").textContent = `${groups.length} 张照片`;
  panel.querySelector("[data-map-cell-thumbs]").innerHTML = groups.length
    ? groups.map((group) => `
      <button class="map-cell-thumb ${Number(group.id) === Number(mapCellState.selectedId) ? "active" : ""}" type="button" data-map-cell-select="${group.id}">
        ${group.thumbnail_url ? `<img src="${group.thumbnail_url}" alt="${escapeHtml(group.display_name)}">` : `<span class="placeholder">${escapeHtml(group.display_name)}</span>`}
      </button>
    `).join("")
    : `<p class="empty">这个格子里没有照片。</p>`;
  renderMapCellSelected(selected);
  await renderMapCellLibrary();
}

function renderMapCellSelected(group) {
  const panel = ensureMapCellPanel();
  const image = panel.querySelector("[data-map-cell-image]");
  const video = panel.querySelector("[data-map-cell-video]");
  const placeholder = panel.querySelector("[data-map-cell-placeholder]");
  const name = panel.querySelector("[data-map-cell-name]");
  const date = panel.querySelector("[data-map-cell-date]");
  const tags = panel.querySelector("[data-map-cell-tags]");
  setMapCellLive(false);
  video.removeAttribute("src");

  if (!group) {
    image.hidden = true;
    video.hidden = true;
    placeholder.hidden = false;
    name.textContent = "未选择照片";
    date.textContent = "";
    tags.innerHTML = "";
    return;
  }

  const primaryImage = imageResource(group);
  const liveVideo = videoResource(group);
  if (primaryImage) {
    image.src = imageUrl(primaryImage);
    image.alt = group.display_name;
    image.hidden = false;
    placeholder.hidden = true;
  } else {
    image.hidden = true;
    placeholder.hidden = false;
  }
  if (liveVideo) video.src = liveVideo.url;

  name.textContent = group.display_name;
  date.textContent = group.taken_at ? new Date(group.taken_at).toLocaleString() : "未知时间";
  tags.innerHTML = group.tags.length
    ? group.tags.map((tag) => `<button class="chip removable" type="button" data-map-cell-remove-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="muted-text">暂无标签</span>`;
}

async function renderMapCellLibrary() {
  const library = document.querySelector("[data-map-cell-library]");
  if (!library) return;
  const response = await fetch("/api/tags");
  const tags = await response.json();
  library.innerHTML = tags.length
    ? tags.map((item) => `<button class="chip tag-option" type="button" data-map-cell-tag-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} <span>${item.count}</span></button>`).join("")
    : `<span class="muted-text">暂无标签库</span>`;
}

function setMapCellLive(show) {
  const group = selectedMapCellGroup();
  const panel = document.querySelector(".map-cell-panel");
  if (!panel || !group) return;
  const image = panel.querySelector("[data-map-cell-image]");
  const video = panel.querySelector("[data-map-cell-video]");
  const liveVideo = videoResource(group);
  if (!image || !video || !liveVideo || image.hidden) return;
  if (show) {
    video.src = liveVideo.url;
    video.hidden = false;
    image.classList.add("under-live");
    video.currentTime = 0;
    video.play().catch(() => {});
  } else {
    video.pause();
    video.hidden = true;
    image.classList.remove("under-live");
  }
}

function updateMapCellGroup(updated) {
  const index = mapCellState.groups.findIndex((group) => Number(group.id) === Number(updated.id));
  if (index >= 0) {
    const existing = mapCellState.groups[index];
    if (existing.resources && !updated.resources) updated.resources = existing.resources;
    mapCellState.groups[index] = updated;
  }
  groupCache.set(Number(updated.id), updated);
}

function initMap() {
  const map = document.querySelector("[data-map]");
  if (!map) return;
  mapState.centerLat = Number(map.dataset.centerLat || 30);
  mapState.centerLon = normalizeLon(Number(map.dataset.centerLon || 104));
  mapState.zoom = Number(map.dataset.zoom || 10);
  mapState.rows = Number(map.dataset.rows || 7);
  mapState.cols = Number(map.dataset.cols || 12);
  renderMap();
  scheduleMapRefresh(0);

  map.addEventListener("wheel", (event) => {
    if (event.target.closest(".map-cell-panel")) return;
    event.preventDefault();
    const oldZoom = mapState.zoom;
    const nextZoom = clamp(oldZoom + (event.deltaY < 0 ? 1 : -1), 2, 18);
    if (nextZoom === oldZoom) return;

    const rect = map.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const oldCenter = lonLatToWorld(mapState.centerLon, mapState.centerLat, oldZoom);
    const pointerWorld = {
      x: oldCenter.x - map.clientWidth / 2 + pointerX,
      y: oldCenter.y - map.clientHeight / 2 + pointerY,
    };
    const pointerLonLat = worldToLonLat(pointerWorld.x, pointerWorld.y, oldZoom);
    const nextPointerWorld = lonLatToWorld(pointerLonLat.lon, pointerLonLat.lat, nextZoom);
    setMapCenterFromWorld(
      nextPointerWorld.x - pointerX + map.clientWidth / 2,
      nextPointerWorld.y - pointerY + map.clientHeight / 2,
      nextZoom,
    );
    mapState.zoom = nextZoom;
    renderMap();
    scheduleMapRefresh();
  }, { passive: false });

  map.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (document.querySelector(".map-cell-panel.open")) return;
    if (event.target.closest("[data-map-cell-row], .map-cell-panel")) return;
    mapState.dragging = true;
    mapState.dragStartX = event.clientX;
    mapState.dragStartY = event.clientY;
    mapState.dragStartCenter = lonLatToWorld(mapState.centerLon, mapState.centerLat, mapState.zoom);
    map.setPointerCapture(event.pointerId);
    map.classList.add("dragging");
  });

  map.addEventListener("pointermove", (event) => {
    if (!mapState.dragging) return;
    setMapCenterFromWorld(
      mapState.dragStartCenter.x - (event.clientX - mapState.dragStartX),
      mapState.dragStartCenter.y - (event.clientY - mapState.dragStartY),
      mapState.zoom,
    );
    renderMap();
    scheduleMapRefresh();
  });

  map.addEventListener("pointerup", (event) => {
    mapState.dragging = false;
    map.releasePointerCapture(event.pointerId);
    map.classList.remove("dragging");
    scheduleMapRefresh(150);
  });

  map.addEventListener("pointercancel", () => {
    mapState.dragging = false;
    map.classList.remove("dragging");
  });

  window.addEventListener("resize", () => {
    renderMap();
    scheduleMapRefresh();
  });
}

function galleryContextIds(source) {
  const gallery = source?.closest(".gallery");
  if (!gallery) return [];
  return [...gallery.querySelectorAll("[data-group-id]")]
    .map((item) => Number(item.dataset.groupId))
    .filter(Boolean);
}

async function getGroupDetails(groupId) {
  const key = Number(groupId);
  if (groupCache.has(key) && groupCache.get(key).resources) return groupCache.get(key);
  const response = await fetch(`/api/groups/${key}`);
  const group = await response.json();
  groupCache.set(key, group);
  return group;
}

function ensureModal() {
  let modal = document.querySelector(".modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-media">
      <button class="modal-close-floating" type="button" data-preview-close aria-label="关闭">×</button>
      <button class="modal-nav modal-prev" type="button" data-preview-prev aria-label="上一张">&lt;</button>
      <div class="modal-view" data-live-hold>
        <img class="modal-image" alt="">
        <video class="modal-live" muted loop playsinline hidden></video>
        <div class="placeholder modal-placeholder" hidden>没有可预览资源</div>
      </div>
      <button class="modal-nav modal-next" type="button" data-preview-next aria-label="下一张">&gt;</button>
    </div>
    <aside class="modal-side">
      <button class="modal-close" type="button">关闭</button>
      <h2></h2>
      <div class="preview-tools">
        <button type="button" data-zoom-out>缩小</button>
        <button type="button" data-zoom-reset>原始</button>
        <button type="button" data-zoom-in>放大</button>
      </div>
      <p class="muted-text live-hint" hidden>按住图片播放 Live</p>
      <div class="chips modal-tags"></div>
      <div class="resource-list"></div>
    </aside>
  `;
  document.body.appendChild(modal);
  modal.querySelector(".modal-close").addEventListener("click", closePreview);
  modal.querySelector(".modal-close-floating").addEventListener("click", closePreview);
  modal.addEventListener("click", (event) => {
    if (previewState.suppressModalViewClick) {
      previewState.suppressModalViewClick = false;
      return;
    }
    if (event.target === modal || event.target.classList.contains("modal-media") || event.target.classList.contains("modal-view")) {
      closePreview();
    }
  });
  return modal;
}

function closePreview() {
  const modal = document.querySelector(".modal");
  stopModalLive();
  if (modal) modal.classList.remove("open");
}

function setPreviewScale(scale) {
  previewState.scale = Math.min(5, Math.max(0.25, scale));
  applyPreviewTransform();
}

function applyPreviewTransform() {
  const image = document.querySelector(".modal-image");
  const live = document.querySelector(".modal-live");
  const transform = `translate(${previewState.panX}px, ${previewState.panY}px) scale(${previewState.scale})`;
  if (image) image.style.transform = transform;
  if (live) live.style.transform = transform;
}

function resetPreviewScale() {
  previewState.panX = 0;
  previewState.panY = 0;
  setPreviewScale(1);
}

function renderModalGroup(group) {
  const modal = ensureModal();
  const image = modal.querySelector(".modal-image");
  const live = modal.querySelector(".modal-live");
  const placeholder = modal.querySelector(".modal-placeholder");
  const title = modal.querySelector("h2");
  const tags = modal.querySelector(".modal-tags");
  const resources = modal.querySelector(".resource-list");
  const hint = modal.querySelector(".live-hint");
  const primaryImage = imageResource(group);
  const liveVideo = videoResource(group);

  stopModalLive();
  resetPreviewScale();

  if (primaryImage) {
    image.removeAttribute("src");
    image.src = imageUrl(primaryImage);
    image.alt = group.display_name;
    image.hidden = false;
    image.onerror = () => {
      if (group.thumbnail_url && image.src !== location.origin + group.thumbnail_url) {
        image.src = group.thumbnail_url;
      }
    };
    placeholder.hidden = true;
  } else if (liveVideo) {
    image.hidden = true;
    placeholder.hidden = true;
    live.style.transform = "translate(0, 0) scale(1)";
    live.src = liveVideo.url;
    live.hidden = false;
    live.controls = true;
    live.muted = false;
    live.play().catch(() => {});
  } else {
    image.hidden = true;
    live.hidden = true;
    placeholder.hidden = false;
  }

  if (primaryImage && liveVideo) {
    live.src = liveVideo.url;
    live.controls = false;
    live.muted = true;
    hint.hidden = false;
  } else {
    live.removeAttribute("src");
    hint.hidden = true;
  }

  title.textContent = group.display_name;
  tags.innerHTML = group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  resources.innerHTML = group.resources
    .map((item) => `<a href="${item.url}" target="_blank">${escapeHtml(item.filename)}<br>${escapeHtml(item.kind)} ${escapeHtml(item.extension)}</a>`)
    .join("");
}

async function openPreview(groupId, contextIds = []) {
  const group = await getGroupDetails(groupId);
  previewState.group = group;
  previewState.contextIds = contextIds.length ? contextIds : previewState.contextIds;
  renderModalGroup(group);
  ensureModal().classList.add("open");
}

async function movePreview(delta) {
  if (!previewState.group || !previewState.contextIds.length) return;
  const current = previewState.contextIds.indexOf(Number(previewState.group.id));
  const next = current + delta;
  if (next < 0 || next >= previewState.contextIds.length) return;
  await openPreview(previewState.contextIds[next], previewState.contextIds);
}

function startModalLive() {
  const modal = document.querySelector(".modal");
  if (!modal || !previewState.group || !imageResource(previewState.group) || !videoResource(previewState.group)) return;
  const image = modal.querySelector(".modal-image");
  const live = modal.querySelector(".modal-live");
  image.hidden = true;
  live.hidden = false;
  live.currentTime = 0;
  applyPreviewTransform();
  live.play().catch(() => {});
}

function stopModalLive() {
  clearTimeout(previewState.holdTimer);
  const wasHolding = previewState.holdTimer !== null;
  previewState.holdTimer = null;
  const modal = document.querySelector(".modal");
  if (!modal) return;
  const live = modal.querySelector(".modal-live");
  const image = modal.querySelector(".modal-image");
  live.pause();
  if (previewState.group && imageResource(previewState.group)) {
    live.hidden = true;
    image.hidden = false;
  }
  if (wasHolding) {
    previewState.suppressModalViewClick = true;
    window.setTimeout(() => {
      previewState.suppressModalViewClick = false;
    }, 250);
  }
}

async function addTagToGroup(groupId, tagName) {
  const data = new FormData();
  data.set("name", tagName);
  const response = await fetch(`/api/groups/${groupId}/tags`, { method: "POST", body: data });
  const group = await response.json();
  const existing = groupCache.get(Number(group.id));
  if (existing?.resources && !group.resources) group.resources = existing.resources;
  groupCache.set(Number(group.id), group);
  return group;
}

async function removeTagFromGroup(groupId, tagName) {
  const response = await fetch(`/api/groups/${groupId}/tags/${encodeURIComponent(tagName)}`, { method: "DELETE" });
  const group = await response.json();
  const existing = groupCache.get(Number(group.id));
  if (existing?.resources && !group.resources) group.resources = existing.resources;
  groupCache.set(Number(group.id), group);
  return group;
}

function currentTaggerGroup() {
  return taggerState.groups[taggerState.index] || null;
}

async function loadTaggerChunk() {
  if (taggerState.loading) return;
  taggerState.loading = true;
  const response = await fetch(
    `/api/groups?tag_status=${encodeURIComponent(taggerState.status)}&include_resources=true&offset=${taggerState.baseOffset + taggerState.groups.length}&limit=80`
  );
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  taggerState.groups.push(...groups);
  taggerState.loading = false;
}

async function loadTaggerWindow(offset) {
  taggerState.loading = true;
  taggerState.baseOffset = Math.max(0, Math.min(offset, Math.max(0, taggerState.total - 1)));
  taggerState.index = 0;
  const response = await fetch(
    `/api/groups?tag_status=${encodeURIComponent(taggerState.status)}&include_resources=true&offset=${taggerState.baseOffset}&limit=80`
  );
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  taggerState.groups = groups;
  taggerState.loading = false;
}

function renderTagLibrary(tags) {
  const library = document.querySelector("#tag-library");
  const empty = document.querySelector("#tag-library-empty");
  if (!library) return;
  library.innerHTML = tags
    .map((item) => `<button class="chip tag-option" type="button" data-tag-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} <span>${item.count}</span></button>`)
    .join("");
  if (empty) empty.hidden = tags.length > 0;
}

async function refreshTagLibrary() {
  const response = await fetch("/api/tags");
  renderTagLibrary(await response.json());
}

function renderCurrentTags(group) {
  const current = document.querySelector("#current-tags");
  if (!current) return;
  current.innerHTML = group.tags.length
    ? group.tags.map((tag) => `<button class="chip removable" type="button" data-remove-current-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="muted-text">暂无标签</span>`;
}

function setTaggerLive(show) {
  const group = currentTaggerGroup();
  const image = document.querySelector("#tagger-image");
  const live = document.querySelector("#tagger-live");
  const video = group ? videoResource(group) : null;
  if (!image || !live || !video || placeholderIsActive()) return;

  if (show) {
    live.src = video.url;
    live.hidden = false;
    image.classList.add("under-live");
    live.currentTime = 0;
    live.play().catch(() => {});
  } else {
    live.pause();
    live.hidden = true;
    image.classList.remove("under-live");
  }
}

function placeholderIsActive() {
  const image = document.querySelector("#tagger-image");
  return !image || image.hidden;
}

function renderTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  const group = currentTaggerGroup();
  const image = document.querySelector("#tagger-image");
  const live = document.querySelector("#tagger-live");
  const placeholder = document.querySelector("#tagger-placeholder");
  const title = document.querySelector("#tagger-title");
  const date = document.querySelector("#tagger-date");
  const kinds = document.querySelector("#tagger-kinds");
  const position = document.querySelector("#tagger-position");

  setTaggerLive(false);
  image.classList.remove("under-live");
  live.removeAttribute("src");

  if (!group) {
    image.hidden = true;
    live.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = "没有可处理的照片";
    title.textContent = "未选择照片";
    date.textContent = "";
    kinds.innerHTML = "";
    position.textContent = "0";
    renderCurrentTags({ tags: [] });
    return;
  }

  const liveVideo = videoResource(group);
  if (group.thumbnail_url) {
    image.src = group.thumbnail_url;
    image.alt = group.display_name;
    image.hidden = false;
    placeholder.hidden = true;
  } else {
    image.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = group.display_name;
  }

  if (liveVideo) live.src = liveVideo.url;

  title.textContent = group.display_name;
  date.textContent = group.taken_at ? new Date(group.taken_at).toLocaleString() : "未知时间";
  kinds.innerHTML = group.resource_kinds.map((kind) => `<span class="chip muted">${escapeHtml(kind)}</span>`).join("");
  position.textContent = String(taggerState.baseOffset + taggerState.index + 1);
  renderCurrentTags(group);
}

async function moveTagger(delta) {
  const nextIndex = taggerState.index + delta;
  if (nextIndex < 0) {
    if (taggerState.baseOffset <= 0) return;
    const nextOffset = Math.max(0, taggerState.baseOffset - 80);
    await loadTaggerWindow(nextOffset);
    taggerState.index = Math.min(79, taggerState.groups.length - 1);
    renderTagger();
    return;
  }
  if (nextIndex >= taggerState.groups.length - 12 && taggerState.baseOffset + taggerState.groups.length < taggerState.total) {
    await loadTaggerChunk();
  }
  if (nextIndex >= taggerState.groups.length) return;
  taggerState.index = nextIndex;
  renderTagger();
}

async function jumpTaggerToOffset(offset) {
  await loadTaggerWindow(offset);
  renderTagger();
}

async function resolveTaggerOffset(params) {
  const query = new URLSearchParams({ tag_status: taggerState.status });
  if (params.index) query.set("index", params.index);
  if (params.jumpDate) query.set("jump_date", params.jumpDate);
  const response = await fetch(`/api/position?${query.toString()}`);
  return response.json();
}

async function copyPreviousTags() {
  const group = currentTaggerGroup();
  const previous = taggerState.groups[taggerState.index - 1];
  if (!group || !previous || !previous.tags.length) return;
  let updated = group;
  for (const tag of previous.tags) {
    updated = await addTagToGroup(group.id, tag);
  }
  Object.assign(group, updated);
  renderTagger();
  await refreshTagLibrary();
}

async function initTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  taggerState.total = Number(root.dataset.totalGroups || 0);
  taggerState.status = root.dataset.tagStatus || "untagged";
  await loadTaggerChunk();
  renderTagger();

  const photo = document.querySelector(".tagger-photo");
  photo.addEventListener("mouseenter", () => setTaggerLive(true));
  photo.addEventListener("mouseleave", () => setTaggerLive(false));
}

document.addEventListener("click", async (event) => {
  const mapCell = event.target.closest("[data-map-cell-row]");
  if (mapCell) {
    await openMapCell(mapCell.dataset.mapCellRow, mapCell.dataset.mapCellCol);
    return;
  }

  if (event.target.closest("[data-map-cell-open-preview]")) {
    const group = selectedMapCellGroup();
    if (group) {
      setMapCellLive(false);
      await openPreview(group.id, mapCellState.groups.map((item) => Number(item.id)));
    }
    return;
  }

  const openMapPanel = document.querySelector(".map-cell-panel.open");
  if (openMapPanel && event.target.closest("[data-map]") && !event.target.closest(".map-cell-board")) {
    closeMapCellPanel();
    return;
  }

  const mapCellSelect = event.target.closest("[data-map-cell-select]");
  if (mapCellSelect) {
    mapCellState.selectedId = Number(mapCellSelect.dataset.mapCellSelect);
    renderMapCellSelected(selectedMapCellGroup());
    document.querySelectorAll(".map-cell-thumb.active").forEach((item) => item.classList.remove("active"));
    mapCellSelect.classList.add("active");
    return;
  }

  const mapCellTag = event.target.closest("[data-map-cell-tag-name]");
  if (mapCellTag) {
    const group = selectedMapCellGroup();
    if (!group) return;
    const updated = await addTagToGroup(group.id, mapCellTag.dataset.mapCellTagName);
    updateMapCellGroup(updated);
    renderMapCellSelected(selectedMapCellGroup());
    await renderMapCellLibrary();
    return;
  }

  const mapCellRemoveTag = event.target.closest("[data-map-cell-remove-tag]");
  if (mapCellRemoveTag) {
    const group = selectedMapCellGroup();
    if (!group) return;
    const updated = await removeTagFromGroup(group.id, mapCellRemoveTag.dataset.mapCellRemoveTag);
    updateMapCellGroup(updated);
    renderMapCellSelected(selectedMapCellGroup());
    await renderMapCellLibrary();
    return;
  }

  const mapMarker = event.target.closest("[data-map-open]");
  if (mapMarker) {
    const ids = [...document.querySelectorAll("[data-map-open]")].map((item) => Number(item.dataset.mapOpen));
    await openPreview(mapMarker.dataset.mapOpen, ids);
    return;
  }

  const preview = event.target.closest("[data-open-preview]");
  if (preview) {
    await openPreview(preview.dataset.openPreview, galleryContextIds(preview));
    return;
  }

  const openCurrent = event.target.closest("[data-open-current]");
  if (openCurrent) {
    const group = currentTaggerGroup();
    if (group) await openPreview(group.id, taggerState.groups.map((item) => Number(item.id)));
    return;
  }

  if (event.target.closest("[data-preview-prev]")) {
    await movePreview(-1);
    return;
  }

  if (event.target.closest("[data-preview-next]")) {
    await movePreview(1);
    return;
  }

  if (event.target.closest("[data-preview-close]")) {
    closePreview();
    return;
  }

  if (event.target.closest("[data-zoom-in]")) {
    setPreviewScale(previewState.scale + 0.25);
    return;
  }

  if (event.target.closest("[data-zoom-out]")) {
    setPreviewScale(previewState.scale - 0.25);
    return;
  }

  if (event.target.closest("[data-zoom-reset]")) {
    resetPreviewScale();
    return;
  }

  if (event.target.closest("[data-tagger-prev]")) {
    await moveTagger(-1);
    return;
  }

  if (event.target.closest("[data-tagger-next]")) {
    await moveTagger(1);
    return;
  }

  if (event.target.closest("[data-copy-prev-tags]")) {
    await copyPreviousTags();
    return;
  }

  const tagOption = event.target.closest("[data-tag-name]");
  if (tagOption) {
    const group = currentTaggerGroup();
    if (!group) return;
    const updated = await addTagToGroup(group.id, tagOption.dataset.tagName);
    Object.assign(group, updated);
    renderTagger();
    await refreshTagLibrary();
    return;
  }

  const removeCurrent = event.target.closest("[data-remove-current-tag]");
  if (removeCurrent) {
    const group = currentTaggerGroup();
    if (!group) return;
    const updated = await removeTagFromGroup(group.id, removeCurrent.dataset.removeCurrentTag);
    Object.assign(group, updated);
    renderTagger();
    await refreshTagLibrary();
    return;
  }

  const remove = event.target.closest("[data-remove-tag]");
  if (remove) {
    const card = remove.closest("[data-group-id]");
    await removeTagFromGroup(card.dataset.groupId, remove.dataset.removeTag);
    remove.remove();
  }
});

document.addEventListener("submit", async (event) => {
  const mapCellQuickForm = event.target.closest("[data-map-cell-quick-form]");
  if (mapCellQuickForm) {
    event.preventDefault();
    const group = selectedMapCellGroup();
    const input = mapCellQuickForm.elements.name;
    const name = input.value.trim();
    if (!group || !name) return;
    const updated = await addTagToGroup(group.id, name);
    updateMapCellGroup(updated);
    mapCellQuickForm.reset();
    renderMapCellSelected(selectedMapCellGroup());
    await renderMapCellLibrary();
    await refreshTagLibrary();
    return;
  }

  const combinedJumpForm = event.target.closest("[data-jump-combined-form]");
  if (combinedJumpForm) {
    event.preventDefault();
    const jumpDate = combinedJumpForm.elements.jump_date.value;
    const index = combinedJumpForm.elements.index.value;
    const position = await resolveTaggerOffset(jumpDate ? { jumpDate } : { index });
    await jumpTaggerToOffset(position.offset);
    return;
  }

  const quickForm = event.target.closest("#quick-tag-form");
  if (quickForm) {
    event.preventDefault();
    const group = currentTaggerGroup();
    const input = quickForm.elements.name;
    const name = input.value.trim();
    if (!group || !name) return;
    const updated = await addTagToGroup(group.id, name);
    Object.assign(group, updated);
    quickForm.reset();
    renderTagger();
    await refreshTagLibrary();
    return;
  }

  const form = event.target.closest(".tag-form");
  if (!form) return;
  event.preventDefault();
  const card = form.closest("[data-group-id]");
  const data = new FormData(form);
  const response = await fetch(`/api/groups/${card.dataset.groupId}/tags`, { method: "POST", body: data });
  const group = await response.json();
  const chips = card.querySelector(".chips");
  chips.innerHTML = group.tags.map((tag) => `<button class="chip removable" data-remove-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
  form.reset();
});

document.addEventListener("keydown", async (event) => {
  if (document.querySelector(".modal.open")) {
    if (event.key === "Escape") closePreview();
    if (event.key === "ArrowLeft") await movePreview(-1);
    if (event.key === "ArrowRight") await movePreview(1);
    if (event.key === "+" || event.key === "=") setPreviewScale(previewState.scale + 0.25);
    if (event.key === "-") setPreviewScale(previewState.scale - 0.25);
    if (event.key === "0") resetPreviewScale();
    return;
  }
  if (document.querySelector(".map-cell-panel.open") && event.key === "Escape") {
    closeMapCellPanel();
    return;
  }
  if (!document.querySelector(".tagger")) return;
  if (event.key === "ArrowLeft") await moveTagger(-1);
  if (event.key === "ArrowRight") await moveTagger(1);
});

document.addEventListener("wheel", (event) => {
  if (!event.target.closest(".modal-view")) return;
  event.preventDefault();
  setPreviewScale(previewState.scale + (event.deltaY < 0 ? 0.15 : -0.15));
}, { passive: false });

document.addEventListener("pointerdown", (event) => {
  if (event.button === 1 && event.target.closest(".modal-view")) {
    event.preventDefault();
    previewState.dragging = true;
    previewState.dragStartX = event.clientX;
    previewState.dragStartY = event.clientY;
    previewState.dragOriginX = previewState.panX;
    previewState.dragOriginY = previewState.panY;
    document.body.classList.add("is-panning");
    return;
  }
  if (event.button !== 0) return;
  if (!event.target.closest("[data-live-hold]")) return;
  previewState.holdTimer = window.setTimeout(startModalLive, 260);
});

document.addEventListener("auxclick", (event) => {
  if (event.button === 1 && event.target.closest(".modal-view")) {
    event.preventDefault();
  }
});

document.addEventListener("pointermove", (event) => {
  if (!previewState.dragging) return;
  previewState.panX = previewState.dragOriginX + event.clientX - previewState.dragStartX;
  previewState.panY = previewState.dragOriginY + event.clientY - previewState.dragStartY;
  applyPreviewTransform();
});

function stopPreviewPointerActions() {
  const wasDragging = previewState.dragging;
  previewState.dragging = false;
  document.body.classList.remove("is-panning");
  stopModalLive();
  if (wasDragging) {
    previewState.suppressModalViewClick = true;
    window.setTimeout(() => {
      previewState.suppressModalViewClick = false;
    }, 250);
  }
}

document.addEventListener("pointerup", stopPreviewPointerActions);
document.addEventListener("pointercancel", stopPreviewPointerActions);
document.addEventListener("pointerleave", (event) => {
  if (event.target.closest?.("[data-live-hold]")) stopModalLive();
});

initTagger();
initDateStrips();
initMap();
