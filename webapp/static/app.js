// ── STATE ─────────────────────────────────────────────────────────────────────
let state = {
  income: [], expenses: [], investments: [],
  budgets: {}, fixedExpenses: [], trips: [],
  events: [], photos: [], albums: [], goals: []
};

let currentLoggedInUser = null;
const INSIGHT_COOLDOWN_MS = 20000;
let insightState = {
  enabled: false,
  lastActivatedAt: 0,
  cooldownTimer: null,
};

function insightCooldownRemainingMs() {
  const elapsed = Date.now() - insightState.lastActivatedAt;
  return Math.max(0, INSIGHT_COOLDOWN_MS - elapsed);
}

function resetFinanceInsightPanels() {
  const aiEl = document.getElementById('ai-summary-block');
  const nextEl = document.getElementById('next-month-block');
  if (aiEl) aiEl.textContent = 'Add at least one month of transactions to generate an AI-style summary.';
  if (nextEl) nextEl.textContent = 'Add spending data to estimate next month.';
}

function refreshInsightsButtonState() {
  const btn = document.getElementById('activate-insights-btn');
  if (!btn) return;
  const remaining = insightCooldownRemainingMs();
  if (remaining > 0) {
    btn.disabled = true;
    btn.textContent = `Activate in ${Math.ceil(remaining / 1000)}s`;
    return;
  }
  btn.disabled = false;
  btn.textContent = insightState.enabled ? 'Refresh Insights' : 'Activate Insights';
  if (insightState.cooldownTimer) {
    clearInterval(insightState.cooldownTimer);
    insightState.cooldownTimer = null;
  }
}

function startInsightCooldown() {
  refreshInsightsButtonState();
  if (insightState.cooldownTimer) clearInterval(insightState.cooldownTimer);
  insightState.cooldownTimer = setInterval(refreshInsightsButtonState, 1000);
}

function activateFinanceInsights() {
  const remaining = insightCooldownRemainingMs();
  if (remaining > 0) {
    toast(`Insights available in ${Math.ceil(remaining / 1000)}s`);
    refreshInsightsButtonState();
    return;
  }
  insightState.enabled = true;
  insightState.lastActivatedAt = Date.now();
  renderOverview();
  startInsightCooldown();
  toast('Insights activated ✓');
}

function loadUserState(username) {
  try {
    const key = 'jr_state_' + username;
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
    } else {
      state = { income:[], expenses:[], investments:[], budgets:{}, fixedExpenses:[], trips:[], events:[], photos:[], albums:[], goals:[] };
    }
  } catch(e) {}
  ['fixedExpenses','trips','events','photos','albums','goals'].forEach(k => { if (!state[k]) state[k] = []; });
  if (!state.budgets) state.budgets = {};
  insightState.enabled = false;
  insightState.lastActivatedAt = 0;
  if (insightState.cooldownTimer) {
    clearInterval(insightState.cooldownTimer);
    insightState.cooldownTimer = null;
  }
  resetFinanceInsightPanels();
  refreshInsightsButtonState();
  renderAll();
}

function saveUserState(username) {
  try {
    localStorage.setItem('jr_state_' + username, JSON.stringify(state));
  } catch(e) {}
}

function loadState() {
  // Legacy: no-op on init, actual load happens after login
}

function saveState() {
  if (currentLoggedInUser) saveUserState(currentLoggedInUser);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────

// User account system — stored in localStorage
function loadAccounts() {
  try { return JSON.parse(localStorage.getItem('jr_accounts') || '{}'); } catch(e) { return {}; }
}
function saveAccounts(accts) {
  try { localStorage.setItem('jr_accounts', JSON.stringify(accts)); } catch(e) {}
}

let pinEntry = '';
let regEntry = '';

function showHub() {
  // Front page → PIN screen
  const fp = document.getElementById('front-page');
  fp.classList.add('hidden');
  setTimeout(() => fp.style.display = 'none', 900);
  const pin = document.getElementById('pin-screen');
  pin.classList.add('visible');
  showLoginView();
}

function backToFront() {
  const pin = document.getElementById('pin-screen');
  pin.classList.add('hidden');
  setTimeout(() => { pin.classList.remove('visible'); pin.classList.remove('hidden'); }, 600);
  const fp = document.getElementById('front-page');
  fp.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => fp.classList.remove('hidden')));
  resetPin();
}

function showLoginView() {
  document.getElementById('pin-login-view').style.display = '';
  document.getElementById('pin-create-view').style.display = 'none';
  resetPin();
  setTimeout(() => document.getElementById('login-username').focus(), 100);
}

function showCreateAccount() {
  document.getElementById('pin-login-view').style.display = 'none';
  document.getElementById('pin-create-view').style.display = '';
  regEntry = '';
  updateRegDots();
  document.getElementById('reg-username').value = '';
  document.getElementById('reg-error').textContent = '';
  document.getElementById('reg-error').classList.remove('show');
  setTimeout(() => document.getElementById('reg-username').focus(), 100);
}

function resetPin() {
  pinEntry = '';
  updateDots();
  const err = document.getElementById('pin-error');
  if (err) { err.textContent = ''; err.classList.remove('show'); }
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot-' + i);
    if (!dot) return;
    dot.classList.remove('filled', 'error');
    if (i < pinEntry.length) dot.classList.add('filled');
  }
}

function updateRegDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('rdot-' + i);
    if (!dot) return;
    dot.classList.remove('filled', 'error');
    if (i < regEntry.length) dot.classList.add('filled');
  }
}

function pinKey(digit) {
  if (pinEntry.length >= 4) return;
  pinEntry += digit;
  updateDots();
  if (pinEntry.length === 4) setTimeout(() => checkPin(), 120);
}

function pinDelete() {
  if (pinEntry.length === 0) return;
  pinEntry = pinEntry.slice(0, -1);
  updateDots();
}

function checkPin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const accounts = loadAccounts();
  const match = accounts[username];

  if (match && match.pin === pinEntry) {
    // Success — load this user's data
    currentLoggedInUser = username;
    loadUserState(username);
    const pin = document.getElementById('pin-screen');
    pin.classList.add('hidden');
    setTimeout(() => { pin.classList.remove('visible'); pin.classList.remove('hidden'); }, 600);
    const hub = document.getElementById('hub-page');
    hub.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => hub.classList.remove('hidden')));
    resetPin();
  } else {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById('dot-' + i);
      dot.classList.remove('filled');
      dot.classList.add('error');
    }
    const errEl = document.getElementById('pin-error');
    errEl.textContent = !username ? 'Enter your username first' : 'Incorrect username or PIN';
    errEl.classList.add('show');
    setTimeout(() => resetPin(), 1400);
  }
}

function regKey(digit) {
  if (regEntry.length >= 4) return;
  regEntry += digit;
  updateRegDots();
  if (regEntry.length === 4) setTimeout(() => createAccount(), 120);
}

function regDelete() {
  if (regEntry.length === 0) return;
  regEntry = regEntry.slice(0, -1);
  updateRegDots();
}

function createAccount() {
  const username = document.getElementById('reg-username').value.trim().toLowerCase();
  const errEl = document.getElementById('reg-error');
  if (!username) {
    regEntry = ''; updateRegDots();
    errEl.textContent = 'Please enter a username first';
    errEl.classList.add('show');
    setTimeout(() => { errEl.classList.remove('show'); errEl.textContent = ''; }, 2000);
    return;
  }
  const accounts = loadAccounts();
  if (accounts[username]) {
    regEntry = ''; updateRegDots();
    for (let i = 0; i < 4; i++) document.getElementById('rdot-' + i).classList.add('error');
    errEl.textContent = 'Username already taken — choose another';
    errEl.classList.add('show');
    setTimeout(() => { for(let i=0;i<4;i++) document.getElementById('rdot-'+i).classList.remove('error'); errEl.classList.remove('show'); errEl.textContent=''; }, 1800);
    return;
  }
  // Save account keyed by username
  accounts[username] = { username, pin: regEntry, createdAt: Date.now() };
  saveAccounts(accounts);
  // Init empty state for this user and auto-login
  currentLoggedInUser = username;
  state = { income:[], expenses:[], investments:[], budgets:{}, fixedExpenses:[], trips:[], events:[], photos:[], albums:[], goals:[] };
  saveUserState(username);
  const pin = document.getElementById('pin-screen');
  pin.classList.add('hidden');
  setTimeout(() => { pin.classList.remove('visible'); pin.classList.remove('hidden'); }, 600);
  const hub = document.getElementById('hub-page');
  hub.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => hub.classList.remove('hidden')));
}

// Keyboard support
document.addEventListener('keydown', (e) => {
  const pinVisible = document.getElementById('pin-screen').classList.contains('visible');
  if (!pinVisible) return;
  const loginActive = document.getElementById('pin-login-view').style.display !== 'none';
  const activeEl = document.activeElement;
  const isTypingText = activeEl && (activeEl.id === 'login-username' || activeEl.id === 'reg-username');
  if (isTypingText) return;
  if (e.key >= '0' && e.key <= '9') { loginActive ? pinKey(e.key) : regKey(e.key); }
  if (e.key === 'Backspace') { loginActive ? pinDelete() : regDelete(); }
});

