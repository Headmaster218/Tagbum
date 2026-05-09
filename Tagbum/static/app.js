const taggerState = {
  groups: [],
  index: 0,
  total: 0,
  loading: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function ensureModal() {
  let modal = document.querySelector(".modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-media"></div>
    <aside class="modal-side">
      <button class="modal-close" type="button">关闭</button>
      <h2></h2>
      <div class="chips modal-tags"></div>
      <div class="resource-list"></div>
    </aside>
  `;
  document.body.appendChild(modal);
  modal.querySelector(".modal-close").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.remove("open");
  });
  return modal;
}

async function openPreview(groupId) {
  const response = await fetch(`/api/groups/${groupId}`);
  const group = await response.json();
  const modal = ensureModal();
  const media = modal.querySelector(".modal-media");
  const title = modal.querySelector("h2");
  const tags = modal.querySelector(".modal-tags");
  const resources = modal.querySelector(".resource-list");
  const primary = group.resources.find((item) => item.kind === "image") || group.resources.find((item) => item.kind === "video");

  media.innerHTML = "";
  if (primary && primary.kind === "video") {
    media.innerHTML = `<video controls autoplay src="${primary.url}"></video>`;
  } else if (group.thumbnail_url) {
    const full = primary ? primary.url : group.thumbnail_url;
    media.innerHTML = `<img src="${full}" alt="">`;
  } else {
    media.innerHTML = `<div class="placeholder">没有可预览资源</div>`;
  }

  title.textContent = group.display_name;
  tags.innerHTML = group.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  resources.innerHTML = group.resources
    .map((item) => `<a href="${item.url}" target="_blank">${escapeHtml(item.filename)}<br>${escapeHtml(item.kind)} ${escapeHtml(item.extension)}</a>`)
    .join("");
  modal.classList.add("open");
}

async function addTagToGroup(groupId, tagName) {
  const data = new FormData();
  data.set("name", tagName);
  const response = await fetch(`/api/groups/${groupId}/tags`, { method: "POST", body: data });
  return response.json();
}

async function removeTagFromGroup(groupId, tagName) {
  const response = await fetch(`/api/groups/${groupId}/tags/${encodeURIComponent(tagName)}`, { method: "DELETE" });
  return response.json();
}

function currentTaggerGroup() {
  return taggerState.groups[taggerState.index] || null;
}

async function loadTaggerChunk() {
  if (taggerState.loading) return;
  taggerState.loading = true;
  const response = await fetch(`/api/groups?offset=${taggerState.groups.length}&limit=80`);
  const groups = await response.json();
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

function renderTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  const group = currentTaggerGroup();
  const image = document.querySelector("#tagger-image");
  const placeholder = document.querySelector("#tagger-placeholder");
  const title = document.querySelector("#tagger-title");
  const date = document.querySelector("#tagger-date");
  const kinds = document.querySelector("#tagger-kinds");
  const position = document.querySelector("#tagger-position");

  if (!group) {
    image.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = "没有可处理的照片";
    title.textContent = "未选择照片";
    date.textContent = "";
    kinds.innerHTML = "";
    renderCurrentTags({ tags: [] });
    return;
  }

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

async function initTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  taggerState.total = Number(root.dataset.totalGroups || 0);
  await loadTaggerChunk();
  renderTagger();
}

document.addEventListener("click", async (event) => {
  const preview = event.target.closest("[data-open-preview]");
  if (preview) {
    await openPreview(preview.dataset.openPreview);
    return;
  }

  const openCurrent = event.target.closest("[data-open-current]");
  if (openCurrent) {
    const group = currentTaggerGroup();
    if (group) await openPreview(group.id);
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
  if (!document.querySelector(".tagger")) return;
  if (event.key === "ArrowLeft") await moveTagger(-1);
  if (event.key === "ArrowRight") await moveTagger(1);
});

initTagger();
