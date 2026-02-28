const CATEGORIES = {
  "Fixed Expense": [
    "House",
    "Car",
    "Car Insurance",
    "Cat",
    "Loan",
    "Telecom",
    "Internet",
    "House Insurance",
    "Car Subscription",
    "Spotify Subscription",
    "Amazon Subscription",
    "Hulu Subscription",
    "Netflix Subscription",
    "Viki Subscription",
    "iPhone Insurance",
    "iCloud+",
  ],
  "Non-Fixed Expense": ["Medical Fee", "Therapy Fee", "House Utility", "Eating"],
};
const UTILITY_SUBCATEGORIES = ["Water", "Electric", "Preston Service Fee"];

const els = {
  roomInput: document.getElementById("roomInput"),
  saveRoomBtn: document.getElementById("saveRoomBtn"),
  prevMonthBtn: document.getElementById("prevMonthBtn"),
  nextMonthBtn: document.getElementById("nextMonthBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  monthInput: document.getElementById("monthInput"),
  dateInput: document.getElementById("dateInput"),
  typeInput: document.getElementById("typeInput"),
  categoryInput: document.getElementById("categoryInput"),
  subcategoryInput: document.getElementById("subcategoryInput"),
  amountInput: document.getElementById("amountInput"),
  paymentMethodInput: document.getElementById("paymentMethodInput"),
  noteInput: document.getElementById("noteInput"),
  expenseForm: document.getElementById("expenseForm"),
  undoLastBtn: document.getElementById("undoLastBtn"),
  formStatus: document.getElementById("formStatus"),
  entriesBody: document.getElementById("entriesBody"),
  fixedTotal: document.getElementById("fixedTotal"),
  nonFixedTotal: document.getElementById("nonFixedTotal"),
  grandTotal: document.getElementById("grandTotal"),
  barChart: document.getElementById("barChart"),
  toggleUtilityBtn: document.getElementById("toggleUtilityBtn"),
  utilityBreakdown: document.getElementById("utilityBreakdown"),
  fixedTemplateGrid: document.getElementById("fixedTemplateGrid"),
  saveTemplateBtn: document.getElementById("saveTemplateBtn"),
  applyTemplateBtn: document.getElementById("applyTemplateBtn"),
  templateStatus: document.getElementById("templateStatus"),
  aiSummaryBtn: document.getElementById("aiSummaryBtn"),
  aiStatus: document.getElementById("aiStatus"),
  aiSummaryText: document.getElementById("aiSummaryText"),
  forecastBtn: document.getElementById("forecastBtn"),
  forecastStatus: document.getElementById("forecastStatus"),
  forecastCards: document.getElementById("forecastCards"),
  forecastCategories: document.getElementById("forecastCategories"),
  liveStatusPill: document.getElementById("liveStatusPill"),
  lastSyncText: document.getElementById("lastSyncText"),
};

const url = new URL(window.location.href);
let state = {
  room: (url.searchParams.get("room") || "home").trim(),
  month: url.searchParams.get("month") || new Date().toISOString().slice(0, 7),
  entries: [],
  lastAddedExpenseId: null,
  templateValues: {},
  live: {
    digest: null,
    timer: null,
    errors: 0,
  },
  isRefreshing: false,
  pendingRefresh: false,
  summaryUtilityBreakdown: [],
  utilityBreakdownVisible: false,
};

const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function shiftMonth(yyyymm, delta) {
  const [y, m] = yyyymm.split("-").map(Number);
  const base = new Date(y, m - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function setCategories() {
  const selectedType = els.typeInput.value;
  const list = CATEGORIES[selectedType] || [];
  const prior = els.categoryInput.value;
  els.categoryInput.innerHTML = "";
  list.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    if (item === prior) opt.selected = true;
    els.categoryInput.appendChild(opt);
  });
  syncSubcategoryUI();
}

function syncSubcategoryUI() {
  const needsUtility =
    els.typeInput.value === "Non-Fixed Expense" && els.categoryInput.value === "House Utility";
  els.subcategoryInput.disabled = !needsUtility;
  if (!needsUtility) {
    els.subcategoryInput.value = "";
  } else if (!UTILITY_SUBCATEGORIES.includes(els.subcategoryInput.value)) {
    els.subcategoryInput.value = UTILITY_SUBCATEGORIES[0];
  }
}

function showStatus(msg, isError = false) {
  els.formStatus.textContent = msg;
  els.formStatus.style.color = isError ? "#b83244" : "#627087";
}

function setUndoState() {
  els.undoLastBtn.disabled = !state.lastAddedExpenseId;
}

function showTemplateStatus(msg, isError = false) {
  els.templateStatus.textContent = msg;
  els.templateStatus.style.color = isError ? "#b83244" : "#627087";
}

function showAIStatus(msg, isError = false) {
  els.aiStatus.textContent = msg;
  els.aiStatus.style.color = isError ? "#b83244" : "#627087";
}

function showForecastStatus(msg, isError = false) {
  els.forecastStatus.textContent = msg;
  els.forecastStatus.style.color = isError ? "#b83244" : "#627087";
}

function setLiveStatus(msg, mode) {
  if (!els.liveStatusPill) return;
  els.liveStatusPill.textContent = msg;
  els.liveStatusPill.classList.remove("ok", "error");
  if (mode === "ok") els.liveStatusPill.classList.add("ok");
  if (mode === "error") els.liveStatusPill.classList.add("error");
}

function setLastSyncText(msg) {
  if (!els.lastSyncText) return;
  els.lastSyncText.textContent = msg;
}

function formatAddedAt(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function buildApiUrl(path) {
  const out = new URL(path, window.location.origin);
  out.searchParams.set("room", state.room);
  out.searchParams.set("month", state.month);
  return out;
}

function renderFixedTemplateInputs(values = state.templateValues || {}) {
  els.fixedTemplateGrid.innerHTML = "";

  CATEGORIES["Fixed Expense"].forEach((cat) => {
    const label = document.createElement("label");
    label.innerHTML = `${cat}<input type="number" min="0" step="0.01" data-cat="${cat}" value="${Number(values[cat] || 0)}" />`;
    els.fixedTemplateGrid.appendChild(label);
  });
}

function collectTemplateValues() {
  const out = {};
  els.fixedTemplateGrid.querySelectorAll("input[data-cat]").forEach((input) => {
    const cat = input.getAttribute("data-cat");
    const amount = Number(input.value || 0);
    if (Number.isFinite(amount) && amount > 0) {
      out[cat] = amount;
    }
  });
  return out;
}

async function loadEntries() {
  const res = await fetch(buildApiUrl("/api/expenses"));
  if (!res.ok) throw new Error("Failed to load entries");
  const data = await res.json();
  state.entries = data.items;

  els.entriesBody.innerHTML = "";
  if (data.items.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="8">No records yet for ${state.month}.</td>`;
    els.entriesBody.appendChild(row);
    return;
  }

  data.items.forEach((item) => {
    const tr = document.createElement("tr");
    const catLabel =
      item.category === "House Utility" && item.subcategory
        ? `${item.category} (${item.subcategory})`
        : item.category;
    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.expense_type}</td>
      <td>${catLabel}</td>
      <td>${moneyFmt.format(item.amount)}</td>
      <td>${item.payment_method || ""}</td>
      <td>${item.note || ""}</td>
      <td>${formatAddedAt(item.created_at)}</td>
      <td><button class="delete-btn" data-id="${item.id}" type="button">Delete</button></td>
    `;
    els.entriesBody.appendChild(tr);
  });

  els.entriesBody.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const ok = window.confirm("Delete this entry?");
      if (!ok) return;

      const delUrl = new URL(`/api/expenses/${id}`, window.location.origin);
      delUrl.searchParams.set("room", state.room);
      const resp = await fetch(delUrl, { method: "DELETE" });
      if (!resp.ok) {
        showStatus("Delete failed.", true);
        return;
      }
      if (String(state.lastAddedExpenseId) === String(id)) {
        state.lastAddedExpenseId = null;
        setUndoState();
      }
      showStatus("Deleted.");
      await refreshAll();
      await checkForChanges();
    });
  });
}

