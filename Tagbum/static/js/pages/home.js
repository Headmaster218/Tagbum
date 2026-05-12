import {
  compactDateItems,
  escapeHtml,
  formatMonthKey,
  formatMonthTitle,
  groupCache,
  homeState,
  kindBadgesHtml,
  resolveDateBucket,
} from "../core/shared.js";

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

function renderSection(groups, offset, sectionNumber, previousMonthKey) {
  let previousMonth = previousMonthKey;
  const cards = groups.map((group) => {
    const monthKey = formatMonthKey(group.taken_at);
    const divider = monthKey !== previousMonth
      ? `<div class="gallery-month-divider" data-month-key="${monthKey}"><span>${escapeHtml(formatMonthTitle(monthKey))}</span></div>`
      : "";
    previousMonth = monthKey;
    return `${divider}${renderAssetCard(group)}`;
  }).join("");
  return {
    html: `
      <section class="gallery-page-section" data-home-page="${sectionNumber}" data-home-offset="${offset}">
        <div class="gallery-page-divider"><span>第 ${sectionNumber} 段</span></div>
        <div class="gallery">${cards}</div>
      </section>
    `,
    lastMonthKey: previousMonth,
  };
}

function sortedChunkOffsets() {
  return [...homeState.chunks.keys()].sort((a, b) => a - b);
}

function loadedCount() {
  return sortedChunkOffsets().reduce((total, offset) => total + (homeState.chunks.get(offset)?.length || 0), 0);
}

function updateStatus(text) {
  const status = document.querySelector("[data-home-gallery-status]");
  if (status) status.textContent = text;
}

function updateCount() {
  const count = document.querySelector("[data-home-count]");
  if (count) count.textContent = `${loadedCount()} / ${homeState.total}`;
}

function currentCards() {
  return [...document.querySelectorAll("[data-home-gallery] [data-group-id]")];
}

function currentScrollRoot() {
  return document.querySelector("[data-home-scroll]");
}

function attachGalleryWheel() {
  const scrollRoot = currentScrollRoot();
  if (!scrollRoot || scrollRoot.dataset.wheelBound === "true") return;
  scrollRoot.dataset.wheelBound = "true";
  scrollRoot.addEventListener("wheel", (event) => {
    const canScroll = scrollRoot.scrollHeight > scrollRoot.clientHeight + 1;
    if (!canScroll) return;
    event.preventDefault();
    scrollRoot.scrollTop += event.deltaY || event.deltaX;
  }, { capture: true, passive: false });
}

function renderGallery() {
  const container = document.querySelector("[data-home-gallery]");
  if (!container) return;
  let previousMonth = null;
  const html = sortedChunkOffsets().map((offset) => {
    const groups = homeState.chunks.get(offset) || [];
    const sectionNumber = Math.floor(offset / homeState.pageSize) + 1;
    const rendered = renderSection(groups, offset, sectionNumber, previousMonth);
    previousMonth = rendered.lastMonthKey;
    return rendered.html;
  }).join("");
  container.innerHTML = html;
  updateCount();
}

