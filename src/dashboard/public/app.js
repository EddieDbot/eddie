const $ = (id) => document.getElementById(id);

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString();
}

function renderItems(containerId, items, renderFn, emptyMsg) {
  const el = $(containerId);
  if (!items.length) {
    el.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = items.map(renderFn).join("");
}

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    return await res.json();
  } catch {
    return null;
  }
}

async function refreshHealth() {
  const data = await fetchJson("/api/health");
  if (!data) return;
  $("status").textContent = data.status === "ok" ? "online" : "offline";
  $("status").className =
    `status ${data.status === "ok" ? "online" : "offline"}`;
  $("uptime").textContent = formatUptime(data.uptime);
  $("memory-status").textContent = data.memoryEnabled ? "Active" : "Off";
}

async function refreshStats() {
  const data = await fetchJson("/api/stats");
  if (!data) return;
  $("total-convos").textContent = data.totalConversations;
  $("total-facts").textContent = data.totalFacts;
  $("total-comms").textContent = data.totalCommunications;
}

async function refreshConversations() {
  const data = await fetchJson("/api/conversations");
  if (!data) return;
  renderItems(
    "conversations-list",
    data,
    (c) =>
      `<div class="item">
      <div>${escapeHtml(c.summary || c.user_message || "No content")}</div>
      <div class="item-meta">${formatTime(c.created_at)}</div>
    </div>`,
    "No conversations yet",
  );
}

async function refreshFacts() {
  const data = await fetchJson("/api/facts");
  if (!data) return;
  renderItems(
    "facts-list",
    data,
    (f) =>
      `<div class="item">
      <div>${escapeHtml(f.content || f.fact || "")}</div>
      <div class="item-meta">
        ${f.category ? `<span class="item-tag">${escapeHtml(f.category)}</span>` : ""}
        ${formatTime(f.created_at)}
      </div>
    </div>`,
    "No facts stored",
  );
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function addFeedEvent(event) {
  const list = $("feed-list");
  const div = document.createElement("div");
  div.className = "feed-event";
  div.innerHTML = `<div>${escapeHtml(event.type)}: ${escapeHtml(JSON.stringify(event.data).slice(0, 200))}</div>
    <div class="feed-time">${formatTime(event.timestamp)}</div>`;
  list.prepend(div);
  while (list.children.length > 100) list.lastChild.remove();
}

function connectSSE() {
  const es = new EventSource("/api/feed");
  es.onmessage = (e) => {
    try {
      addFeedEvent(JSON.parse(e.data));
    } catch {}
  };
  es.onerror = () => {
    $("status").textContent = "offline";
    $("status").className = "status offline";
    es.close();
    setTimeout(connectSSE, 5000);
  };
}

async function refreshHeartbeat() {
  const data = await fetchJson("/api/heartbeat-log");
  if (!data) return;
  renderItems(
    "heartbeat-list",
    data,
    (h) =>
      `<div class="item">
      <div><span class="decision-tag decision-${escapeHtml(h.decision)}">${escapeHtml(h.decision)}</span> ${escapeHtml(h.summary || "")}</div>
      <div class="item-meta">${h.duration_ms ? (h.duration_ms / 1000).toFixed(1) + "s" : ""} ${formatTime(h.created_at)}</div>
    </div>`,
    "No heartbeat activity",
  );
}

async function refreshCronJobs() {
  const data = await fetchJson("/api/cron-jobs");
  if (!data) return;
  renderItems(
    "cron-list",
    data,
    (j) =>
      `<div class="item">
      <div><span class="decision-tag decision-${j.enabled ? "on" : "off"}">${j.enabled ? "on" : "off"}</span> <strong>${escapeHtml(j.name)}</strong> — ${escapeHtml(j.schedule_type)} ${escapeHtml(j.schedule_value)}</div>
      <div class="item-meta">${escapeHtml(j.prompt.slice(0, 80))} — next: ${formatTime(j.next_run_at)}</div>
    </div>`,
    "No cron jobs configured",
  );
}

async function refreshJobs() {
  const data = await fetchJson("/api/jobs");
  if (!data) return;
  renderItems(
    "jobs-list",
    data,
    (j) => {
      const statusClass =
        j.status === "running"
          ? "running"
          : j.status === "completed"
            ? "completed"
            : j.status === "failed"
              ? "failed"
              : "other";
      return `<div class="item">
      <div><span class="job-tag job-${escapeHtml(statusClass)}">${escapeHtml(j.status)}</span> #${escapeHtml(String(j.id))} <span style="opacity:0.7">${escapeHtml(j.model)}</span></div>
      <div class="item-meta">${escapeHtml(j.prompt ? j.prompt.slice(0, 80) : "")} — ${formatTime(j.startedAt)}</div>
    </div>`;
    },
    "No jobs yet",
  );
}

async function refreshMetrics() {
  const data = await fetchJson("/api/system-metrics");
  if (!data || data.error) return;
  if (data.memory) {
    $("mem-use").textContent =
      `${data.memory.usedGb}/${data.memory.totalGb}GB (${data.memory.usePct}%)`;
  }
  if (data.cpu) {
    $("cpu-load").textContent = data.cpu.loadAvg1m.toFixed(2);
  }
  if (data.disk) {
    $("disk-use").textContent = `${data.disk.usePct}%`;
  }
}

async function refreshCost() {
  const data = await fetchJson("/api/usage");
  if (!data) return;
  $("cost-total").textContent = `$${(data.totalCostUsd || 0).toFixed(4)}`;
  $("cost-input").textContent = (data.totalInputTokens || 0).toLocaleString();
  $("cost-output").textContent = (data.totalOutputTokens || 0).toLocaleString();

  const breakdown = data.bySource ?? {};
  const entries = Object.entries(breakdown);
  if (entries.length > 0) {
    $("cost-breakdown").innerHTML = entries
      .map(
        ([src, val]) =>
          `<div class="item"><div>${escapeHtml(src)}</div><div class="item-meta">$${(val.costUsd || 0).toFixed(4)}</div></div>`,
      )
      .join("");
  }
}

async function refresh() {
  await Promise.all([
    refreshHealth(),
    refreshStats(),
    refreshConversations(),
    refreshFacts(),
    refreshHeartbeat(),
    refreshCronJobs(),
    refreshJobs(),
    refreshMetrics(),
    refreshCost(),
  ]);
}

refresh();
connectSSE();
setInterval(refresh, 30000);
