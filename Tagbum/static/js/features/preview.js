import {
  MAP_TILE_PROVIDERS,
  clamp,
  currentTheme,
  escapeHtml,
  groupCache,
  providerDisplayLonLat,
  providerSourceLonLat,
  imageResource,
  imageUrl,
  kindBadgeMeta,
  lonLatToWorld,
  normalizeLon,
  previewState,
  tileUrl,
  videoResource,
  worldToLonLat,
} from "../core/shared.js";
import { tagChainsHtml } from "./tag-graph.js";

const pickerState = {
  lat: 30,
  lon: 104,
  zoom: 12,
  dragging: false,
  startX: 0,
  startY: 0,
  startCenter: null,
};

const PREVIEW_PANEL_DEFAULT_ORDER = ["resources", "tags", "overview", "location", "metadata"];
const PREVIEW_PANEL_ORDER_KEY = "tagbum.previewPanelOrder";
const PREVIEW_TEXT = {
  "zh-CN": {
    unknown: "未知",
    unknownTime: "未知时间",
    noLocation: "没有位置信息",
    noLocationSelected: "未选择位置",
    noMetadata: "没有元数据",
    noPreview: "暂无预览",
    liveHint: "长按照片播放 Live",
    cannotPreview: "该资源暂不支持直接预览",
    untitled: "未命名",
    download: "下载",
    close: "关闭",
    previous: "上一张",
    next: "下一张",
    zoomOut: "缩小",
    zoomIn: "放大",
    reset: "重置",
    center: "居中",
    resources: "资源",
    overview: "概览",
    location: "位置",
    metadata: "元数据",
    currentPosition: "当前位置",
    openMap: "打开地图",
    groupMetadata: "资源组元数据",
    editMetadata: "编辑元数据",
    name: "名称",
    takenAt: "拍摄时间",
    selectPoint: "地图选点",
    clear: "清空",
    saveMetadata: "保存元数据",
    pickLocation: "选择位置",
    cancel: "取消",
    useThisPoint: "使用此位置",
    saving: "保存中...",
    saveFailed: "保存失败。",
    saved: "已保存。",
    tags: "标签",
    resourceCount: "资源数",
    tagRelations: "标签关系",
    groupKey: "统一资源符",
    folder: "目录",
    root: "相册根目录",
    moveUp: "上移",
    moveDown: "下移",
  },
  en: {
    unknown: "Unknown",
    unknownTime: "Unknown time",
    noLocation: "No location",
    noLocationSelected: "No location selected",
    noMetadata: "No metadata",
    noPreview: "No preview available",
    liveHint: "Hold on the photo to play Live",
    cannotPreview: "This resource cannot be previewed directly.",
    untitled: "Untitled",
    download: "Download",
    close: "Close",
    previous: "Previous",
    next: "Next",
    zoomOut: "Zoom Out",
    zoomIn: "Zoom In",
    reset: "Reset",
    center: "Center",
    resources: "Resources",
    overview: "Overview",
    location: "Location",
    metadata: "Metadata",
    currentPosition: "Current Position",
    openMap: "Open Map",
    groupMetadata: "Group Metadata",
    editMetadata: "Edit Metadata",
    name: "Name",
    takenAt: "Taken At",
    selectPoint: "Select Point",
    clear: "Clear",
    saveMetadata: "Save Metadata",
    pickLocation: "Pick Location",
    cancel: "Cancel",
    useThisPoint: "Use This Point",
    saving: "Saving...",
    saveFailed: "Save failed.",
    saved: "Saved.",
    tags: "Tags",
    resourceCount: "Resources",
    tagRelations: "Tag Relations",
    groupKey: "Group Key",
    folder: "Folder",
    root: "Root",
    moveUp: "Move Up",
    moveDown: "Move Down",
  },
};

const PREVIEW_TRANSLATIONS = {
  "zh-CN": {
    unknown: "未知",
    unknownTime: "未知时间",
    noLocation: "没有位置信息",
    noLocationSelected: "未选择位置",
    noMetadata: "没有元数据",
    noPreview: "暂无预览",
    liveHint: "长按照片播放 Live",
    cannotPreview: "该资源暂不支持直接预览",
    untitled: "未命名",
    download: "下载",
    close: "关闭",
    previous: "上一张",
    next: "下一张",
    zoomOut: "缩小",
    zoomIn: "放大",
    reset: "重置",
    center: "居中",
    resources: "资源",
    overview: "概览",
    location: "位置",
    metadata: "元数据",
    currentPosition: "当前位置",
    openMap: "打开地图",
    groupMetadata: "资源组元数据",
    editMetadata: "编辑元数据",
    name: "名称",
    takenAt: "拍摄时间",
    selectPoint: "地图选点",
    clear: "清空",
    saveMetadata: "保存元数据",
    pickLocation: "选择位置",
    cancel: "取消",
    useThisPoint: "使用此位置",
    saving: "保存中...",
    saveFailed: "保存失败。",
    saved: "已保存。",
    tags: "标签",
    resourceCount: "资源数",
    groupKey: "统一资源符",
    folder: "目录",
    root: "相册根目录",
    moveUp: "上移",
    moveDown: "下移",
  },
  en: PREVIEW_TEXT.en,
};

