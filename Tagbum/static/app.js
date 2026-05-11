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
const MAP_DENSITY_LEVELS = [10, 20, 40, 84, 140, 200];
const homeState = {
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
const MAP_TILE_PROVIDERS = {
  osm: {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    coordinateSystem: "wgs84",
    subdomains: [""],
  },
  amap: {
    name: "高德地图",
    url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
    attribution: "© 高德地图",
    coordinateSystem: "gcj02",
    subdomains: ["1", "2", "3", "4"],
  },
};

const mapState = {
  centerLat: 30,
  centerLon: 104,
  zoom: 10,
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

function resolveDateBucket(items, value) {
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
  const selectedBucket = resolveDateBucket(dateItems, selected);
  if (selectedBucket) {
    setDateStripSelection(strip, selectedBucket.date, selectedBucket.count, Boolean(strip.dataset.selectedDate), true);
  }
}

function formatMonthKey(value) {
  if (!value) return "unknown";
  return value.slice(0, 7);
}

function formatMonthTitle(value) {
  if (!value) return "未知时间";
  const [year, month] = value.split("-");
  return `${year}/${Number(month)}`;
}

function renderAssetCard(group) {
  const badges = kindBadgesHtml(group.resource_kinds || []);
  const tags = (group.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  const media = group.thumbnail_url
    ? `<img src="${group.thumbnail_url}" alt="${escapeHtml(group.display_name)}">`
    : `<span class="placeholder">${escapeHtml(group.display_name)}</span>`;
  const dateText = group.taken_at ? new Date(group.taken_at).toLocaleString() : "未知时间";
  return `
    <article class="asset-card" data-group-id="${group.id}" data-taken-at="${group.taken_at || ""}">
      <button class="preview-button" type="button" data-open-preview="${group.id}">
        ${media}
      </button>
      <div class="asset-meta">
        <strong>${escapeHtml(group.display_name)}</strong>
        <span>${escapeHtml(dateText)}</span>
        <div class="chips">${tags}${badges}</div>
      </div>
    </article>
  `;
}

function renderHomeMonthDivider(monthKey) {
  return `
    <div class="gallery-month-divider" data-month-key="${monthKey}">
      <span>${escapeHtml(formatMonthTitle(monthKey))}</span>
    </div>
  `;
}

function renderHomePageSection(groups, offset, sectionIndex) {
  let previousMonth = homeState.lastMonthKey;
  const cards = groups.map((group) => {
    const monthKey = formatMonthKey(group.taken_at);
    const divider = monthKey !== previousMonth ? renderHomeMonthDivider(monthKey) : "";
    previousMonth = monthKey;
    return `${divider}${renderAssetCard(group)}`;
  }).join("");
  homeState.lastMonthKey = previousMonth;
  return `
    <section class="gallery-page-section" data-home-page="${sectionIndex}" data-home-offset="${offset}">
      <div class="gallery-page-divider"><span>第 ${sectionIndex} 段</span></div>
      <div class="gallery">${cards}</div>
    </section>
  `;
}

function updateHomeStatus(text) {
  const status = document.querySelector("[data-home-gallery-status]");
  if (status) status.textContent = text;
}

function updateHomeCount() {
  const count = document.querySelector("[data-home-count]");
  if (!count) return;
  const loaded = document.querySelectorAll("[data-home-gallery] [data-group-id]").length;
  count.textContent = `${loaded} / ${homeState.total}`;
}

function currentHomeCards() {
  return [...document.querySelectorAll("[data-home-gallery] [data-group-id]")];
}

function updateHomeTimelineMarker(value) {
  const timeline = document.querySelector("[data-home-timeline]");
  const current = document.querySelector("[data-home-timeline-current]");
  const label = document.querySelector("[data-home-timeline-label]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  timeline.querySelectorAll(".home-timeline-tick.active").forEach((item) => item.classList.remove("active"));
  if (cell) cell.classList.add("active");
  const text = cell?.dataset.endDate && cell.dataset.endDate !== value ? `${value} - ${cell.dataset.endDate}` : value;
  if (current) current.textContent = text;
  if (label) label.textContent = text;
}

function syncHomeTimelineToDate(value, recenter = true) {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  if (!cell) return;
  timeline.dataset.selectedDate = value;
  updateHomeTimelineMarker(value);
  if (recenter) {
    timeline.scrollTop = Math.max(0, cell.offsetTop + cell.offsetHeight / 2 - timeline.clientHeight / 2);
  }
}

function selectedHomeTimelineCell() {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return null;
  const cells = [...timeline.querySelectorAll("[data-date]")];
  if (!cells.length) return null;
  const center = timeline.scrollTop + timeline.clientHeight / 2;
  return cells.reduce((nearest, cell) => {
    const cellCenter = cell.offsetTop + cell.offsetHeight / 2;
    const nearestCenter = nearest.offsetTop + nearest.offsetHeight / 2;
    return Math.abs(cellCenter - center) < Math.abs(nearestCenter - center) ? cell : nearest;
  }, cells[0]);
}

function updateHomeTimelineFromCenter(recenter = false) {
  const cell = selectedHomeTimelineCell();
  if (!cell) return;
  homeState.requestedDate = cell.dataset.date;
  updateHomeTimelineMarker(cell.dataset.date);
  if (recenter) syncHomeTimelineToDate(cell.dataset.date, true);
}

async function jumpHomeToDate(rawDate) {
  if (!rawDate) return;
  const response = await fetch(`/api/position?jump_date=${encodeURIComponent(rawDate)}`);
  if (!response.ok) return;
  const payload = await response.json();
  const pageOffset = Math.max(0, Math.floor((payload.offset || 0) / homeState.pageSize) * homeState.pageSize);
  await resetHomeGallery(pageOffset, rawDate, payload.offset || 0);
}

function currentVisibleHomeDate() {
  const cards = currentHomeCards();
  if (!cards.length) return "";
  const threshold = 96;
  const candidate = cards.find((card) => card.getBoundingClientRect().bottom > threshold);
  return candidate?.dataset.takenAt?.slice(0, 10) || cards[0].dataset.takenAt?.slice(0, 10) || "";
}

function updateHomeTimelineFromScroll() {
  const value = currentVisibleHomeDate();
  if (!value || homeState.timelineDragging) return;
  syncHomeTimelineToDate(resolveDateBucket(homeState.timelineItems, value)?.date || value, true);
}

async function loadHomePage(offset, append = true, focusOffset = null) {
  if (homeState.loading || homeState.done) return;
  homeState.loading = true;
  updateHomeStatus("正在加载...");
  const response = await fetch(`/api/groups?offset=${offset}&limit=${homeState.pageSize}`, { cache: "no-store" });
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  const container = document.querySelector("[data-home-gallery]");
  if (!container) return;
  if (!append) container.innerHTML = "";
  if (!groups.length) {
    homeState.done = true;
    homeState.loading = false;
    updateHomeStatus(container.children.length ? "已加载全部内容" : "还没有索引照片。");
    updateHomeCount();
    return;
  }
  homeState.pageNumber += 1;
  container.insertAdjacentHTML("beforeend", renderHomePageSection(groups, offset, homeState.pageNumber));
  homeState.nextOffset = offset + groups.length;
  homeState.done = homeState.nextOffset >= homeState.total;
  homeState.loading = false;
  updateHomeCount();
  updateHomeStatus(homeState.done ? "已加载全部内容" : "继续向下滚动以加载更多");
  if (focusOffset !== null) {
    const focusIndex = Math.max(0, Math.min(groups.length - 1, focusOffset - offset));
    const focusGroup = groups[focusIndex];
    const card = container.querySelector(`[data-group-id="${focusGroup.id}"]`);
    card?.scrollIntoView({ block: "start" });
  }
  updateHomeTimelineFromScroll();
}

async function resetHomeGallery(offset = 0, requestedDate = "", focusOffset = null) {
  homeState.nextOffset = offset;
  homeState.done = false;
  homeState.loading = false;
  homeState.pageNumber = Math.floor(offset / homeState.pageSize);
  homeState.lastMonthKey = null;
  homeState.requestedDate = requestedDate;
  await loadHomePage(offset, false, focusOffset);
}

function buildHomeTimelineItems(dates) {
  return compactDateItems(dates, 5);
}

function sizeHomeTimeline() {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return;
  const inset = Math.max(0, timeline.clientHeight / 2 - 3);
  timeline.style.paddingTop = `${inset}px`;
  timeline.style.paddingBottom = `${inset}px`;
}

function renderHomeTimeline(items) {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return;
  homeState.timelineItems = items;
  timeline.innerHTML = items.map((item) => {
    const day = Number(item.date.slice(8, 10));
    const monthStart = day <= 5;
    return `
      <button
        class="home-timeline-tick ${item.count > 0 ? "has-images" : "empty-day"} ${monthStart ? "month-start" : ""}"
        type="button"
        data-date="${item.date}"
        data-end-date="${item.end_date}"
        data-count="${item.count}"
        title="${item.date} - ${item.end_date} · ${item.count}"
      >
        <span class="home-timeline-stem"></span>
        ${monthStart ? `<span class="home-timeline-month">${formatMonthTitle(item.date)}</span>` : ""}
      </button>
    `;
  }).join("");
}

function attachHomeTimelineEvents() {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return;
  let scrollTimer = null;
  timeline.addEventListener("wheel", (event) => {
    event.preventDefault();
    timeline.scrollTop += event.deltaY || event.deltaX;
    updateHomeTimelineFromCenter(false);
  }, { passive: false });
  timeline.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => updateHomeTimelineFromCenter(false), 40);
  });
  timeline.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    homeState.timelineDragging = true;
    homeState.timelineMoved = false;
    homeState.timelineStartY = event.clientY;
    homeState.timelineScrollTop = timeline.scrollTop;
    timeline.setPointerCapture(event.pointerId);
    timeline.classList.add("dragging");
  });
  timeline.addEventListener("pointermove", (event) => {
    if (!homeState.timelineDragging) return;
    const delta = event.clientY - homeState.timelineStartY;
    if (Math.abs(delta) > 3) homeState.timelineMoved = true;
    timeline.scrollTop = homeState.timelineScrollTop - delta;
  });
  timeline.addEventListener("pointerup", async (event) => {
    if (!homeState.timelineDragging) return;
    homeState.timelineDragging = false;
    timeline.releasePointerCapture(event.pointerId);
    timeline.classList.remove("dragging");
    updateHomeTimelineFromCenter(false);
    const cell = event.target.closest("[data-date]");
    if (cell && !homeState.timelineMoved) {
      homeState.requestedDate = cell.dataset.date;
      syncHomeTimelineToDate(cell.dataset.date, true);
      await jumpHomeToDate(cell.dataset.date);
    }
  });
  timeline.addEventListener("pointercancel", () => {
    homeState.timelineDragging = false;
    timeline.classList.remove("dragging");
  });
  document.querySelector("[data-home-timeline-jump]")?.addEventListener("click", async () => {
    const selected = selectedHomeTimelineCell();
    if (!selected) return;
    homeState.requestedDate = selected.dataset.date;
    await jumpHomeToDate(selected.dataset.date);
  });
}

