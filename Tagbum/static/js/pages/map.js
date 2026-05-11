import {
  MAP_DENSITY_LEVELS,
  MAP_TILE_PROVIDERS,
  clamp,
  escapeHtml,
  groupCache,
  imageResource,
  imageUrl,
  kindBadgeMeta,
  lonLatToWorld,
  mapCellState,
  mapDisplayLonLat,
  mapState,
  normalizeLon,
  setMapCenterFromWorld,
  tileUrl,
  videoResource,
  worldToLonLat,
  wrappedWorldDelta,
} from "../core/shared.js";

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
  updateMapGridFromDensity(map);
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

function bestMapGrid(map, target) {
  const aspect = Math.max(0.2, Math.min(5, map.clientWidth / Math.max(1, map.clientHeight)));
  let best = { rows: 1, cols: Math.max(1, Math.round(target)), score: Number.POSITIVE_INFINITY };
  const maxSide = Math.max(4, Math.ceil(Math.sqrt(target) * 4));
  for (let rows = 1; rows <= maxSide; rows += 1) {
    for (let cols = 1; cols <= maxSide; cols += 1) {
      const total = rows * cols;
      const ratio = cols / rows;
      const totalPenalty = Math.abs(total - target) / target;
      const aspectPenalty = Math.abs(ratio - aspect) / aspect;
      const score = totalPenalty + aspectPenalty * 0.9;
      if (score < best.score) best = { rows, cols, score };
    }
  }
  return best;
}

function updateMapGridFromDensity(map = document.querySelector("[data-map]")) {
  if (!map) return;
  const grid = bestMapGrid(map, mapState.densityTarget);
  mapState.rows = grid.rows;
  mapState.cols = grid.cols;
}

function resizeMapCanvas(map = document.querySelector("[data-map]")) {
  if (!map) return;
  const rect = map.getBoundingClientRect();
  const bottomGap = window.innerWidth <= 760 ? 18 : 28;
  const minHeight = window.innerWidth <= 760 ? 360 : 420;
  const availableHeight = window.innerHeight - rect.top - bottomGap;
  const height = Math.max(minHeight, availableHeight);
  map.style.setProperty("--map-height", `${height}px`);
}

function updateMapDensityLabel() {
  const label = document.querySelector("[data-map-density-label]");
  if (!label) return;
  label.textContent = `${mapState.cols}×${mapState.rows} · 约 ${mapState.densityTarget} 格`;
}

function setMapDensity(index, refresh = true) {
  const map = document.querySelector("[data-map]");
  mapState.densityIndex = clamp(Number(index) || 0, 0, MAP_DENSITY_LEVELS.length - 1);
  mapState.densityTarget = MAP_DENSITY_LEVELS[mapState.densityIndex];
  if (map) {
    map.dataset.density = String(mapState.densityIndex);
    updateMapGridFromDensity(map);
  }
  const slider = document.querySelector("[data-map-density]");
  if (slider) slider.value = String(mapState.densityIndex);
  localStorage.setItem("tagbum.mapDensity", String(mapState.densityIndex));
  updateMapDensityLabel();
  if (refresh) {
    closeMapCellPanel();
    scheduleMapRefresh(0);
  }
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
  const provider = mapState.tileProvider;
  const displayCenter = mapDisplayLonLat(mapState.centerLon, mapState.centerLat);
  const center = lonLatToWorld(displayCenter.lon, displayCenter.lat, zoom);
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
      html.push(`<img class="map-tile" src="${tileUrl(provider, zoom, wrappedX, y)}" style="left:${left}px;top:${top}px" alt="">`);
    }
  }
  tiles.innerHTML = html.join("");
  const attribution = map.querySelector(".map-attribution");
  if (attribution) attribution.textContent = provider.attribution;
}

function renderMapMarkers(map) {
  const markerLayer = map.querySelector("[data-map-markers]");
  const cells = JSON.parse(markerLayer.dataset.cells || "[]");
  const width = map.clientWidth;
  const height = map.clientHeight;
  const displayCenter = mapDisplayLonLat(mapState.centerLon, mapState.centerLat);
  const center = lonLatToWorld(displayCenter.lon, displayCenter.lat, mapState.zoom);
  markerLayer.innerHTML = cells.map((cell) => {
    const group = cell.group;
    const displayPoint = mapDisplayLonLat(group.longitude, group.latitude);
    const point = lonLatToWorld(displayPoint.lon, displayPoint.lat, mapState.zoom);
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
    count.textContent = cells.length ? `${cells.length} 个位置 · ${photoCount} 张` : "当前视野没有带位置的图片";
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

export function closeMapCellPanel() {
  setMapCellLive(false);
  const panel = document.querySelector(".map-cell-panel");
  if (panel) panel.classList.remove("open");
}

export function selectedMapCellGroup() {
  return mapCellState.groups.find((group) => Number(group.id) === Number(mapCellState.selectedId)) || null;
}

export async function openMapCell(row, col) {
  const params = currentMapRequestParams({ row: String(row), col: String(col) });
  if (!params) return;
  mapCellState.loading = true;
  mapCellState.row = Number(row);
  mapCellState.col = Number(col);
  mapCellState.bounds = params;
  const panel = ensureMapCellPanel();
  panel.classList.add("open");
  panel.querySelector("[data-map-cell-title]").textContent = "加载中...";
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

export function renderMapCellSelected(group) {
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

export async function renderMapCellLibrary() {
  const library = document.querySelector("[data-map-cell-library]");
  if (!library) return;
  const response = await fetch("/api/tags");
  const tags = await response.json();
  library.innerHTML = tags.length
    ? tags.map((item) => `<button class="chip tag-option" type="button" data-map-cell-tag-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} <span>${item.count}</span></button>`).join("")
    : `<span class="muted-text">暂无标签库</span>`;
}

export function setMapCellLive(show) {
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

export function updateMapCellGroup(updated) {
  const index = mapCellState.groups.findIndex((group) => Number(group.id) === Number(updated.id));
  if (index >= 0) {
    const existing = mapCellState.groups[index];
    if (existing.resources && !updated.resources) updated.resources = existing.resources;
    mapCellState.groups[index] = updated;
  }
  groupCache.set(Number(updated.id), updated);
}

export function initMap() {
  const map = document.querySelector("[data-map]");
  if (!map) return;
  mapState.centerLat = Number(map.dataset.centerLat || 30);
  mapState.centerLon = normalizeLon(Number(map.dataset.centerLon || 104));
  mapState.zoom = Number(map.dataset.zoom || 10);
  mapState.tileProviderKey = map.dataset.tileProvider || "osm";
  mapState.tileProvider = MAP_TILE_PROVIDERS[mapState.tileProviderKey] || MAP_TILE_PROVIDERS.osm;
  const storedDensity = Number(localStorage.getItem("tagbum.mapDensity"));
  const initialDensity = Number.isFinite(storedDensity) ? storedDensity : Number(map.dataset.density || 3);
  resizeMapCanvas(map);
  setMapDensity(initialDensity, false);
  renderMap();
  scheduleMapRefresh(0);

  document.querySelector("[data-map-density]")?.addEventListener("input", (event) => setMapDensity(event.target.value, true));

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
    resizeMapCanvas(map);
    updateMapGridFromDensity(map);
    updateMapDensityLabel();
    closeMapCellPanel();
    renderMap();
    scheduleMapRefresh();
  });
}
