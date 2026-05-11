import { compactDateItems, dateStripState, formatMonthLabel, resolveDateBucket } from "../core/shared.js";

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
  strip.innerHTML = dateItems.map((item) => {
    const hasImages = item.count > 0;
    const day = Number(item.date.slice(8, 10));
    const monthLabel = day === 1 ? `<span class="month-label">${formatMonthLabel(item.date)}</span>` : "";
    return `<button class="date-cell ${hasImages ? "has-images" : "empty-day"} ${day <= 5 ? "month-start" : ""}" type="button" data-date="${item.date}" data-end-date="${item.end_date}" data-count="${item.count}" title="${item.date} - ${item.end_date} · ${item.count} 张"><span class="tick"></span>${monthLabel}</button>`;
  }).join("");

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

export async function initDateStrips() {
  const strips = [...document.querySelectorAll("[data-date-strip]")];
  await Promise.all(strips.map(initDateStrip));
}