function updateTimelineMarker(value) {
  const timeline = document.querySelector("[data-home-timeline]");
  const label = document.querySelector("[data-home-timeline-label]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  timeline.querySelectorAll(".home-timeline-tick.active").forEach((item) => item.classList.remove("active"));
  if (cell) cell.classList.add("active");
  const text = cell?.dataset.endDate && cell.dataset.endDate !== value ? `${value} - ${cell.dataset.endDate}` : value;
  if (label) label.textContent = text;
}

function syncTimelineToDate(value, recenter = true) {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  if (!cell) return;
  timeline.dataset.selectedDate = value;
  updateTimelineMarker(value);
  if (recenter) timeline.scrollTop = Math.max(0, cell.offsetTop + cell.offsetHeight / 2 - timeline.clientHeight / 2);
}

function selectedTimelineCell() {
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

function updateTimelineFromCenter(recenter = false) {
  const cell = selectedTimelineCell();
  if (!cell) return;
  homeState.requestedDate = cell.dataset.date;
  updateTimelineMarker(cell.dataset.date);
  if (recenter) syncTimelineToDate(cell.dataset.date, true);
}

function currentVisibleDate() {
  const cards = currentCards();
  if (!cards.length) return "";
  const scrollRoot = currentScrollRoot();
  if (!scrollRoot) return "";
  const rootRect = scrollRoot.getBoundingClientRect();
  const threshold = rootRect.top + 96;
  const candidate = cards.find((card) => card.getBoundingClientRect().bottom > threshold);
  return candidate?.dataset.takenAt?.slice(0, 10) || cards[0].dataset.takenAt?.slice(0, 10) || "";
}

function updateTimelineFromScroll() {
  const value = currentVisibleDate();
  if (!value || homeState.timelineDragging) return;
  syncTimelineToDate(resolveDateBucket(homeState.timelineItems, value)?.date || value, true);
}

async function fetchChunk(offset) {
  const response = await fetch(`/api/groups?offset=${offset}&limit=${homeState.pageSize}`, { cache: "no-store" });
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  return groups;
}

async function loadChunk(offset, mode = "append", focusOffset = null) {
  if (homeState.loadingOffsets.has(offset)) return;
  if (offset < 0 || offset >= homeState.total) return;
  if (homeState.chunks.has(offset)) return;
  homeState.loadingOffsets.add(offset);
  updateStatus(mode === "prepend" ? "正在向上加载..." : "正在加载...");
  const scrollRoot = currentScrollRoot();
  const beforeHeight = scrollRoot?.scrollHeight || 0;
  const beforeScrollTop = scrollRoot?.scrollTop || 0;
  const groups = await fetchChunk(offset);
  homeState.loadingOffsets.delete(offset);
  if (!groups.length) {
    if (mode === "prepend") homeState.reachedTop = true;
    else homeState.reachedBottom = true;
    updateStatus(loadedCount() ? "已加载当前可见范围" : "还没有已索引的照片。");
    return;
  }
  homeState.chunks.set(offset, groups);
  homeState.reachedTop = sortedChunkOffsets()[0] <= 0;
  homeState.reachedBottom = sortedChunkOffsets().at(-1) + groups.length >= homeState.total;
  renderGallery();
  if (mode === "prepend" && scrollRoot) {
    const afterHeight = scrollRoot.scrollHeight;
    scrollRoot.scrollTop = beforeScrollTop + (afterHeight - beforeHeight);
  }
  if (focusOffset !== null && scrollRoot) {
    const chunk = homeState.chunks.get(offset) || [];
    const focusIndex = Math.max(0, Math.min(chunk.length - 1, focusOffset - offset));
    const focusGroup = chunk[focusIndex];
    scrollRoot.querySelector(`[data-group-id="${focusGroup.id}"]`)?.scrollIntoView({ block: "start" });
  }
  updateStatus(homeState.reachedTop && homeState.reachedBottom ? "已加载全部内容" : "继续滚动以加载更多");
  updateTimelineFromScroll();
}

async function ensureViewportFilled() {
  const scrollRoot = currentScrollRoot();
  if (!scrollRoot) return;
  let attempts = 0;
  let previousHeight = scrollRoot.scrollHeight;
  while (!homeState.reachedBottom && scrollRoot.scrollHeight <= scrollRoot.clientHeight + 120 && attempts < 4) {
    const lastOffset = sortedChunkOffsets().at(-1);
    if (!Number.isFinite(lastOffset)) break;
    const lastLength = homeState.chunks.get(lastOffset)?.length || 0;
    await loadChunk(lastOffset + lastLength, "append");
    attempts += 1;
    if (scrollRoot.scrollHeight <= previousHeight) break;
    previousHeight = scrollRoot.scrollHeight;
  }
}

async function resetGallery(offset = 0, requestedDate = "", focusOffset = null) {
  homeState.chunks = new Map();
  homeState.loadingOffsets = new Set();
  homeState.reachedTop = false;
  homeState.reachedBottom = false;
  homeState.requestedDate = requestedDate;
  renderGallery();
  await loadChunk(offset, "replace", focusOffset);
  await ensureViewportFilled();
}

async function maybeLoadAroundScroll() {
  const scrollRoot = currentScrollRoot();
  if (!scrollRoot) return;
  if (scrollRoot.scrollTop < 360 && !homeState.reachedTop) {
    const firstOffset = sortedChunkOffsets()[0];
    if (Number.isFinite(firstOffset)) {
      await loadChunk(Math.max(0, firstOffset - homeState.pageSize), "prepend");
    }
  }
  if (scrollRoot.scrollHeight - scrollRoot.scrollTop - scrollRoot.clientHeight < 900 && !homeState.reachedBottom) {
    const lastOffset = sortedChunkOffsets().at(-1);
    if (Number.isFinite(lastOffset)) {
      const lastLength = homeState.chunks.get(lastOffset)?.length || 0;
      await loadChunk(lastOffset + lastLength, "append");
    }
  }
}

async function jumpToDate(rawDate) {
  if (!rawDate) return;
  const response = await fetch(`/api/position?jump_date=${encodeURIComponent(rawDate)}`);
  if (!response.ok) return;
  const payload = await response.json();
  const pageOffset = Math.max(0, Math.floor((payload.offset || 0) / homeState.pageSize) * homeState.pageSize);
  await resetGallery(pageOffset, rawDate, payload.offset || 0);
}

function sizeTimeline() {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return;
  const inset = Math.max(0, timeline.clientHeight / 2 - 3);
  timeline.style.paddingTop = `${inset}px`;
  timeline.style.paddingBottom = `${inset}px`;
}

function renderTimeline(items) {
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

function attachTimelineEvents() {
  const timeline = document.querySelector("[data-home-timeline]");
  if (!timeline) return;
  let scrollTimer = null;
  timeline.addEventListener("wheel", (event) => {
    event.preventDefault();
    timeline.scrollTop += event.deltaY || event.deltaX;
    updateTimelineFromCenter(false);
  }, { capture: true, passive: false });
  timeline.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => updateTimelineFromCenter(false), 40);
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
    updateTimelineFromCenter(false);
    const cell = event.target.closest("[data-date]");
    if (cell && !homeState.timelineMoved) {
      homeState.requestedDate = cell.dataset.date;
      syncTimelineToDate(cell.dataset.date, true);
      await jumpToDate(cell.dataset.date);
    }
  });
  timeline.addEventListener("pointercancel", () => {
    homeState.timelineDragging = false;
    timeline.classList.remove("dragging");
  });
  document.querySelector("[data-home-timeline-jump]")?.addEventListener("click", async () => {
    const selected = selectedTimelineCell();
    if (!selected) return;
    await jumpToDate(selected.dataset.date);
  });
}