const PREVIEW_ZH = {
  unknown: "\u672a\u77e5",
  unknownTime: "\u672a\u77e5\u65f6\u95f4",
  noLocation: "\u6ca1\u6709\u4f4d\u7f6e\u4fe1\u606f",
  noLocationSelected: "\u672a\u9009\u62e9\u4f4d\u7f6e",
  noMetadata: "\u6ca1\u6709\u5143\u6570\u636e",
  noPreview: "\u6682\u65e0\u9884\u89c8",
  liveHint: "\u957f\u6309\u7167\u7247\u64ad\u653e Live",
  cannotPreview: "\u8be5\u8d44\u6e90\u6682\u4e0d\u652f\u6301\u76f4\u63a5\u9884\u89c8",
  untitled: "\u672a\u547d\u540d",
  download: "\u4e0b\u8f7d",
  close: "\u5173\u95ed",
  previous: "\u4e0a\u4e00\u5f20",
  next: "\u4e0b\u4e00\u5f20",
  zoomOut: "\u7f29\u5c0f",
  zoomIn: "\u653e\u5927",
  reset: "\u91cd\u7f6e",
  center: "\u5c45\u4e2d",
  resources: "\u8d44\u6e90",
  overview: "\u6982\u89c8",
  location: "\u4f4d\u7f6e",
  metadata: "\u5143\u6570\u636e",
  currentPosition: "\u5f53\u524d\u4f4d\u7f6e",
  openMap: "\u6253\u5f00\u5730\u56fe",
  groupMetadata: "\u8d44\u6e90\u7ec4\u5143\u6570\u636e",
  editMetadata: "\u7f16\u8f91\u5143\u6570\u636e",
  name: "\u540d\u79f0",
  takenAt: "\u62cd\u6444\u65f6\u95f4",
  selectPoint: "\u5730\u56fe\u9009\u70b9",
  clear: "\u6e05\u7a7a",
  saveMetadata: "\u4fdd\u5b58\u5143\u6570\u636e",
  pickLocation: "\u9009\u62e9\u4f4d\u7f6e",
  cancel: "\u53d6\u6d88",
  useThisPoint: "\u4f7f\u7528\u6b64\u4f4d\u7f6e",
  saving: "\u4fdd\u5b58\u4e2d...",
  saveFailed: "\u4fdd\u5b58\u5931\u8d25\u3002",
  saved: "\u5df2\u4fdd\u5b58\u3002",
  tags: "\u6807\u7b7e",
  resourceCount: "\u8d44\u6e90\u6570",
  tagRelations: "\u6807\u7b7e\u5173\u7cfb",
  groupKey: "\u7edf\u4e00\u8d44\u6e90\u7b26",
  folder: "\u76ee\u5f55",
  root: "\u76f8\u518c\u6839\u76ee\u5f55",
  moveUp: "\u4e0a\u79fb",
  moveDown: "\u4e0b\u79fb",
};

function previewLocale() {
  const raw = document.body?.dataset.uiLanguage || document.documentElement.lang || "zh-CN";
  return PREVIEW_TRANSLATIONS[raw] ? raw : (raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
}

function t(key) {
  const locale = previewLocale();
  if (locale === "zh-CN") return PREVIEW_ZH[key] || key;
  return PREVIEW_TRANSLATIONS[locale]?.[key] || PREVIEW_ZH[key] || key;
}

function loadPreviewPanelOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_PANEL_ORDER_KEY) || "[]");
    if (!Array.isArray(parsed)) return [...PREVIEW_PANEL_DEFAULT_ORDER];
    const valid = PREVIEW_PANEL_DEFAULT_ORDER.filter((key) => parsed.includes(key));
    const missing = PREVIEW_PANEL_DEFAULT_ORDER.filter((key) => !valid.includes(key));
    return [...valid, ...missing];
  } catch {
    return [...PREVIEW_PANEL_DEFAULT_ORDER];
  }
}

function savePreviewPanelOrder(order) {
  localStorage.setItem(PREVIEW_PANEL_ORDER_KEY, JSON.stringify(order));
}

export function galleryContextIds(source) {
  const homeGallery = source?.closest("[data-home-gallery], [data-filter-gallery]");
  const scope = homeGallery || source?.closest(".gallery");
  if (!scope) return [];
  return [...scope.querySelectorAll("[data-group-id]")]
    .map((item) => Number(item.dataset.groupId))
    .filter(Boolean);
}

export function duplicatePreviewIds(source) {
  const scope = source?.closest("[data-duplicate-preview-scope]");
  if (!scope) return [];
  return [...scope.querySelectorAll("[data-open-duplicate-preview]")]
    .map((item) => Number(item.dataset.openDuplicatePreview))
    .filter(Boolean);
}

async function getGroupDetails(groupId, { force = false } = {}) {
  const key = Number(groupId);
  if (!force && groupCache.has(key) && groupCache.get(key).resources) return groupCache.get(key);
  const response = await fetch(`/api/groups/${key}`);
  const group = await response.json();
  groupCache.set(key, group);
  return group;
}

