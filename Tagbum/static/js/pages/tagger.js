import { groupCache, imageResource, imageUrl, kindBadgesHtml, taggerState, videoResource } from "../core/shared.js";
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

function placeholderIsActive() {
  const imageElement = document.querySelector("#tagger-image");
  return !imageElement || imageElement.hidden;
}

function setTaggerLive(show) {
  const group = currentTaggerGroup();
  const imageElement = document.querySelector("#tagger-image");
  const live = document.querySelector("#tagger-live");
  const video = group ? videoResource(group) : null;
  if (!imageElement || !live || !video || placeholderIsActive()) return;
  if (show) {
    live.src = video.url;
    live.hidden = false;
    imageElement.classList.add("under-live");
    live.currentTime = 0;
    live.play().catch(() => {});
  } else {
    live.pause();
    live.hidden = true;
    imageElement.classList.remove("under-live");
  }
}

export function renderTagger() {
  const root = document.querySelector(".tagger");
  if (!root) return;
  const group = currentTaggerGroup();
  const imageElement = document.querySelector("#tagger-image");
  const live = document.querySelector("#tagger-live");
  const placeholder = document.querySelector("#tagger-placeholder");
  const title = document.querySelector("#tagger-title");
  const date = document.querySelector("#tagger-date");
  const kinds = document.querySelector("#tagger-kinds");
  const position = document.querySelector("#tagger-position");

  setTaggerLive(false);
  imageElement.classList.remove("under-live");
  live.removeAttribute("src");

  if (!group) {
    imageElement.hidden = true;
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
  const stillImage = imageResource(group);
  if (group.thumbnail_url || stillImage) {
    imageElement.src = group.thumbnail_url || imageUrl(stillImage);
    imageElement.alt = group.display_name;
    imageElement.hidden = false;
    placeholder.hidden = true;
  } else {
    imageElement.hidden = true;
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

export async function completeCurrentTags() {
  const group = currentTaggerGroup();
  if (!group) return;
  const button = document.querySelector("[data-complete-tags]");
  if (button) button.disabled = true;
  const response = await fetch(`/api/groups/${group.id}/tag-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed: true }),
  });
  if (button) button.disabled = false;
  if (!response.ok) return;
  const updated = await response.json();
  groupCache.set(Number(updated.id), updated);

  if (taggerState.status === "untagged") {
    taggerState.groups.splice(taggerState.index, 1);
    taggerState.total = Math.max(0, taggerState.total - 1);
    if (taggerState.index >= taggerState.groups.length) {
      taggerState.index = Math.max(0, taggerState.groups.length - 1);
    }
    if (taggerState.baseOffset + taggerState.groups.length < taggerState.total) await loadTaggerChunk();
    renderTagger();
    return;
  }

  Object.assign(group, updated);
  await moveTagger(1);
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
