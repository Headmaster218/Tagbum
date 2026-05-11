import {
  downloadResource,
  escapeHtml,
  groupCache,
  imageResource,
  imageUrl,
  kindBadgeMeta,
  previewState,
  videoResource,
} from "../core/shared.js";

export function galleryContextIds(source) {
  const homeGallery = source?.closest("[data-home-gallery]");
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

export function closePreview() {
  const modal = document.querySelector(".modal");
  stopModalLive();
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

export async function openPreview(groupId, contextIds = []) {
  const group = await getGroupDetails(groupId);
  previewState.group = group;
  previewState.contextIds = contextIds.length ? contextIds : previewState.contextIds;
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

export function startModalLive() {
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

export function stopModalLive() {
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

export function stopPreviewPointerActions() {
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
    if (!previewState.group || !imageResource(previewState.group) || !videoResource(previewState.group)) return;
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
}