function updateStoredPreviewAudio(video) {
  if (!video) return;
  previewState.volume = video.volume;
  previewState.muted = video.muted;
  localStorage.setItem("tagbum.previewVolume", String(video.volume));
  localStorage.setItem("tagbum.previewMuted", String(video.muted));
}

function applyPreviewAudio(video, { allowUnmute = true } = {}) {
  if (!video) return;
  video.volume = Number.isFinite(previewState.volume) ? previewState.volume : 1;
  video.muted = allowUnmute ? previewState.muted : true;
}

function playbackUrl(resource) {
  return resource?.preview_url || resource?.url;
}

function bytesLabel(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) return t("unknown");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDimensions(resource) {
  if (!resource?.width || !resource?.height) return "--";
  return `${resource.width} x ${resource.height}`;
}

function formatTakenAtForCard(value) {
  if (!value) return t("unknownTime");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];
  return `${parts.join("-")} ${time.join(":")}`;
}

function currentSelectedResource(group) {
  if (!group?.resources?.length) return null;
  if (previewState.resourceId) {
    const selected = group.resources.find((item) => Number(item.id) === Number(previewState.resourceId));
    if (selected) return selected;
  }
  return imageResource(group) || videoResource(group) || group.resources[0];
}

function defaultPreviewResource(group) {
  return imageResource(group) || videoResource(group) || group.resources?.[0] || null;
}

function mapProviderForPicker() {
  const key = document.body?.dataset.mapTileProvider || "osm";
  return MAP_TILE_PROVIDERS[key] || MAP_TILE_PROVIDERS.osm;
}

function flattenMetadata(value, prefix = "") {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    if (!value.length) return [];
    return value.flatMap((item, index) => flattenMetadata(item, `${prefix}[${index}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return flattenMetadata(item, nextPrefix);
    });
  }
  return [[prefix || "value", value]];
}

function metadataRowsHtml(metadata) {
  const entries = flattenMetadata(metadata).sort((left, right) => left[0].localeCompare(right[0]));
  if (!entries.length) {
    return `<div class="preview-meta-empty">${escapeHtml(t("noMetadata"))}</div>`;
  }
  return entries.map(([key, value]) => `
    <div class="preview-metadata-row">
      <span>${escapeHtml(key)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join("");
}

function renderMiniMap(target, lat, lon, zoom, showCrosshair = false) {
  if (!target) return;
  if (lat == null || lon == null) {
    target.innerHTML = `<div class="preview-map-empty">${escapeHtml(t("noLocation"))}</div>`;
    return;
  }
  const provider = mapProviderForPicker();
  const display = providerDisplayLonLat(provider, lon, lat);
  const width = target.clientWidth || 260;
  const height = target.clientHeight || 180;
  const center = lonLatToWorld(display.lon, display.lat, zoom);
  const tileZoom = clamp(Math.round(zoom), 2, 18);
  const scale = 256 * 2 ** zoom;
  const maxTile = 2 ** tileZoom;
  const tileWorldSize = scale / maxTile;
  const startX = Math.floor((center.x - width / 2) / tileWorldSize);
  const endX = Math.floor((center.x + width / 2) / tileWorldSize);
  const startY = Math.floor((center.y - height / 2) / tileWorldSize);
  const endY = Math.floor((center.y + height / 2) / tileWorldSize);
  const dark = currentTheme() === "dark";
  const tiles = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      const left = x * tileWorldSize - center.x + width / 2;
      const top = y * tileWorldSize - center.y + height / 2;
      tiles.push(`
        <img
          class="preview-map-tile"
          src="${tileUrl(provider, tileZoom, wrappedX, y, { dark })}"
          style="left:${left}px;top:${top}px;width:${tileWorldSize}px;height:${tileWorldSize}px"
          alt=""
        >
      `);
    }
  }

  target.innerHTML = `
    <div class="preview-map-tiles">${tiles.join("")}</div>
    ${showCrosshair ? '<div class="preview-map-crosshair" aria-hidden="true"></div>' : '<div class="preview-map-pin" aria-hidden="true"></div>'}
  `;
}

function renderLocationPreviewFromValues(lat, lon) {
  const miniMap = document.querySelector("[data-preview-location-map]");
  const text = document.querySelector("[data-preview-location-text]");
  if (!miniMap || !text) return;
  if (lat == null || lon == null) {
    text.textContent = t("noLocation");
    renderMiniMap(miniMap, null, null, 10);
    return;
  }
  text.textContent = `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
  renderMiniMap(miniMap, Number(lat), Number(lon), 12);
}

function renderLocationPreview(group) {
  renderLocationPreviewFromValues(group?.latitude, group?.longitude);
}

function renderResourceList(group) {
  const resources = ensureModal().querySelector(".resource-list");
  resources.innerHTML = (group.resources || []).map((item) => {
    const meta = kindBadgeMeta(item.kind);
    const active = Number(item.id) === Number(previewState.resourceId);
    return `
      <div class="resource-list-item ${active ? "active" : ""}">
        <button class="resource-list-main" type="button" data-preview-resource="${item.id}">
          <span class="chip resource-kind-badge ${meta.className}" title="${escapeHtml(meta.label)}">${escapeHtml(meta.letter)}</span>
          <span class="resource-list-copy">
            <strong>${escapeHtml(item.filename)}</strong>
            <small>${escapeHtml(meta.label)} ${escapeHtml(item.extension || "")}</small>
          </span>
        </button>
        <a class="resource-download-button" href="${item.url}" download="${escapeHtml(item.filename || "")}" data-resource-download="${item.id}">${escapeHtml(t("download"))}</a>
      </div>
    `;
  }).join("");
}

function renderResourceMetadata(group) {
  const root = document.querySelector("[data-preview-resource-meta]");
  if (!root) return;
  root.innerHTML = (group.resources || []).map((resource) => `
    <article class="preview-meta-resource">
      <strong>${escapeHtml(resource.filename)}</strong>
      <span>${escapeHtml(kindBadgeMeta(resource.kind).label)} ${escapeHtml(resource.extension || "")}</span>
      <span>${bytesLabel(resource.size_bytes)}</span>
      <span>${formatDimensions(resource)}</span>
      <span>${formatDateTime(resource.mtime)}</span>
      <span class="preview-path">${escapeHtml(resource.path || "")}</span>
      <div class="preview-metadata-grid">
        ${metadataRowsHtml(resource.metadata)}
      </div>
    </article>
  `).join("");
}

function renderGroupMetadata(group) {
  const root = document.querySelector("[data-preview-group-meta]");
  if (!root) return;
  const metadata = {
    group_key: group.group_key,
    display_name: group.display_name,
    taken_at: group.taken_at,
    latitude: group.latitude,
    longitude: group.longitude,
    source_root: group.source_root,
    source_dir: group.source_dir,
    resource_kinds: group.resource_kinds,
    tags: group.tags,
  };
  root.innerHTML = metadataRowsHtml(metadata);
}

function renderMetadataSummary(group) {
  const summary = document.querySelector("[data-preview-meta-summary]");
  if (!summary) return;
  summary.innerHTML = `
    <article><span>${escapeHtml(t("name"))}</span><strong>${escapeHtml(group.display_name || "")}</strong></article>
    <article><span>${escapeHtml(t("takenAt"))}</span><strong>${escapeHtml(formatDateTime(group.taken_at))}</strong></article>
    <article><span>${escapeHtml(t("tags"))}</span><strong>${group.tags?.length || 0}</strong></article>
    <article><span>${escapeHtml(t("resourceCount"))}</span><strong>${group.resources?.length || 0}</strong></article>
    <article><span>${escapeHtml(t("groupKey"))}</span><strong>${escapeHtml(group.group_key || "")}</strong></article>
    <article><span>${escapeHtml(t("folder"))}</span><strong>${escapeHtml(group.source_dir || "")}</strong></article>
    <article><span>${escapeHtml(t("root"))}</span><strong>${escapeHtml(group.source_root || "")}</strong></article>
  `;
}

function pickerFields() {
  return {
    lat: document.querySelector("[data-preview-latitude]"),
    lon: document.querySelector("[data-preview-longitude]"),
    coords: document.querySelector("[data-preview-coords]"),
    status: document.querySelector("[data-preview-edit-status]"),
  };
}

function setDraftLocation(lat, lon) {
  const fields = pickerFields();
  if (fields.lat) fields.lat.value = lat == null ? "" : String(lat);
  if (fields.lon) fields.lon.value = lon == null ? "" : String(lon);
  if (fields.coords) {
    fields.coords.textContent = lat == null || lon == null
      ? t("noLocationSelected")
      : `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
  }
  renderLocationPreviewFromValues(lat, lon);
}