async function initHomeGallery() {
  const root = document.querySelector("[data-home-gallery-root]");
  if (!root) return;
  homeState.total = Number(root.dataset.totalGroups || 0);
  homeState.pageSize = Number(root.dataset.pageSize || 72);
  const initialOffset = Number(root.dataset.initialOffset || 0);
  const timelineResponse = await fetch("/api/dates", { cache: "no-store" });
  const timelinePayload = await timelineResponse.json();
  const items = buildHomeTimelineItems(timelinePayload.dates || []);
  renderHomeTimeline(items);
  sizeHomeTimeline();
  attachHomeTimelineEvents();
  const initialDate = root.dataset.currentDate || timelinePayload.max_date || "";
  const initialBucket = resolveDateBucket(items, initialDate);
  if (initialBucket) {
    homeState.requestedDate = initialBucket.date;
    syncHomeTimelineToDate(initialBucket.date, true);
  }
  if (homeState.total <= 0) {
    updateHomeStatus("还没有索引照片。");
    updateHomeCount();
    return;
  }
  await resetHomeGallery(initialOffset, initialDate, initialOffset);
  const sentinel = document.querySelector("[data-home-gallery-sentinel]");
  if (sentinel) {
    const observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || homeState.loading || homeState.done) return;
      await loadHomePage(homeState.nextOffset, true);
    }, { rootMargin: "1200px 0px 1200px 0px" });
    observer.observe(sentinel);
  }
  window.addEventListener("scroll", () => updateHomeTimelineFromScroll(), { passive: true });
  window.addEventListener("resize", () => {
    sizeHomeTimeline();
    updateHomeTimelineFromScroll();
  });
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