export async function initHomeGallery() {
  const root = document.querySelector("[data-home-gallery-root]");
  const scrollRoot = currentScrollRoot();
  if (!root || !scrollRoot) return;
  homeState.total = Number(root.dataset.totalGroups || 0);
  homeState.pageSize = Number(root.dataset.pageSize || 72);
  homeState.chunks = new Map();
  homeState.loadingOffsets = new Set();
  homeState.reachedTop = false;
  homeState.reachedBottom = false;

  const timelineResponse = await fetch("/api/dates", { cache: "no-store" });
  const timelinePayload = await timelineResponse.json();
  const items = compactDateItems(timelinePayload.dates || [], 5);
  renderTimeline(items);
  sizeTimeline();
  attachTimelineEvents();
  attachGalleryWheel();

  const initialOffset = Number(root.dataset.initialOffset || 0);
  const initialDate = root.dataset.currentDate || timelinePayload.max_date || "";
  const initialBucket = resolveDateBucket(items, initialDate);
  if (initialBucket) {
    homeState.requestedDate = initialBucket.date;
    syncTimelineToDate(initialBucket.date, true);
  }

  if (homeState.total <= 0) {
    updateStatus("还没有已索引的照片。");
    updateCount();
    return;
  }

  await resetGallery(initialOffset, initialDate, initialOffset);

  let scrollTimer = null;
  scrollRoot.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(async () => {
      updateTimelineFromScroll();
      await maybeLoadAroundScroll();
    }, 30);
  }, { passive: true });

  window.addEventListener("resize", () => {
    sizeTimeline();
    updateTimelineFromScroll();
  });
}