function clearLocationDraft() {
  setDraftLocation(null, null);
}

function updateMetadataEditor(group) {
  const nameInput = document.querySelector("[data-preview-name]");
  const takenAtInput = document.querySelector("[data-preview-taken-at]");
  const status = document.querySelector("[data-preview-edit-status]");
  if (nameInput) nameInput.value = group.display_name || "";
  if (takenAtInput) takenAtInput.value = formatDateTimeInput(group.taken_at);
  if (status) status.textContent = "";
  setDraftLocation(group.latitude, group.longitude);
}

function updateVisibleGroupCards(group) {
  const cards = document.querySelectorAll(`[data-group-id="${group.id}"]`);
  cards.forEach((card) => {
    const title = card.querySelector(".asset-meta strong");
    if (title) title.textContent = group.display_name || "";

    const time = card.querySelector(".asset-meta > span");
    if (time) time.textContent = formatTakenAtForCard(group.taken_at);

    const image = card.querySelector(".preview-button img");
    if (image) image.alt = group.display_name || "";

    const placeholder = card.querySelector(".preview-button .placeholder");
    if (placeholder) placeholder.textContent = group.display_name || "";
  });
}

function renderModalResource(group, resource) {
  const modal = ensureModal();
  const image = modal.querySelector(".modal-image");
  const live = modal.querySelector(".modal-live");
  const placeholder = modal.querySelector(".modal-placeholder");
  const hint = modal.querySelector(".live-hint");
  const hasLivePair = Boolean(imageResource(group) && videoResource(group));

  stopModalLive();
  resetPreviewScale();
  live.pause();
  live.hidden = true;
  live.controls = resource?.kind === "live" || resource?.kind === "video";
  live.loop = resource?.kind === "live";
  live.removeAttribute("src");
  image.hidden = true;
  placeholder.hidden = true;
  hint.hidden = true;

  if (!resource) {
    placeholder.hidden = false;
    renderResourceList(group);
    return;
  }

  if (resource.kind === "image") {
    image.removeAttribute("src");
    image.src = imageUrl(resource);
    image.alt = group.display_name;
    image.hidden = false;
    image.onerror = () => {
      if (group.thumbnail_url && image.src !== `${location.origin}${group.thumbnail_url}`) {
        image.src = group.thumbnail_url;
      }
    };
    if (hasLivePair) hint.hidden = false;
  } else if (resource.kind === "live" || resource.kind === "video") {
    live.src = playbackUrl(resource);
    live.hidden = false;
    live.currentTime = 0;
    applyPreviewAudio(live, { allowUnmute: true });
    applyPreviewTransform();
    live.play().catch(() => {});
  } else {
    placeholder.hidden = false;
    placeholder.textContent = t("cannotPreview");
  }

  renderResourceList(group);
}

