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

function readJsonScript(selector) {
  const node = document.querySelector(selector);
  if (!node) return null;
  try {
    return JSON.parse(node.textContent || "null");
  } catch {
    return null;
  }
}

function defaultCondition() {
  return { kind: "condition", field: "tag", value: "", negate: false };
}

function defaultGroup() {
  return { kind: "group", op: "and", negate: false, items: [defaultCondition()] };
}

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function normalizeNode(node) {
  if (!node || typeof node !== "object") return defaultGroup();
  if (node.kind === "condition") {
    return {
      kind: "condition",
      field: node.field === "resource" ? "resource" : "tag",
      value: String(node.value || ""),
      negate: Boolean(node.negate),
    };
  }
  const items = Array.isArray(node.items) ? node.items.map(normalizeNode) : [];
  return {
    kind: "group",
    op: node.op === "or" ? "or" : "and",
    negate: Boolean(node.negate),
    items: items.length ? items : [defaultCondition()],
  };
}

function currentExpression() {
  return filterState.expression || defaultGroup();
}

function serializeExpression() {
  return JSON.stringify(currentExpression());
}

function resourceOptionList() {
  return filterState.resourceOptions || [];
}

function tagOptionList() {
  return filterState.tagOptions || [];
}

function resourceLabel(value) {
  const match = resourceOptionList().find(([optionValue]) => optionValue === value);
  return match?.[1] || value;
}

function updateExpressionAtPath(path, updater) {
  const next = cloneNode(currentExpression());
  let target = next;
  for (const index of path) target = target.items[index];
  updater(target);
  filterState.expression = normalizeNode(next);
  renderBuilder();
}

function removeAtPath(path) {
  if (!path.length) {
    filterState.expression = defaultGroup();
    renderBuilder();
    return;
  }
  const next = cloneNode(currentExpression());
  let target = next;
  for (const index of path.slice(0, -1)) target = target.items[index];
  target.items.splice(path[path.length - 1], 1);
  if (!target.items.length) target.items.push(defaultCondition());
  filterState.expression = normalizeNode(next);
  renderBuilder();
}

function addCondition(path) {
  updateExpressionAtPath(path, (group) => {
    group.items.push(defaultCondition());
  });
}

function addGroup(path) {
  updateExpressionAtPath(path, (group) => {
    group.items.push(defaultGroup());
  });
}

