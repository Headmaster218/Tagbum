import {
  escapeHtml,
  formatMonthKey,
  formatMonthTitle,
  groupCache,
  homeState,
  kindBadgesHtml,
  compactDateItems,
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

function renderHomeMonthDivider(monthKey) {
  return `<div class="gallery-month-divider" data-month-key="${monthKey}"><span>${escapeHtml(formatMonthTitle(monthKey))}</span></div>`;
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

export async function initHomeGallery() {
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
