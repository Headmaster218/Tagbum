import {
  compactDateItems,
  escapeHtml,
  filterState,
  formatMonthKey,
  formatMonthTitle,
  groupCache,
  kindBadgesHtml,
  resolveDateBucket,
} from "../core/shared.js";

function querySuffix() {
  const query = new URLSearchParams();
  if (filterState.tag) query.set("tag", filterState.tag);
  if (filterState.kind) query.set("kind", filterState.kind);
  return query.toString();
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

function renderMonthDivider(monthKey) {
  return `<div class="gallery-month-divider" data-month-key="${monthKey}"><span>${escapeHtml(formatMonthTitle(monthKey))}</span></div>`;
}

function renderSection(groups, offset, sectionIndex) {
  let previousMonth = filterState.lastMonthKey;
  const cards = groups.map((group) => {
    const monthKey = formatMonthKey(group.taken_at);
    const divider = monthKey !== previousMonth ? renderMonthDivider(monthKey) : "";
    previousMonth = monthKey;
    return `${divider}${renderAssetCard(group)}`;
  }).join("");
  filterState.lastMonthKey = previousMonth;
  return `
    <section class="gallery-page-section" data-filter-page="${sectionIndex}" data-filter-offset="${offset}">
      <div class="gallery-page-divider"><span>第 ${sectionIndex} 段</span></div>
      <div class="gallery">${cards}</div>
    </section>
  `;
}

function updateStatus(text) {
  const status = document.querySelector("[data-filter-gallery-status]");
  if (status) status.textContent = text;
}

function updateCount() {
  const count = document.querySelector("[data-filter-count]");
  if (!count) return;
  const loaded = document.querySelectorAll("[data-filter-gallery] [data-group-id]").length;
  count.textContent = `${loaded} / ${filterState.total}`;
}

function currentCards() {
  return [...document.querySelectorAll("[data-filter-gallery] [data-group-id]")];
}

function updateTimelineMarker(value) {
  const timeline = document.querySelector("[data-filter-timeline]");
  const label = document.querySelector("[data-filter-timeline-label]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  timeline.querySelectorAll(".home-timeline-tick.active").forEach((item) => item.classList.remove("active"));
  if (cell) cell.classList.add("active");
  const text = cell?.dataset.endDate && cell.dataset.endDate !== value ? `${value} - ${cell.dataset.endDate}` : value;
  if (label) label.textContent = text;
}

function syncTimelineToDate(value, recenter = true) {
  const timeline = document.querySelector("[data-filter-timeline]");
  if (!timeline || !value) return;
  const cell = timeline.querySelector(`[data-date="${CSS.escape(value)}"]`);
  if (!cell) return;
  timeline.dataset.selectedDate = value;
  updateTimelineMarker(value);
  if (recenter) {
    timeline.scrollTop = Math.max(0, cell.offsetTop + cell.offsetHeight / 2 - timeline.clientHeight / 2);
  }
}

function selectedTimelineCell() {
  const timeline = document.querySelector("[data-filter-timeline]");
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
  filterState.requestedDate = cell.dataset.date;
  updateTimelineMarker(cell.dataset.date);
  if (recenter) syncTimelineToDate(cell.dataset.date, true);
}

async function jumpToDate(rawDate) {
  if (!rawDate) return;
  const query = new URLSearchParams();
  query.set("jump_date", rawDate);
  if (filterState.tag) query.set("tag", filterState.tag);
  if (filterState.kind) query.set("kind", filterState.kind);
  const response = await fetch(`/api/position?${query.toString()}`);
  if (!response.ok) return;
  const payload = await response.json();
  const pageOffset = Math.max(0, Math.floor((payload.offset || 0) / filterState.pageSize) * filterState.pageSize);
  await resetGallery(pageOffset, rawDate, payload.offset || 0);
}

function currentVisibleDate() {
  const cards = currentCards();
  if (!cards.length) return "";
  const threshold = 96;
  const candidate = cards.find((card) => card.getBoundingClientRect().bottom > threshold);
  return candidate?.dataset.takenAt?.slice(0, 10) || cards[0].dataset.takenAt?.slice(0, 10) || "";
}

function updateTimelineFromScroll() {
  const value = currentVisibleDate();
  if (!value || filterState.timelineDragging) return;
  syncTimelineToDate(resolveDateBucket(filterState.timelineItems, value)?.date || value, true);
}

async function loadPage(offset, append = true, focusOffset = null) {
  if (filterState.loading || filterState.done) return;
  filterState.loading = true;
  updateStatus("正在加载...");
  const suffix = querySuffix();
  const url = `/api/groups?offset=${offset}&limit=${filterState.pageSize}${suffix ? `&${suffix}` : ""}`;
  const response = await fetch(url, { cache: "no-store" });
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  const container = document.querySelector("[data-filter-gallery]");
  if (!container) return;
  if (!append) container.innerHTML = "";
  if (!groups.length) {
    filterState.done = true;
    filterState.loading = false;
    updateStatus(container.children.length ? "已加载全部内容" : "当前筛选条件下还没有照片。");
    updateCount();
    return;
  }
  filterState.pageNumber += 1;
  container.insertAdjacentHTML("beforeend", renderSection(groups, offset, filterState.pageNumber));
  filterState.nextOffset = offset + groups.length;
  filterState.done = filterState.nextOffset >= filterState.total;
  filterState.loading = false;
  updateCount();
  updateStatus(filterState.done ? "已加载全部内容" : "继续向下滚动以加载更多");
  if (focusOffset !== null) {
    const focusIndex = Math.max(0, Math.min(groups.length - 1, focusOffset - offset));
    const focusGroup = groups[focusIndex];
    const card = container.querySelector(`[data-group-id="${focusGroup.id}"]`);
    card?.scrollIntoView({ block: "start" });
  }
  updateTimelineFromScroll();
}

async function resetGallery(offset = 0, requestedDate = "", focusOffset = null) {
  filterState.nextOffset = offset;
  filterState.done = false;
  filterState.loading = false;
  filterState.pageNumber = Math.floor(offset / filterState.pageSize);
  filterState.lastMonthKey = null;
  filterState.requestedDate = requestedDate;
  await loadPage(offset, false, focusOffset);
}

function renderTimeline(items) {
  const timeline = document.querySelector("[data-filter-timeline]");
  if (!timeline) return;
  filterState.timelineItems = items;
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

function sizeTimeline() {
  const timeline = document.querySelector("[data-filter-timeline]");
  if (!timeline) return;
  const inset = Math.max(0, timeline.clientHeight / 2 - 3);
  timeline.style.paddingTop = `${inset}px`;
  timeline.style.paddingBottom = `${inset}px`;
}

function attachTimelineEvents() {
  const timeline = document.querySelector("[data-filter-timeline]");
  if (!timeline) return;
  let scrollTimer = null;
  timeline.addEventListener("wheel", (event) => {
    event.preventDefault();
    timeline.scrollTop += event.deltaY || event.deltaX;
    updateTimelineFromCenter(false);
  }, { passive: false });
  timeline.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => updateTimelineFromCenter(false), 40);
  });
  timeline.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    filterState.timelineDragging = true;
    filterState.timelineMoved = false;
    filterState.timelineStartY = event.clientY;
    filterState.timelineScrollTop = timeline.scrollTop;
    timeline.setPointerCapture(event.pointerId);
    timeline.classList.add("dragging");
  });
  timeline.addEventListener("pointermove", (event) => {
    if (!filterState.timelineDragging) return;
    const delta = event.clientY - filterState.timelineStartY;
    if (Math.abs(delta) > 3) filterState.timelineMoved = true;
    timeline.scrollTop = filterState.timelineScrollTop - delta;
  });
  timeline.addEventListener("pointerup", async (event) => {
    if (!filterState.timelineDragging) return;
    filterState.timelineDragging = false;
    timeline.releasePointerCapture(event.pointerId);
    timeline.classList.remove("dragging");
    updateTimelineFromCenter(false);
    const cell = event.target.closest("[data-date]");
    if (cell && !filterState.timelineMoved) {
      filterState.requestedDate = cell.dataset.date;
      syncTimelineToDate(cell.dataset.date, true);
      await jumpToDate(cell.dataset.date);
    }
  });
  timeline.addEventListener("pointercancel", () => {
    filterState.timelineDragging = false;
    timeline.classList.remove("dragging");
  });
  document.querySelector("[data-filter-timeline-jump]")?.addEventListener("click", async () => {
    const selected = selectedTimelineCell();
    if (!selected) return;
    filterState.requestedDate = selected.dataset.date;
    await jumpToDate(selected.dataset.date);
  });
}