function renderBars(rows) {
  els.barChart.innerHTML = "";

  if (!rows.length) {
    els.barChart.textContent = "No category totals yet.";
    return;
  }

  const max = Math.max(...rows.map((r) => r.total), 1);

  rows.forEach((row) => {
    const pct = Math.max(2, Math.round((row.total / max) * 100));
    const wrap = document.createElement("div");
    wrap.className = "bar-row";
    wrap.innerHTML = `
      <span>${row.category}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <strong>${moneyFmt.format(row.total)}</strong>
    `;
    els.barChart.appendChild(wrap);
  });
}

function renderUtilityBreakdown(rows) {
  els.utilityBreakdown.innerHTML = "";
  if (!rows || rows.length === 0) {
    els.utilityBreakdown.textContent = "No utility breakdown yet.";
    return;
  }
  const max = Math.max(...rows.map((r) => r.total), 1);
  rows.forEach((row) => {
    const pct = Math.max(2, Math.round((row.total / max) * 100));
    const wrap = document.createElement("div");
    wrap.className = "bar-row";
    wrap.innerHTML = `
      <span>${row.subcategory}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <strong>${moneyFmt.format(row.total)}</strong>
    `;
    els.utilityBreakdown.appendChild(wrap);
  });
}

function renderForecastCategoryBars(rows) {
  els.forecastCategories.innerHTML = "";
  if (!rows.length) {
    els.forecastCategories.textContent = "No forecast category data yet.";
    return;
  }
  const max = Math.max(...rows.map((r) => r.predicted_amount), 1);
  rows.forEach((row) => {
    const pct = Math.max(2, Math.round((row.predicted_amount / max) * 100));
    const wrap = document.createElement("div");
    wrap.className = "bar-row";
    wrap.innerHTML = `
      <span>${row.category}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <strong>${moneyFmt.format(row.predicted_amount)}</strong>
    `;
    els.forecastCategories.appendChild(wrap);
  });
}

