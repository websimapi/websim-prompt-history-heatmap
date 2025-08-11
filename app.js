// Prompt History Heatmap + Background Leaderboard Aggregator

import { WebsimSocket } from '@websim/websim-socket';

const heatmapEl = document.getElementById('heatmap');
const tooltipEl = document.getElementById('tooltip');
const statusEl = document.getElementById('load-status');
const pageCountEl = document.getElementById('page-count');
const statTotalEl = document.getElementById('stat-total');
const statStreakEl = document.getElementById('stat-streak');
const statBestEl = document.getElementById('stat-best');
const statAvgEl = document.getElementById('stat-avg');
const yearSelect = document.getElementById('year-select');

const creatorImg = document.getElementById('creator-img');
const creatorName = document.getElementById('creator-name');
const creatorAvatarLink = document.getElementById('creator-avatar');
const creatorSub = document.getElementById('creator-sub');

const leaderboardEl = document.getElementById('leaderboard');

// DB socket (vanilla)
const room = new WebsimSocket();

// State
const state = {
  creator: null,
  countsByDay: new Map(), // key: 'YYYY-MM-DD' value: count
  minDate: null,
  maxDate: null,
  fetchedPages: 0,
  totalCount: 0,
  view: 'year', // 'year' | 'month' | 'week'
  year: new Date().getFullYear(),
  backgroundLoopRunning: false,
};

// Utility: format YYYY-MM-DD
const toKey = (d) => d.toISOString().slice(0, 10);

