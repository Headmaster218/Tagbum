import {
  escapeHtml,
  groupCache,
  imageResource,
  imageUrl,
  kindBadgeMeta,
  previewState,
  videoResource,
} from "../core/shared.js";

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

async function getGroupDetails(groupId) {
  const key = Number(groupId);
  if (groupCache.has(key) && groupCache.get(key).resources) return groupCache.get(key);
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
        <video class="modal-live" controls playsinline hidden></video>
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
  const video = modal.querySelector(".modal-live");
  video.addEventListener("volumechange", () => updateStoredPreviewAudio(video));
  return modal;
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
        <a class="resource-download-button" href="${item.url}" download="${escapeHtml(item.filename || "")}" data-resource-download="${item.id}">下载</a>
      </div>
    `;
  }).join("");
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
      if (group.thumbnail_url && image.src !== location.origin + group.thumbnail_url) {
        image.src = group.thumbnail_url;
      }
    };
    if (hasLivePair) hint.hidden = false;
  } else if (resource.kind === "live" || resource.kind === "video") {
    live.src = playbackUrl(resource);
    live.hidden = false;
    live.currentTime = 0;
    applyPreviewAudio(live, { allowUnmute: true });
    live.play().catch(() => {});
  } else {
    placeholder.hidden = false;
    placeholder.textContent = "该资源暂不支持直接预览";
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

  title.textContent = group.display_name;
  tags.innerHTML = group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  renderModalResource(group, currentSelectedResource(group));
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
  renderModalGroup(previewState.group);
}

export function startModalLive() {
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

export function stopModalLive() {
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
}
