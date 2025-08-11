// Prompt History Heatmap
// Aggregates creator's posted generations by site.created_at to estimate "prompts per day".
// Loads asynchronously in pages and updates the heatmap as results stream in.

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
};

// Utility: format YYYY-MM-DD
const toKey = (d) => d.toISOString().slice(0, 10);

// Utility: parse date string (ISO) into Date at UTC midnight
function toUTCDate(iso) {
  const d = new Date(iso);
  // normalize to midnight local for rendering grid by weekday
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

function updateStats() {
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

  statTotalEl.textContent = fmtNum(total);

  // streaks
  const sortedKeys = Array.from(state.countsByDay.keys()).sort();
  // build a set for fast membership
  const active = new Set(sortedKeys.filter(k => state.countsByDay.get(k) > 0));

  const today = new Date();
  const todayKey = toKey(today);
  let currentStreak = 0;
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // count backwards until a zero-count day or no data. We treat missing days as zero.
  while (true) {
    const key = toKey(cursor);
    if (active.has(key)) currentStreak++;
    else break;
    cursor = addDays(cursor, -1);
  }

  // best streak
  let bestStreak = 0;
  // iterate full range between minDate and maxDate (or 1 year if missing)
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

  // average per day over visible year (or over full observed span)
  let daySpan = Math.max(1, dayDiff(rangeStart, rangeEnd) + 1);
  const avg = total / daySpan;

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
  cell.addEventListener('mouseenter', () => {
    tooltipEl.innerHTML = `
      <div><strong>${count}</strong> prompt${count === 1 ? '' : 's'}</div>
      <div class="muted">${date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
    `;
    tooltipEl.hidden = false;
    positionTooltip(cell);
  });
  cell.addEventListener('mousemove', () => positionTooltip(cell));
  cell.addEventListener('mouseleave', () => { tooltipEl.hidden = true; });
  cell.addEventListener('focus', () => {
    tooltipEl.innerHTML = `
      <div><strong>${count}</strong> prompt${count === 1 ? '' : 's'}</div>
      <div class="muted">${date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</div>
    `;
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
  updateStats();
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
    updateStats();
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

async function init() {
  setupControls();

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

  // Stream in data
  fetchAllProjectsByCreator(creator.username);
}

init();

