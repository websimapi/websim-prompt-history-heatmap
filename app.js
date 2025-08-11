// Prompt History Heatmap + Background Database Aggregator (leaderboard UI removed)

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
const syncBtn = document.getElementById('sync-btn');

const creatorImg = document.getElementById('creator-img');
const creatorName = document.getElementById('creator-name');
const creatorAvatarLink = document.getElementById('creator-avatar');
const creatorSub = document.getElementById('creator-sub');

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
  lastUpsertHash: null,
};

// Utility: format YYYY-MM-DD
function dateKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Alias toKey to our date key formatter (fixes ReferenceError)
const toKey = dateKeyLocal;

// Utility: parse any ISO timestamp into a Date at LOCAL midnight
function toLocalMidnight(iso) {
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
  let x = rect.left + rect.width / 2;
  let y = rect.top;

  // Keep tooltip within viewport on mobile
  const padding = 12;
  const vw = window.innerWidth;
  const tooltipWidth = 220; // max-width
  if (x - tooltipWidth / 2 < padding) x = padding + tooltipWidth / 2;
  if (x + tooltipWidth / 2 > vw - padding) x = vw - padding - tooltipWidth / 2;

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
    const d = new Date();
    d.setFullYear(state.year);
    buildMonthHeatmap(d);
  } else {
    buildWeekHeatmap(new Date());
  }
}

