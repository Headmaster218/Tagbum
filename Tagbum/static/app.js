import { escapeHtml, mapCellState, previewState, taggerState } from "./js/core/shared.js";
import { initDateStrips } from "./js/features/date-strip.js";
import {
  centerPreview,
  closeMapPicker,
  closePreview,
  duplicatePreviewIds,
  galleryContextIds,
  initPreviewModule,
  isMapPickerOpen,
  movePreview,
  openPreview,
  resetPreviewScale,
  selectPreviewResource,
  setPreviewScale,
} from "./js/features/preview.js";
import { addTagToGroup, removeTagFromGroup } from "./js/features/tags.js";
import { initTagGraphModule } from "./js/features/tag-graph.js";
import { initHomeGallery } from "./js/pages/home.js";
import { initFilterGallery } from "./js/pages/filter.js";
import {
  closeMapCellPanel,
  initMap,
  openMapCell,
  renderMapCellLibrary,
  renderMapCellSelected,
  selectedMapCellGroup,
  setMapCellLive,
  updateMapCellGroup,
} from "./js/pages/map.js";
import {
  completeCurrentTags,
  copyPreviousTags,
  currentTaggerGroup,
  initTagger,
  jumpTaggerToOffset,
  moveTagger,
  refreshTagLibrary,
  renderTagger,
  resolveTaggerOffset,
} from "./js/pages/tagger.js";
import { initSettingsPage } from "./js/pages/settings.js";
import { initToolsPage } from "./js/pages/tools.js";

function activeTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("tagbum.theme", theme);
  window.dispatchEvent(new CustomEvent("tagbum:themechange", { detail: { theme } }));
  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    const nextLabel = theme === "dark" ? "浅色" : "深色";
    button.textContent = nextLabel;
    button.setAttribute("aria-label", `切换到${nextLabel}模式`);
    button.setAttribute("title", `切换到${nextLabel}模式`);
  }
}

function initThemeToggle() {
  applyTheme(activeTheme());
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    applyTheme(activeTheme() === "dark" ? "light" : "dark");
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

  const previewResource = event.target.closest("[data-preview-resource]");
  if (previewResource) {
    selectPreviewResource(previewResource.dataset.previewResource);
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

  if (event.target.closest("[data-complete-tags]")) {
    await completeCurrentTags();
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
    const updated = await removeTagFromGroup(card.dataset.groupId, remove.dataset.removeTag);
    const chips = card.querySelector(".chips");
    chips.innerHTML = updated.tags.map((tag) => `<button class="chip removable" data-remove-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("");
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
    if (event.key === "Escape") {
      if (isMapPickerOpen()) {
        closeMapPicker();
      } else {
        closePreview();
      }
    }
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

initPreviewModule();
initTagGraphModule();
initThemeToggle();
initTagger();
initDateStrips();
initHomeGallery();
initFilterGallery();
initMap();
initSettingsPage();
initToolsPage();
