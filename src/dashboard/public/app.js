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

// Tab switching
function switchTab(tabId) {
  document
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const pane = document.getElementById("tab-" + tabId);
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (pane) pane.classList.add("active");
  if (btn) btn.classList.add("active");
  localStorage.setItem("eddie-tab", tabId);
}

const savedTab = localStorage.getItem("eddie-tab") || "reports";
switchTab(savedTab);

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

let selectedReport = null;
let activeReportsTab = "ingestion";
let selectedRoadmapId = null;
let _reportsCache = [];
let _roadmapCache = [];

function renderMarkdown(md) {
  // Escape HTML first
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Triple-backtick code blocks
  html = html.replace(
    /```(?:\w+)?\n([\s\S]*?)```/g,
    (_, code) => `<pre><code>${code}</code></pre>`,
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Lists — convert consecutive "- " lines into <ul>
  html = html.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^- /, "")}</li>`)
      .join("");
    return `<ul>${items}</ul>\n`;
  });

  // Paragraphs — split on double newlines, wrap non-block elements
  const blockTags = /^<(h[1-3]|ul|pre|hr)/;
  html = html
    .split(/\n{2,}/)
    .map((chunk) => {
      chunk = chunk.trim();
      if (!chunk) return "";
      if (blockTags.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, " ")}</p>`;
    })
    .join("\n");

  return html;
}

async function refreshReports() {
  const data = await fetchJson("/api/reports");
  if (!data || !Array.isArray(data)) return;
  _reportsCache = data;
  if (activeReportsTab === "ingestion") renderReportsSidebar(data);
}

function renderReportsSidebar(data) {
  const sidebar = $("reports-sidebar");
  if (!data.length) {
    sidebar.innerHTML = '<div class="empty">No reports yet</div>';
    return;
  }
  sidebar.innerHTML = data
    .map((r) => {
      const newCount = r.verdicts?.NET_NEW ?? 0;
      const impCount = r.verdicts?.IMPROVE ?? 0;
      const badges = [
        newCount > 0
          ? `<span class="report-badge-new">${newCount} NEW</span>`
          : "",
        impCount > 0
          ? `<span class="report-badge-improve">${impCount} IMP</span>`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const route = r.routedTo
        ? `<span class="report-route">${escapeHtml(r.routedTo)}</span>`
        : "";
      const active = selectedReport === r.filename ? " active" : "";
      return `<div class="report-item${active}" data-filename="${escapeHtml(r.filename)}">
      <div class="report-title">${escapeHtml(r.title)}</div>
      <div class="report-meta">
        <span class="report-date">${escapeHtml(r.date)}</span>
        ${route}
        ${badges}
      </div>
    </div>`;
    })
    .join("");
}

async function loadReport(filename) {
  selectedReport = filename;
  // Toggle active class immediately
  document.querySelectorAll(".report-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.filename === filename);
  });
  const viewer = $("reports-viewer");
  viewer.innerHTML = '<div class="reports-placeholder">Loading...</div>';
  const data = await fetchJson(`/api/report/${encodeURIComponent(filename)}`);
  if (!data || data.error) {
    viewer.innerHTML =
      '<div class="reports-placeholder">Failed to load report</div>';
    return;
  }
  viewer.innerHTML = `<div class="md-content">${renderMarkdown(data.content)}</div>`;
}

async function refreshRoadmap() {
  const data = await fetchJson("/api/roadmap");
  if (!data || !Array.isArray(data)) return;
  _roadmapCache = data;
  if (activeReportsTab === "roadmap") renderRoadmapSidebar(data);
}

function renderRoadmapSidebar(items) {
  const sidebar = $("reports-sidebar");
  const pending = items.filter((i) => i.status === "pending");
  if (!pending.length) {
    sidebar.innerHTML = '<div class="empty">No roadmap items</div>';
    return;
  }
  const groups = {};
  for (const item of pending) {
    (groups[item.domain] = groups[item.domain] || []).push(item);
  }
  const effortOrder = { S: 0, M: 1, L: 2, XL: 3 };
  const effortLabel = { S: "🟢 S", M: "🟡 M", L: "🟠 L", XL: "🔴 XL" };
  let html = "";
  for (const [domain, domainItems] of Object.entries(groups)) {
    const sorted = domainItems
      .slice()
      .sort((a, b) =>
        b.impact !== a.impact
          ? b.impact - a.impact
          : (effortOrder[a.effort] ?? 3) - (effortOrder[b.effort] ?? 3),
      );
    html += `<div class="roadmap-group">
      <div class="roadmap-group-header">${escapeHtml(domain)} <span class="roadmap-count">${sorted.length}</span></div>
      ${sorted
        .map((item) => {
          const active = selectedRoadmapId === item.id ? " active" : "";
          const typeBadge =
            item.type === "NET_NEW"
              ? '<span class="badge-type-new">🆕 NEW</span>'
              : '<span class="badge-type-improve">🔼 IMP</span>';
          const effortBadge = `<span class="badge-effort-${item.effort.toLowerCase()}">${effortLabel[item.effort] || item.effort}</span>`;
          const impactBadge = `<span class="badge-impact">★ ${item.impact}/5</span>`;
          return `<div class="roadmap-item${active}" data-item-id="${escapeHtml(item.id)}">
          <div class="roadmap-item-name">${escapeHtml(item.name)}</div>
          <div class="roadmap-item-meta">${typeBadge}${effortBadge}${impactBadge}</div>
        </div>`;
        })
        .join("")}
    </div>`;
  }
  sidebar.innerHTML = html;
}