function renderForecastCards(data) {
  const p = data.patterns || {};
  els.forecastCards.innerHTML = `
    <div><span>Next Month</span><strong>${data.next_month || "-"}</strong></div>
    <div><span>Predicted Total</span><strong>${moneyFmt.format(data.prediction_total || 0)}</strong></div>
    <div><span>Confidence</span><strong>${(data.confidence || "-").toUpperCase()}</strong></div>
    <div><span>History Months</span><strong>${data.history_months_used || 0}</strong></div>
    <div><span>Fixed Ratio</span><strong>${((p.fixed_ratio || 0) * 100).toFixed(1)}%</strong></div>
    <div><span>Non-Fixed Ratio</span><strong>${((p.non_fixed_ratio || 0) * 100).toFixed(1)}%</strong></div>
    <div><span>Weekday Avg Txn</span><strong>${moneyFmt.format(p.weekday_avg_transaction || 0)}</strong></div>
    <div><span>Weekend Avg Txn</span><strong>${moneyFmt.format(p.weekend_avg_transaction || 0)}</strong></div>
  `;
}

async function loadSummary() {
  const res = await fetch(buildApiUrl("/api/summary"));
  if (!res.ok) throw new Error("Failed to load summary");
  const data = await res.json();

  els.fixedTotal.textContent = moneyFmt.format(data.totals.fixed_total);
  els.nonFixedTotal.textContent = moneyFmt.format(data.totals.non_fixed_total);
  els.grandTotal.textContent = moneyFmt.format(data.totals.grand_total);
  renderBars(data.by_category);
  state.summaryUtilityBreakdown = data.utility_breakdown || [];
  if (state.utilityBreakdownVisible) {
    renderUtilityBreakdown(state.summaryUtilityBreakdown);
  }
}

