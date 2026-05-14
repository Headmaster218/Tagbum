import { escapeHtml } from "../core/shared.js";

let graphCache = null;

export async function fetchTagGraph({ force = false } = {}) {
  if (graphCache && !force) return graphCache;
  const response = await fetch("/api/tag-graph", { cache: "no-store" });
  graphCache = await response.json();
  return graphCache;
}

export function clearTagGraphCache() {
  graphCache = null;
}

export function tagAncestorsFromPaths(group) {
  const explicit = new Set(group?.tags || []);
  return (group?.tag_paths || []).map((path) => ({
    path,
    explicit: path.filter((name) => explicit.has(name)),
  }));
}

export function tagChainsHtml(group) {
  const paths = tagAncestorsFromPaths(group);
  if (!paths.length) return `<span class="muted-text">暂无标签关系</span>`;
  const explicit = new Set(group.tags || []);
  const levels = [];
  paths.forEach(({ path }) => {
    path.forEach((name, index) => {
      if (!levels[index]) levels[index] = new Set();
      levels[index].add(name);
    });
  });
  return `
    <div class="tag-hierarchy">
      ${levels.map((names, index) => `
        <div class="tag-hierarchy-level">
          <span class="tag-hierarchy-depth">${index + 1}</span>
          <div class="tag-hierarchy-nodes">
            ${[...names].sort().map((name) => `
              <span class="chip ${explicit.has(name) ? "explicit-tag" : "inferred-tag"}">${escapeHtml(name)}</span>
            `).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function graphRoots(graph) {
  const childNames = new Set((graph.relations || []).map((item) => item.child));
  const roots = (graph.tags || []).map((item) => item.name).filter((name) => !childNames.has(name));
  return roots.length ? roots.sort() : (graph.tags || []).map((item) => item.name).sort();
}

function renderGraphBranch(graph, name, seen = new Set()) {
  const count = (graph.tags || []).find((item) => item.name === name)?.count || 0;
  const children = graph.children?.[name] || [];
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return `
    <li>
      <div class="tag-graph-node">
        <strong>${escapeHtml(name)}</strong>
        <span>${count}</span>
      </div>
      ${children.length ? `
        <ul>
          ${children
            .filter((child) => !nextSeen.has(child))
            .map((child) => renderGraphBranch(graph, child, nextSeen))
            .join("")}
        </ul>
      ` : ""}
    </li>
  `;
}

function renderGraphModal(graph) {
  const modal = ensureTagGraphModal();
  const tree = modal.querySelector("[data-tag-graph-tree]");
  const relations = modal.querySelector("[data-tag-graph-relations]");
  const options = (graph.tags || [])
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (${item.count})</option>`)
    .join("");
  modal.querySelectorAll("[data-tag-graph-tag-select]").forEach((select) => {
    const current = select.value;
    select.innerHTML = `<option value="">选择标签</option>${options}`;
    if (current) select.value = current;
  });
  tree.innerHTML = `<ul>${graphRoots(graph).map((name) => renderGraphBranch(graph, name)).join("")}</ul>`;
  relations.innerHTML = (graph.relations || []).length
    ? graph.relations.map((item) => `
      <div class="tag-relation-row">
        <span><strong>${escapeHtml(item.parent)}</strong> / ${escapeHtml(item.child)}</span>
        <button type="button" data-remove-tag-relation data-parent="${escapeHtml(item.parent)}" data-child="${escapeHtml(item.child)}">删除</button>
      </div>
    `).join("")
    : `<p class="muted-text">还没有标签关系。</p>`;
}

export async function openTagGraphModal() {
  const graph = await fetchTagGraph({ force: true });
  renderGraphModal(graph);
  ensureTagGraphModal().classList.add("open");
}

function closeTagGraphModal() {
  document.querySelector("[data-tag-graph-modal]")?.classList.remove("open");
}

function ensureTagGraphModal() {
  let modal = document.querySelector("[data-tag-graph-modal]");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "tag-graph-modal";
  modal.dataset.tagGraphModal = "true";
  modal.innerHTML = `
    <div class="tag-graph-card">
      <header>
        <div>
          <h2>标签关系管理</h2>
          <p class="muted-text">只维护标签之间的父子关系，不会修改已经写入照片的显式标签。</p>
        </div>
        <button type="button" data-close-tag-graph>关闭</button>
      </header>
      <form class="tag-graph-form" data-tag-graph-form>
        <label>
          <span>父标签</span>
          <select name="parent" data-tag-graph-tag-select></select>
        </label>
        <label>
          <span>子标签</span>
          <select name="child" data-tag-graph-tag-select></select>
        </label>
        <button type="submit">建立关系</button>
        <p class="muted-text" data-tag-graph-status></p>
      </form>
      <section class="tag-graph-layout">
        <div>
          <h3>关系图谱</h3>
          <div class="tag-graph-tree" data-tag-graph-tree></div>
        </div>
        <div>
          <h3>已建立关系</h3>
          <div class="tag-graph-relations" data-tag-graph-relations></div>
        </div>
      </section>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close-tag-graph]")) closeTagGraphModal();
  });
  modal.querySelector("[data-tag-graph-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = modal.querySelector("[data-tag-graph-status]");
    const parent = form.elements.parent.value;
    const child = form.elements.child.value;
    status.textContent = "保存中...";
    const response = await fetch("/api/tag-relations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent, child }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "保存失败。" }));
      status.textContent = error.detail || "保存失败。";
      return;
    }
    graphCache = await response.json();
    status.textContent = "已保存。";
    renderGraphModal(graphCache);
    window.dispatchEvent(new CustomEvent("tagbum:taggraphchange", { detail: graphCache }));
  });
  modal.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-tag-relation]");
    if (!button) return;
    const query = new URLSearchParams({ parent: button.dataset.parent, child: button.dataset.child });
    const response = await fetch(`/api/tag-relations?${query.toString()}`, { method: "DELETE" });
    if (!response.ok) return;
    graphCache = await response.json();
    renderGraphModal(graphCache);
    window.dispatchEvent(new CustomEvent("tagbum:taggraphchange", { detail: graphCache }));
  });
  return modal;
}

export function initTagGraphModule() {
  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-open-tag-graph]")) {
      await openTagGraphModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.querySelector("[data-tag-graph-modal].open")) {
      closeTagGraphModal();
    }
  });
}
