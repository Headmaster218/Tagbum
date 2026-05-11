import { escapeHtml } from "../core/shared.js";

function renderScanStatus(status) {
  const root = document.querySelector("[data-scan-status]");
  if (!root) return;
  const message = root.querySelector("[data-scan-message]");
  const detail = root.querySelector("[data-scan-detail]");
  const bar = root.querySelector("[data-scan-progress]");
  const label = root.querySelector("[data-scan-progress-label]");
  const stats = root.querySelector("[data-scan-stats]");
  if (message) message.textContent = status.message || "";
  if (detail) {
    if (status.running) {
      detail.textContent = status.current_album ? `正在扫描 ${status.current_album}` : `正在扫描 ${status.profile || ""}`;
    } else if (status.finished_at) {
      detail.textContent = `完成时间：${status.finished_at}`;
    } else {
      detail.textContent = "";
    }
  }
  const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
  if (bar) bar.style.width = `${percent}%`;
  if (label) label.textContent = `${status.current || 0} / ${status.total || 0} · ${percent}%`;
  if (stats && Array.isArray(status.stats)) {
    stats.innerHTML = status.stats.map((item) => `
      <article>
        <strong>${escapeHtml(item.album || "")}</strong>
        <span>${item.error ? escapeHtml(item.error) : `分组 ${item.groups_seen || 0}，资源新增 ${item.resources_created || 0}，更新 ${item.resources_updated || 0}，跳过 ${item.resources_skipped || 0}`}</span>
      </article>
    `).join("");
  }
}

export function initSettingsPage() {
  if (!document.querySelector("[data-scan-status]")) return;
  const nameInput = document.querySelector("[data-profile-name]");
  const databaseInput = document.querySelector("[data-profile-database]");
  const albumInput = document.querySelector("[data-profile-albums]");
  let databaseTouched = false;

  databaseInput?.addEventListener("input", () => {
    databaseTouched = true;
  });

  nameInput?.addEventListener("input", async () => {
    const name = nameInput.value.trim();
    if (!name || databaseTouched || !databaseInput) return;
    const response = await fetch(`/api/settings/default-database?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    databaseInput.value = payload.database || "";
  });

  document.querySelector("[data-pick-album-folder]")?.addEventListener("click", async () => {
    const button = document.querySelector("[data-pick-album-folder]");
    button.disabled = true;
    button.textContent = "选择中...";
    try {
      const response = await fetch("/api/settings/pick-folder", { method: "POST" });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.path && albumInput) {
        const existing = albumInput.value.trim();
        albumInput.value = existing ? `${existing}\n${payload.path}` : payload.path;
      }
    } finally {
      button.disabled = false;
      button.textContent = "选择相册";
    }
  });

  const poll = async () => {
    const response = await fetch("/api/settings/scan-status", { cache: "no-store" });
    if (!response.ok) return;
    renderScanStatus(await response.json());
  };
  poll();
  window.setInterval(poll, 1000);
}