async function refreshAll() {
  if (state.isRefreshing) {
    state.pendingRefresh = true;
    return;
  }

  state.isRefreshing = true;
  try {
    await Promise.all([loadEntries(), loadSummary()]);
    const now = new Date();
    setLastSyncText(`Last synced: ${now.toLocaleTimeString()}`);
  } catch (err) {
    showStatus(err.message, true);
  } finally {
    state.isRefreshing = false;
    if (state.pendingRefresh) {
      state.pendingRefresh = false;
      refreshAll();
    }
  }
}

async function loadTemplate() {
  const endpoint = new URL("/api/template", window.location.origin);
  endpoint.searchParams.set("room", state.room);
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Failed to load template");
  const data = await res.json();
  state.templateValues = data.template || {};
  renderFixedTemplateInputs(state.templateValues);
}

async function fetchChangesDigest() {
  const res = await fetch(buildApiUrl("/api/changes"));
  if (!res.ok) throw new Error("Live sync unavailable");
  const data = await res.json();
  return data.signature || null;
}

async function checkForChanges() {
  try {
    const nextDigest = await fetchChangesDigest();

    if (!state.live.digest) {
      state.live.digest = nextDigest;
      state.live.errors = 0;
      setLiveStatus("Live sync: on", "ok");
      return;
    }

    if (nextDigest !== state.live.digest) {
      state.live.digest = nextDigest;
      await refreshAll();
      setLiveStatus("Live sync: updated", "ok");
      return;
    }

    state.live.errors = 0;
    setLiveStatus("Live sync: on", "ok");
  } catch {
    state.live.errors += 1;
    setLiveStatus("Live sync: reconnecting...", "error");
  }
}

function startLiveSync() {
  if (state.live.timer) {
    clearInterval(state.live.timer);
  }
  state.live.digest = null;
  state.live.errors = 0;
  checkForChanges();
  state.live.timer = setInterval(checkForChanges, 1500);
}

async function onSubmit(event) {
  event.preventDefault();

  const payload = {
    room: state.room,
    date: els.dateInput.value,
    expense_type: els.typeInput.value,
    category: els.categoryInput.value,
    subcategory: els.subcategoryInput.value,
    amount: Number(els.amountInput.value),
    payment_method: els.paymentMethodInput.value,
    note: els.noteInput.value,
  };

  const res = await fetch("/api/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showStatus(err.error || "Failed to save", true);
    return;
  }
  const data = await res.json();
  state.lastAddedExpenseId = data.id || null;
  setUndoState();

  els.amountInput.value = "";
  els.noteInput.value = "";
  syncSubcategoryUI();
  showStatus("Saved. You can undo this add.");
  await refreshAll();
  await checkForChanges();
}

async function undoLastAdd() {
  if (!state.lastAddedExpenseId) {
    showStatus("No recent add to undo.");
    return;
  }
  const id = state.lastAddedExpenseId;
  const delUrl = new URL(`/api/expenses/${id}`, window.location.origin);
  delUrl.searchParams.set("room", state.room);
  const resp = await fetch(delUrl, { method: "DELETE" });
  if (!resp.ok) {
    showStatus("Undo failed.", true);
    return;
  }
  state.lastAddedExpenseId = null;
  setUndoState();
  showStatus("Last add reverted.");
  await refreshAll();
  await checkForChanges();
}

async function applyFixedTemplate() {
  const template = collectTemplateValues();
  const cats = Object.keys(template);
  if (!cats.length) {
    showTemplateStatus("Enter at least one amount in template.", true);
    return;
  }
  const res = await fetch("/api/template/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room: state.room,
      month: state.month,
      template,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showTemplateStatus(data.error || "Template sync failed.", true);
    return;
  }

  showTemplateStatus(
    `Synced ${data.categories_synced || 0} categories (added ${data.inserted || 0}, updated ${
      data.updated || 0
    }, removed duplicates ${data.removed_duplicates || 0}).`
  );
  await refreshAll();
  await checkForChanges();
}

