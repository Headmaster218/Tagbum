import { escapeHtml, groupCache, imageResource, imageUrl, kindBadgesHtml, taggerState, videoResource } from "../core/shared.js";
import { addTagToGroup, refreshTagLibrary, renderCurrentTags, removeTagFromGroup } from "../features/tags.js";

export function currentTaggerGroup() {
  return taggerState.groups[taggerState.index] || null;
}

async function loadTaggerChunk() {
  if (taggerState.loading) return;
  taggerState.loading = true;
  const response = await fetch(
    `/api/groups?tag_status=${encodeURIComponent(taggerState.status)}&include_resources=true&offset=${taggerState.baseOffset + taggerState.groups.length}&limit=80`
  );
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  taggerState.groups.push(...groups);
  taggerState.loading = false;
}

async function loadTaggerWindow(offset) {
  taggerState.loading = true;
  taggerState.baseOffset = Math.max(0, Math.min(offset, Math.max(0, taggerState.total - 1)));
  taggerState.index = 0;
  const response = await fetch(
    `/api/groups?tag_status=${encodeURIComponent(taggerState.status)}&include_resources=true&offset=${taggerState.baseOffset}&limit=80`
  );
  const groups = await response.json();
  groups.forEach((group) => groupCache.set(Number(group.id), group));
  taggerState.groups = groups;
  taggerState.loading = false;
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

export function renderTagger() {
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
  kinds.innerHTML = kindBadgesHtml(group.resource_kinds);
  position.textContent = String(taggerState.baseOffset + taggerState.index + 1);
  renderCurrentTags(group);
}

export async function moveTagger(delta) {
  const nextIndex = taggerState.index + delta;
  if (nextIndex < 0) {
    if (taggerState.baseOffset <= 0) return;
    const nextOffset = Math.max(0, taggerState.baseOffset - 80);
    await loadTaggerWindow(nextOffset);
    taggerState.index = Math.min(79, taggerState.groups.length - 1);
    renderTagger();
    return;
  }
  if (nextIndex >= taggerState.groups.length - 12 && taggerState.baseOffset + taggerState.groups.length < taggerState.total) {
    await loadTaggerChunk();
  }
  if (nextIndex >= taggerState.groups.length) return;
  taggerState.index = nextIndex;
  renderTagger();
}

export async function jumpTaggerToOffset(offset) {
  await loadTaggerWindow(offset);
  renderTagger();
}

export async function resolveTaggerOffset(params) {
  const query = new URLSearchParams({ tag_status: taggerState.status });
  if (params.index) query.set("index", params.index);
  if (params.jumpDate) query.set("jump_date", params.jumpDate);
  const response = await fetch(`/api/position?${query.toString()}`);
  return response.json();
}

export async function copyPreviousTags() {
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

export async function initTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  taggerState.total = Number(root.dataset.totalGroups || 0);
  taggerState.status = root.dataset.tagStatus || "untagged";
  await loadTaggerChunk();
  renderTagger();
  const photo = document.querySelector(".tagger-photo");
  photo?.addEventListener("mouseenter", () => setTaggerLive(true));
  photo?.addEventListener("mouseleave", () => setTaggerLive(false));
}

export { addTagToGroup, refreshTagLibrary, removeTagFromGroup, setTaggerLive };