// Utility: parse date string (ISO) into Date at local midnight for grid by weekday
function toUTCDate(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Compute levels 0-4 given count
function levelForCount(c) {
  if (c <= 0) return 0;
  if (c === 1) return 1;
  if (c <= 3) return 2;
  if (c <= 6) return 3;
  return 4;
}

function fmtNum(n) {
  return Intl.NumberFormat().format(n);
}

function dayDiff(a, b) {
  const MS = 24 * 3600 * 1000;
  return Math.round((b - a) / MS);
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function startOfWeek(d) {
  const day = d.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // make Monday 0
  const res = new Date(d);
  res.setDate(d.getDate() - diff);
  res.setHours(0,0,0,0);
  return res;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(year) {
  return new Date(year, 0, 1);
}

function endOfYear(year) {
  return new Date(year, 11, 31);
}

function monthLabelsForYear(year) {
  const labels = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(year, m, 1);
    labels.push(d.toLocaleString(undefined, { month: 'short' }));
  }
  return labels;
}

function updateCreatorUI(user) {
  const profileUrl = `https://websim.com/@${user.username}`;
  creatorName.textContent = `@${user.username}`;
  creatorName.href = profileUrl;
  creatorAvatarLink.href = profileUrl;
  creatorImg.src = user.avatar_url || `https://images.websim.com/avatar/${user.username}`;
  creatorImg.alt = `${user.username} avatar`;
  creatorSub.textContent = `Prompt activity overview`;
}

function computeStats() {
  // total prompts
  let total = 0;
  let minDate = null;
  let maxDate = null;
  for (const [k, v] of state.countsByDay) {
    total += v;
    const d = new Date(k);
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  state.totalCount = total;
  state.minDate = minDate;
  state.maxDate = maxDate;

  // streaks
  const sortedKeys = Array.from(state.countsByDay.keys()).sort();
  const active = new Set(sortedKeys.filter(k => state.countsByDay.get(k) > 0));

  const today = new Date();
  let currentStreak = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (true) {
    const key = toKey(cursor);
    if (active.has(key)) currentStreak++;
    else break;
    cursor = addDays(cursor, -1);
  }

  // best streak
  let bestStreak = 0;
  const rangeStart = state.minDate ? new Date(state.minDate) : addDays(today, -365);
  const rangeEnd = state.maxDate ? new Date(state.maxDate) : today;
  let s = 0;
  for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) {
    const k = toKey(d);
    if (active.has(k)) {
      s++;
      bestStreak = Math.max(bestStreak, s);
    } else {
      s = 0;
    }
  }

  // average per day over observed span
  const daySpan = Math.max(1, dayDiff(rangeStart, rangeEnd) + 1);
  const avg = total / daySpan;

  return {
    total,
    currentStreak,
    bestStreak,
    avg,
  };
}

function updateStatsUI() {
  const { total, currentStreak, bestStreak, avg } = computeStats();
  statTotalEl.textContent = fmtNum(total);
  statStreakEl.textContent = `${currentStreak} days`;
  statBestEl.textContent = `${bestStreak} days`;
  statAvgEl.textContent = avg < 10 ? avg.toFixed(2) : fmtNum(Math.round(avg));
}

function buildYearHeatmap(year) {
  heatmapEl.innerHTML = '';

  const start = startOfWeek(startOfYear(year)); // align to Monday
  const end = endOfYear(year);
  const totalDays = dayDiff(start, end) + 1;
  const weeks = Math.ceil(totalDays / 7);

  // Build columns (weeks)
  const monthLabelRow = document.createElement('div');
  monthLabelRow.className = 'hm-month-labels';
  const monthPositions = new Map(); // month index -> first column index

  for (let w = 0; w < weeks; w++) {
    const weekCol = document.createElement('div');
    weekCol.className = 'hm-week';

    for (let r = 0; r < 7; r++) {
      const cellDate = addDays(start, w * 7 + r);
      const inYear = cellDate.getFullYear() === year;
      const k = toKey(cellDate);
      const count = state.countsByDay.get(k) || 0;
      const lvl = inYear ? levelForCount(count) : 0;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'hm-day';
      cell.tabIndex = inYear ? 0 : -1;
      cell.dataset.level = lvl;
      cell.dataset.date = k;
      cell.title = `${count} prompt${count === 1 ? '' : 's'} on ${cellDate.toLocaleDateString()}`;
      cell.setAttribute('aria-label', cell.title);

      attachTooltipHandlers(cell, count, cellDate);
      weekCol.appendChild(cell);
    }

    // month labels: mark the first week that contains each month
    const colStartDate = addDays(start, w * 7);
    if (!monthPositions.has(colStartDate.getMonth()) && colStartDate.getFullYear() === year) {
      monthPositions.set(colStartDate.getMonth(), w);
    }

    heatmapEl.appendChild(weekCol);
  }

  // month labels
  // Insert short label at their first week column
  for (const [month, col] of monthPositions.entries()) {
    const span = document.createElement('div');
    span.className = 'label';
    span.style.gridColumnStart = String(col + 1);
    span.style.setProperty('--col-start', col + 1);
    span.textContent = new Date(year, month, 1).toLocaleString(undefined, { month: 'short' });
    monthLabelRow.appendChild(span);
  }
  heatmapEl.parentElement.appendChild(monthLabelRow);
}

function buildMonthHeatmap(refDate) {
  heatmapEl.innerHTML = '';

  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const start = startOfWeek(startOfMonth(refDate)); // Monday aligned
  const end = new Date(year, month + 1, 0); // last day of month
  const totalDays = dayDiff(start, end) + 1;
  const weeks = Math.ceil(totalDays / 7);

  for (let w = 0; w < weeks; w++) {
    const weekCol = document.createElement('div');
    weekCol.className = 'hm-week';
    for (let r = 0; r < 7; r++) {
      const cellDate = addDays(start, w * 7 + r);
      const inMonth = cellDate.getMonth() === month && cellDate.getFullYear() === year;
      const k = toKey(cellDate);
      const count = state.countsByDay.get(k) || 0;
      const lvl = inMonth ? levelForCount(count) : 0;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'hm-day';
      cell.tabIndex = inMonth ? 0 : -1;
      cell.dataset.level = lvl;
      cell.dataset.date = k;
      cell.title = `${count} prompt${count === 1 ? '' : 's'} on ${cellDate.toLocaleDateString()}`;
      cell.setAttribute('aria-label', cell.title);
      attachTooltipHandlers(cell, count, cellDate);
      weekCol.appendChild(cell);
    }
    heatmapEl.appendChild(weekCol);
  }
}

function buildWeekHeatmap(refDate) {
  heatmapEl.innerHTML = '';

  const start = startOfWeek(refDate);
  const weekCol = document.createElement('div');
  weekCol.className = 'hm-week';

  for (let r = 0; r < 7; r++) {
    const cellDate = addDays(start, r);
    const k = toKey(cellDate);
    const count = state.countsByDay.get(k) || 0;
    const lvl = levelForCount(count);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'hm-day';
    cell.tabIndex = 0;
    cell.dataset.level = lvl;
    cell.dataset.date = k;
    cell.title = `${count} prompt${count === 1 ? '' : 's'} on ${cellDate.toLocaleDateString()}`;
    cell.setAttribute('aria-label', cell.title);
    attachTooltipHandlers(cell, count, cellDate);
    weekCol.appendChild(cell);
  }
  heatmapEl.appendChild(weekCol);
}

function attachTooltipHandlers(cell, count, date) {
  function setContent() {
    tooltipEl.innerHTML = `
      <div><strong>${count}</strong> prompt${count === 1 ? '' : 's'}</div>
      <div class="muted">${date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
    `;
  }
  cell.addEventListener('mouseenter', () => {
    setContent();
    tooltipEl.hidden = false;
    positionTooltip(cell);
  });
  cell.addEventListener('mousemove', () => positionTooltip(cell));
  cell.addEventListener('mouseleave', () => { tooltipEl.hidden = true; });
  cell.addEventListener('focus', () => {
    setContent();
    tooltipEl.hidden = false;
    positionTooltip(cell);
  });
  cell.addEventListener('blur', () => { tooltipEl.hidden = true; });
}

function positionTooltip(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top;
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function refreshView() {
  // clear any month labels row if rebuilding
  const labels = heatmapEl.parentElement.querySelector('.hm-month-labels');
  if (labels) labels.remove();

  if (state.view === 'year') {
    buildYearHeatmap(state.year);
  } else if (state.view === 'month') {
    // for month view, use selected year + the latest month with data or current month
    const d = new Date();
    d.setFullYear(state.year);
    buildMonthHeatmap(d);
  } else {
    buildWeekHeatmap(new Date());
  }
}

// As new data arrives, update cells for currently-rendered period
function incrementalPaint() {
  // Update only title/tooltips and data-levels in the currently visible grid
  const cells = heatmapEl.querySelectorAll('.hm-day');
  for (const cell of cells) {
    const k = cell.dataset.date;
    if (!k) continue;
    const d = new Date(k);
    const count = state.countsByDay.get(k) || 0;
    const lvl = levelForCount(count);
    cell.dataset.level = lvl;
    cell.title = `${count} prompt${count === 1 ? '' : 's'} on ${d.toLocaleDateString()}`;
  }
  updateStatsUI();
}

function populateYearSelect() {
  yearSelect.innerHTML = '';
  const currentYear = new Date().getFullYear();
  // Show a range around observed data if available
  const minYear = state.minDate ? state.minDate.getFullYear() : currentYear - 4;
  const maxYear = state.maxDate ? state.maxDate.getFullYear() : currentYear;
  for (let y = maxYear; y >= minYear; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === state.year) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

// Fetch all projects by creator; stream pages and aggregate counts
async function fetchAllProjectsByCreator(username) {
  let after = null;
  let hasNext = true;
  let page = 0;

  statusEl.textContent = 'Loading prompt activity…';

  // clear previous
  state.countsByDay.clear();
  state.minDate = null;
  state.maxDate = null;
  state.fetchedPages = 0;
  state.totalCount = 0;

  while (hasNext) {
    page++;
    const params = new URLSearchParams();
    params.set('first', '50');
    if (after) params.set('after', after);
    // Only include projects that have a posted revision
    // The endpoint doesn't directly filter posted=true, so filter client-side.
    const url = `/api/v1/users/${encodeURIComponent(username)}/projects?` + params.toString();

    let body;
    try {
      const res = await fetch(url);
      body = await res.json();
    } catch (e) {
      statusEl.textContent = 'Failed to load activity.';
      console.error(e);
      break;
    }

    state.fetchedPages = page;
    pageCountEl.textContent = `(page ${page})`;

    const pageData = body?.projects?.data ?? [];
    const meta = body?.projects?.meta ?? null;
    const nextCursor = meta?.end_cursor ?? null;
    hasNext = Boolean(meta?.has_next_page);
    after = nextCursor;

    // Aggregate counts by site.created_at (posted generations)
    for (const row of pageData) {
      const project = row.project;
      const site = row.site;
      // Count only posted content (published/posted flag)
      if (!project?.posted) continue;
      if (!site?.created_at) continue;
      const d = toUTCDate(site.created_at);
      const k = toKey(d);
      state.countsByDay.set(k, (state.countsByDay.get(k) || 0) + 1);
    }

    // Update stats and repaint incrementally as data streams in
    updateStatsUI();
    incrementalPaint();

    // Yield to UI between pages
    await new Promise(r => setTimeout(r, 0));

    // Safety: avoid too many pages in case of gigantic history (cap to, say, 50 pages = 2500 projects)
    if (page >= 50) {
      hasNext = false;
    }
  }

  statusEl.textContent = 'Loaded.';
  pageCountEl.textContent = state.fetchedPages ? `(pages: ${state.fetchedPages})` : '';
  populateYearSelect();
  refreshView(); // final layout pass (ensures month labels etc.)
}

// Background: persist creator stats to leaderboard collection keyed by user_id
async function upsertLeaderboardForCreator(creatorId) {
  const { total, currentStreak, bestStreak, avg } = computeStats();
  try {
    await room.collection('prompt_leaderboard_v1').upsert({
      id: creatorId,            // primary key = user_id (stored as text in schema)
      total_prompts: total,
      current_streak: currentStreak,
      best_streak: bestStreak,
      avg_per_day: Number(avg.toFixed(4)),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Leaderboard upsert failed', e);
  }
}

// Subscribe to leaderboard and render
let unsubscribeLeaderboard = null;
function startLeaderboardSubscription() {
  const sql = `
    select
      pl.id,
      pl.total_prompts,
      pl.current_streak,
      pl.best_streak,
      pl.avg_per_day,
      u.username
    from public.prompt_leaderboard_v1 pl
    join public.user u on (u.id::text = pl.id)
    order by pl.total_prompts desc, pl.best_streak desc, pl.current_streak desc
    limit 20
  `;
  try {
    if (unsubscribeLeaderboard) unsubscribeLeaderboard();
  } catch {}
  unsubscribeLeaderboard = room.query(sql).subscribe((rows) => {
    renderLeaderboard(rows || []);
  });
}

function renderLeaderboard(rows) {
  leaderboardEl.innerHTML = '';
  rows.forEach((r, idx) => {
    const li = document.createElement('li');
    li.className = 'lb-item';
    li.innerHTML = `
      <div class="lb-rank">${idx + 1}</div>
      <div class="lb-user">
        <img src="https://images.websim.com/avatar/${r.username}" alt="${r.username} avatar" />
        <a href="https://websim.com/@${r.username}" target="_blank" rel="noopener">@${r.username}</a>
      </div>
      <div class="lb-metric"><span class="lb-total">${fmtNum(r.total_prompts || 0)}</span> total</div>
    `;
    leaderboardEl.appendChild(li);
  });
}

// Controls
function setupControls() {
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      state.view = btn.dataset.view;
      refreshView();
      incrementalPaint();
    });
  });

  yearSelect.addEventListener('change', () => {
    state.year = Number(yearSelect.value);
    refreshView();
    incrementalPaint();
  });
}

// Background loop: periodically refresh creator data and upsert leaderboard
async function backgroundAggregatorLoop() {
  if (state.backgroundLoopRunning || !state.creator?.username || !state.creator?.id) return;
  state.backgroundLoopRunning = true;

  // gentle stagger so UI stabilizes before background work
  await new Promise(r => setTimeout(r, 1000));

  while (true) {
    try {
      // Recompute from source to keep totals honest (bounded by safety cap in fetch)
      await fetchAllProjectsByCreator(state.creator.username);
      await upsertLeaderboardForCreator(state.creator.id);
    } catch (e) {
      console.warn('Background aggregation pass failed', e);
    }

    // sleep between passes; keep it light
    await new Promise(r => setTimeout(r, 2 * 60 * 1000)); // 2 minutes
  }
}

async function init() {
  setupControls();
  startLeaderboardSubscription();

  // Identify the creator of the current page if available
  let creator = null;
  try {
    creator = await window.websim.getCreator?.();
  } catch {}
  if (!creator) {
    // Fallback to current user as the "creator" if getCreator is unavailable
    try { creator = await window.websim.getUser?.(); } catch {}
  }
  if (!creator || !creator.username) {
    creatorSub.textContent = 'No creator context available.';
    statusEl.textContent = 'Cannot determine creator.';
    return;
  }
  state.creator = creator;
  updateCreatorUI(creator);

  // Initial render scaffold for the current year so UI isn't empty
  state.year = new Date().getFullYear();
  refreshView();

  // Stream in data once immediately for UI
  await fetchAllProjectsByCreator(creator.username);
  await upsertLeaderboardForCreator(creator.id);

  // Start background loop to keep leaderboard fresh "infinitely"
  backgroundAggregatorLoop();
}

init();