async function saveTemplate() {
  const template = collectTemplateValues();
  const res = await fetch("/api/template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: state.room, template }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showTemplateStatus(data.error || "Template save failed.", true);
    return;
  }
  state.templateValues = template;
  renderFixedTemplateInputs(state.templateValues);
  showTemplateStatus(`Template saved (${data.saved_categories || 0} categories).`);
  await checkForChanges();
}

async function generateAISummary() {
  showAIStatus("Generating summary...");
  els.aiSummaryText.textContent = "";

  const res = await fetch("/api/ai-summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: state.room, month: state.month }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showAIStatus(data.error || "AI summary failed.", true);
    return;
  }

  showAIStatus("Done.");
  els.aiSummaryText.textContent = data.summary || "No summary returned.";
}

async function runForecast() {
  showForecastStatus("Running forecast...");
  const res = await fetch(buildApiUrl("/api/forecast"));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showForecastStatus(data.error || "Forecast failed.", true);
    return;
  }
  renderForecastCards(data);
  renderForecastCategoryBars(data.category_forecast || []);
  showForecastStatus(data.message || "Done.");
}

function applyRoomAndMonthToUrl() {
  const next = new URL(window.location.href);
  next.searchParams.set("room", state.room);
  next.searchParams.set("month", state.month);
  window.history.replaceState({}, "", next.toString());
}

function exportCsv() {
  window.location.href = buildApiUrl("/api/export.csv").toString();
}

async function updateMonth(nextMonth) {
  state.month = nextMonth;
  els.monthInput.value = state.month;
  els.dateInput.value = `${state.month}-01`;
  applyRoomAndMonthToUrl();
  startLiveSync();
  await refreshAll();
}

function init() {
  els.roomInput.value = state.room;
  els.monthInput.value = state.month;
  els.dateInput.value = `${state.month}-01`;
  setUndoState();

  setCategories();
  renderFixedTemplateInputs();
  Promise.all([refreshAll(), loadTemplate()]).catch((err) => showTemplateStatus(err.message, true));
  startLiveSync();

  els.typeInput.addEventListener("change", setCategories);
  els.categoryInput.addEventListener("change", syncSubcategoryUI);
  els.expenseForm.addEventListener("submit", onSubmit);

  els.saveRoomBtn.addEventListener("click", async () => {
    state.room = (els.roomInput.value.trim() || "home").slice(0, 50);
    state.lastAddedExpenseId = null;
    setUndoState();
    applyRoomAndMonthToUrl();
    startLiveSync();
    await Promise.all([refreshAll(), loadTemplate()]);
  });

  els.monthInput.addEventListener("change", async () => {
    if (!els.monthInput.value) return;
    state.lastAddedExpenseId = null;
    setUndoState();
    await updateMonth(els.monthInput.value);
  });

  els.prevMonthBtn.addEventListener("click", async () => {
    state.lastAddedExpenseId = null;
    setUndoState();
    await updateMonth(shiftMonth(state.month, -1));
  });

  els.nextMonthBtn.addEventListener("click", async () => {
    state.lastAddedExpenseId = null;
    setUndoState();
    await updateMonth(shiftMonth(state.month, 1));
  });

  els.exportCsvBtn.addEventListener("click", exportCsv);

  els.saveTemplateBtn.addEventListener("click", saveTemplate);

  els.applyTemplateBtn.addEventListener("click", applyFixedTemplate);
  els.aiSummaryBtn.addEventListener("click", generateAISummary);
  els.forecastBtn.addEventListener("click", runForecast);
  els.undoLastBtn.addEventListener("click", undoLastAdd);
  els.toggleUtilityBtn.addEventListener("click", () => {
    state.utilityBreakdownVisible = !state.utilityBreakdownVisible;
    if (state.utilityBreakdownVisible) {
      els.utilityBreakdown.classList.remove("hidden");
      renderUtilityBreakdown(state.summaryUtilityBreakdown);
      els.toggleUtilityBtn.textContent = "Hide Utility Breakdown";
    } else {
      els.utilityBreakdown.classList.add("hidden");
      els.toggleUtilityBtn.textContent = "Show Utility Breakdown";
    }
  });
}

init();