function enterSection(id) {
  const hub = document.getElementById('hub-page');
  hub.classList.add('hidden');
  setTimeout(() => hub.style.display = 'none', 600);
  showSection(id);
}

function goToHub() {
  document.getElementById('front-page').style.display = 'none';
  const hub = document.getElementById('hub-page');
  hub.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => hub.classList.remove('hidden')));
}

const SECTION_TITLES = {
  overview:'Overview', income:'Income', spending:'Daily Spending', budget:'Budget',
  fixed:'Fixed Expenses', goals:'Savings Goals', investments:'Investments',
  travel:'Travel', calendar:'Calendar', photos:'Photo Album'
};

const NAV_ITEMS = ['overview','income','spending','budget','fixed','goals','investments','travel','calendar','photos'];

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('section-' + id);
  if (el) el.classList.add('active');
  const idx = NAV_ITEMS.indexOf(id);
  if (idx >= 0) document.querySelectorAll('.nav-item')[idx]?.classList.add('active');
  document.getElementById('page-title').textContent = SECTION_TITLES[id] || id;
  renderTopbarActions(id);
  renderAll();
}

function renderTopbarActions(id) {
  const actions = {
    overview: `<button class="btn btn-ghost btn-sm" onclick="exportData()">Export</button><button class="btn btn-primary btn-sm" onclick="showSection('income')">+ Income</button><button class="btn btn-ghost btn-sm" onclick="showSection('spending')">+ Expense</button>`,
    income: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('inc-amount').focus()">+ Add Income</button>`,
    spending: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('exp-amount').focus()">+ Add Expense</button>`,
    fixed: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('fx-name').focus()">+ Add Fixed</button>`,
    goals: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('gl-name').focus()">+ Add Goal</button>`,
    investments: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('inv-ticker').focus()">+ Add Position</button>`,
    travel: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('tr-dest').focus()">+ Plan Trip</button>`,
    calendar: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('ev-title').focus()">+ Add Event</button>`,
    photos: `<button class="btn btn-primary btn-sm" onclick="document.getElementById('photo-upload').click()">+ Add Photos</button>`,
    budget: ``
  };
  document.getElementById('topbar-actions').innerHTML = actions[id] || '';
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmt(n) { return '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function getMonth(d) { const dt = new Date(d+'T00:00:00'); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; }
function thisMonth() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; }
function thisYear() { return String(new Date().getFullYear()); }
function toMonthly(amount, freq) {
  switch(freq) { case 'weekly': return amount*52/12; case 'quarterly': return amount/3; case 'annually': return amount/12; default: return amount; }
}

// ── ADD / DELETE ──────────────────────────────────────────────────────────────
function addIncome() {
  const amount = parseFloat(document.getElementById('inc-amount').value);
  const cat = document.getElementById('inc-cat').value;
  const date = document.getElementById('inc-date').value || todayStr();
  const notes = document.getElementById('inc-notes').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
  state.income.push({ id: Date.now(), desc: notes || cat, amount, cat, date, notes });
  saveState(); renderAll(); toast('Income added ✓');
  document.getElementById('inc-amount').value = '';
  document.getElementById('inc-notes').value = '';
}

function addExpense() {
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const cat = document.getElementById('exp-cat').value;
  const date = document.getElementById('exp-date').value || todayStr();
  const notes = document.getElementById('exp-notes').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
  state.expenses.push({ id: Date.now(), desc: notes || cat, amount, cat, date, notes });
  saveState(); renderAll(); toast('Expense added ✓');
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-notes').value = '';
}

function addBudget() {
  const cat = document.getElementById('bud-cat').value;
  const limit = parseFloat(document.getElementById('bud-limit').value);
  if (!limit || limit <= 0) { alert('Enter a valid limit.'); return; }
  state.budgets[cat] = limit;
  saveState(); renderAll(); toast('Budget set ✓');
  document.getElementById('bud-limit').value = '';
}

function deleteBudget(cat) {
  if (!confirm(`Remove ${cat} budget?`)) return;
  delete state.budgets[cat];
  saveState(); renderAll();
}

const FX_SUBCATS = {
  'Home': ['Rent','Mortgage','Electric','Water','Gas','Building Fee','Home Insurance','Other Home'],
  'Car': ['Lease Payment','Car Insurance','Loan Payment','Tesla Premium Connection','Parking','Other Car'],
  'Loans': ['Personal Loan','Student Loan','Credit Card','Monthly Repayment','Other Loan'],
  'Insurance': ['Cat Insurance','Dog Insurance','Health Insurance','Life Insurance','Dental','Vision','Other Insurance'],
  'Connectivity': ['Internet','T-Mobile','Phone Insurance','iCloud','Google One','Other Connectivity'],
  'Subscriptions': ['Netflix','Hulu','Viki','Spotify','Amazon Prime','Disney+','Apple TV+','YouTube Premium','Other Subscription'],
};
const FX_ICONS = { Home:'🏠', Car:'🚗', Loans:'💳', Insurance:'🛡️', Connectivity:'📡', Subscriptions:'📱' };
const FX_COLORS = { Home:'#7a9aaa', Car:'#5c2d1e', Loans:'#8b2035', Insurance:'#a06828', Connectivity:'#4a7060', Subscriptions:'#b07890' };

function updateSubcats(prefix) {
  const catEl = document.getElementById((prefix||'fx')+'-cat');
  const subEl = document.getElementById((prefix||'fx')+'-subcat');
  if (!catEl || !subEl) return;
  const opts = FX_SUBCATS[catEl.value] || [];
  subEl.innerHTML = opts.map(o => `<option value="${o}">${o}</option>`).join('');
}

function addFixed() {
  const name = document.getElementById('fx-name').value.trim();
  const amount = parseFloat(document.getElementById('fx-amount').value);
  const cat = document.getElementById('fx-cat').value;
  const subcat = document.getElementById('fx-subcat').value;
  const freq = document.getElementById('fx-freq').value;
  const due = parseInt(document.getElementById('fx-due').value) || null;
  const status = document.getElementById('fx-status').value;
  const notes = document.getElementById('fx-notes').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
  state.fixedExpenses.push({ id: Date.now(), name: name || subcat, subcat, cat, amount, freq, due, status, notes });
  saveState(); renderAll(); toast('Fixed expense added ✓');
  document.getElementById('fx-name').value = '';
  document.getElementById('fx-amount').value = '';
  document.getElementById('fx-due').value = '';
  document.getElementById('fx-notes').value = '';
}

function deleteFixed(id) { if (!confirm('Delete?')) return; state.fixedExpenses = state.fixedExpenses.filter(i => i.id !== id); saveState(); renderAll(); }
function toggleFixedStatus(id) { const i = state.fixedExpenses.find(x => x.id === id); if (i) { i.status = i.status === 'active' ? 'paused' : 'active'; saveState(); renderAll(); } }

function addGoal() {
  const name = document.getElementById('gl-name').value.trim();
  const target = parseFloat(document.getElementById('gl-target-amt').value);
  const saved = parseFloat(document.getElementById('gl-saved-amt').value) || 0;
  const date = document.getElementById('gl-date').value;
  const emoji = document.getElementById('gl-emoji').value.trim() || '🎯';
  const notes = document.getElementById('gl-notes').value.trim();
  if (!name || !target) { alert('Please enter name and target.'); return; }
  state.goals.push({ id: Date.now(), name, target, saved, date, emoji, notes });
  saveState(); renderAll(); toast('Goal added ✓');
  ['gl-name','gl-target-amt','gl-saved-amt','gl-date','gl-emoji','gl-notes'].forEach(id => document.getElementById(id).value = '');
}

function updateGoalSaved(id, delta) {
  const g = state.goals.find(x => x.id === id);
  if (!g) return;
  const newVal = Math.max(0, g.saved + delta);
  g.saved = Math.min(g.target, newVal);
  saveState(); renderAll();
}

function deleteGoal(id) { if (!confirm('Delete goal?')) return; state.goals = state.goals.filter(g => g.id !== id); saveState(); renderAll(); }

function addInvestment() {
  const ticker = document.getElementById('inv-ticker').value.trim().toUpperCase();
  const name = document.getElementById('inv-name').value.trim() || ticker;
  const shares = parseFloat(document.getElementById('inv-shares').value);
  const buyPrice = parseFloat(document.getElementById('inv-buy').value);
  const currentPrice = parseFloat(document.getElementById('inv-current').value);
  const type = document.getElementById('inv-type').value;
  const date = document.getElementById('inv-date').value || todayStr();
  const account = document.getElementById('inv-account').value.trim();
  if (!ticker || isNaN(shares) || isNaN(buyPrice) || isNaN(currentPrice)) { alert('Fill all required fields.'); return; }
  state.investments.push({ id: Date.now(), ticker, name, shares, buyPrice, currentPrice, type, date, account });
  saveState(); renderAll(); toast('Investment added ✓');
  ['inv-ticker','inv-name','inv-shares','inv-buy','inv-current','inv-account'].forEach(id => document.getElementById(id).value = '');
}

function addTrip() {
  const dest = document.getElementById('tr-dest').value.trim();
  const country = document.getElementById('tr-country').value.trim();
  const start = document.getElementById('tr-start').value;
  const end = document.getElementById('tr-end').value;
  const status = document.getElementById('tr-status').value;
  const budget = parseFloat(document.getElementById('tr-budget').value) || 0;
  const emoji = document.getElementById('tr-emoji').value.trim() || '✈️';
  const hotel = document.getElementById('tr-hotel').value.trim();
  const notes = document.getElementById('tr-notes').value.trim();
  if (!dest) { alert('Enter a destination.'); return; }
  state.trips.push({ id: Date.now(), dest, country, start, end, status, budget, emoji, hotel, notes });
  saveState(); renderAll(); toast('Trip added ✓');
  ['tr-dest','tr-country','tr-start','tr-end','tr-budget','tr-emoji','tr-hotel','tr-notes'].forEach(id => document.getElementById(id).value = '');
}

function deleteTrip(id) { if (!confirm('Remove trip?')) return; state.trips = state.trips.filter(t => t.id !== id); saveState(); renderAll(); }

function addEvent() {
  const title = document.getElementById('ev-title').value.trim();
  const date = document.getElementById('ev-date').value;
  const time = document.getElementById('ev-time').value;
  const cat = document.getElementById('ev-cat').value;
  const notes = document.getElementById('ev-notes').value.trim();
  if (!title || !date) { alert('Enter title and date.'); return; }
  state.events.push({ id: Date.now(), title, date, time, cat, notes });
  saveState(); renderCalendar(); toast('Event added ✓');
  document.getElementById('ev-title').value = '';
  document.getElementById('ev-notes').value = '';
}

function deleteEvent(id) { if (!confirm('Remove event?')) return; state.events = state.events.filter(e => e.id !== id); saveState(); renderCalendar(); }

function addAlbum() {
  const name = document.getElementById('alb-name').value.trim();
  const date = document.getElementById('alb-date').value;
  if (!name) { alert('Enter album name.'); return; }
  state.albums.push({ id: Date.now(), name, date });
  saveState(); renderPhotos(); toast('Album created ✓');
  document.getElementById('alb-name').value = '';
}

function deleteAlbum(id) { if (!confirm('Delete album?')) return; state.albums = state.albums.filter(a => a.id !== id); saveState(); renderPhotos(); }

// ── EDIT MODAL ────────────────────────────────────────────────────────────────
function openEditModal(type, id) {
  const overlay = document.getElementById('edit-modal-overlay');
  const body = document.getElementById('edit-modal-body');
  const title = document.getElementById('edit-modal-title');

  if (type === 'income') {
    const item = state.income.find(i => i.id === id); if (!item) return;
    title.textContent = 'Edit Income';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Amount ($)</label><input type="number" id="e-amount" value="${item.amount}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Category</label><select id="e-cat">${['Salary','Freelance','Business','Investment','Gift','Bonus','Other'].map(c=>`<option ${item.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="e-date" value="${item.date}"></div>
      <div class="form-group"><label class="form-label">Notes</label><input type="text" id="e-notes" value="${item.notes||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteItem('income',${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('income',${id})">Save</button>
    </div>`;
  } else if (type === 'expenses') {
    const item = state.expenses.find(i => i.id === id); if (!item) return;
    const cats = ['Housing','Food','Transport','Entertainment','Healthcare','Shopping','Utilities','Education','Travel','Pets','Personal Care','Other'];
    title.textContent = 'Edit Expense';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Amount ($)</label><input type="number" id="e-amount" value="${item.amount}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Category</label><select id="e-cat">${cats.map(c=>`<option ${item.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="e-date" value="${item.date}"></div>
      <div class="form-group"><label class="form-label">Notes</label><input type="text" id="e-notes" value="${item.notes||item.desc||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteItem('expenses',${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('expenses',${id})">Save</button>
    </div>`;
  } else if (type === 'investments') {
    const item = state.investments.find(i => i.id === id); if (!item) return;
    title.textContent = 'Edit Investment';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Ticker</label><input type="text" id="e-ticker" value="${item.ticker}" style="text-transform:uppercase;"></div>
      <div class="form-group"><label class="form-label">Full Name</label><input type="text" id="e-inv-name" value="${item.name}"></div>
      <div class="form-group"><label class="form-label">Shares</label><input type="number" id="e-shares" value="${item.shares}" step="0.0001"></div>
      <div class="form-group"><label class="form-label">Buy Price</label><input type="number" id="e-buy" value="${item.buyPrice}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Current Price</label><input type="number" id="e-current" value="${item.currentPrice}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Type</label><select id="e-inv-type">${['Stock','ETF','Crypto','Bond','Real Estate','Other'].map(t=>`<option ${item.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="e-date" value="${item.date}"></div>
      <div class="form-group"><label class="form-label">Account</label><input type="text" id="e-account" value="${item.account||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteItem('investments',${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('investments',${id})">Save</button>
    </div>`;
  } else if (type === 'fixed') {
    const item = state.fixedExpenses.find(i => i.id === id); if (!item) return;
    const cats = Object.keys(FX_SUBCATS);
    const subcats = FX_SUBCATS[item.cat] || [];
    title.textContent = 'Edit Fixed Expense';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Name</label><input type="text" id="e-fx-name" value="${item.name||''}"></div>
      <div class="form-group"><label class="form-label">Amount ($)</label><input type="number" id="e-amount" value="${item.amount}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Category</label><select id="e-fx-cat" onchange="updateEditSubcats()">${cats.map(c=>`<option value="${c}" ${item.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Subcategory</label><select id="e-fx-subcat">${subcats.map(s=>`<option ${item.subcat===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Frequency</label><select id="e-fx-freq">${['monthly','weekly','quarterly','annually'].map(f=>`<option value="${f}" ${item.freq===f?'selected':''}>${f}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Due Day</label><input type="number" id="e-fx-due" value="${item.due||''}" min="1" max="31"></div>
      <div class="form-group"><label class="form-label">Status</label><select id="e-fx-status"><option value="active" ${item.status==='active'?'selected':''}>Active</option><option value="paused" ${item.status==='paused'?'selected':''}>Paused</option></select></div>
      <div class="form-group"><label class="form-label">Notes</label><input type="text" id="e-fx-notes" value="${item.notes||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteFixed(${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('fixed',${id})">Save</button>
    </div>`;
  } else if (type === 'trips') {
    const item = state.trips.find(i => i.id === id); if (!item) return;
    title.textContent = 'Edit Trip';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Destination</label><input type="text" id="e-dest" value="${item.dest}"></div>
      <div class="form-group"><label class="form-label">Country</label><input type="text" id="e-country" value="${item.country||''}"></div>
      <div class="form-group"><label class="form-label">Start Date</label><input type="date" id="e-start" value="${item.start||''}"></div>
      <div class="form-group"><label class="form-label">End Date</label><input type="date" id="e-end" value="${item.end||''}"></div>
      <div class="form-group"><label class="form-label">Status</label><select id="e-status"><option value="planned" ${item.status==='planned'?'selected':''}>Planned</option><option value="upcoming" ${item.status==='upcoming'?'selected':''}>Upcoming</option><option value="completed" ${item.status==='completed'?'selected':''}>Completed</option></select></div>
      <div class="form-group"><label class="form-label">Budget ($)</label><input type="number" id="e-amount" value="${item.budget||0}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Emoji</label><input type="text" id="e-emoji" value="${item.emoji||'✈️'}" maxlength="4"></div>
      <div class="form-group"><label class="form-label">Accommodation</label><input type="text" id="e-hotel" value="${item.hotel||''}"></div>
      <div class="form-group full"><label class="form-label">Notes</label><input type="text" id="e-notes" value="${item.notes||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteTrip(${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('trips',${id})">Save</button>
    </div>`;
  } else if (type === 'events') {
    const item = state.events.find(i => i.id === id); if (!item) return;
    title.textContent = 'Edit Event';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group full"><label class="form-label">Title</label><input type="text" id="e-ev-title" value="${item.title}"></div>
      <div class="form-group"><label class="form-label">Date</label><input type="date" id="e-date" value="${item.date}"></div>
      <div class="form-group"><label class="form-label">Time</label><input type="time" id="e-ev-time" value="${item.time||''}"></div>
      <div class="form-group"><label class="form-label">Category</label><select id="e-ev-cat">${['personal','travel','health','finance','social','anniversary','work'].map(c=>`<option value="${c}" ${item.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="form-group full"><label class="form-label">Notes</label><input type="text" id="e-notes" value="${item.notes||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteEvent(${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('events',${id})">Save</button>
    </div>`;
  } else if (type === 'goals') {
    const item = state.goals.find(i => i.id === id); if (!item) return;
    title.textContent = 'Edit Goal';
    body.innerHTML = `<div class="form-grid">
      <div class="form-group"><label class="form-label">Goal Name</label><input type="text" id="e-gl-name" value="${item.name}"></div>
      <div class="form-group"><label class="form-label">Emoji</label><input type="text" id="e-gl-emoji" value="${item.emoji||'🎯'}" maxlength="4"></div>
      <div class="form-group"><label class="form-label">Target ($)</label><input type="number" id="e-gl-target" value="${item.target}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Saved ($)</label><input type="number" id="e-gl-saved" value="${item.saved}" step="0.01"></div>
      <div class="form-group"><label class="form-label">Target Date</label><input type="date" id="e-gl-date" value="${item.date||''}"></div>
      <div class="form-group"><label class="form-label">Notes</label><input type="text" id="e-gl-notes" value="${item.notes||''}"></div>
    </div><div class="form-actions" style="margin-top:16px;justify-content:space-between;">
      <button class="btn btn-danger btn-sm" onclick="deleteGoal(${id});closeEditModal()">Delete</button>
      <button class="btn btn-primary" onclick="saveEdit('goals',${id})">Save</button>
    </div>`;
  }

  overlay.classList.add('open');
}

function updateEditSubcats() {
  const cat = document.getElementById('e-fx-cat')?.value;
  const sub = document.getElementById('e-fx-subcat');
  if (!sub || !cat) return;
  sub.innerHTML = (FX_SUBCATS[cat]||[]).map(o=>`<option>${o}</option>`).join('');
}

function saveEdit(type, id) {
  if (type === 'income') {
    const item = state.income.find(i => i.id === id); if (!item) return;
    item.amount = parseFloat(document.getElementById('e-amount').value) || item.amount;
    item.cat = document.getElementById('e-cat').value;
    item.date = document.getElementById('e-date').value;
    item.notes = document.getElementById('e-notes').value.trim();
    item.desc = item.notes || item.cat;
  } else if (type === 'expenses') {
    const item = state.expenses.find(i => i.id === id); if (!item) return;
    item.amount = parseFloat(document.getElementById('e-amount').value) || item.amount;
    item.cat = document.getElementById('e-cat').value;
    item.date = document.getElementById('e-date').value;
    item.notes = document.getElementById('e-notes').value.trim();
    item.desc = item.notes || item.cat;
  } else if (type === 'investments') {
    const item = state.investments.find(i => i.id === id); if (!item) return;
    item.ticker = document.getElementById('e-ticker').value.trim().toUpperCase();
    item.name = document.getElementById('e-inv-name').value.trim();
    item.shares = parseFloat(document.getElementById('e-shares').value) || item.shares;
    item.buyPrice = parseFloat(document.getElementById('e-buy').value) || item.buyPrice;
    item.currentPrice = parseFloat(document.getElementById('e-current').value) || item.currentPrice;
    item.type = document.getElementById('e-inv-type').value;
    item.date = document.getElementById('e-date').value;
    item.account = document.getElementById('e-account').value.trim();
  } else if (type === 'fixed') {
    const item = state.fixedExpenses.find(i => i.id === id); if (!item) return;
    item.name = document.getElementById('e-fx-name').value.trim() || item.subcat;
    item.amount = parseFloat(document.getElementById('e-amount').value) || item.amount;
    item.cat = document.getElementById('e-fx-cat').value;
    item.subcat = document.getElementById('e-fx-subcat').value;
    item.freq = document.getElementById('e-fx-freq').value;
    item.due = parseInt(document.getElementById('e-fx-due').value) || null;
    item.status = document.getElementById('e-fx-status').value;
    item.notes = document.getElementById('e-fx-notes').value.trim();
  } else if (type === 'trips') {
    const item = state.trips.find(i => i.id === id); if (!item) return;
    item.dest = document.getElementById('e-dest').value.trim();
    item.country = document.getElementById('e-country').value.trim();
    item.start = document.getElementById('e-start').value;
    item.end = document.getElementById('e-end').value;
    item.status = document.getElementById('e-status').value;
    item.budget = parseFloat(document.getElementById('e-amount').value) || 0;
    item.emoji = document.getElementById('e-emoji').value.trim() || '✈️';
    item.hotel = document.getElementById('e-hotel').value.trim();
    item.notes = document.getElementById('e-notes').value.trim();
  } else if (type === 'events') {
    const item = state.events.find(i => i.id === id); if (!item) return;
    item.title = document.getElementById('e-ev-title').value.trim();
    item.date = document.getElementById('e-date').value;
    item.time = document.getElementById('e-ev-time').value;
    item.cat = document.getElementById('e-ev-cat').value;
    item.notes = document.getElementById('e-notes').value.trim();
  } else if (type === 'goals') {
    const item = state.goals.find(i => i.id === id); if (!item) return;
    item.name = document.getElementById('e-gl-name').value.trim();
    item.emoji = document.getElementById('e-gl-emoji').value.trim() || '🎯';
    item.target = parseFloat(document.getElementById('e-gl-target').value) || item.target;
    item.saved = parseFloat(document.getElementById('e-gl-saved').value) || 0;
    item.date = document.getElementById('e-gl-date').value;
    item.notes = document.getElementById('e-gl-notes').value.trim();
  }
  saveState(); renderAll(); closeEditModal(); toast('Saved ✓');
}

function closeEditModal(e) {
  const overlay = document.getElementById('edit-modal-overlay');
  if (!e || e.target === overlay) overlay.classList.remove('open');
}

function deleteItem(type, id) {
  state[type] = state[type].filter(i => i.id !== id);
  saveState(); renderAll();
}

// ── RENDER ALL ────────────────────────────────────────────────────────────────
function renderAll() {
  renderOverview(); renderIncome(); renderExpenses(); renderBudget();
  renderFixed(); renderGoals(); renderInvestments(); renderTravel(); renderCalendar(); renderPhotos();
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
function renderOverview() {
  const tm = thisMonth();
  const monthIncome = state.income.filter(i => getMonth(i.date) === tm).reduce((s,i) => s+i.amount, 0);
  const monthSpend = state.expenses.filter(i => getMonth(i.date) === tm).reduce((s,i) => s+i.amount, 0);
  const monthFixed = state.fixedExpenses.filter(i => i.status === 'active').reduce((s,i) => s+toMonthly(i.amount,i.freq), 0);
  const savings = monthIncome - monthSpend - monthFixed;
  const portfolio = state.investments.reduce((s,i) => s + i.shares * i.currentPrice, 0);

  document.getElementById('ov-income').textContent = fmt(monthIncome);
  document.getElementById('ov-spend').textContent = fmt(monthSpend);
  document.getElementById('ov-fixed').textContent = fmt(monthFixed);
  document.getElementById('ov-savings').textContent = fmt(savings);
  document.getElementById('ov-portfolio').textContent = fmt(portfolio);
  document.getElementById('sidebar-savings').textContent = fmt(savings);

  renderBarChart();
  renderDonutChart('donut-wrap', state.expenses.filter(i => getMonth(i.date) === tm), 'cat');
  if (insightState.enabled) {
    renderFinanceInsights(monthIncome, monthSpend, monthFixed, savings);
  } else {
    resetFinanceInsightPanels();
  }
  renderRecentTable();
}

function renderFinanceInsights(monthIncome, monthSpend, monthFixed, savings) {
  const aiEl = document.getElementById('ai-summary-block');
  const nextEl = document.getElementById('next-month-block');
  if (!aiEl || !nextEl) return;

  const monthExpenses = state.expenses.filter(i => getMonth(i.date) === thisMonth());
  const categoryTotals = {};
  monthExpenses.forEach((item) => {
    categoryTotals[item.cat] = (categoryTotals[item.cat] || 0) + item.amount;
  });
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];

  const expenseByMonth = {};
  state.expenses.forEach((item) => {
    const m = getMonth(item.date);
    expenseByMonth[m] = (expenseByMonth[m] || 0) + item.amount;
  });
  const monthKeys = Object.keys(expenseByMonth).sort();
  const currentMonthKey = thisMonth();
  const currentIndex = monthKeys.indexOf(currentMonthKey);
  const previousMonthSpend = currentIndex > 0 ? expenseByMonth[monthKeys[currentIndex - 1]] : null;
  const spendDeltaPct =
    previousMonthSpend && previousMonthSpend > 0
      ? ((monthSpend - previousMonthSpend) / previousMonthSpend) * 100
      : null;

  const recentVariableSpending = monthKeys
    .slice(-3)
    .map((m) => expenseByMonth[m])
    .filter((v) => Number.isFinite(v));
  const weightedVariableProjection = recentVariableSpending.length
    ? recentVariableSpending.reduce((sum, value, idx) => sum + value * (idx + 1), 0) /
      recentVariableSpending.reduce((sum, _value, idx) => sum + (idx + 1), 0)
    : 0;
  const projectedVariable = Math.round(weightedVariableProjection * 100) / 100;
  const projectedTotalOutflow = Math.round((projectedVariable + monthFixed) * 100) / 100;
  const projectedNet = Math.round((monthIncome - projectedTotalOutflow) * 100) / 100;

  const summaryLines = [
    `This month income is ${fmt(monthIncome)}, variable spending is ${fmt(monthSpend)}, and fixed monthly costs are ${fmt(monthFixed)}.`,
    `Estimated net savings after all spending: ${savings >= 0 ? '+' : '-'}${fmt(Math.abs(savings))}.`,
  ];
  if (topCategory) {
    summaryLines.push(`Top spending category: ${topCategory[0]} at ${fmt(topCategory[1])}.`);
  }
  if (spendDeltaPct !== null) {
    const trendWord = spendDeltaPct >= 0 ? 'up' : 'down';
    summaryLines.push(`Variable spending is ${trendWord} ${Math.abs(spendDeltaPct).toFixed(1)}% vs last month.`);
  }
  aiEl.textContent = summaryLines.join('\n');

  const confidence =
    recentVariableSpending.length >= 3 ? 'higher confidence' :
    recentVariableSpending.length === 2 ? 'medium confidence' :
    recentVariableSpending.length === 1 ? 'low confidence' : 'not enough data';

  const nextLines = [
    `Anticipated variable spending: ${fmt(projectedVariable)} (based on last ${recentVariableSpending.length || 0} month(s)).`,
    `Anticipated total outflow (variable + fixed): ${fmt(projectedTotalOutflow)}.`,
    `If income stays near ${fmt(monthIncome)}, anticipated next-month savings: ${projectedNet >= 0 ? '+' : '-'}${fmt(Math.abs(projectedNet))}.`,
    `Forecast confidence: ${confidence}.`,
  ];
  nextEl.textContent = nextLines.join('\n');
}

function renderBarChart() {
  const months = {};
  [...state.income.map(i=>i.date), ...state.expenses.map(i=>i.date)].forEach(d => { const m = getMonth(d); months[m] = months[m] || {inc:0,exp:0}; });
  state.income.forEach(i => { const m = getMonth(i.date); if(months[m]) months[m].inc += i.amount; });
  state.expenses.forEach(i => { const m = getMonth(i.date); if(months[m]) months[m].exp += i.amount; });
  const keys = Object.keys(months).sort().slice(-6);
  if (keys.length === 0) return;
  const maxVal = Math.max(...keys.map(k => Math.max(months[k].inc, months[k].exp)), 1);
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';
  keys.forEach(k => {
    const { inc, exp } = months[k];
    const [y, mo] = k.split('-');
    const label = new Date(y, mo-1, 1).toLocaleString('default',{month:'short'});
    const group = document.createElement('div');
    group.className = 'bar-group';
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    wrap.style.cssText = 'display:flex;gap:2px;align-items:flex-end;flex:1;width:100%;';
    const b1 = document.createElement('div');
    b1.className = 'bar bar-income';
    b1.style.cssText = `height:${Math.max(2,(inc/maxVal*100))}%;flex:1;`;
    b1.title = `Income: ${fmt(inc)}`;
    const b2 = document.createElement('div');
    b2.className = 'bar bar-expense';
    b2.style.cssText = `height:${Math.max(2,(exp/maxVal*100))}%;flex:1;`;
    b2.title = `Expense: ${fmt(exp)}`;
    wrap.append(b1, b2);
    const lbl = document.createElement('div');
    lbl.className = 'bar-label'; lbl.textContent = label;
    group.append(wrap, lbl);
    container.appendChild(group);
  });
}

function renderDonutChart(containerId, items, keyField) {
  const totals = {};
  items.forEach(i => { totals[i[keyField]] = (totals[i[keyField]]||0) + i.amount; });
  const entries = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const container = document.getElementById(containerId);
  if (!container) return;
  if (entries.length === 0) { container.innerHTML = '<div class="empty-state" style="width:100%;padding:16px 0;font-size:0.68rem;">No data yet</div>'; return; }
  const total = entries.reduce((s,[,v]) => s+v, 0);
  const colors = ['#7a9aaa','#5c2d1e','#c9a080','#8b2035','#d4b090','#4a7060','#a06828','#b07890','#6a8a6a','#8a6050'];
  container.innerHTML = '';
  const size = 120, r = 44, cx = 60, cy = 60;
  let svgPath = ''; let startAngle = -90;
  entries.forEach(([key, val], idx) => {
    const pct = val/total, angle = pct*360, endAngle = startAngle+angle;
    const rad1 = startAngle*Math.PI/180, rad2 = endAngle*Math.PI/180;
    const x1 = cx+r*Math.cos(rad1), y1 = cy+r*Math.sin(rad1);
    const x2 = cx+r*Math.cos(rad2), y2 = cy+r*Math.sin(rad2);
    const large = angle > 180 ? 1 : 0;
    svgPath += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[idx%colors.length]}" opacity="0.85"/>`;
    startAngle = endAngle;
  });
  svgPath += `<circle cx="${cx}" cy="${cy}" r="26" fill="var(--surface)"/>`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.innerHTML = svgPath;
  container.appendChild(svg);
  const legend = document.createElement('div');
  legend.className = 'donut-legend';
  entries.slice(0,7).forEach(([key, val], idx) => {
    const pct = Math.round(val/total*100);
    legend.innerHTML += `<div class="legend-item"><div class="legend-dot" style="background:${colors[idx%colors.length]};"></div><div class="legend-name">${key}</div><div class="legend-pct">${pct}%</div></div>`;
  });
  container.appendChild(legend);
}

function renderRecentTable() {
  const all = [...state.income.map(i => ({...i,type:'income'})), ...state.expenses.map(i => ({...i,type:'expense'}))].sort((a,b) => b.date.localeCompare(a.date)).slice(0,8);
  const tbody = document.getElementById('recent-tbody');
  if (all.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No transactions yet</td></tr>'; return; }
  tbody.innerHTML = all.map(item => `<tr>
    <td style="color:var(--muted)">${item.date}</td>
    <td>${item.notes || item.desc || item.cat}</td>
    <td><span class="badge ${item.type==='income'?'badge-green':'badge-red'}">${item.cat}</span></td>
    <td class="${item.type==='income'?'amount-pos':'amount-neg'}">${item.type==='income'?'+':'-'}${fmt(item.amount)}</td>
  </tr>`).join('');
}

// ── INCOME ────────────────────────────────────────────────────────────────────
function renderIncome() {
  const tm = thisMonth(), ty = thisYear();
  const monthInc = state.income.filter(i=>getMonth(i.date)===tm).reduce((s,i)=>s+i.amount,0);
  const yearInc = state.income.filter(i=>i.date.startsWith(ty)).reduce((s,i)=>s+i.amount,0);
  const months = new Set(state.income.map(i=>getMonth(i.date))).size;
  document.getElementById('inc-month').textContent = fmt(monthInc);
  document.getElementById('inc-year').textContent = fmt(yearInc);
  document.getElementById('inc-avg').textContent = fmt(months > 0 ? yearInc/months : 0);
  document.getElementById('inc-sources').textContent = new Set(state.income.map(i=>i.cat)).size;
  const sorted = [...state.income].sort((a,b)=>b.date.localeCompare(a.date));
  const tbody = document.getElementById('income-tbody');
  if (sorted.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No income recorded</td></tr>'; return; }
  tbody.innerHTML = sorted.map(i => `<tr onclick="openEditModal('income',${i.id})">
    <td style="color:var(--muted)">${i.date}</td><td>${i.notes||i.desc||''}</td>
    <td><span class="badge badge-green">${i.cat}</span></td>
    <td class="amount-pos">+${fmt(i.amount)}</td>
    <td><button class="del-btn" onclick="event.stopPropagation();deleteItem('income',${i.id})">✕</button></td>
  </tr>`).join('');
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────
function renderExpenses() {
  const tm = thisMonth(), ty = thisYear();
  const monthExp = state.expenses.filter(i=>getMonth(i.date)===tm).reduce((s,i)=>s+i.amount,0);
  const yearExp = state.expenses.filter(i=>i.date.startsWith(ty)).reduce((s,i)=>s+i.amount,0);
  const months = new Set(state.expenses.map(i=>getMonth(i.date))).size;
  document.getElementById('exp-month').textContent = fmt(monthExp);
  document.getElementById('exp-year').textContent = fmt(yearExp);
  document.getElementById('exp-avg').textContent = fmt(months > 0 ? yearExp/months : 0);
  document.getElementById('exp-count').textContent = state.expenses.length;
  const search = (document.getElementById('search-exp')?.value||'').toLowerCase();
  const filterCat = document.getElementById('filter-cat')?.value||'';
  let filtered = [...state.expenses].sort((a,b)=>b.date.localeCompare(a.date));
  if (search) filtered = filtered.filter(i=>(i.notes||i.desc||'').toLowerCase().includes(search)||i.cat.toLowerCase().includes(search));
  if (filterCat) filtered = filtered.filter(i=>i.cat===filterCat);
  const tbody = document.getElementById('expense-tbody');
  if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses found</td></tr>'; return; }
  tbody.innerHTML = filtered.map(i => `<tr onclick="openEditModal('expenses',${i.id})">
    <td style="color:var(--muted)">${i.date}</td><td>${i.notes||i.desc||''}</td>
    <td><span class="badge badge-red">${i.cat}</span></td>
    <td class="amount-neg">-${fmt(i.amount)}</td>
    <td><button class="del-btn" onclick="event.stopPropagation();deleteItem('expenses',${i.id})">✕</button></td>
  </tr>`).join('');
}

// ── BUDGET ────────────────────────────────────────────────────────────────────
function renderBudget() {
  const tm = thisMonth();
  const catSpend = {};
  state.expenses.filter(i=>getMonth(i.date)===tm).forEach(i=>{ catSpend[i.cat]=(catSpend[i.cat]||0)+i.amount; });
  const budgetCats = Object.keys(state.budgets);
  const totalBudget = budgetCats.reduce((s,c)=>s+state.budgets[c],0);
  const totalSpent = budgetCats.reduce((s,c)=>s+(catSpend[c]||0),0);
  document.getElementById('bud-total').textContent = fmt(totalBudget);
  document.getElementById('bud-spent').textContent = fmt(totalSpent);
  document.getElementById('bud-remaining').textContent = fmt(Math.max(0,totalBudget-totalSpent));
  document.getElementById('bud-cats').textContent = budgetCats.length;
  const container = document.getElementById('budget-progress');
  if (budgetCats.length === 0) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">◻</div>No budgets set yet</div>'; return; }
  container.innerHTML = budgetCats.map(cat => {
    const spent = catSpend[cat]||0, limit = state.budgets[cat];
    const pct = Math.min(100, Math.round(spent/limit*100));
    const color = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--green)';
    return `<div class="progress-wrap">
      <div class="progress-info"><span class="progress-name">${cat}</span><span class="progress-vals">${fmt(spent)} / ${fmt(limit)} ${spent>limit?'<span style="color:var(--red);font-size:0.58rem;">OVER</span>':''}</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;background:${color};"></div></div>
    </div>
    <button class="btn btn-danger btn-sm" style="margin-bottom:14px;" onclick="deleteBudget('${cat}')">Remove ${cat}</button>`;
  }).join('');
}

// ── FIXED EXPENSES ────────────────────────────────────────────────────────────
function renderFixed() {
  const active = state.fixedExpenses.filter(i => i.status === 'active');
  const monthly = active.reduce((s,i) => s+toMonthly(i.amount,i.freq), 0);
  const tm = thisMonth();
  const monthInc = state.income.filter(i=>getMonth(i.date)===tm).reduce((s,i)=>s+i.amount,0);
  const pct = monthInc > 0 ? Math.round(monthly/monthInc*100) : 0;
  document.getElementById('fx-monthly').textContent = fmt(monthly);
  document.getElementById('fx-annual').textContent = fmt(monthly*12);
  document.getElementById('fx-pct').textContent = pct + '%';
  document.getElementById('fx-count').textContent = active.length;

  // Due list
  const today = new Date().getDate();
  const dueList = document.getElementById('fx-due-list');
  const dueItems = state.fixedExpenses.filter(i=>i.status==='active'&&i.due).sort((a,b)=>a.due-b.due);
  if (dueItems.length === 0) { dueList.innerHTML = '<div class="empty-state"><div class="empty-icon">⊟</div>No due dates set</div>'; }
  else {
    dueList.innerHTML = dueItems.map(i => {
      const daysUntil = i.due - today;
      const badge = i.due === today ? `<span class="badge badge-yellow">Today</span>`
        : i.due < today ? `<span class="badge badge-red">Day ${i.due}</span>`
        : daysUntil <= 5 ? `<span class="badge badge-yellow">In ${daysUntil}d</span>`
        : `<span class="badge badge-blue">Day ${i.due}</span>`;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);">
        <div><div style="font-size:0.78rem;">${FX_ICONS[i.cat]||''} ${i.subcat||i.name}</div><div style="font-size:0.6rem;color:var(--muted);margin-top:2px;">${i.cat}</div></div>
        <div style="display:flex;align-items:center;gap:8px;">${badge}<div class="amount-neg" style="font-size:0.82rem;">${fmt(toMonthly(i.amount,i.freq))}</div></div>
      </div>`;
    }).join('');
  }

  // Donut
  const catTotals = {};
  active.forEach(i => { const m=toMonthly(i.amount,i.freq); catTotals[i.cat]=(catTotals[i.cat]||0)+m; });
  const entries = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const totalM = entries.reduce((s,[,v])=>s+v,0);
  const fxDonut = document.getElementById('fx-donut');
  if (entries.length === 0) { fxDonut.innerHTML = '<div class="empty-state" style="width:100%;">No data yet</div>'; }
  else {
    fxDonut.innerHTML = '';
    const size=120,r=44,cx=60,cy=60; let svgPath='',startAngle=-90;
    entries.forEach(([cat,val]) => {
      const color=FX_COLORS[cat]||'#8a8a8a',pctA=val/totalM,angle=pctA*360,endAngle=startAngle+angle;
      const rad1=startAngle*Math.PI/180,rad2=endAngle*Math.PI/180;
      const x1=cx+r*Math.cos(rad1),y1=cy+r*Math.sin(rad1),x2=cx+r*Math.cos(rad2),y2=cy+r*Math.sin(rad2);
      svgPath+=`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${angle>180?1:0} 1 ${x2} ${y2} Z" fill="${color}" opacity="0.85"/>`;
      startAngle=endAngle;
    });
    svgPath+=`<circle cx="${cx}" cy="${cy}" r="26" fill="var(--surface)"/>`;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',size);svg.setAttribute('height',size);svg.innerHTML=svgPath;
    fxDonut.appendChild(svg);
    const leg=document.createElement('div');leg.className='donut-legend';
    entries.forEach(([cat,val]) => {
      const p=Math.round(val/totalM*100),color=FX_COLORS[cat]||'#8a8a8a';
      leg.innerHTML+=`<div class="legend-item"><div class="legend-dot" style="background:${color};"></div><div class="legend-name">${FX_ICONS[cat]||''} ${cat}</div><div class="legend-pct">${p}% · ${fmt(val)}/mo</div></div>`;
    });
    fxDonut.appendChild(leg);
  }

  // Grouped list
  const grouped = document.getElementById('fx-grouped-list');
  const freqLabels = {monthly:'Monthly',weekly:'Weekly',quarterly:'Quarterly',annually:'Annually'};
  grouped.innerHTML = Object.keys(FX_SUBCATS).map(cat => {
    const items = state.fixedExpenses.filter(i=>i.cat===cat);
    const catMonthly = items.filter(i=>i.status==='active').reduce((s,i)=>s+toMonthly(i.amount,i.freq),0);
    const color = FX_COLORS[cat]||'#8a8a8a';
    return `<div class="panel" style="margin-bottom:14px;">
      <div class="panel-header" style="border-left:3px solid ${color};">
        <div style="display:flex;align-items:center;gap:8px;"><span>${FX_ICONS[cat]||''}</span><div class="panel-title">${cat}</div></div>
        <span style="font-size:0.75rem;color:var(--red);">${fmt(catMonthly)}/mo</span>
      </div>
      <div class="panel-body" style="padding:0;">
        <table class="data-table"><thead><tr><th>Name</th><th>Frequency</th><th>Due</th><th>Amount</th><th>Monthly</th><th>Status</th><th></th></tr></thead>
        <tbody>
        ${items.length === 0 ? `<tr><td colspan="7" class="empty-state" style="padding:18px;">No ${cat} expenses</td></tr>` : items.map(i => {
          const mc = toMonthly(i.amount,i.freq);
          return `<tr onclick="openEditModal('fixed',${i.id})">
            <td><div style="font-weight:400;">${i.subcat||i.name}</div>${i.name&&i.name!==i.subcat?`<div style="font-size:0.6rem;color:var(--muted);">${i.name}</div>`:''}</td>
            <td style="font-size:0.7rem;color:var(--muted);">${freqLabels[i.freq]}</td>
            <td style="font-size:0.72rem;color:var(--muted);">${i.due?`Day ${i.due}`:'—'}</td>
            <td style="font-size:0.75rem;">${fmt(i.amount)}</td>
            <td class="amount-neg">${fmt(mc)}</td>
            <td><span class="badge ${i.status==='active'?'badge-green':'badge-yellow'}">${i.status}</span></td>
            <td style="display:flex;gap:3px;">
              <button class="del-btn" onclick="event.stopPropagation();toggleFixedStatus(${i.id})" style="color:var(--yellow);" title="Toggle">⏸</button>
              <button class="del-btn" onclick="event.stopPropagation();deleteFixed(${i.id})">✕</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody></table>
      </div>
    </div>`;
  }).join('');
}

// ── GOALS ─────────────────────────────────────────────────────────────────────
function renderGoals() {
  const total = state.goals.length;
  const target = state.goals.reduce((s,g)=>s+g.target,0);
  const saved = state.goals.reduce((s,g)=>s+g.saved,0);
  const done = state.goals.filter(g=>g.saved>=g.target).length;
  document.getElementById('gl-count').textContent = total;
  document.getElementById('gl-target').textContent = fmt(target);
  document.getElementById('gl-saved').textContent = fmt(saved);
  document.getElementById('gl-done').textContent = done;
  const container = document.getElementById('goals-list');
  if (state.goals.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:40px;"><div class="empty-icon">◎</div>No savings goals yet — add your first goal!</div>'; return; }
  container.innerHTML = state.goals.map(g => {
    const pct = Math.min(100, Math.round(g.saved/g.target*100));
    const remaining = Math.max(0, g.target - g.saved);
    const color = pct >= 100 ? 'var(--green)' : pct >= 75 ? 'var(--accent2)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    const daysLeft = g.date ? Math.ceil((new Date(g.date) - new Date()) / 86400000) : null;
    return `<div class="goal-card">
      <div class="goal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.5rem;">${g.emoji||'🎯'}</span>
          <div>
            <div class="goal-name">${g.name}</div>
            ${g.date ? `<div style="font-size:0.6rem;color:var(--muted);">${g.date}${daysLeft !== null ? ` · ${daysLeft > 0 ? daysLeft+' days left' : 'Past due'}` : ''}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="goal-pct" style="color:${color};">${pct}%</div>
          <button class="del-btn" onclick="openEditModal('goals',${g.id})" style="color:var(--muted);">✎</button>
          <button class="del-btn" onclick="deleteGoal(${g.id})">✕</button>
        </div>
      </div>
      <div class="progress-info"><span style="color:var(--muted);font-size:0.7rem;">Saved: ${fmt(g.saved)}</span><span style="color:var(--muted);font-size:0.7rem;">Target: ${fmt(g.target)}</span></div>
      <div class="progress-bar-bg" style="height:8px;margin-bottom:10px;"><div class="progress-bar-fill" style="width:${pct}%;background:${color};"></div></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-ghost btn-sm" onclick="updateGoalSaved(${g.id},-100)">-$100</button>
        <button class="btn btn-ghost btn-sm" onclick="updateGoalSaved(${g.id},-50)">-$50</button>
        <button class="btn btn-primary btn-sm" onclick="updateGoalSaved(${g.id},50)">+$50</button>
        <button class="btn btn-primary btn-sm" onclick="updateGoalSaved(${g.id},100)">+$100</button>
        <button class="btn btn-primary btn-sm" onclick="updateGoalSaved(${g.id},500)">+$500</button>
        ${pct >= 100 ? '<span class="badge badge-green" style="margin-left:4px;">✓ Completed!</span>' : `<span style="font-size:0.68rem;color:var(--muted);">${fmt(remaining)} to go</span>`}
      </div>
      ${g.notes ? `<div style="font-size:0.65rem;color:var(--muted);margin-top:8px;font-style:italic;">${g.notes}</div>` : ''}
    </div>`;
  }).join('');
}

// ── INVESTMENTS ───────────────────────────────────────────────────────────────
function renderInvestments() {
  const invs = state.investments;
  const totalCurrent = invs.reduce((s,i)=>s+i.shares*i.currentPrice,0);
  const totalCost = invs.reduce((s,i)=>s+i.shares*i.buyPrice,0);
  const gain = totalCurrent - totalCost;
  const pct = totalCost > 0 ? (gain/totalCost*100) : 0;
  document.getElementById('inv-total').textContent = fmt(totalCurrent);
  const gainEl = document.getElementById('inv-gain');
  gainEl.textContent = (gain>=0?'+':'-') + fmt(Math.abs(gain));
  gainEl.className = 'stat-value ' + (gain>=0?'green':'red');
  const pctEl = document.getElementById('inv-pct');
  pctEl.textContent = (pct>=0?'+':'') + pct.toFixed(2) + '%';
  pctEl.className = 'stat-value ' + (pct>=0?'green':'red');
  document.getElementById('inv-positions').textContent = invs.length;
  const grid = document.getElementById('inv-grid');
  if (invs.length === 0) { grid.innerHTML = '<div class="panel" style="grid-column:1/-1;"><div class="empty-state" style="padding:40px;"><div class="empty-icon">◈</div>No investments yet</div></div>'; return; }
  const typeBadge = {Stock:'badge-blue',ETF:'badge-yellow',Crypto:'badge-red',Bond:'badge-green','Real Estate':'badge-blue',Other:'badge-rose'};
  grid.innerHTML = invs.map(inv => {
    const currentVal = inv.shares*inv.currentPrice;
    const costBasis = inv.shares*inv.buyPrice;
    const g = currentVal - costBasis;
    const gPct = (g/costBasis*100);
    return `<div class="inv-card" onclick="openEditModal('investments',${inv.id})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div><div class="inv-ticker">${inv.ticker}</div><div class="inv-name">${inv.name}${inv.account?` · ${inv.account}`:''}</div></div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
          <span class="badge ${typeBadge[inv.type]||'badge-blue'}">${inv.type}</span>
          <button class="del-btn" onclick="event.stopPropagation();deleteItem('investments',${inv.id})">✕</button>
        </div>
      </div>
      <div class="inv-row"><span class="inv-row-label">Shares</span><span>${inv.shares}</span></div>
      <div class="inv-row"><span class="inv-row-label">Buy Price</span><span>${fmt(inv.buyPrice)}</span></div>
      <div class="inv-row"><span class="inv-row-label">Current Price</span><span>${fmt(inv.currentPrice)}</span></div>
      <div class="inv-row"><span class="inv-row-label">Value</span><span>${fmt(currentVal)}</span></div>
      <div class="inv-gain ${g>=0?'amount-pos':'amount-neg'}">${g>=0?'+':'-'}${fmt(Math.abs(g))} (${gPct>=0?'+':''}${gPct.toFixed(2)}%)</div>
    </div>`;
  }).join('');

  // Donut by type
  const byType = {};
  invs.forEach(i => { const v=i.shares*i.currentPrice; byType[i.type]=(byType[i.type]||0)+v; });
  const entries = Object.entries(byType);
  const totalV = entries.reduce((s,[,v])=>s+v,0);
  const donut = document.getElementById('inv-donut');
  if (totalV === 0) { donut.innerHTML = '<div class="empty-state" style="width:100%;">No data yet</div>'; return; }
  const colors = ['#7a9aaa','#5c2d1e','#8b2035','#c9a080','#a06828','#4a7060'];
  donut.innerHTML = '';
  const size=120,r=44,cx=60,cy=60;let svgPath='',startAngle=-90;
  entries.forEach(([type,val],idx)=>{
    const pctA=val/totalV,angle=pctA*360,endAngle=startAngle+angle;
    const rad1=startAngle*Math.PI/180,rad2=endAngle*Math.PI/180;
    const x1=cx+r*Math.cos(rad1),y1=cy+r*Math.sin(rad1),x2=cx+r*Math.cos(rad2),y2=cy+r*Math.sin(rad2);
    svgPath+=`<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${angle>180?1:0} 1 ${x2} ${y2} Z" fill="${colors[idx%colors.length]}" opacity="0.85"/>`;
    startAngle=endAngle;
  });
  svgPath+=`<circle cx="${cx}" cy="${cy}" r="26" fill="var(--surface)"/>`;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width',size);svg.setAttribute('height',size);svg.innerHTML=svgPath;
  donut.appendChild(svg);
  const leg=document.createElement('div');leg.className='donut-legend';
  entries.forEach(([type,val],idx)=>{
    const p=Math.round(val/totalV*100);
    leg.innerHTML+=`<div class="legend-item"><div class="legend-dot" style="background:${colors[idx%colors.length]};"></div><div class="legend-name">${type}</div><div class="legend-pct">${p}% — ${fmt(val)}</div></div>`;
  });
  donut.appendChild(leg);
}

// ── TRAVEL ────────────────────────────────────────────────────────────────────
const TRIP_BG = { planned:'linear-gradient(135deg,#7a9aaa,#5c7a8a)', upcoming:'linear-gradient(135deg,#c9a060,#a06828)', completed:'linear-gradient(135deg,#6a9060,#4a7040)' };

function renderTravel() {
  document.getElementById('tr-total').textContent = state.trips.length;
  document.getElementById('tr-upcoming').textContent = state.trips.filter(t=>t.status==='upcoming').length;
  document.getElementById('tr-completed').textContent = state.trips.filter(t=>t.status==='completed').length;
  document.getElementById('tr-planned').textContent = state.trips.filter(t=>t.status==='planned').length;
  const grid = document.getElementById('trip-grid');
  if (state.trips.length === 0) { grid.innerHTML = '<div class="panel" style="grid-column:1/-1;"><div class="empty-state" style="padding:40px;"><div class="empty-icon">✈</div>No trips yet — start planning!</div></div>'; return; }
  const sorted = [...state.trips].sort((a,b)=>({upcoming:0,planned:1,completed:2}[a.status]||0)-({upcoming:0,planned:1,completed:2}[b.status]||0)||((a.start||'').localeCompare(b.start||'')));
  const statusLabel = {planned:'Dream Trip',upcoming:'Booked ✓',completed:'Visited ✓'};
  const statusBadge = {planned:'badge-blue',upcoming:'badge-yellow',completed:'badge-green'};
  grid.innerHTML = sorted.map(t => {
    const nights = t.start && t.end ? Math.round((new Date(t.end)-new Date(t.start))/86400000) : null;
    return `<div class="trip-card trip-status-${t.status}" onclick="openEditModal('trips',${t.id})">
      <div class="trip-card-banner" style="background:${TRIP_BG[t.status]};"><span style="font-size:3rem;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.2));">${t.emoji}</span></div>
      <div class="trip-card-body">
        <div class="trip-card-title">${t.dest}${t.country?`, ${t.country}`:''}</div>
        <div class="trip-card-dates">${t.start?t.start+(t.end?` → ${t.end}`:''):'Dates TBD'}${nights?` · ${nights} nights`:''}</div>
        <div class="trip-card-meta">
          <span class="badge ${statusBadge[t.status]}">${statusLabel[t.status]}</span>
          ${t.budget?`<span class="badge badge-blue">${fmt(t.budget)}</span>`:''}
          ${t.hotel?`<span class="badge badge-yellow" style="font-size:0.56rem;">🏨 ${t.hotel}</span>`:''}
        </div>
        ${t.notes?`<div style="font-size:0.65rem;color:var(--muted);margin-top:8px;line-height:1.5;">${t.notes}</div>`:''}
        <div style="margin-top:10px;"><button class="del-btn" onclick="event.stopPropagation();deleteTrip(${t.id})">✕ Remove</button></div>
      </div>
    </div>`;
  }).join('');
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
const EV_COLORS = { personal:'#c9a060', travel:'#7a9aaa', health:'#8b2035', finance:'#5a7840', social:'#7a6aaa', anniversary:'#c9909a', work:'#8a7060' };
const EV_EMOJI = { personal:'💛', travel:'✈️', health:'❤️', finance:'💚', social:'💙', anniversary:'🩷', work:'🤍' };

function calPrev() { calMonth--; if (calMonth<0){calMonth=11;calYear--;} renderCalendar(); }
function calNext() { calMonth++; if (calMonth>11){calMonth=0;calYear++;} renderCalendar(); }

function renderCalendar() {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-title').textContent = `${MONTHS[calMonth]} ${calYear}`;
  const today = new Date();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const grid = document.getElementById('cal-grid');
  const evByDate = {};
  state.events.forEach(e => { evByDate[e.date] = evByDate[e.date] || []; evByDate[e.date].push(e); });
  let html = '';
  for (let i=firstDay-1; i>=0; i--) html += `<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev-i}</span></div>`;
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
    const evs = evByDate[dateStr]||[];
    const dots = evs.slice(0,3).map(e=>`<div class="cal-dot" style="background:${EV_COLORS[e.cat]||'#8a7060'};"></div>`).join('');
    html += `<div class="cal-day ${isToday?'today':''}" onclick="calDayClick('${dateStr}')">
      <span class="cal-day-num">${d}</span>
      <div class="cal-dots">${dots}</div>
      ${evs[0]?`<div class="cal-pill" style="background:${EV_COLORS[evs[0].cat]}22;color:${EV_COLORS[evs[0].cat]};">${evs[0].title}</div>`:''}
    </div>`;
  }
  const total = firstDay + daysInMonth;
  const rem = total%7===0?0:7-(total%7);
  for (let i=1; i<=rem; i++) html += `<div class="cal-day other-month"><span class="cal-day-num">${i}</span></div>`;
  grid.innerHTML = html;

  // Upcoming events
  const upcoming = [...state.events].filter(e=>e.date>=todayStr()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,10);
  const upEl = document.getElementById('upcoming-events');
  if (upcoming.length === 0) { upEl.innerHTML = '<div class="empty-state">No upcoming events</div>'; return; }
  upEl.innerHTML = upcoming.map(e => {
    const color = EV_COLORS[e.cat]||'#8a7060';
    return `<div class="event-item" onclick="openEditModal('events',${e.id})">
      <div class="ev-dot" style="background:${color};"></div>
      <div style="flex:1;">
        <div class="event-title">${EV_EMOJI[e.cat]||''} ${e.title}</div>
        <div class="event-meta">${e.date}${e.time?' · '+e.time:''}${e.notes?' · '+e.notes:''}</div>
      </div>
      <button class="del-btn" onclick="event.stopPropagation();deleteEvent(${e.id})">✕</button>
    </div>`;
  }).join('');
}

function calDayClick(dateStr) {
  document.getElementById('ev-date').value = dateStr;
  document.getElementById('ev-title').focus();
}

// ── PHOTOS ────────────────────────────────────────────────────────────────────
let activeAlbum = 'all';

function handlePhotoUpload(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.photos.push({ id: Date.now()+Math.random(), src: e.target.result, name: file.name.replace(/\.[^/.]+$/,''), date: todayStr(), album: activeAlbum==='all'?(state.albums[0]?.id||null):activeAlbum });
      saveState(); renderPhotoGrid();
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function deletePhoto(id) { state.photos = state.photos.filter(p => p.id !== id); saveState(); renderPhotoGrid(); }

function filterAlbum(albumId, btn) {
  activeAlbum = albumId;
  document.querySelectorAll('.album-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderPhotoGrid();
}

function renderPhotos() {
  const albumListEl = document.getElementById('album-list');
  if (state.albums.length === 0) { albumListEl.innerHTML = '<div class="empty-state"><div class="empty-icon">❋</div>No albums yet</div>'; }
  else {
    albumListEl.innerHTML = state.albums.map(a => {
      const count = state.photos.filter(p=>p.album==a.id).length;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="cursor:pointer;flex:1;" onclick="filterAlbum(${a.id},document.querySelector('[data-album=\\'${a.id}\\']'))">
          <div style="font-size:0.78rem;">📁 ${a.name}</div>
          <div style="font-size:0.6rem;color:var(--muted);margin-top:2px;">${a.date||''} · ${count} photo${count!==1?'s':''}</div>
        </div>
        <button class="del-btn" onclick="deleteAlbum(${a.id})">✕</button>
      </div>`;
    }).join('');
  }
  const tabsEl = document.getElementById('album-tabs');
  tabsEl.innerHTML = `<button class="album-tab ${activeAlbum==='all'?'active':''}" onclick="filterAlbum('all',this)">All Photos</button>`;
  state.albums.forEach(a => { tabsEl.innerHTML += `<button class="album-tab ${activeAlbum==a.id?'active':''}" data-album="${a.id}" onclick="filterAlbum(${a.id},this)">${a.name}</button>`; });
  renderPhotoGrid();
}

function renderPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  let photos = activeAlbum==='all' ? state.photos : state.photos.filter(p=>p.album==activeAlbum);
  if (photos.length === 0) { grid.innerHTML = `<div style="grid-column:1/-1;"><div class="empty-state" style="padding:50px;"><div class="empty-icon">🌸</div>${activeAlbum==='all'?'Your memories will live here — add your first photo!':'No photos in this album yet'}</div></div>`; return; }
  grid.innerHTML = photos.map(p => `<div class="photo-item">
    <img class="photo-img" src="${p.src}" alt="${p.name}">
    <div class="photo-overlay"><button class="photo-overlay-btn" onclick="deletePhoto(${p.id})" title="Delete">🗑</button></div>
    <div class="photo-caption"><div class="photo-caption-title">${p.name}</div><div class="photo-caption-date">${p.date}</div></div>
  </div>`).join('');
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportData() {
  // Exclude large photo data from export for size
  const exportData = { ...state, photos: state.photos.map(p => ({...p, src: '[photo data excluded]'})) };
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'joey-renee-planner.json';
  a.click();
  toast('Export complete ✓');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = todayStr();
  document.getElementById('inc-date').value = today;
  document.getElementById('exp-date').value = today;
  document.getElementById('inv-date').value = today;
  document.getElementById('ev-date').value = today;
  document.getElementById('alb-date').value = today;
  updateSubcats('fx');
  refreshInsightsButtonState();
  // Drag and drop photos
  const uploadZone = document.querySelector('.upload-zone');
  if (uploadZone) {
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)'; });
    uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
    uploadZone.addEventListener('drop', e => {
      e.preventDefault(); uploadZone.style.borderColor = '';
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => { state.photos.push({ id: Date.now()+Math.random(), src: ev.target.result, name: file.name.replace(/\.[^/.]+$/,''), date: todayStr(), album: state.albums[0]?.id||null }); saveState(); renderPhotoGrid(); };
        reader.readAsDataURL(file);
      });
    });
  }
});
