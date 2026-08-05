'use strict';
// Logika interfejsu. Zasada: plan liczy sie SAM przy kazdej zmianie sciezki,
// profilu i parametrow - nie ma zadnego przycisku "sprawdz plan".

const $ = sel => document.querySelector(sel);

const els = {
  version: $('#version'),
  select: $('#instanceSelect'),
  path: $('#pathInput'),
  browse: $('#browseBtn'),
  info: $('#instanceInfo'),
  warnings: $('#warnings'),
  profileSeg: $('#profileSeg'),
  renderDistance: $('#renderDistance'),
  xmx: $('#xmx'),
  scan: $('#scanBox'),
  plan: $('#plan'),
  counts: $('#counts'),
  apply: $('#applyBtn'),
  revert: $('#revertBtn'),
  refresh: $('#refreshBtn'),
  log: $('#logArea'),
  clearLog: $('#clearLog'),
};

const state = {
  profiles: {},
  groups: [],
  profile: 'standard',
  items: [],
  checked: new Set(),
  busy: false,
  planToken: 0,
};

const STATE_LABEL = { ok: 'zrobione', todo: 'do zmiany', missing: 'brak celu', error: 'blad', skipped: 'pominiete' };
const SIDE_LABEL = { client: 'klient', server: 'serwer', both: 'klient+serwer' };
const MARK = { ok: '✓', todo: '→', missing: '–', error: '!' };

function log(msg) {
  els.log.textContent += msg + '\n';
  els.log.scrollTop = els.log.scrollHeight;
}

// ------------------------------------------------------------------- start

(async function init() {
  const info = await window.patcher.info();
  state.profiles = info.profiles;
  state.groups = info.groups || [];
  els.version.textContent = 'v' + info.version;
  buildProfileSegments();
  applyProfileDefaults('standard');

  window.patcher.onLog(log);

  const res = await window.patcher.instances();
  fillInstances(res.instances || []);

  log('TFG Patcher ' + info.version + ' - zrodla modow: ' + info.sourcesFile);
  log('Plan odswieza sie sam. Zaznacz pozycje i kliknij "Zastosuj zaznaczone".');
  refreshPlan();
  doRefreshMods(true);
})();

function buildProfileSegments() {
  els.profileSeg.innerHTML = '';
  for (const p of Object.values(state.profiles)) {
    const b = document.createElement('button');
    b.className = 'seg' + (p.id === state.profile ? ' on' : '');
    b.textContent = p.label;
    b.title = p.description;
    b.dataset.profile = p.id;
    b.addEventListener('click', () => {
      state.profile = p.id;
      [...els.profileSeg.children].forEach(c => c.classList.toggle('on', c.dataset.profile === p.id));
      applyProfileDefaults(p.id);
      refreshPlan();
    });
    els.profileSeg.appendChild(b);
  }
}

function applyProfileDefaults(id) {
  const p = state.profiles[id];
  if (!p) return;
  // przelaczenie profilu przywraca JEGO wartosci; recznie mozna je potem nadpisac
  if (p.renderDistance) els.renderDistance.value = p.renderDistance;
  if (p.xmx) els.xmx.value = p.xmx;
  els.renderDistance.disabled = id === 'server';
}

function fillInstances(list) {
  els.select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = list.length ? '-- wybierz z listy --' : '-- nie znaleziono instancji Prisma --';
  els.select.appendChild(none);

  for (const inst of list) {
    const o = document.createElement('option');
    o.value = inst.path;
    const bits = [inst.name];
    if (inst.mods) bits.push(inst.mods + ' modow');
    if (inst.likelyTfg) bits.push('TFG');
    o.textContent = (inst.likelyTfg ? '★ ' : '   ') + bits.join('  ·  ');
    els.select.appendChild(o);
  }
  const best = list.find(i => i.likelyTfg) || list[0];
  if (best) {
    els.select.value = best.path;
    els.path.value = best.path;
  }
}

// ------------------------------------------------------------------ zdarzenia

els.select.addEventListener('change', () => {
  if (els.select.value) { els.path.value = els.select.value; refreshPlan(); }
});
els.browse.addEventListener('click', async () => {
  const dir = await window.patcher.pickDir();
  if (dir) { els.path.value = dir; els.select.value = ''; refreshPlan(); }
});
els.path.addEventListener('input', debounce(refreshPlan, 450));
els.renderDistance.addEventListener('change', refreshPlan);
els.xmx.addEventListener('change', refreshPlan);
els.scan.addEventListener('change', refreshPlan);
els.clearLog.addEventListener('click', () => { els.log.textContent = ''; });
els.apply.addEventListener('click', doApply);
els.revert.addEventListener('click', doRevert);
els.refresh.addEventListener('click', () => doRefreshMods(false));
document.querySelectorAll('[data-win]').forEach(b =>
  b.addEventListener('click', () => window.patcher.window(b.dataset.win)));

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function options() {
  return {
    profile: state.profile,
    renderDistance: Number(els.renderDistance.value) || 8,
    xmx: Number(els.xmx.value) || 6144,
    scan: els.scan.checked,
    force: false,
  };
}

// ---------------------------------------------------------------------- plan