function downloadResource(group) {
  return imageResource(group) || videoResource(group) || group.resources?.[0] || null;
}

function kindBadgeMeta(kind) {
  const mapping = {
    image: { letter: "I", label: "Image", className: "kind-image" },
    live: { letter: "L", label: "Live", className: "kind-live" },
    video: { letter: "V", label: "Video", className: "kind-video" },
    edited: { letter: "E", label: "Edited", className: "kind-edited" },
  };
  return mapping[kind] || { letter: String(kind || "?").slice(0, 1).toUpperCase(), label: kind, className: "kind-generic" };
}

function kindBadgesHtml(kinds) {
  return (kinds || []).map((kind) => {
    const meta = kindBadgeMeta(kind);
    return `<span class="chip resource-kind-badge ${meta.className}" title="${escapeHtml(meta.label)}">${escapeHtml(meta.letter)}</span>`;
  }).join("");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformGcjLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformGcjLon(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

function wgs84ToGcj02(lon, lat) {
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

function mapDisplayLonLat(lon, lat) {
  return mapState.tileProvider.coordinateSystem === "gcj02" ? wgs84ToGcj02(lon, lat) : { lon, lat };
}

function tileUrl(provider, zoom, x, y) {
  const subdomains = provider.subdomains || [""];
  const subdomain = subdomains[Math.abs(x + y) % subdomains.length] || "";
  return provider.url
    .replace("{s}", subdomain)
    .replace("{z}", String(zoom))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
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

function renderMapMarkersLegacy(map) {
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
  mapState.tileProviderKey = map.dataset.tileProvider || "osm";
  mapState.tileProvider = MAP_TILE_PROVIDERS[mapState.tileProviderKey] || MAP_TILE_PROVIDERS.osm;
  const storedDensity = Number(localStorage.getItem("tagbum.mapDensity"));
  const initialDensity = Number.isFinite(storedDensity) ? storedDensity : Number(map.dataset.density || 3);
  resizeMapCanvas(map);
  setMapDensity(initialDensity, false);
  renderMap();
  scheduleMapRefresh(0);

  const densitySlider = document.querySelector("[data-map-density]");
  densitySlider?.addEventListener("input", (event) => setMapDensity(event.target.value, true));

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

function galleryContextIds(source) {
  const homeGallery = source?.closest("[data-home-gallery]");
  const scope = homeGallery || source?.closest(".gallery");
  if (!scope) return [];
  return [...scope.querySelectorAll("[data-group-id]")]
    .map((item) => Number(item.dataset.groupId))
    .filter(Boolean);
}

function duplicatePreviewIds(source) {
  const scope = source?.closest("[data-duplicate-preview-scope]");
  if (!scope) return [];
  return [...scope.querySelectorAll("[data-open-duplicate-preview]")]
    .map((item) => Number(item.dataset.openDuplicatePreview))
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
        <button type="button" data-preview-center>居中</button>
        <a class="preview-download" data-preview-download href="#" download>下载</a>
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

function centerPreview() {
  previewState.panX = 0;
  previewState.panY = 0;
  applyPreviewTransform();
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
  const download = modal.querySelector("[data-preview-download]");
  const primaryImage = imageResource(group);
  const liveVideo = videoResource(group);
  const primaryDownload = downloadResource(group);

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
  } else if (!liveVideo) {
    live.removeAttribute("src");
    hint.hidden = true;
  } else {
    hint.hidden = true;
  }

  title.textContent = group.display_name;
  tags.innerHTML = group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  if (download && primaryDownload) {
    download.href = primaryDownload.url;
    download.download = primaryDownload.filename || "";
    download.hidden = false;
  } else if (download) {
    download.removeAttribute("href");
    download.download = "";
    download.hidden = true;
  }
  resources.innerHTML = group.resources
    .map((item) => `<a href="${item.url}" download="${escapeHtml(item.filename || "")}">${escapeHtml(item.filename)}<br>${escapeHtml(kindBadgeMeta(item.kind).label)} ${escapeHtml(item.extension)}</a>`)
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
  kinds.innerHTML = kindBadgesHtml(group.resource_kinds);
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

function renderScanStatus(status) {
  const root = document.querySelector("[data-scan-status]");
  if (!root) return;
  const message = root.querySelector("[data-scan-message]");
  const detail = root.querySelector("[data-scan-detail]");
  const bar = root.querySelector("[data-scan-progress]");
  const label = root.querySelector("[data-scan-progress-label]");
  const stats = root.querySelector("[data-scan-stats]");
  if (message) message.textContent = status.message || "";
  if (detail) {
    if (status.running) {
      detail.textContent = status.current_album ? `正在扫描 ${status.current_album}` : `正在扫描 ${status.profile || ""}`;
    } else if (status.finished_at) {
      detail.textContent = `完成时间：${status.finished_at}`;
    } else {
      detail.textContent = "";
    }
  }
  const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = `${status.current || 0} / ${status.total || 0} · ${percent}%`;
  if (stats && Array.isArray(status.stats)) {
    stats.innerHTML = status.stats.map((item) => `
      <article>
        <strong>${escapeHtml(item.album || "")}</strong>
        <span>${item.error ? escapeHtml(item.error) : `分组 ${item.groups_seen || 0}，资源新增 ${item.resources_created || 0}，更新 ${item.resources_updated || 0}，跳过 ${item.resources_skipped || 0}`}</span>
      </article>
    `).join("");
  }
}

function renderDuplicateStatus(status) {
  const root = document.querySelector("[data-duplicate-status]");
  if (!root) return;
  const message = root.querySelector("[data-duplicate-message]");
  const detail = root.querySelector("[data-duplicate-detail]");
  const bar = root.querySelector("[data-duplicate-progress]");
  const label = root.querySelector("[data-duplicate-progress-label]");
  if (message) message.textContent = status.message || "";
  if (detail) {
    if (status.running) {
      detail.textContent = status.profile ? `正在分析 ${status.profile}` : "正在分析";
    } else if (status.finished_at) {
      detail.textContent = `完成时间：${status.finished_at}`;
    } else {
      detail.textContent = "";
    }
  }
  const percent = status.total ? Math.max(0, Math.min(100, Math.round((Number(status.current || 0) / Number(status.total || 1)) * 100))) : 0;
  if (bar) bar.style.width = `${percent}%`;
  if (label) {
    label.textContent = `${status.current || 0} / ${status.total || 0} · 缓存 ${status.cached || 0} · 完全重复 ${status.exact_sets || 0} 组 · 元数据不同 ${status.content_sets || 0} 组`;
  }
}

function initSettingsPage() {
  if (!document.querySelector("[data-scan-status]")) return;
  const nameInput = document.querySelector("[data-profile-name]");
  const databaseInput = document.querySelector("[data-profile-database]");
  const albumInput = document.querySelector("[data-profile-albums]");
  let databaseTouched = false;

  databaseInput?.addEventListener("input", () => {
    databaseTouched = true;
  });

  nameInput?.addEventListener("input", async () => {
    const name = nameInput.value.trim();
    if (!name || databaseTouched || !databaseInput) return;
    const response = await fetch(`/api/settings/default-database?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    databaseInput.value = payload.database || "";
  });

  document.querySelector("[data-pick-album-folder]")?.addEventListener("click", async () => {
    const button = document.querySelector("[data-pick-album-folder]");
    button.disabled = true;
    button.textContent = "选择中";
    try {
      const response = await fetch("/api/settings/pick-folder", { method: "POST" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.path && albumInput) {
        const existing = albumInput.value.trim();
        albumInput.value = existing ? `${existing}\n${payload.path}` : payload.path;
      }
    } finally {
      button.disabled = false;
      button.textContent = "选择相册";
    }
  });

  const poll = async () => {
    const response = await fetch("/api/settings/scan-status", { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    renderScanStatus(status);
  };
  poll();
  window.setInterval(poll, 1000);
}

function initToolsPage() {
  const root = document.querySelector("[data-duplicate-status]");
  if (!root) return;
  initBusyLockForms();
  let lastRunning = root.dataset.running === "true";
  let lastFinishedAt = root.dataset.finishedAt || "";
  const poll = async () => {
    const response = await fetch("/api/tools/duplicates/status", { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    renderDuplicateStatus(status);
    const nextFinishedAt = status.finished_at || "";
    if ((lastRunning && !status.running) || (!status.running && nextFinishedAt && nextFinishedAt !== lastFinishedAt)) {
      window.location.reload();
      return;
    }
    lastRunning = Boolean(status.running);
    lastFinishedAt = nextFinishedAt;
  };
  poll();
  window.setInterval(poll, 1000);
}

function initBusyLockForms() {
  const forms = [...document.querySelectorAll("[data-busy-lock-form]")];
  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (form.dataset.busy === "true") {
        event.preventDefault();
        return;
      }
      form.dataset.busy = "true";
      document.body.classList.add("tools-action-busy");
      form.classList.add("is-busy");
      form.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      if (event.submitter) {
        event.submitter.dataset.originalLabel = event.submitter.textContent;
        event.submitter.textContent = "处理中...";
      }
    });
  });
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

  const duplicatePreview = event.target.closest("[data-open-duplicate-preview]");
  if (duplicatePreview) {
    await openPreview(duplicatePreview.dataset.openDuplicatePreview, duplicatePreviewIds(duplicatePreview));
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

  if (event.target.closest("[data-preview-center]")) {
    centerPreview();
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
  if (!previewState.group || !imageResource(previewState.group) || !videoResource(previewState.group)) return;
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

document.addEventListener("pointerup", stopPreviewPointerActions);
document.addEventListener("pointercancel", stopPreviewPointerActions);
document.addEventListener("pointerleave", (event) => {
  if (event.target.closest?.("[data-live-hold]")) stopModalLive();
});

initTagger();
initDateStrips();
initHomeGallery();
initMap();
initSettingsPage();
initToolsPage();
