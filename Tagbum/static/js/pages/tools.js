export function initBusyLockForms() {
  const forms = [...document.querySelectorAll("[data-busy-lock-form]")];
  forms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (form.dataset.busy === "true") {
        event.preventDefault();
        return;
      }
      form.dataset.busy = "true";
      document.body.classList.add("tools-action-busy");
      form.classList.add("is-busy");
      form.querySelectorAll("button").forEach((button) => {
        button.disabled = true;
      });
      if (event.submitter) {
        event.submitter.dataset.originalLabel = event.submitter.textContent;
        event.submitter.textContent = "处理中...";
      }
    });
  });
}

function renderDuplicateStatus(status) {
  const root = document.querySelector("[data-duplicate-status]");
  if (!root) return;
  const message = root.querySelector("[data-duplicate-message]");
  const detail = root.querySelector("[data-duplicate-detail]");
  const bar = root.querySelector("[data-duplicate-progress]");
  const label = root.querySelector("[data-duplicate-progress-label]");
  if (message) message.textContent = status.message || "";
  if (detail) {
    if (status.running) {
      detail.textContent = status.profile ? `正在分析 ${status.profile}` : "正在分析";
    } else if (status.finished_at) {
      detail.textContent = `完成时间：${status.finished_at}`;
    } else {
      detail.textContent = "";
    }
  }
  const percent = status.total ? Math.max(0, Math.min(100, Math.round((Number(status.current || 0) / Number(status.total || 1)) * 100))) : 0;
  if (bar) bar.style.width = `${percent}%`;
  if (label) {
    label.textContent = `${status.current || 0} / ${status.total || 0} · 缓存 ${status.cached || 0} · 完全重复 ${status.exact_sets || 0} 组 · 元数据不同 ${status.content_sets || 0} 组`;
  }
}

export function initToolsPage() {
  const root = document.querySelector("[data-duplicate-status]");
  if (!root) return;
  initBusyLockForms();
  let lastRunning = root.dataset.running === "true";
  let lastFinishedAt = root.dataset.finishedAt || "";
  const poll = async () => {
    const response = await fetch("/api/tools/duplicates/status", { cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    renderDuplicateStatus(status);
    const nextFinishedAt = status.finished_at || "";
    if ((lastRunning && !status.running) || (!status.running && nextFinishedAt && nextFinishedAt !== lastFinishedAt)) {
      window.location.reload();
      return;
    }
    lastRunning = Boolean(status.running);
    lastFinishedAt = nextFinishedAt;
  };
  poll();
  window.setInterval(poll, 1000);
}