async function refreshPlan() {
  const dir = els.path.value.trim().replace(/^"|"$/g, '');
  const token = ++state.planToken;
  if (!dir) { renderEmpty('Wskaz katalog instancji.'); return; }

  const res = await window.patcher.buildPlan(dir, options());
  if (token !== state.planToken) return; // starsza odpowiedz - ignorujemy

  if (!res.ok) {
    els.info.innerHTML = '';
    els.warnings.innerHTML = `<div class="warn-item">${escapeHtml(res.error)}</div>`;
    renderEmpty('Nie rozpoznano instancji pod ta sciezka.');
    return;
  }

  if (res.profile !== state.profile) {
    state.profile = res.profile;
    [...els.profileSeg.children].forEach(c => c.classList.toggle('on', c.dataset.profile === res.profile));
    applyProfileDefaults(res.profile);
    log('Wykryto serwer - profil przelaczony na "server".');
  }

  els.info.innerHTML =
    `<b>${escapeHtml(res.instance.kind)}</b><br>` +
    `gra: ${escapeHtml(res.instance.gameDir)}<br>` +
    `strona: ${SIDE_LABEL[res.instance.side]}`;
  els.warnings.innerHTML = res.warnings.map(w => `<div class="warn-item">${escapeHtml(w)}</div>`).join('');

  state.items = res.items;
  // domyslnie zaznaczone jest to, co faktycznie jest do zrobienia
  state.checked = new Set(res.items.filter(i => i.state === 'todo').map(i => i.id));
  renderPlan();
}

function renderEmpty(msg) {
  state.items = [];
  els.plan.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
  els.counts.innerHTML = '';
  els.apply.disabled = true;
}

function renderPlan() {
  els.plan.innerHTML = '';
  // Pozycje ida grupami (optymalizacje / mody / narzedzia) w kolejnosci z silnika;
  // grupa bez pozycji nie zajmuje miejsca.
  const groups = state.groups.length ? state.groups : [{ id: 'optimizations', label: '' }];
  for (const group of groups) {
    const inGroup = state.items.filter(i => (i.group || 'optimizations') === group.id);
    if (!inGroup.length) continue;
    if (group.label) {
      const head = document.createElement('div');
      head.className = 'grouphead';
      head.innerHTML = `<span class="glabel">${escapeHtml(group.label)}</span>`
        + `<span class="gdesc">${escapeHtml(group.description || '')}</span>`;
      els.plan.appendChild(head);
    }
    for (const item of inGroup) renderItem(item);
  }
  updateCounts();
}

function renderItem(item) {
  {
    const el = document.createElement('div');
    el.className = 'item ' + item.state;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.checked.has(item.id);
    // 'brak celu' tez da sie zaznaczyc - cel moze powstac przy wczesniejszej latce
    box.disabled = item.state === 'skipped' || item.state === 'error';
    box.addEventListener('change', () => {
      box.checked ? state.checked.add(item.id) : state.checked.delete(item.id);
      updateCounts();
    });

    const body = document.createElement('div');
    const lines = item.skipReason
      ? `<div class="line missing"><span class="m">–</span><span>${escapeHtml(item.skipReason)}</span></div>`
      : item.statuses.map(s =>
          `<div class="line ${s.state}"><span class="m">${MARK[s.state] || ''}</span><span>${escapeHtml(s.text)}</span></div>`).join('');

    body.innerHTML =
      `<div class="head">
         <span class="title">${escapeHtml(item.title)}</span>
         <span class="pill ${item.state}">${STATE_LABEL[item.state]}</span>
         <span class="pill side">${SIDE_LABEL[item.side]}</span>
       </div>
       <div class="why">${escapeHtml(item.why || '')}</div>
       <div class="lines">${lines}</div>
       <div class="doc">${escapeHtml(item.doc)}</div>`;

    el.append(box, body);
    els.plan.appendChild(el);
  }
}

function updateCounts() {
  const by = s => state.items.filter(i => i.state === s).length;
  const chips = [
    ['todo', by('todo'), 'do zmiany'],
    ['ok', by('ok'), 'zrobione'],
    ['missing', by('missing'), 'brak celu'],
    ['skipped', by('skipped'), 'pominiete'],
    ['error', by('error'), 'blad'],
  ].filter(([, n]) => n > 0);
  els.counts.innerHTML = chips.map(([cls, n, label]) => `<span class="pill ${cls}">${n} ${label}</span>`).join('');
  els.apply.disabled = state.busy || state.checked.size === 0;
  els.apply.textContent = state.checked.size
    ? `Zastosuj zaznaczone (${state.checked.size})` : 'Zastosuj zaznaczone';
}

// ------------------------------------------------------------------- akcje

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  els.apply.disabled = on || state.checked.size === 0;
  els.revert.disabled = on;
}

async function doApply() {
  const dir = els.path.value.trim();
  const ids = [...state.checked];
  setBusy(true);
  log('');
  log('Stosuje zmiany...');
  const res = await window.patcher.apply(dir, options(), ids);
  if (!res.ok) log('BLAD: ' + res.error);
  else {
    log('');
    log(`Gotowe: zalatanych ${res.applied}, bledow ${res.failed}, pominietych ${res.skipped}.`);
    if (res.journal) log('Kopie zapasowe: ' + res.journal);
  }
  setBusy(false);
  refreshPlan();
}

/**
 * Pobranie wydan modow. Jedyne miejsce w aplikacji, ktore rusza siec - reszta
 * planu pracuje na plikach juz sciagnietych, wiec offline dziala normalnie.
 */
async function doRefreshMods(quiet) {
  els.refresh.disabled = true;
  els.refresh.textContent = 'Sprawdzam...';
  if (!quiet) log('');
  const res = await window.patcher.refreshMods();
  if (!res.ok) log('BLAD pobierania modow: ' + res.error);
  els.refresh.disabled = false;
  els.refresh.textContent = 'Sprawdz mody';
  refreshPlan();
}

async function doRevert() {
  const dir = els.path.value.trim();
  setBusy(true);
  log('');
  const res = await window.patcher.revert(dir);
  if (!res.ok) log('BLAD: ' + res.error);
  else log(res.count < 0 ? 'Nic nie cofnieto.' : 'Cofnieto operacji: ' + res.count);
  setBusy(false);
  refreshPlan();
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