function renderModalGroup(group) {
  const modal = ensureModal();
  const title = modal.querySelector("h2");
  const tags = modal.querySelector(".modal-tags");

  if (!previewState.resourceId) {
    previewState.resourceId = defaultPreviewResource(group)?.id || null;
  }

  title.textContent = group.display_name || t("untitled");
  tags.innerHTML = (group.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  renderPreviewTagPanel(group);
  renderMetadataSummary(group);
  renderGroupMetadata(group);
  renderResourceMetadata(group);
  updateMetadataEditor(group);
  renderModalResource(group, currentSelectedResource(group));
}

function panelSummaryHtml(key) {
  return `
    <summary>
      <span>${escapeHtml(t(key))}</span>
      <span class="preview-panel-order">
        <button type="button" class="preview-panel-move" data-preview-panel-move="${key}" data-direction="-1" title="${escapeHtml(t("moveUp"))}" aria-label="${escapeHtml(t("moveUp"))}">↑</button>
        <button type="button" class="preview-panel-move" data-preview-panel-move="${key}" data-direction="1" title="${escapeHtml(t("moveDown"))}" aria-label="${escapeHtml(t("moveDown"))}">↓</button>
      </span>
    </summary>
  `;
}

function renderPreviewTagPanel(group) {
  const root = document.querySelector("[data-preview-tag-panel]");
  if (!root) return;
  const explicit = (group.tags || [])
    .map((tag) => `<span class="chip explicit-tag">${escapeHtml(tag)}</span>`)
    .join("") || `<span class="muted-text">暂无标签</span>`;
  const inferred = (group.inferred_tags || [])
    .map((tag) => `<span class="chip inferred-tag">${escapeHtml(tag)}</span>`)
    .join("");
  root.innerHTML = `
    <div class="tag-cluster explicit-tags">${explicit}</div>
    ${inferred ? `<div class="tag-cluster inferred-tags">${inferred}</div>` : ""}
    <div class="tag-chain-list">${tagChainsHtml(group)}</div>
    <button type="button" data-open-tag-graph>${escapeHtml(t("tagRelations"))}</button>
  `;
}

function panelSummaryHtmlFixed(key) {
  return `
    <summary>
      <span>${escapeHtml(t(key))}</span>
      <span class="preview-panel-order">
        <button type="button" class="preview-panel-move" data-preview-panel-move="${key}" data-direction="-1" title="${escapeHtml(t("moveUp"))}" aria-label="${escapeHtml(t("moveUp"))}">&uarr;</button>
        <button type="button" class="preview-panel-move" data-preview-panel-move="${key}" data-direction="1" title="${escapeHtml(t("moveDown"))}" aria-label="${escapeHtml(t("moveDown"))}">&darr;</button>
      </span>
    </summary>
  `;
}

function applyPreviewPanelOrder() {
  const host = document.querySelector("[data-preview-panels]");
  if (!host) return;
  const panels = new Map([...host.querySelectorAll("[data-preview-panel]")].map((panel) => [panel.dataset.previewPanel, panel]));
  loadPreviewPanelOrder().forEach((key) => {
    const panel = panels.get(key);
    if (panel) host.appendChild(panel);
  });
}

function movePreviewPanel(key, direction) {
  const order = loadPreviewPanelOrder();
  const index = order.indexOf(key);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  savePreviewPanelOrder(order);
  applyPreviewPanelOrder();
}

function ensureModal() {
  let modal = document.querySelector(".modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-media">
      <button class="modal-close-floating" type="button" data-preview-close aria-label="${escapeHtml(t("close"))}">×</button>
      <button class="modal-nav modal-prev" type="button" data-preview-prev aria-label="${escapeHtml(t("previous"))}">&lt;</button>
      <div class="modal-view" data-live-hold>
        <img class="modal-image" alt="">
        <video class="modal-live" controls playsinline hidden></video>
        <div class="placeholder modal-placeholder" hidden>${escapeHtml(t("noPreview"))}</div>
      </div>
      <button class="modal-nav modal-next" type="button" data-preview-next aria-label="${escapeHtml(t("next"))}">&gt;</button>
    </div>
    <aside class="modal-side">
      <button class="modal-close" type="button">${escapeHtml(t("close"))}</button>
      <h2></h2>
      <div class="preview-tools">
        <button type="button" data-zoom-out>${escapeHtml(t("zoomOut"))}</button>
        <button type="button" data-zoom-reset>${escapeHtml(t("reset"))}</button>
        <button type="button" data-zoom-in>${escapeHtml(t("zoomIn"))}</button>
        <button type="button" data-preview-center>${escapeHtml(t("center"))}</button>
      </div>
      <p class="muted-text live-hint" hidden>${escapeHtml(t("liveHint"))}</p>
      <div class="chips modal-tags"></div>

      <div class="preview-panels" data-preview-panels>
      <details class="preview-panel" data-preview-panel="resources" open>
        ${panelSummaryHtmlFixed("resources")}
        <div class="preview-meta-section">
          <div class="resource-list"></div>
          <div class="preview-meta-resources" data-preview-resource-meta></div>
        </div>
      </details>

      <details class="preview-panel" data-preview-panel="tags">
        ${panelSummaryHtmlFixed("tags")}
        <div class="preview-meta-section" data-preview-tag-panel></div>
      </details>

      <details class="preview-panel" data-preview-panel="overview">
        ${panelSummaryHtmlFixed("overview")}
        <div class="preview-meta-section">
          <div class="preview-meta-summary" data-preview-meta-summary></div>
        </div>
      </details>

      <details class="preview-panel" data-preview-panel="location">
        ${panelSummaryHtmlFixed("location")}
        <div class="preview-meta-section">
          <div class="preview-meta-head">
            <h3>${escapeHtml(t("currentPosition"))}</h3>
            <button type="button" data-preview-open-map-picker>${escapeHtml(t("openMap"))}</button>
          </div>
          <button type="button" class="preview-map-mini" data-preview-open-map-picker data-preview-location-map aria-label="${escapeHtml(t("openMap"))}"></button>
          <p class="muted-text" data-preview-location-text>${escapeHtml(t("noLocation"))}</p>
        </div>
      </details>

      <details class="preview-panel" data-preview-panel="metadata">
        ${panelSummaryHtmlFixed("metadata")}
        <div class="preview-meta-section">
          <div class="preview-meta-head">
            <h3>${escapeHtml(t("groupMetadata"))}</h3>
          </div>
          <div class="preview-metadata-grid" data-preview-group-meta></div>
          <div class="preview-meta-head">
            <h3>${escapeHtml(t("editMetadata"))}</h3>
          </div>
          <form class="preview-edit-form" data-preview-edit-form>
          <label>
            <span>${escapeHtml(t("name"))}</span>
            <input type="text" name="display_name" data-preview-name>
          </label>
          <label>
            <span>${escapeHtml(t("takenAt"))}</span>
            <input type="datetime-local" name="taken_at" data-preview-taken-at>
          </label>
          <div class="preview-coords-row">
            <span class="preview-coords-label">${escapeHtml(t("location"))}</span>
            <strong data-preview-coords>${escapeHtml(t("noLocationSelected"))}</strong>
            <div class="preview-coords-actions">
              <button type="button" data-preview-open-map-picker>${escapeHtml(t("selectPoint"))}</button>
              <button type="button" class="secondary-button" data-preview-clear-location>${escapeHtml(t("clear"))}</button>
            </div>
          </div>
          <input type="hidden" name="latitude" data-preview-latitude>
          <input type="hidden" name="longitude" data-preview-longitude>
          <button type="submit" data-preview-save>${escapeHtml(t("saveMetadata"))}</button>
          <p class="muted-text preview-edit-status" data-preview-edit-status></p>
          </form>
        </div>
      </details>
      </div>
    </aside>
    <div class="preview-picker-modal" data-preview-picker-modal hidden>
      <div class="preview-picker-card">
        <header>
          <h3>${escapeHtml(t("pickLocation"))}</h3>
          <button type="button" data-preview-picker-close>${escapeHtml(t("close"))}</button>
        </header>
        <div class="preview-picker-map" data-preview-picker-map></div>
        <div class="preview-picker-toolbar">
          <button type="button" data-preview-picker-zoom-out>-</button>
          <button type="button" data-preview-picker-zoom-in>+</button>
          <span data-preview-picker-coords></span>
          <button type="button" class="secondary-button" data-preview-picker-cancel>${escapeHtml(t("cancel"))}</button>
          <button type="button" data-preview-picker-save>${escapeHtml(t("useThisPoint"))}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector(".modal-close").addEventListener("click", closePreview);
  modal.querySelector(".modal-close-floating").addEventListener("click", closePreview);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closePreview();
  });
  modal.querySelector("[data-preview-picker-modal]").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMapPicker();
  });
  modal.querySelector(".preview-picker-card").addEventListener("click", (event) => {
    event.stopPropagation();
  });
  modal.querySelectorAll("[data-preview-panel-move]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      movePreviewPanel(button.dataset.previewPanelMove, Number(button.dataset.direction || 0));
    });
  });
  modal.querySelector("[data-preview-edit-form]").addEventListener("submit", submitMetadataForm);
  modal.querySelectorAll("[data-preview-open-map-picker]").forEach((button) => {
    button.addEventListener("click", openMapPicker);
  });
  modal.querySelector("[data-preview-clear-location]").addEventListener("click", clearLocationDraft);
  modal.querySelector("[data-preview-picker-close]").addEventListener("click", closeMapPicker);
  modal.querySelector("[data-preview-picker-cancel]").addEventListener("click", closeMapPicker);
  modal.querySelector("[data-preview-picker-save]").addEventListener("click", savePickedLocation);
  modal.querySelector("[data-preview-picker-zoom-in]").addEventListener("click", () => adjustPickerZoom(1));
  modal.querySelector("[data-preview-picker-zoom-out]").addEventListener("click", () => adjustPickerZoom(-1));
  bindPickerCanvas(modal.querySelector("[data-preview-picker-map]"));
  const video = modal.querySelector(".modal-live");
  video.addEventListener("volumechange", () => updateStoredPreviewAudio(video));
  applyPreviewPanelOrder();
  return modal;
}

