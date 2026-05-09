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
  total: 0,
  status: "untagged",
  loading: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function galleryContextIds(source) {
  const gallery = source?.closest(".gallery");
  if (!gallery) return [];
  return [...gallery.querySelectorAll("[data-group-id]")]
    .map((item) => Number(item.dataset.groupId))
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

function renderModalGroup(group) {
  const modal = ensureModal();
  const image = modal.querySelector(".modal-image");
  const live = modal.querySelector(".modal-live");
  const placeholder = modal.querySelector(".modal-placeholder");
  const title = modal.querySelector("h2");
  const tags = modal.querySelector(".modal-tags");
  const resources = modal.querySelector(".resource-list");
  const hint = modal.querySelector(".live-hint");
  const primaryImage = imageResource(group);
  const liveVideo = videoResource(group);

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
  } else {
    live.removeAttribute("src");
    hint.hidden = true;
  }

  title.textContent = group.display_name;
  tags.innerHTML = group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  resources.innerHTML = group.resources
    .map((item) => `<a href="${item.url}" target="_blank">${escapeHtml(item.filename)}<br>${escapeHtml(item.kind)} ${escapeHtml(item.extension)}</a>`)
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
    `/api/groups?tag_status=${encodeURIComponent(taggerState.status)}&include_resources=true&offset=${taggerState.groups.length}&limit=80`
  );
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  taggerState.groups.push(...groups);
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
  kinds.innerHTML = group.resource_kinds.map((kind) => `<span class="chip muted">${escapeHtml(kind)}</span>`).join("");
  position.textContent = String(taggerState.index + 1);
  renderCurrentTags(group);
}

async function moveTagger(delta) {
  const nextIndex = taggerState.index + delta;
  if (nextIndex < 0) return;
  if (nextIndex >= taggerState.groups.length - 12 && taggerState.groups.length < taggerState.total) {
    await loadTaggerChunk();
  }
  if (nextIndex >= taggerState.groups.length) return;
  taggerState.index = nextIndex;
  renderTagger();
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

document.addEventListener("click", async (event) => {
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
  previewState.dragging = false;
  document.body.classList.remove("is-panning");
  stopModalLive();
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