export async function initFilterGallery() {
  const root = document.querySelector("[data-filter-gallery-root]");
  if (!root) return;
  filterState.total = Number(root.dataset.totalGroups || 0);
  filterState.pageSize = Number(root.dataset.pageSize || 72);
  filterState.tag = root.dataset.activeTag || "";
  filterState.kind = root.dataset.activeKind || "";
  const query = new URLSearchParams();
  if (filterState.tag) query.set("tag", filterState.tag);
  if (filterState.kind) query.set("kind", filterState.kind);
  const timelineResponse = await fetch(`/api/dates?${query.toString()}`, { cache: "no-store" });
  const timelinePayload = await timelineResponse.json();
  const items = compactDateItems(timelinePayload.dates || [], 5);
  renderTimeline(items);
  sizeTimeline();
  attachTimelineEvents();
  const initialDate = root.dataset.currentDate || timelinePayload.max_date || "";
  const initialBucket = resolveDateBucket(items, initialDate);
  if (initialBucket) {
    filterState.requestedDate = initialBucket.date;
    syncTimelineToDate(initialBucket.date, true);
  }
  if (filterState.total <= 0) {
    updateStatus("当前筛选条件下还没有照片。");
    updateCount();
    return;
  }
  await resetGallery(0, initialDate, 0);
  const sentinel = document.querySelector("[data-filter-gallery-sentinel]");
  if (sentinel) {
    const observer = new IntersectionObserver(async (entries) => {
      const entry = entries[0];
      if (!entry?.isIntersecting || filterState.loading || filterState.done) return;
      await loadPage(filterState.nextOffset, true);
    }, { rootMargin: "1200px 0px 1200px 0px" });
    observer.observe(sentinel);
  }
  window.addEventListener("scroll", () => updateTimelineFromScroll(), { passive: true });
  window.addEventListener("resize", () => {
    sizeTimeline();
    updateTimelineFromScroll();
  });
}