async function submitMetadataForm(event) {
  event.preventDefault();
  if (!previewState.group) return;

  const form = event.currentTarget;
  const status = form.querySelector("[data-preview-edit-status]");
  const saveButton = form.querySelector("[data-preview-save]");
  const displayName = form.querySelector("[data-preview-name]")?.value.trim() || "";
  const takenAt = form.querySelector("[data-preview-taken-at]")?.value || null;
  const latitude = form.querySelector("[data-preview-latitude]")?.value || null;
  const longitude = form.querySelector("[data-preview-longitude]")?.value || null;
  const payload = {
    display_name: displayName,
    taken_at: takenAt ? new Date(takenAt).toISOString() : null,
    latitude: latitude ? Number(latitude) : null,
    longitude: longitude ? Number(longitude) : null,
  };

  status.textContent = t("saving");
  if (saveButton) saveButton.disabled = true;

  let response;
  try {
    response = await fetch(`/api/groups/${previewState.group.id}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    status.textContent = t("saveFailed");
    if (saveButton) saveButton.disabled = false;
    return;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: t("saveFailed") }));
    status.textContent = error.detail || t("saveFailed");
    if (saveButton) saveButton.disabled = false;
    return;
  }

  const updated = await response.json();
  groupCache.set(Number(updated.id), updated);
  previewState.group = updated;
  updateVisibleGroupCards(updated);
  renderModalGroup(updated);
  status.textContent = t("saved");
  if (saveButton) saveButton.disabled = false;
}

function updatePickerCoordsLabel() {
  const label = document.querySelector("[data-preview-picker-coords]");
  if (label) label.textContent = `${pickerState.lat.toFixed(6)}, ${pickerState.lon.toFixed(6)}  z${pickerState.zoom.toFixed(1)}`;
}

function renderPickerMap() {
  const map = document.querySelector("[data-preview-picker-map]");
  if (!map) return;
  renderMiniMap(map, pickerState.lat, pickerState.lon, pickerState.zoom, true);
  updatePickerCoordsLabel();
}

function adjustPickerZoom(delta) {
  pickerState.zoom = clamp(Number((pickerState.zoom + delta).toFixed(1)), 2, 18);
  renderPickerMap();
}

function bindPickerCanvas(map) {
  if (!map || map.dataset.bound === "true") return;
  map.dataset.bound = "true";

  map.addEventListener("wheel", (event) => {
    event.preventDefault();
    adjustPickerZoom(event.deltaY < 0 ? 0.5 : -0.5);
  }, { passive: false });

  map.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pickerState.dragging = true;
    pickerState.startX = event.clientX;
    pickerState.startY = event.clientY;
    pickerState.startCenter = lonLatToWorld(pickerState.lon, pickerState.lat, pickerState.zoom);
    map.setPointerCapture(event.pointerId);
  });

  map.addEventListener("pointermove", (event) => {
    if (!pickerState.dragging) return;
    const nextWorldX = pickerState.startCenter.x - (event.clientX - pickerState.startX);
    const nextWorldY = pickerState.startCenter.y - (event.clientY - pickerState.startY);
    const next = worldToLonLat(nextWorldX, nextWorldY, pickerState.zoom);
    const source = providerSourceLonLat(mapProviderForPicker(), next.lon, next.lat);
    pickerState.lon = normalizeLon(source.lon);
    pickerState.lat = clamp(source.lat, -85.0511, 85.0511);
    renderPickerMap();
  });

  map.addEventListener("pointerup", (event) => {
    pickerState.dragging = false;
    map.releasePointerCapture(event.pointerId);
  });

  map.addEventListener("pointercancel", () => {
    pickerState.dragging = false;
  });
}

function openMapPicker() {
  const modal = ensureModal();
  const draftLat = Number(document.querySelector("[data-preview-latitude]")?.value);
  const draftLon = Number(document.querySelector("[data-preview-longitude]")?.value);
  const hasDraft = Number.isFinite(draftLat) && Number.isFinite(draftLon);
  const group = previewState.group;

  pickerState.lat = hasDraft ? draftLat : (group?.latitude ?? 30);
  pickerState.lon = hasDraft ? draftLon : (group?.longitude ?? 104);
  pickerState.zoom = (hasDraft || (group?.latitude != null && group?.longitude != null)) ? 12 : 10;
  renderPickerMap();
  modal.querySelector("[data-preview-picker-modal]").hidden = false;
}

export function closeMapPicker() {
  const modal = document.querySelector("[data-preview-picker-modal]");
  if (modal) modal.hidden = true;
}

export function isMapPickerOpen() {
  const modal = document.querySelector("[data-preview-picker-modal]");
  return Boolean(modal && !modal.hidden);
}

function savePickedLocation() {
  setDraftLocation(pickerState.lat, pickerState.lon);
  closeMapPicker();
}

function rebuildPreviewModalForLocale() {
  const modal = document.querySelector(".modal");
  const wasOpen = modal?.classList.contains("open") || false;
  if (modal) modal.remove();
  if (!previewState.group) return;
  renderModalGroup(previewState.group);
  if (wasOpen) ensureModal().classList.add("open");
}

export function closePreview() {
  const modal = document.querySelector(".modal");
  stopModalLive();
  closeMapPicker();
  if (modal) modal.classList.remove("open");
}

export function setPreviewScale(scale) {
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

export function resetPreviewScale() {
  previewState.panX = 0;
  previewState.panY = 0;
  setPreviewScale(1);
}

export function centerPreview() {
  previewState.panX = 0;
  previewState.panY = 0;
  applyPreviewTransform();
}

export async function openPreview(groupId, contextIds = [], resourceId = null) {
  const group = await getGroupDetails(groupId);
  previewState.group = group;
  previewState.contextIds = contextIds.length ? contextIds : previewState.contextIds;
  previewState.resourceId = resourceId || defaultPreviewResource(group)?.id || null;
  renderModalGroup(group);
  ensureModal().classList.add("open");
}

export async function movePreview(delta) {
  if (!previewState.group || !previewState.contextIds.length) return;
  const current = previewState.contextIds.indexOf(Number(previewState.group.id));
  const next = current + delta;
  if (next < 0 || next >= previewState.contextIds.length) return;
  await openPreview(previewState.contextIds[next], previewState.contextIds);
}

export function selectPreviewResource(resourceId) {
  if (!previewState.group) return;
  previewState.resourceId = Number(resourceId);
  renderModalResource(previewState.group, currentSelectedResource(previewState.group));
}

function startModalLive() {
  const modal = document.querySelector(".modal");
  if (!modal || !previewState.group) return;
  const selected = currentSelectedResource(previewState.group);
  const liveResource = videoResource(previewState.group);
  if (!selected || selected.kind !== "image" || !liveResource) return;
  const image = modal.querySelector(".modal-image");
  const live = modal.querySelector(".modal-live");
  image.hidden = true;
  live.hidden = false;
  live.controls = false;
  live.loop = true;
  live.src = playbackUrl(liveResource);
  live.currentTime = 0;
  applyPreviewAudio(live, { allowUnmute: true });
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
  if (live) live.pause();
  if (previewState.group && currentSelectedResource(previewState.group)?.kind === "image") {
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

function stopPreviewPointerActions() {
  const wasDragging = previewState.dragging;
  const wasHoldingLive = previewState.holdTimer !== null;
  previewState.dragging = false;
  document.body.classList.remove("is-panning");
  if (wasHoldingLive) stopModalLive();
  if (wasDragging) {
    previewState.suppressModalViewClick = true;
    window.setTimeout(() => {
      previewState.suppressModalViewClick = false;
    }, 250);
  }
}

export function initPreviewModule() {
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
    if (!previewState.group || currentSelectedResource(previewState.group)?.kind !== "image" || !videoResource(previewState.group)) return;
    previewState.holdTimer = window.setTimeout(startModalLive, 260);
  });

  document.addEventListener("auxclick", (event) => {
    if (event.button === 1 && event.target.closest(".modal-view")) event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!previewState.dragging) return;
    previewState.panX = previewState.dragOriginX + event.clientX - previewState.dragStartX;
    previewState.panY = previewState.dragOriginY + event.clientY - previewState.dragStartY;
    applyPreviewTransform();
  });

  document.addEventListener("pointerup", stopPreviewPointerActions);
  document.addEventListener("pointercancel", stopPreviewPointerActions);
  document.addEventListener("pointerleave", (event) => {
    if (event.target.closest?.("[data-live-hold]")) stopModalLive();
  });

  window.addEventListener("tagbum:themechange", () => {
    if (previewState.group) {
      const lat = document.querySelector("[data-preview-latitude]")?.value;
      const lon = document.querySelector("[data-preview-longitude]")?.value;
      const hasDraft = lat !== "" && lon !== "";
      renderLocationPreviewFromValues(
        hasDraft ? Number(lat) : previewState.group.latitude,
        hasDraft ? Number(lon) : previewState.group.longitude,
      );
      if (!document.querySelector("[data-preview-picker-modal]")?.hidden) renderPickerMap();
    }
  });

  window.addEventListener("tagbum:languagechange", rebuildPreviewModalForLocale);
  window.addEventListener("tagbum:taggraphchange", async () => {
    if (!previewState.group) return;
    const refreshed = await getGroupDetails(previewState.group.id, { force: true });
    previewState.group = refreshed;
    renderModalGroup(refreshed);
  });
}