function showRoadmapItem(id) {
  const item = _roadmapCache.find((i) => i.id === id);
  if (!item) return;
  selectedRoadmapId = id;
  document.querySelectorAll(".roadmap-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.itemId === id);
  });
  const effortEmoji = { S: "🟢", M: "🟡", L: "🟠", XL: "🔴" };
  const effortDesc = {
    S: "Small (<1 hr)",
    M: "Medium (1–4 hrs)",
    L: "Large (~1 day)",
    XL: "XL (multi-day)",
  };
  const typeBadge =
    item.type === "NET_NEW"
      ? '<span class="badge-type-new badge-effort-full">🆕 NET_NEW</span>'
      : '<span class="badge-type-improve badge-effort-full">🔼 IMPROVE</span>';
  const effortBadge = `<span class="badge-effort-${item.effort.toLowerCase()} badge-effort-full">${effortEmoji[item.effort] || ""} ${effortDesc[item.effort] || item.effort}</span>`;
  const impactBadge = `<span class="badge-impact-full">Impact ${item.impact}/5</span>`;
  const domainTag = `<span style="font-size:0.72rem;color:#8892b0">${escapeHtml(item.domain)}</span>`;
  const sources = item.sources?.length
    ? `<div class="roadmap-detail-sources">Sources: ${item.sources
        .map(
          (s) =>
            `<a href="https://youtube.com/watch?v=${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`,
        )
        .join(", ")}</div>`
    : "";
  $("reports-viewer").innerHTML = `<div class="roadmap-detail">
    <div class="roadmap-detail-name">${escapeHtml(item.name)}</div>
    <div class="roadmap-detail-meta">${typeBadge}${effortBadge}${impactBadge}${domainTag}</div>
    ${item.description ? `<div class="roadmap-detail-desc">${escapeHtml(item.description)}</div>` : ""}
    ${sources}
  </div>`;
}

function switchReportsTab(rtab) {
  activeReportsTab = rtab;
  document.querySelectorAll(".reports-subtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.rtab === rtab);
  });
  $("reports-viewer").innerHTML =
    '<div class="reports-placeholder">Select an item to view</div>';
  if (rtab === "ingestion") {
    renderReportsSidebar(_reportsCache);
  } else {
    renderRoadmapSidebar(_roadmapCache);
  }
}

document.querySelectorAll(".reports-subtab").forEach((btn) => {
  btn.addEventListener("click", () => switchReportsTab(btn.dataset.rtab));
});

document
  .querySelector('.reports-subtab[data-rtab="ingestion"]')
  ?.classList.add("active");

$("reports-sidebar").addEventListener("click", (e) => {
  const reportItem = e.target.closest(".report-item");
  if (reportItem && reportItem.dataset.filename) {
    loadReport(reportItem.dataset.filename);
    return;
  }
  const roadmapItem = e.target.closest(".roadmap-item");
  if (roadmapItem && roadmapItem.dataset.itemId) {
    showRoadmapItem(roadmapItem.dataset.itemId);
  }
});

async function refreshNeedsAttention() {
  try {
    const data = await fetchJson("/api/needs-attention");
    if (!data) return;
    const count = data.total || 0;
    const badge = $("attention-count");
    if (badge) badge.textContent = count > 0 ? String(count) : "";

    const failedDiv = $("attention-failed-jobs");
    if (failedDiv) {
      if (data.failedJobs?.length) {
        failedDiv.innerHTML =
          "<strong>Failed jobs (48h):</strong><ul>" +
          data.failedJobs
            .map(
              (j) =>
                `<li>${j.id.slice(0, 8)} — ${escapeHtml(j.prompt?.slice(0, 60) || "unknown")}${j.error ? ` (${escapeHtml(j.error.slice(0, 60))})` : ""}</li>`,
            )
            .join("") +
          "</ul>";
      } else {
        failedDiv.innerHTML = "";
      }
    }

    const judgDiv = $("attention-judgments");
    if (judgDiv) {
      if (data.pendingJudgments?.length) {
        judgDiv.innerHTML =
          "<strong>Pending judgments:</strong><ul>" +
          data.pendingJudgments
            .map(
              (j) =>
                `<li>[${j.confidence}%] ${escapeHtml(j.source)}: ${escapeHtml(j.decision?.slice(0, 80) || "")} <code>/approve ${j.id.slice(0, 8)}</code></li>`,
            )
            .join("") +
          "</ul>";
      } else {
        judgDiv.innerHTML = "";
      }
    }
  } catch (e) {
    // silent fail
  }
}

async function refreshHealthIndicators() {
  try {
    const data = await fetchJson("/api/health-indicators");
    if (!data) return;
    const div = $("health-indicators");
    if (!div) return;
    div.innerHTML = [
      `<div class="stat"><span class="stat-value">${data.jobSuccessRate ?? "?"}%</span><span class="stat-label">Job Success</span></div>`,
      `<div class="stat"><span class="stat-value">${data.totalJobs7d ?? 0}</span><span class="stat-label">Total Jobs</span></div>`,
      `<div class="stat"><span class="stat-value">${data.selfHealRate ?? "?"}/100</span><span class="stat-label">Heal Rate</span></div>`,
      `<div class="stat"><span class="stat-value">${data.selfHealSuccessRate ?? "?"}%</span><span class="stat-label">Heal Success</span></div>`,
      `<div class="stat"><span class="stat-value">${data.avgJobDurationMs ? Math.round(data.avgJobDurationMs / 60000) + "m" : "?"}</span><span class="stat-label">Avg Duration</span></div>`,
      `<div class="stat"><span class="stat-value">${data.maxJobDurationMs ? Math.round(data.maxJobDurationMs / 60000) + "m" : "?"}</span><span class="stat-label">Max Duration</span></div>`,
      `<div class="stat"><span class="stat-value">${data.escalationCount7d ?? 0}</span><span class="stat-label">Escalations</span></div>`,
    ].join("");
  } catch (e) {
    // silent fail
  }
}

function formatNumber(n) {
  const num = parseInt(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

async function refreshYoutube() {
  try {
    const data = await fetchJson("/api/youtube");
    if (!data) return;
    if (data.error) {
      $("youtube-stats").innerHTML =
        `<p class="empty">${escapeHtml(data.error)}</p>`;
      return;
    }
    if (data.stats) {
      $("yt-subs").textContent = formatNumber(data.stats.subscriberCount);
      $("yt-views").textContent = formatNumber(data.stats.viewCount);
      $("yt-videos").textContent = data.stats.videoCount;
    }
    if (data.videos?.length > 0) {
      $("recent-videos").innerHTML = data.videos
        .slice(0, 3)
        .map(
          (v) =>
            `<div class="item">
          <div>${escapeHtml(v.title)}</div>
          <div class="item-meta">${formatNumber(v.viewCount)} views &middot; ${formatTime(v.publishedAt)}</div>
        </div>`,
        )
        .join("");
    }
  } catch (e) {
    // silent fail
  }
}

async function refreshGoals() {
  try {
    const data = await fetchJson("/api/goals");
    if (!data) return;
    const goals = data.goals ?? [];
    if (goals.length === 0) {
      $("goals-list").innerHTML = '<div class="empty">No active goals</div>';
      return;
    }
    $("goals-list").innerHTML = goals
      .map(
        (g) =>
          `<div class="item">
        <div>${escapeHtml(g.title)}</div>
        ${g.description ? `<div class="item-meta">${escapeHtml(g.description)}</div>` : ""}
      </div>`,
      )
      .join("");
  } catch (e) {
    // silent fail
  }
}

async function refreshRevenue() {
  try {
    const data = await fetchJson("/api/revenue");
    if (!data) return;
    if (data.error) {
      const panel = $("revenue-panel");
      if (panel)
        panel.querySelector(".stats-grid").innerHTML =
          `<p class="empty">${escapeHtml(data.error)}</p>`;
      return;
    }
    $("rev-mrr").textContent = "$" + (data.totalMRR || 0).toFixed(2);
    $("rev-total").textContent = "$" + (data.totalAllTime || 0).toFixed(2);
    const entries = data.entries ?? [];
    if (entries.length > 0) {
      $("revenue-entries").innerHTML = entries
        .slice(0, 5)
        .map(
          (e) =>
            `<div class="item">
          <div>${escapeHtml(e.source)}</div>
          <div class="item-meta">$${parseFloat(e.amount).toFixed(2)} &mdash; ${escapeHtml(e.date)}</div>
        </div>`,
        )
        .join("");
    } else {
      $("revenue-entries").innerHTML =
        '<div class="empty">No entries yet. Use /revenue add to log income.</div>';
    }
  } catch (e) {
    // silent fail
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
    refreshReports(),
    refreshRoadmap(),
    refreshNeedsAttention(),
    refreshHealthIndicators(),
    refreshYoutube(),
    refreshGoals(),
    refreshRevenue(),
  ]);
}

refresh();
connectSSE();
setInterval(refresh, 30000);
