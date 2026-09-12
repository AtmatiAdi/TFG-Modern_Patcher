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
  expand: $('#expandBtn'),
  log: $('#logArea'),
  clearLog: $('#clearLog'),
};

const state = {
  profiles: {},
  groups: [],
  profile: 'standard',
  items: [],
  // Tryb kazdej pozycji: 'on' (zastosuj), 'off' (wycofaj wg "undo" z presetu),
  // 'skip' (nie ruszaj). Nieobecna w mapie = skip.
  mode: new Map(),
  busy: false,
  planToken: 0,
  // Zwijanie: KAZDA pozycja startuje zwinieta, niezaleznie od stanu. manualExpand
  // trzyma recznie rozwiniete pozycje - kasowany przy nowym planie, bo wtedy zmienia
  // sie sam zestaw pozycji.
  manualExpand: new Map(),
  expandAll: false,
};

const STATE_LABEL = { ok: 'zrobione', todo: 'do zmiany', missing: 'brak celu', error: 'blad', skipped: 'pominiete' };
// Ta sama pozycja ogladana od strony "wycofaj": ok = juz wycofane, todo = do wycofania.
const OFF_LABEL = { ...STATE_LABEL, ok: 'wycofane', todo: 'do wycofania' };
const SIDE_LABEL = { client: 'klient', server: 'serwer', both: 'klient+serwer' };
const MARK = { ok: '✓', todo: '→', missing: '–', error: '!' };
const MODE_TITLE = {
  on: 'zastosuj (klik: wycofaj / nie ruszaj)',
  off: 'wycofaj wg presetu (klik: nie ruszaj)',
  skip: 'nie ruszaj (klik: zastosuj)',
};

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
  updateExpandBtn();

  window.patcher.onLog(log);

  const res = await window.patcher.instances();
  fillInstances(res.instances || []);

  log('TFG Patcher ' + info.version + ' - repozytoria zrodlowe: ' + info.sourcesFile);
  log(info.usingPreset
    ? 'Optymalizacje i pliki gry z presetow pobranych z repozytoriow.'
    : 'Brak presetu - zadne repozytorium nie ma wydania z preset-*.json. '
      + 'Plan pokazuje same mody.');
  log('Plan odswieza sie sam. Kwadrat przy pozycji: ✓ zastosuj, ✕ wycofaj (gdy preset'
    + ' umie), pusty = nie ruszaj. Potem "Zastosuj zaznaczone".');
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
  // Profil bez renderDistance (serwerowy) nie ma czego tu ustawiac. Sprawdzamy
  // wartosc, nie nazwe - nazwy profili sa danymi presetu, nie stala aplikacji.
  els.renderDistance.disabled = !p.renderDistance || p.side === 'server';
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
els.expand.addEventListener('click', () => {
  state.expandAll = !state.expandAll;
  state.manualExpand.clear();
  updateExpandBtn();
  renderPlan();
});
document.querySelectorAll('[data-win]').forEach(b =>
  b.addEventListener('click', () => window.patcher.window(b.dataset.win)));

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function options() {
  return {
    profile: state.profile,
    // Puste pole = "nie nadpisuj", a nie jakas wartosc z aplikacji: wartosci profili
    // sa danymi presetu i tylko on ma prawo je znac.
    renderDistance: Number(els.renderDistance.value) || undefined,
    xmx: Number(els.xmx.value) || undefined,
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
  // Tryb domyslny bierze sie z presetu i profilu: "on" dla pozycji zaznaczonych,
  // "off" dla odznaczonych, ktore preset umie wycofac (np. RAM Keeper w profilu
  // "high" - Standard go zaklada, High ma go zdjac, nie zostawic). Pozycja, ktora
  // w swoim trybie nie ma nic do roboty, startuje jako "nie ruszaj".
  state.mode = new Map();
  for (const i of res.items) {
    if (i.mode === 'on' && i.state === 'todo') state.mode.set(i.id, 'on');
    else if (i.mode === 'off' && i.undoState === 'todo') state.mode.set(i.id, 'off');
  }
  // nowy plan = inny zestaw pozycji, wiec reczne rozwiniecia przestaja mieć sens
  state.manualExpand.clear();
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

/**
 * Czy pozycja ma byc rozwinieta. Regula jest jedna i nie zalezy od stanu pozycji:
 * wszystko startuje ZWINIETE, do samego tytulu ze znacznikiem stanu. Szczegoly
 * rozwija ten, kto ich chce - klikiem w naglowek albo "Rozwin wszystko".
 */
function isExpanded(item) {
  if (state.manualExpand.has(item.id)) return state.manualExpand.get(item.id);
  return state.expandAll;
}

function modeOf(item) { return state.mode.get(item.id) || 'skip'; }

/** Kolejny tryb po kliknieciu: on -> off (gdy preset umie wycofac) -> skip -> on. */
function nextMode(item) {
  const m = modeOf(item);
  if (m === 'on') return item.canUndo ? 'off' : 'skip';
  if (m === 'off') return 'skip';
  return 'on';
}

/** Stan i linie pozycji OGLADANEJ w danym trybie: "wycofaj" pokazuje sprawdzenie "undo". */
function view(item) {
  const off = modeOf(item) === 'off';
  return {
    off,
    state: off ? item.undoState : item.state,
    statuses: off ? item.undoStatuses : item.statuses,
    labels: off ? OFF_LABEL : STATE_LABEL,
  };
}

function renderItem(item, replace = null) {
  const v = view(item);
  const el = document.createElement('div');
  el.className = 'item ' + v.state + (v.off ? ' off' : '') + (isExpanded(item) ? '' : ' collapsed');
  el.dataset.id = item.id;

  // Trojstan zamiast checkboxa: zastosuj / wycofaj / nie ruszaj. Jeden przycisk w tej
  // samej kolumnie, zeby tytuly nie skakaly; kolejne klikniecia przelaczaja tryb.
  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'tri ' + modeOf(item);
  box.title = MODE_TITLE[modeOf(item)];
  // 'brak celu' tez da sie zaznaczyc - cel moze powstac przy wczesniejszej latce
  box.disabled = item.state === 'skipped' || item.state === 'error';
  // Zmiana trybu nie rusza zwijania: zwiniecie pozycji, ktora ktos wlasnie rozwinal,
  // zeby jej sie przyjrzec przed kliknieciem, byloby wyrwaniem jej sprzed oczu.
  box.addEventListener('click', () => {
    const m = nextMode(item);
    m === 'skip' ? state.mode.delete(item.id) : state.mode.set(item.id, m);
    renderItem(item, el);
    updateCounts();
  });

  const body = document.createElement('div');
  const lines = item.skipReason
    ? `<div class="line missing"><span class="m">–</span><span>${escapeHtml(item.skipReason)}</span></div>`
    : v.statuses.map(s =>
        `<div class="line ${s.state}"><span class="m">${MARK[s.state] || ''}</span><span>${escapeHtml(s.text)}</span></div>`).join('');

  body.innerHTML =
    `<div class="head">
       <span class="pill state ${v.state}${v.off ? ' off' : ''}">${v.labels[v.state]}</span>
       <span class="title">${escapeHtml(item.title)}</span>
       <span class="pill side">${SIDE_LABEL[item.side]}</span>
       <button class="toggle" type="button" title="Rozwin / zwin">
         <svg viewBox="0 0 12 12"><path d="M3 4.5L6 8l3-3.5"/></svg>
       </button>
     </div>
     <div class="why">${escapeHtml(item.why || '')}</div>
     <div class="lines">${lines}</div>
     <div class="doc">${escapeHtml(item.doc)}</div>`;

  // Caly naglowek jest klikalny; trojstan lezy poza nim, wiec nic sie nie gryzie.
  body.querySelector('.head').addEventListener('click', () => {
    state.manualExpand.set(item.id, !isExpanded(item));
    el.classList.toggle('collapsed', !isExpanded(item));
  });

  el.append(box, body);
  replace ? replace.replaceWith(el) : els.plan.appendChild(el);
}

function updateExpandBtn() {
  els.expand.textContent = state.expandAll ? 'Zwin wszystko' : 'Rozwin wszystko';
}

function updateCounts() {
  const by = s => state.items.filter(i => i.state === s).length;

  // "do zmiany" liczy ZAZNACZONE, bo naglowek ma mowic, co sie stanie po kliknieciu.
  // Sama liczba pozycji roznych od celu klocila sie z lista i z przyciskiem: preset
  // odznacza czesc pozycji sam (selected: false), a uzytkownik odznacza kolejne, i nic
  // z tego nie bylo widac. Gdy zaznaczone nie jest wszystko, pokazujemy oba czlony
  // ("3 z 11") - inaczej zniknelby rozmiar roboty, ktora zostaje do zrobienia.
  // Pozycja liczy sie w tym trybie, w ktorym jest ogladana: "wycofaj" patrzy na
  // stan "undo", pozostale na stan "changes".
  const todo = state.items.filter(i => view(i).state === 'todo');
  const todoOn = todo.filter(i => modeOf(i) !== 'skip').length;
  const off = state.items.filter(i => modeOf(i) === 'off').length;

  const chips = [
    ['todo', todo.length, todoOn === todo.length ? `${todo.length}` : `${todoOn} z ${todo.length}`, 'do zmiany'],
    ['todo off', off, null, 'do wycofania'],
    ['ok', by('ok'), null, 'zrobione'],
    ['missing', by('missing'), null, 'brak celu'],
    ['skipped', by('skipped'), null, 'pominiete'],
    ['error', by('error'), null, 'blad'],
  ].filter(([, n]) => n > 0);
  // Licznika zwinietych juz nie ma: skoro zwiniete jest wszystko, ta liczba nic nie mowi.
  els.counts.innerHTML = chips.map(([cls, n, text, label]) =>
    `<span class="pill ${cls}">${text || n} ${label}</span>`).join('');
  els.apply.disabled = state.busy || state.mode.size === 0;
  els.apply.textContent = state.mode.size
    ? `Zastosuj zaznaczone (${state.mode.size})` : 'Zastosuj zaznaczone';
}

// ------------------------------------------------------------------- akcje

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  els.apply.disabled = on || state.mode.size === 0;
  els.revert.disabled = on;
}

async function doApply() {
  const dir = els.path.value.trim();
  const ids = { on: [], off: [] };
  for (const [id, m] of state.mode) ids[m].push(id);
  setBusy(true);
  log('');
  log('Stosuje zmiany...');
  // Podsumowanie i ewentualny blad wypisuje proces glowny przez kanal logu - inaczej
  // wyladowalyby przed ostatnimi liniami operacji (patrz main.js, plan:apply).
  await window.patcher.apply(dir, options(), ids);
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
  if (!res.ok) log('BLAD sprawdzania repozytoriow: ' + res.error);

  // Preset przynosi wlasne grupy i profile, wiec po pobraniu moga byc inne niz te,
  // ktore okno dostalo przy starcie.
  if (res.groups && res.groups.length) state.groups = res.groups;
  if (res.profiles && Object.keys(res.profiles).length) {
    state.profiles = res.profiles;
    buildProfileSegments();
    applyProfileDefaults(state.profile);
  }

  els.refresh.disabled = false;
  els.refresh.textContent = 'Sprawdz zrodla';
  refreshPlan();
}

async function doRevert() {
  const dir = els.path.value.trim();
  setBusy(true);
  log('');
  await window.patcher.revert(dir);
  setBusy(false);
  refreshPlan();
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