// As new data arrives, update cells for currently-rendered period
function incrementalPaint() {
  const cells = heatmapEl.querySelectorAll('.hm-day');
  for (const cell of cells) {
    const k = cell.dataset.date;
    if (!k) continue;
    const parts = k.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
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

/*
  Prompt history based on revision creation times
  We count one "prompt" for each ProjectRevision created by the creator.
  This uses /users/{user}/projects to enumerate projects,
  then /projects/{id}/revisions (paginated) to aggregate revision.created_at.
*/

const isMobile = () => window.matchMedia('(max-width: 560px)').matches;

async function fetchProjectRevisions(projectId, creatorId, opts = {}) {
  let after = null;
  let hasNext = true;
  let pages = 0;

  // Lighter load on mobile
  const MAX_REV_PAGES = opts.maxRevisionPages ?? (isMobile() ? 15 : 50);

  while (hasNext) {
    pages++;
    const params = new URLSearchParams();
    params.set('first', '100');
    if (after) params.set('after', after);
    const url = `/api/v1/projects/${encodeURIComponent(projectId)}/revisions?` + params.toString();

    let body;
    try {
      const res = await fetch(url);
      body = await res.json();
    } catch (e) {
      console.warn('Failed to fetch revisions for project', projectId, e);
      break;
    }

    const pageData = body?.revisions?.data ?? [];
    const meta = body?.revisions?.meta ?? null;
    after = meta?.end_cursor ?? null;
    hasNext = Boolean(meta?.has_next_page);

    for (const row of pageData) {
      const rev = row.project_revision;
      if (!rev || !rev.created_at) continue;

      // Count all revisions on the creator's projects as prompts (prompt date = revision created_at local date)
      const d = toLocalMidnight(rev.created_at);
      const k = toKey(d);
      state.countsByDay.set(k, (state.countsByDay.get(k) || 0) + 1);
    }

    // repaint incrementally
    incrementalPaint();

    if (pages >= MAX_REV_PAGES) {
      hasNext = false;
    }

    // yield
    await new Promise(r => setTimeout(r, 0));
  }
}

// Fetch prompt history for creator by traversing projects and their revisions
async function fetchPromptHistoryByCreator(username, creatorId) {
  let after = null;
  let hasNext = true;
  let projPages = 0;
  let processedProjects = 0;

  // Lighter pagination caps on mobile
  const MAX_PROJECT_PAGES = isMobile() ? 12 : 40;     // pages
  const MAX_PROJECTS_TOTAL = isMobile() ? 250 : 800;  // total projects

  statusEl.textContent = 'Loading prompt history (by revision dates)…';

  // reset aggregates
  state.countsByDay.clear();
  state.minDate = null;
  state.maxDate = null;
  state.fetchedPages = 0;
  state.totalCount = 0;

  while (hasNext) {
    projPages++;
    const params = new URLSearchParams();
    params.set('first', '50');
    // Prefer posted projects for a truer "prompt" proxy and smaller result sets
    params.set('posted', 'true');
    if (after) params.set('after', after);
    const url = `/api/v1/users/${encodeURIComponent(username)}/projects?` + params.toString();

    let body;
    try {
      const res = await fetch(url);
      body = await res.json();
    } catch (e) {
      statusEl.textContent = 'Failed to load prompt history.';
      console.error(e);
      break;
    }

    state.fetchedPages = projPages;
    pageCountEl.textContent = `(projects page ${projPages})`;

    const pageData = body?.projects?.data ?? [];
    const meta = body?.projects?.meta ?? null;
    const nextCursor = meta?.end_cursor ?? null;
    hasNext = Boolean(meta?.has_next_page);
    after = nextCursor;

    // Process each project: fetch revisions and count prompts
    for (const row of pageData) {
      if (processedProjects >= MAX_PROJECTS_TOTAL) {
        hasNext = false;
        break;
      }
      const project = row.project;
      if (!project?.id) continue;

      processedProjects++;
      statusEl.textContent = `Loading prompt history… (${processedProjects} projects, page ${projPages})`;

      // Count revisions for this project
      await fetchProjectRevisions(project.id, creatorId);

      // Light pause to avoid hammering the API
      await new Promise(r => setTimeout(r, 0));
    }

    if (projPages >= MAX_PROJECT_PAGES) {
      hasNext = false;
    }

    // repaint stats as we go
    updateStatsUI();
    incrementalPaint();
  }

  statusEl.textContent = 'Loaded.';
  pageCountEl.textContent = state.fetchedPages ? `(projects pages: ${state.fetchedPages})` : '';
  populateYearSelect();
  refreshView(); // final layout pass (ensures month labels etc.)
}

// Background: persist creator stats to database collection keyed by user_id
function makeStatsHash({ total, currentStreak, bestStreak, avg }) {
  return `${total}|${currentStreak}|${bestStreak}|${avg.toFixed(4)}`;
}

async function upsertLeaderboardForCreator(creatorId) {
  const { total, currentStreak, bestStreak, avg } = computeStats();
  const hash = makeStatsHash({ total, currentStreak, bestStreak, avg });
  if (hash === state.lastUpsertHash) return; // no change, skip write

  try {
    await room.collection('prompt_leaderboard_v1').upsert({
      id: String(creatorId),   // primary key = user_id stored as text
      total_prompts: state.totalCount || total,
      current_streak: currentStreak,
      best_streak: bestStreak,
      avg_per_day: Number(avg.toFixed(4)),
      updated_at: new Date().toISOString(),
    });
    state.lastUpsertHash = hash;
  } catch (e) {
    console.warn('DB upsert failed', e);
  }
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

  syncBtn.addEventListener('click', async () => {
    if (!state.creator?.username || !state.creator?.id) return;
    syncBtn.disabled = true;
    syncBtn.classList.add('spinning');
    statusEl.textContent = 'Syncing…';
    try {
      await fetchPromptHistoryByCreator(state.creator.username, state.creator.id);
      await upsertLeaderboardForCreator(state.creator.id);
      statusEl.textContent = 'Synced to database.';
    } catch (e) {
      console.warn('Manual sync failed', e);
      statusEl.textContent = 'Sync failed.';
    } finally {
      syncBtn.disabled = false;
      syncBtn.classList.remove('spinning');
    }
  });
}

// Background loop: periodically refresh creator data and upsert to database
async function backgroundAggregatorLoop() {
  if (state.backgroundLoopRunning || !state.creator?.username || !state.creator?.id) return;
  state.backgroundLoopRunning = true;

  // gentle stagger so UI stabilizes before background work
  await new Promise(r => setTimeout(r, 1000));

  const loop = async () => {
    // Backoff more on mobile
    const intervalMs = isMobile() ? 5 * 60 * 1000 : 2 * 60 * 1000;

    try {
      if (document.visibilityState === 'visible') {
        await fetchPromptHistoryByCreator(state.creator.username, state.creator.id);
        await upsertLeaderboardForCreator(state.creator.id);
      }
    } catch (e) {
      console.warn('Background aggregation pass failed', e);
    } finally {
      setTimeout(loop, intervalMs);
    }
  };

  loop();
}

async function init() {
  setupControls();

  // Identify the creator of the current page if available
  let creator = null;
  try {
    creator = await window.websim.getCreator?.();
  } catch {}
  if (!creator) {
    try { creator = await window.websim.getUser?.(); } catch {}
  }
  if (!creator || !creator.username) {
    creatorSub.textContent = 'No creator context available.';
    statusEl.textContent = 'Cannot determine creator.';
    return;
  }
  state.creator = creator;
  updateCreatorUI(creator);

  // Choose a more compact default on small screens
  state.year = new Date().getFullYear();
  if (isMobile()) {
    state.view = 'month';
  }

  // Initial render scaffold
  refreshView();

  // Stream in data once immediately for UI
  await fetchPromptHistoryByCreator(creator.username, creator.id);
  await upsertLeaderboardForCreator(creator.id);

  // Start background loop to keep database aggregates fresh
  backgroundAggregatorLoop();

  // Rerender heatmap responsively when viewport crosses mobile threshold
  const mq = window.matchMedia('(max-width: 560px)');
  mq.addEventListener?.('change', () => {
    if (isMobile() && state.view === 'year') {
      state.view = 'month';
    }
    refreshView();
    incrementalPaint();
  });
}

init();