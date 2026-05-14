import { escapeHtml, groupCache } from "../core/shared.js";
import { tagChainsHtml } from "./tag-graph.js";

export async function addTagToGroup(groupId, tagName) {
  const data = new FormData();
  data.set("name", tagName);
  const response = await fetch(`/api/groups/${groupId}/tags`, { method: "POST", body: data });
  const group = await response.json();
  const existing = groupCache.get(Number(group.id));
  if (existing?.resources && !group.resources) group.resources = existing.resources;
  groupCache.set(Number(group.id), group);
  return group;
}

export async function removeTagFromGroup(groupId, tagName) {
  const response = await fetch(`/api/groups/${groupId}/tags/${encodeURIComponent(tagName)}`, { method: "DELETE" });
  const group = await response.json();
  const existing = groupCache.get(Number(group.id));
  if (existing?.resources && !group.resources) group.resources = existing.resources;
  groupCache.set(Number(group.id), group);
  return group;
}

export async function refreshTagLibrary() {
  const response = await fetch("/api/tags");
  renderTagLibrary(await response.json());
}

export function renderTagLibrary(tags) {
  const library = document.querySelector("#tag-library");
  const empty = document.querySelector("#tag-library-empty");
  if (!library) return;
  library.innerHTML = tags
    .map((item) => `<button class="chip tag-option" type="button" data-tag-name="${escapeHtml(item.name)}">${escapeHtml(item.name)} <span>${item.count}</span></button>`)
    .join("");
  if (empty) empty.hidden = tags.length > 0;
}

export function renderCurrentTags(group) {
  const current = document.querySelector("#current-tags");
  if (!current) return;
  const explicit = group.tags?.length
    ? group.tags.map((tag) => `<button class="chip removable explicit-tag" type="button" data-remove-current-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")
    : `<span class="muted-text">暂无标签</span>`;
  const inferred = (group.inferred_tags || [])
    .map((tag) => `<span class="chip inferred-tag">${escapeHtml(tag)}</span>`)
    .join("");
  current.innerHTML = `
    <div class="tag-cluster explicit-tags">${explicit}</div>
    ${inferred ? `<div class="tag-cluster inferred-tags">${inferred}</div>` : ""}
    <div class="tag-chain-list">${tagChainsHtml(group)}</div>
  `;
}