function renderCondition(node, path) {
  const tagOptions = tagOptionList()
    .map(([name, count]) => `<option value="${escapeHtml(name)}"${node.value === name ? " selected" : ""}>${escapeHtml(name)} (${count})</option>`)
    .join("");
  const resourceOptions = resourceOptionList()
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${node.value === value ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const valueControl = node.field === "tag"
    ? `<select data-filter-value="${path.join(".")}"><option value="">选择标签</option>${tagOptions}</select>`
    : `<select data-filter-value="${path.join(".")}"><option value="">选择类型</option>${resourceOptions}</select>`;
  return `
    <div class="filter-condition" data-filter-path="${path.join(".")}">
      <label class="filter-negate-toggle">
        <input type="checkbox" data-filter-negate="${path.join(".")}" ${node.negate ? "checked" : ""}>
        <span>非</span>
      </label>
      <select data-filter-field="${path.join(".")}">
        <option value="tag"${node.field === "tag" ? " selected" : ""}>标签</option>
        <option value="resource"${node.field === "resource" ? " selected" : ""}>资源类型</option>
      </select>
      ${valueControl}
      <button type="button" data-filter-remove="${path.join(".")}">删除</button>
    </div>
  `;
}

function renderGroup(node, path = [], isRoot = false) {
  const items = node.items.map((item, index) => {
    const childPath = [...path, index];
    return item.kind === "group" ? renderGroup(item, childPath) : renderCondition(item, childPath);
  }).join("");
  return `
    <section class="filter-group ${isRoot ? "is-root" : ""}" data-filter-group="${path.join(".")}">
      <header class="filter-group-head">
        <div class="filter-group-meta">
          <strong>${isRoot ? "根规则组" : "子规则组"}</strong>
          <select data-filter-op="${path.join(".")}">
            <option value="and"${node.op === "and" ? " selected" : ""}>匹配全部（AND）</option>
            <option value="or"${node.op === "or" ? " selected" : ""}>匹配任一（OR）</option>
          </select>
          <label class="filter-negate-toggle">
            <input type="checkbox" data-filter-group-negate="${path.join(".")}" ${node.negate ? "checked" : ""}>
            <span>整组取反</span>
          </label>
        </div>
        <div class="filter-group-actions">
          <button type="button" data-filter-add-condition="${path.join(".")}">加条件</button>
          <button type="button" data-filter-add-group="${path.join(".")}">加分组</button>
          ${isRoot ? "" : `<button type="button" data-filter-remove="${path.join(".")}">删除分组</button>`}
        </div>
      </header>
      <div class="filter-group-body">${items}</div>
    </section>
  `;
}

function renderBuilder() {
  const tree = document.querySelector("[data-filter-builder-tree]");
  if (!tree) return;
  tree.innerHTML = renderGroup(currentExpression(), [], true);
}

function expressionQueryString() {
  const expression = serializeExpression();
  const query = new URLSearchParams();
  query.set("filter_expr", expression);
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
  query.set("filter_expr", serializeExpression());
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
  const query = new URLSearchParams();
  query.set("offset", String(offset));
  query.set("limit", String(filterState.pageSize));
  query.set("filter_expr", serializeExpression());
  const response = await fetch(`/api/groups?${query.toString()}`, { cache: "no-store" });
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

async function refreshTimelineAndResults() {
  const query = new URLSearchParams();
  query.set("filter_expr", serializeExpression());
  const timelineResponse = await fetch(`/api/dates?${query.toString()}`, { cache: "no-store" });
  const timelinePayload = await timelineResponse.json();
  const items = compactDateItems(timelinePayload.dates || [], 5);
  renderTimeline(items);
  sizeTimeline();
  const initialDate = timelinePayload.max_date || "";
  const initialBucket = resolveDateBucket(items, initialDate);
  if (initialBucket) {
    filterState.requestedDate = initialBucket.date;
    syncTimelineToDate(initialBucket.date, true);
  } else {
    const label = document.querySelector("[data-filter-timeline-label]");
    if (label) label.textContent = "选择日期";
  }
  const positionResponse = await fetch(`/api/position?${query.toString()}`, { cache: "no-store" });
  const positionPayload = await positionResponse.json();
  filterState.total = Number(positionPayload.total || 0);
  updateCount();
  await resetGallery(0, initialDate, 0);
}

function attachBuilderEvents() {
  const root = document.querySelector("[data-filter-builder-root]");
  if (!root) return;
  root.addEventListener("change", (event) => {
    const field = event.target.closest("[data-filter-field]");
    if (field) {
      const path = field.dataset.filterField.split(".").map(Number);
      updateExpressionAtPath(path, (node) => {
        node.field = field.value === "resource" ? "resource" : "tag";
        node.value = "";
      });
      return;
    }
    const value = event.target.closest("[data-filter-value]");
    if (value) {
      const path = value.dataset.filterValue.split(".").map(Number);
      updateExpressionAtPath(path, (node) => {
        node.value = value.value;
      });
      return;
    }
    const negate = event.target.closest("[data-filter-negate]");
    if (negate) {
      const path = negate.dataset.filterNegate.split(".").map(Number);
      updateExpressionAtPath(path, (node) => {
        node.negate = negate.checked;
      });
      return;
    }
    const groupNegate = event.target.closest("[data-filter-group-negate]");
    if (groupNegate) {
      const raw = groupNegate.dataset.filterGroupNegate;
      const path = raw ? raw.split(".").filter(Boolean).map(Number) : [];
      updateExpressionAtPath(path, (node) => {
        node.negate = groupNegate.checked;
      });
      return;
    }
    const op = event.target.closest("[data-filter-op]");
    if (op) {
      const raw = op.dataset.filterOp;
      const path = raw ? raw.split(".").filter(Boolean).map(Number) : [];
      updateExpressionAtPath(path, (node) => {
        node.op = op.value === "or" ? "or" : "and";
      });
    }
  });

  root.addEventListener("click", async (event) => {
    const addRule = event.target.closest("[data-filter-add-condition]");
    if (addRule) {
      const raw = addRule.dataset.filterAddCondition;
      addCondition(raw ? raw.split(".").filter(Boolean).map(Number) : []);
      return;
    }
    const addSubgroup = event.target.closest("[data-filter-add-group]");
    if (addSubgroup) {
      const raw = addSubgroup.dataset.filterAddGroup;
      addGroup(raw ? raw.split(".").filter(Boolean).map(Number) : []);
      return;
    }
    const remove = event.target.closest("[data-filter-remove]");
    if (remove) {
      const path = remove.dataset.filterRemove.split(".").filter(Boolean).map(Number);
      removeAtPath(path);
      return;
    }
    if (event.target.closest("[data-filter-reset]")) {
      filterState.expression = defaultGroup();
      renderBuilder();
      return;
    }
    if (event.target.closest("[data-filter-apply]")) {
      const query = expressionQueryString();
      history.replaceState(null, "", `/filter?${query}`);
      await refreshTimelineAndResults();
    }
  });
}

export async function initFilterGallery() {
  const root = document.querySelector("[data-filter-gallery-root]");
  const builderRoot = document.querySelector("[data-filter-builder-root]");
  if (!root || !builderRoot) return;
  filterState.total = Number(root.dataset.totalGroups || 0);
  filterState.pageSize = Number(root.dataset.pageSize || 72);
  filterState.tagOptions = readJsonScript("[data-filter-tags]") || [];
  filterState.resourceOptions = readJsonScript("[data-filter-resource-options]") || [];
  filterState.expression = normalizeNode(readJsonScript("[data-filter-initial-expr]") || defaultGroup());

  renderBuilder();
  attachBuilderEvents();
  attachTimelineEvents();

  const query = new URLSearchParams();
  query.set("filter_expr", serializeExpression());
  const timelineResponse = await fetch(`/api/dates?${query.toString()}`, { cache: "no-store" });
  const timelinePayload = await timelineResponse.json();
  const items = compactDateItems(timelinePayload.dates || [], 5);
  renderTimeline(items);
  sizeTimeline();
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
