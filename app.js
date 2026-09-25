'use strict';
/* ═════════════════════════ CONSTANTES Y UTILIDADES ═════════════════════════ */
const STORE_KEY  = 'promedioUAM.v2';
const LEGACY_KEY = 'calculadoraBeca.v1';
const PCT = [0.30, 0.35, 0.35];
const STEPS = ['Materias', 'Configuración', 'Confirmar'];

const ICON = {
  back:  '<svg viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x:     '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Reglamento UAM, art. 45 parágrafo: promedios con 4 decimales SIN aproximación → truncar.
const trunc4 = x => Math.floor(x * 10000 + 1e-7) / 10000;
const fmt4   = x => trunc4(x).toFixed(4);
// Art. 38: notas parciales y definitivas con un decimal, con aproximación.
const round1 = x => Math.round(x * 10 + 1e-7) / 10;

/* ═════════════════════════ ESTADO ═════════════════════════ */
let state = { semesters: [] };
const ui = { tab: 'calc', histId: null, editing: false };

const activeSem = () => state.semesters.find(s => !s.closed) || null;
const closedSems = () => state.semesters.filter(s => s.closed).sort((a, b) => {
  const na = a.numero ?? -1, nb = b.numero ?? -1;
  if (nb !== na) return nb - na;
  return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
});
const lastClosed = () => [...state.semesters].filter(s => s.closed)
  .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')))[0] || null;
const semLabel = s => s && s.numero ? `${s.numero}° semestre` : 'Semestre sin número';

// Periodos UAM: -1 enero a abril, -2 intersemestral (junio a agosto), -3 agosto a diciembre.
const PERIOD_RE = /^(\d{4})-([123])$/;
const PERIOD_MSG = 'El periodo debe tener el formato año-número, por ejemplo 2026-1, 2026-2 o 2026-3.';
const isPeriod = p => PERIOD_RE.test(String(p || '').trim());
// Sugiere el siguiente periodo regular (se salta el intersemestral); siempre es editable.
function nextPeriod(p) {
  const m = PERIOD_RE.exec(String(p || '').trim());
  if (!m) return '';
  return m[2] === '3' ? `${+m[1] + 1}-1` : `${m[1]}-3`;
}
function guessPeriod() {
  const d = new Date(), mo = d.getMonth(); // 0 = enero
  return `${d.getFullYear()}-${mo <= 4 ? 1 : mo <= 6 ? 2 : 3}`;
}

function normalizeMat(m) {
  const tipo = m.tipo === 'unico' ? 'unico' : 'cortes';
  const len = tipo === 'unico' ? 1 : 3;
  const notas = Array.from({ length: len }, (_, i) => {
    const v = m.notas?.[i];
    if (v === null || v === undefined || v === '') return null;
    const n = num(v, NaN);
    return Number.isFinite(n) ? round1(clamp(n, 0, 5)) : null;
  });
  return {
    id: String(m.id ?? uid('mat')),
    nombre: String(m.nombre ?? ''),
    creditos: clamp(int(m.creditos, 3), 1, 10),
    tipo, notas,
  };
}

function normalizeSem(s) {
  const c = s.cfg || {};
  const n = int(s.numero, NaN);
  return {
    id: String(s.id || uid('sem')),
    numero: Number.isFinite(n) && n > 0 ? n : null,
    periodo: String(s.periodo || ''),
    closed: !!s.closed,
    createdAt: s.createdAt || new Date().toISOString(),
    closedAt: s.closedAt || null,
    updatedAt: s.updatedAt || s.closedAt || s.createdAt || new Date().toISOString(),
    cfg: {
      prev: num(c.prev, 0),
      prevCreds: Math.max(0, int(c.prevCreds, 0)),
      plan: Math.max(0, int(c.plan, 0)),
      aprobados: Math.max(0, int(c.aprobados, 0)),
      meta: num(c.meta, 4.2),
    },
    materias: Array.isArray(s.materias) ? s.materias.map(normalizeMat) : [],
  };
}

// Solo puede haber un semestre activo; si llegan varios (p. ej. al importar) se cierran los demás.
function enforceSingleActive(list) {
  let seen = false;
  list.forEach(s => {
    if (!s.closed) {
      if (seen) { s.closed = true; s.closedAt = s.closedAt || new Date().toISOString(); }
      seen = true;
    }
  });
  return list;
}

const touch = sem => { sem.updatedAt = new Date().toISOString(); };

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, semesters: state.semesters })); }
  catch (e) { console.warn('No se pudo guardar el estado:', e); }
}

function migrateLegacy(p) {
  const c = p.cfgs || {};
  const total = int(c['cfg-total'], 0);
  const actual = int(c['cfg-actual'], 0);
  return normalizeSem({
    id: uid('sem'), numero: null, periodo: '', closed: false,
    cfg: {
      prev: num(c['cfg-prev'], 0),
      prevCreds: Math.max(0, total - actual),
      plan: int(c['cfg-plan'], 0),
      aprobados: int(c['cfg-aprobados'], 0),
      meta: num(c['cfg-meta'], 4.2),
    },
    materias: p.materias,
  });
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.semesters)) {
        state.semesters = enforceSingleActive(p.semesters.map(normalizeSem));
        return 'ok';
      }
    }
  } catch (e) { console.warn('No se pudo leer el estado:', e); }
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.materias)) {
        state.semesters = [migrateLegacy(p)];
        save();
        return 'migrated';
      }
    }
  } catch (e) { console.warn('No se pudo migrar la versión anterior:', e); }
  return 'empty';
}

/* ═════════════════════════ CÁLCULOS ═════════════════════════ */
function calcFinal(m) {
  if (m.tipo === 'unico') {
    const v = m.notas[0];
    return v == null ? { final: null, complete: false } : { final: round1(v), complete: true };
  }
  let sum = 0, all = true;
  for (let i = 0; i < 3; i++) {
    const v = m.notas[i];
    if (v == null) all = false; else sum += v * PCT[i];
  }
  return all ? { final: round1(sum), complete: true } : { final: null, complete: false };
}

function compute(sem) {
  const c = sem.cfg;
  const actual = sem.materias.reduce((s, m) => s + m.creditos, 0);
  const prevCreds = c.prevCreds;
  const total = prevCreds + actual;
  const puntosPrev = c.prev * prevCreds;
  let currPts = 0, currCreds = 0, completadas = 0, pendCreds = 0;
  const finals = {};
  sem.materias.forEach(m => {
    const r = calcFinal(m);
    finals[m.id] = r;
    if (r.complete) { currPts += r.final * m.creditos; currCreds += m.creditos; completadas++; }
    else pendCreds += m.creditos;
  });
  const semProm = currCreds > 0 ? currPts / currCreds : null;
  const baseCreds = prevCreds + currCreds;
  // Acumulado provisional: solo con créditos que ya tienen nota (no asume 0 en lo pendiente).
  const acum = currCreds > 0 && baseCreds > 0 ? (puntosPrev + currPts) / baseCreds : null;
  const allComplete = sem.materias.length > 0 && pendCreds === 0;
  const notaNec = pendCreds > 0 ? (c.meta * total - puntosPrev - currPts) / pendCreds : null;
  return { actual, prevCreds, total, puntosPrev, currPts, currCreds, completadas, pendCreds,
           finals, semProm, acum, allComplete, notaNec, n: sem.materias.length };
}

const gradeClass = v => v >= 4.2 ? 'alta' : v >= 3.0 ? 'media' : 'baja';
const PEND_BADGE = '<span class="nb pend">—</span>';

function statusChip(sem, r) {
  if (!r.allComplete) return '<span class="sb pend">Incompleto</span>';
  return trunc4(r.acum) >= sem.cfg.meta
    ? '<span class="sb gana">Meta alcanzada</span>'
    : '<span class="sb pierde">Bajo la meta</span>';
}

/* ═════════════════════════ RENDER GENERAL ═════════════════════════ */
function render() {
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
  $('#view-calc').hidden = ui.tab !== 'calc';
  $('#view-hist').hidden = ui.tab !== 'hist';
  updateHeader();

  if (ui.tab === 'calc') {
    const s = activeSem();
    s ? mountCalc($('#view-calc'), s, { mode: 'active' }) : renderEmptyCalc($('#view-calc'));
  } else {
    const s = ui.histId && state.semesters.find(x => x.id === ui.histId && x.closed);
    if (s) mountCalc($('#view-hist'), s, { mode: 'history', editing: ui.editing });
    else { ui.histId = null; ui.editing = false; renderHistList($('#view-hist')); }
  }
  $('#fab').hidden = !(ui.tab === 'calc' && activeSem());
}

function updateHeader() {
  const pill = $('#sem-pill');
  const s = activeSem();
  pill.classList.toggle('off', !s);
  pill.innerHTML = s
    ? `<span class="dot"></span><strong>${esc(semLabel(s))}</strong>${s.periodo ? `<span class="per">${esc(s.periodo)}</span>` : ''}`
    : '<span class="dot"></span>Sin semestre activo';
}

function renderEmptyCalc(root) {
  root.__ctx = null;
  const hasHistory = state.semesters.some(s => s.closed);
  root.innerHTML = `
    <div class="empty-state">
      <h1>No hay un semestre activo</h1>
      <p>${hasHistory
        ? 'Tu último semestre quedó guardado en Historial. Configura el siguiente para seguir calculando.'
        : 'Configura tu primer semestre para empezar a calcular tu promedio.'}</p>
      <button class="btn btn-primary" data-action="start-sem">Iniciar semestre</button>
    </div>`;
}

/* ═════════════════════════ CALCULADORA ═════════════════════════ */
function fieldHTML(label, group, key, attrs, ro, hint = '') {
  const a = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<label class="field"><span class="label">${label}</span>
    <input ${a} data-${group}="${key}" ${ro ? 'disabled' : ''}>${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
}

function mountCalc(root, sem, opts) {
  const history = opts.mode === 'history';
  const ro = history && !opts.editing;
  const c = sem.cfg;
  root.__ctx = { sem, opts, ro };

  const compact = sem.materias.length
    ? sem.materias.map(m => `<span class="mc-item"><span class="mc-name">${m.nombre ? esc(m.nombre) : '<span class="faint">Sin nombre</span>'}</span><span class="mc-meta">${m.creditos} cr, ${m.tipo === 'unico' ? 'única' : '3 cortes'}</span></span>`).join('')
    : `<span class="mc-empty">${ro ? 'Este semestre no tiene materias.' : 'Aún no hay materias. Haz clic para agregarlas.'}</span>`;

  root.innerHTML = `
  <div class="calc">
    <div class="calc-head">
      <div>
        ${history ? `<button class="btn btn-ghost btn-sm back" data-action="hist-back">${ICON.back} Historial</button>` : ''}
        <h1 class="sem-title" data-bind="title"></h1>
        <div class="sem-sub"><span class="sem-period" data-bind="period"></span>${history ? '<span data-bind="status"></span>' : ''}</div>
      </div>
      ${history ? `<div class="calc-actions">
        <button class="btn ${opts.editing ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="toggle-edit">${opts.editing ? 'Terminar edición' : 'Editar'}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-sem">Eliminar</button>
      </div>` : ''}
    </div>
    ${history && opts.editing ? '<div class="edit-note">Estás editando un semestre cerrado. Los cambios se guardan al instante y no afectan a los demás semestres.</div>' : ''}

    <div class="stats">
      <div class="stat"><div class="stat-label">Promedio anterior</div><div class="stat-value" data-bind="s-prev">—</div></div>
      <div class="stat"><div class="stat-label">Promedio del semestre</div><div class="stat-value" data-bind="s-curr">—</div></div>
      <div class="stat"><div class="stat-label">Acumulado proyectado</div><div class="stat-value" data-bind="s-acum">—</div></div>
      <div class="stat"><div class="stat-label">Meta de beca</div><div class="stat-value" data-bind="s-meta">—</div></div>
    </div>

    <div class="calc-grid">
      <aside class="side">
        <section class="panel panel-config">
          <div class="panel-head"><h2>Configuración</h2></div>
          <div class="panel-scroll">
            <div class="form">
              <div class="grid2">
                ${fieldHTML('Semestre', 'meta', 'numero', { type: 'number', min: 1, max: 20, step: 1, value: sem.numero ?? '', placeholder: '7' }, ro)}
                ${fieldHTML('Periodo', 'meta', 'periodo', { type: 'text', value: sem.periodo, placeholder: '2026-2', maxlength: 6 }, ro)}
              </div>
              ${fieldHTML('Promedio acumulado anterior', 'cfg', 'prev', { type: 'number', min: 0, max: 5, step: '0.0001', value: c.prev }, ro)}
              <div class="grid2">
                ${fieldHTML('Créditos cursados antes', 'cfg', 'prevCreds', { type: 'number', min: 0, step: 1, value: c.prevCreds }, ro)}
                <div class="field"><span class="label">Créditos del semestre</span><output class="computed" data-bind="actual"></output></div>
              </div>
              <div class="field"><span class="label">Créditos inscritos totales</span><output class="computed" data-bind="total"></output></div>
              <div class="grid2">
                ${fieldHTML('Créditos plan carrera', 'cfg', 'plan', { type: 'number', min: 1, step: 1, value: c.plan }, ro)}
                ${fieldHTML('Créditos aprobados', 'cfg', 'aprobados', { type: 'number', min: 0, step: 1, value: c.aprobados }, ro)}
              </div>
              ${fieldHTML('Meta de promedio (beca o distinción)', 'cfg', 'meta', { type: 'number', min: 0, max: 5, step: '0.1', value: c.meta }, ro)}
              <div class="formula" data-bind="formula"></div>
            </div>
          </div>
        </section>

        <section class="panel panel-materias">
          <div class="panel-head">
            <h2>Materias <span class="count" data-bind="count"></span></h2>
            ${ro ? '' : '<button class="btn btn-secondary btn-sm" data-action="open-materias">Editar</button>'}
          </div>
          <div class="panel-scroll">
            <button class="mc" ${ro ? 'disabled' : 'data-action="open-materias"'} aria-label="Abrir materias">${compact}</button>
          </div>
        </section>
      </aside>

      <div class="content">
        <section class="banner" data-bind="banner" data-state="idle">
          <div class="banner-text">
            <span class="banner-chip" data-bind="chip"></span>
            <h2 class="banner-title" data-bind="btitle"></h2>
            <p class="banner-sub" data-bind="bsub"></p>
          </div>
          <div class="banner-num">
            <span class="banner-label">Acumulado proyectado</span>
            <span class="banner-value" data-bind="bvalue">—</span>
          </div>
        </section>

        <section class="panel">
          <div class="progress">
            <div class="progress-top"><span>Avance en la carrera</span><span data-bind="plabel"></span></div>
            <div class="track"><div class="fill" data-bind="pfill" style="width:0%"></div></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Notas del semestre</h2><span class="hint">Notas de 0.0 a 5.0, un decimal</span></div>
          <div class="table-wrap">
            <table>
              <thead data-bind="thead"></thead>
              <tbody data-bind="tbody"></tbody>
              <tfoot data-bind="tfoot"></tfoot>
            </table>
          </div>
        </section>

        <div class="alert" data-bind="alert"></div>
      </div>
    </div>
  </div>`;

  renderTable(root, sem, ro);
  refresh(root);
}

function gInput(m, i, ro) {
  const v = m.notas[i];
  const label = m.tipo === 'unico' ? 'nota única' : `corte ${i + 1}`;
  return `<input class="g-input" type="number" inputmode="decimal" min="0" max="5" step="0.1" placeholder="—"
    value="${v == null ? '' : v.toFixed(1)}" data-grade="${esc(m.id)}" data-idx="${i}"
    aria-label="${esc(m.nombre || 'Materia')}, ${label}" ${ro ? 'disabled' : ''}>`;
}

function renderTable(root, sem, ro) {
  const thead = $('[data-bind="thead"]', root);
  const tbody = $('[data-bind="tbody"]', root);
  if (!sem.materias.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><p>Aún no hay materias en este semestre.</p>
      ${ro ? '' : '<button class="btn btn-secondary btn-sm" data-action="open-materias">Agregar materias</button>'}</div></td></tr>`;
    return;
  }
  const hayC = sem.materias.some(m => m.tipo === 'cortes');
  const hayU = sem.materias.some(m => m.tipo === 'unico');
  thead.innerHTML = `<tr>
    <th>Asignatura</th>
    ${hayC ? '<th class="c">Corte 1 <span>30%</span></th><th class="c">Corte 2 <span>35%</span></th><th class="c">Corte 3 <span>35%</span></th>' : ''}
    ${hayU ? '<th class="c">Nota única</th>' : ''}
    <th class="c">Final</th><th class="r">Nota × créd.</th><th class="c">Estado</th>
  </tr>`;
  tbody.innerHTML = sem.materias.map(m => {
    let cells = '';
    if (m.tipo === 'cortes') {
      cells = [0, 1, 2].map(i => `<td class="c">${gInput(m, i, ro)}</td>`).join('');
      if (hayU) cells += '<td></td>';
    } else {
      if (hayC) cells = '<td></td><td></td><td></td>';
      cells += `<td class="c">${gInput(m, 0, ro)}</td>`;
    }
    return `<tr data-row="${esc(m.id)}">
      <td><div class="mat-name">${m.nombre ? esc(m.nombre) : '<span class="faint">Sin nombre</span>'}</div>
          <div class="mat-cred">${m.creditos} crédito${m.creditos !== 1 ? 's' : ''}, ${m.tipo === 'unico' ? 'nota única' : '3 cortes'}</div></td>
      ${cells}
      <td class="c" data-cell="final"></td>
      <td class="r mono" data-cell="pts"></td>
      <td class="c" data-cell="estado"></td>
    </tr>`;
  }).join('');
}

// Actualiza todo lo calculado sin reconstruir inputs (así no se pierde el foco al escribir).
function refresh(root) {
  const ctx = root.__ctx; if (!ctx) return;
  const { sem } = ctx;
  const c = sem.cfg;
  const r = compute(sem);
  const B = k => $(`[data-bind="${k}"]`, root);
  const hidden = sem.closed && !r.allComplete; // cerrado con pendientes: sin resultado ni análisis

  B('title').textContent = semLabel(sem);
  B('period').textContent = sem.periodo || 'Sin periodo';
  if (B('status')) B('status').innerHTML = statusChip(sem, r);
  B('actual').textContent = r.actual;
  B('total').textContent = r.total;
  B('count').textContent = r.n;
  B('formula').innerHTML =
    `Puntos previos = ${fmt4(c.prev)} × ${r.prevCreds} = <strong>${r.puntosPrev.toFixed(2)}</strong><br>
     Acumulado = (<strong>${r.puntosPrev.toFixed(2)}</strong> + puntos del semestre) ÷ (${r.prevCreds} + créditos con nota final)`;

  // Stats
  const setStat = (el, txt, cls = '') => { el.textContent = txt; el.className = 'stat-value' + (cls ? ' ' + cls : ''); };
  setStat(B('s-prev'), fmt4(c.prev));
  setStat(B('s-meta'), c.meta.toFixed(2));
  if (hidden || r.semProm == null) {
    setStat(B('s-curr'), '—'); setStat(B('s-acum'), '—');
  } else {
    const sp = trunc4(r.semProm), ac = trunc4(r.acum);
    setStat(B('s-curr'), sp.toFixed(4), sp >= c.meta ? 'good' : sp >= c.meta - .3 ? 'warn' : 'bad');
    setStat(B('s-acum'), ac.toFixed(4), ac >= c.meta ? 'good' : ac >= c.meta - .2 ? 'warn' : 'bad');
  }

  // Filas
  $$('tr[data-row]', root).forEach(tr => {
    const m = sem.materias.find(x => x.id === tr.dataset.row); if (!m) return;
    const f = r.finals[m.id];
    $('[data-cell="final"]', tr).innerHTML = f.complete ? `<span class="nb ${gradeClass(f.final)}">${f.final.toFixed(1)}</span>` : PEND_BADGE;
    $('[data-cell="pts"]', tr).textContent = f.complete ? (f.final * m.creditos).toFixed(2) : '—';
    $('[data-cell="estado"]', tr).innerHTML = !f.complete ? '<span class="sb pend">Pendiente</span>'
      : f.final >= 3 ? '<span class="sb gana">Aprobada</span>' : '<span class="sb pierde">Reprobada</span>';
  });

  // Pie de tabla
  const tfoot = B('tfoot');
  if (!r.n) tfoot.innerHTML = '';
  else {
    const cols = (sem.materias.some(m => m.tipo === 'cortes') ? 3 : 0) + (sem.materias.some(m => m.tipo === 'unico') ? 1 : 0);
    const prom = !hidden && r.semProm != null ? `<span class="nb ${gradeClass(trunc4(r.semProm))}">${fmt4(r.semProm)}</span>` : PEND_BADGE;
    tfoot.innerHTML = `<tr><td>Totales (${r.completadas}/${r.n} materias)</td>${cols ? `<td colspan="${cols}"></td>` : ''}
      <td class="c">${prom}</td><td class="r mono">${r.currPts.toFixed(2)}</td><td></td></tr>`;
  }

  // Progreso
  const pct = c.plan > 0 ? Math.min(100, Math.round(c.aprobados / c.plan * 100)) : 0;
  B('pfill').style.width = pct + '%';
  B('plabel').textContent = `${c.aprobados} de ${c.plan} créditos aprobados (${pct}%)`;

  paintBanner(B, sem, r, hidden);
  paintAlert(B, sem, r, hidden);
}

function paintBanner(B, sem, r, hidden) {
  const meta = sem.cfg.meta;
  let st = 'idle', chip = 'Sin datos', title, sub, val = '—';
  if (!r.n) {
    title = 'Agrega tus materias para empezar';
    sub = 'El estado de la beca aparece cuando haya notas finales.';
  } else if (hidden) {
    chip = 'Incompleto';
    title = 'Semestre cerrado con notas pendientes';
    sub = 'No hay resultado ni análisis. Usa Editar para completar las notas.';
  } else if (r.acum == null) {
    chip = 'Pendiente';
    title = 'Aún no hay materias con nota final';
    sub = 'Ingresa las notas en la tabla. El acumulado se proyecta con las materias completas.';
  } else {
    const ac = trunc4(r.acum);
    val = ac.toFixed(4);
    const partial = !r.allComplete;
    const def = (meta - ac).toFixed(4);
    if (ac >= meta) {
      st = 'ok'; chip = 'En la meta'; title = 'Beca o distinción en camino';
      sub = `Acumulado ${val}, por encima de la meta de ${meta.toFixed(2)}${partial ? '. Proyección parcial.' : '.'}`;
    } else if (ac >= meta - 0.15) {
      st = 'warn'; chip = 'Muy cerca'; title = 'Muy cerca: el último corte cuenta';
      sub = `Te faltan ${def} puntos para llegar a ${meta.toFixed(2)} de acumulado.`;
    } else {
      st = 'no'; chip = 'Por debajo'; title = 'Por debajo de la meta';
      sub = `Diferencia de ${def} puntos para llegar a ${meta.toFixed(2)} de acumulado.`;
    }
  }
  B('banner').dataset.state = st;
  B('chip').textContent = chip;
  B('btitle').textContent = title;
  B('bsub').textContent = sub;
  B('bvalue').textContent = val;
}

function paintAlert(B, sem, r, hidden) {
  const el = B('alert');
  const meta = sem.cfg.meta;
  el.hidden = hidden;
  if (hidden) return;
  if (!r.n) {
    el.dataset.tone = 'info';
    el.innerHTML = 'Abre el panel Materias para agregar las asignaturas del semestre. Todo se calcula en tiempo real.';
    return;
  }
  if (!r.allComplete) {
    let msg = r.completadas
      ? `Proyección parcial: ${r.completadas} de ${r.n} materias tienen nota final. Acumulado provisional: <strong>${fmt4(r.acum)}</strong>.`
      : 'Ninguna materia tiene nota final todavía.';
    const nn = r.notaNec;
    if (nn !== null) {
      if (nn <= 0) msg += ` Ya superarías ${meta.toFixed(2)} aunque saques 0.0 en lo que falta.`;
      else if (nn > 5) msg += `<br>Ya no es posible llegar a ${meta.toFixed(2)} este semestre: necesitarías <strong>${nn.toFixed(2)}</strong> en ${r.pendCreds} créditos pendientes.`;
      else msg += `<br>Para llegar a <strong>${meta.toFixed(2)}</strong> necesitas un promedio de <strong>${nn.toFixed(2)}</strong> en los <strong>${r.pendCreds}</strong> créditos pendientes.`;
    }
    el.dataset.tone = 'warn';
    el.innerHTML = msg;
  } else if (trunc4(r.acum) >= meta) {
    el.dataset.tone = 'good';
    el.innerHTML = `Objetivo alcanzado. Promedio acumulado final: <strong>${fmt4(r.acum)}</strong> sobre <strong>${r.total}</strong> créditos inscritos.`;
  } else {
    el.dataset.tone = 'bad';
    el.innerHTML = `Promedio acumulado: <strong>${fmt4(r.acum)}</strong>, ${(meta - trunc4(r.acum)).toFixed(4)} puntos por debajo de <strong>${meta.toFixed(2)}</strong> sobre ${r.total} créditos inscritos.`;
  }
}

/* ═════════════════════════ EVENTOS DE LAS VISTAS ═════════════════════════ */
function bindView(root) {
  root.addEventListener('input', e => {
    const ctx = root.__ctx; if (!ctx || ctx.ro) return;
    const { sem } = ctx;
    const t = e.target;
    if (t.dataset.cfg) {
      const k = t.dataset.cfg;
      sem.cfg[k] = (k === 'prev' || k === 'meta') ? clamp(num(t.value, 0), 0, 5) : Math.max(0, int(t.value, 0));
      touch(sem); save(); refresh(root);
    } else if (t.dataset.meta) {
      if (t.dataset.meta === 'numero') { const n = int(t.value, NaN); sem.numero = Number.isFinite(n) && n > 0 ? n : null; }
      else sem.periodo = t.value.trim();
      touch(sem); save(); refresh(root); updateHeader();
    } else if (t.dataset.grade) {
      const m = sem.materias.find(x => x.id === t.dataset.grade); if (!m) return;
      const v = t.value === '' ? NaN : num(t.value, NaN);
      m.notas[+t.dataset.idx] = Number.isFinite(v) ? round1(clamp(v, 0, 5)) : null;
      touch(sem); save(); refresh(root);
    }
  });
  // Al salir del campo, la nota se muestra como quedó guardada (recortada a 0–5 y a un decimal).
  root.addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset.grade || !root.__ctx) return;
    const m = root.__ctx.sem.materias.find(x => x.id === t.dataset.grade);
    if (m) { const v = m.notas[+t.dataset.idx]; t.value = v == null ? '' : v.toFixed(1); }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b || !root.contains(b)) return;
    handleAction(b.dataset.action, b, root);
  });
}

function handleAction(action, el, root) {
  const ctx = root.__ctx;
  switch (action) {
    case 'open-materias': if (ctx && !ctx.ro) openMaterias(ctx.sem); break;
    case 'start-sem': openWizard(); break;
    case 'hist-back': ui.histId = null; ui.editing = false; render(); break;
    case 'open-hist': ui.histId = el.dataset.id; ui.editing = false; render(); window.scrollTo(0, 0); break;
    case 'toggle-edit':
      ui.editing = !ui.editing; render();
      if (!ui.editing) toast('Cambios guardados');
      break;
    case 'delete-sem': if (ctx) confirmDelete(ctx.sem); break;
    case 'export': exportData(); break;
    case 'import': $('#import-input').click(); break;
  }
}

/* ═════════════════════════ HISTORIAL ═════════════════════════ */
function renderHistList(root) {
  root.__ctx = null;
  const list = closedSems();
  const card = s => {
    const r = compute(s);
    const inc = !r.allComplete;
    return `<button class="hist-card" data-action="open-hist" data-id="${esc(s.id)}">
      <span class="hc-top"><span class="hc-title">${esc(semLabel(s))}</span>${statusChip(s, r)}</span>
      <span class="hc-period">${esc(s.periodo || 'Sin periodo')}</span>
      <span class="hc-metrics">
        <span><span class="hc-k">Semestre</span><span class="hc-v">${inc ? '—' : fmt4(r.semProm)}</span></span>
        <span><span class="hc-k">Acumulado</span><span class="hc-v">${inc ? '—' : fmt4(r.acum)}</span></span>
        <span><span class="hc-k">Créditos</span><span class="hc-v">${r.actual}</span></span>
      </span>
    </button>`;
  };
  root.innerHTML = `
    <div class="hist-head">
      <div>
        <h1 class="page-title">Historial</h1>
        <p class="page-sub">Cada semestre queda guardado tal como lo cerraste. Ábrelo para ver su calculadora o editarla.</p>
      </div>
      <div class="hist-tools">
        <button class="btn btn-secondary btn-sm" data-action="export">Exportar respaldo</button>
        <button class="btn btn-secondary btn-sm" data-action="import">Importar respaldo</button>
      </div>
    </div>
    ${list.length
      ? `<div class="hist-grid">${list.map(card).join('')}</div>`
      : `<div class="empty-state small"><h2>Todavía no hay semestres cerrados</h2>
         <p>Cuando cierres un semestre desde la calculadora, aparecerá aquí con sus notas y resultados.</p></div>`}
    <p class="storage-note">Los datos se guardan en este navegador. Exporta un respaldo de vez en cuando para no perderlos si borras el historial de navegación o cambias de equipo.</p>`;
}

function confirmDelete(sem) {
  openModal({
    title: `¿Eliminar ${semLabel(sem).toLowerCase()}?`,
    body: `<p>Se borrarán sus materias, notas y configuración${sem.periodo ? ` del periodo <strong>${esc(sem.periodo)}</strong>` : ''}. Esta acción no se puede deshacer.</p>`,
    actions: [
      { label: 'Cancelar', variant: 'secondary' },
      { label: 'Eliminar semestre', variant: 'danger', onClick: () => {
          state.semesters = state.semesters.filter(s => s.id !== sem.id);
          ui.histId = null; ui.editing = false;
          save(); render(); toast('Semestre eliminado');
        } },
    ],
  });
}

function exportData() {
  const data = { app: 'promedio-uam', version: 2, exportedAt: new Date().toISOString(), semesters: state.semesters };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `promedio-uam-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Respaldo exportado');
}

// Contenido comparable de un semestre (sin marcas de tiempo).
const semContent = s => JSON.stringify({ n: s.numero, p: s.periodo, c: s.closed, cfg: s.cfg, m: s.materias });

// Combina el archivo con lo que ya hay, sin borrar nada:
// - el semestre activo del archivo queda en la Calculadora, y el activo actual pasa a Historial;
// - semestres cerrados nuevos se agregan al historial;
// - si el mismo semestre cerrado existe en ambos lados con cambios, se queda la versión editada más recientemente.
function mergeSemesters(current, incoming) {
  const list = current.map(s => ({ ...s }));
  const res = { added: 0, updated: 0, same: 0, newActive: null, movedToHistory: null };
  const incActive = incoming.find(s => !s.closed) || null;

  if (incActive) {
    const curActive = list.find(s => !s.closed);
    if (curActive && curActive.id !== incActive.id) {
      curActive.closed = true;
      curActive.closedAt = new Date().toISOString();
      curActive.updatedAt = curActive.closedAt;
      res.movedToHistory = curActive;
    }
    res.newActive = incActive;
  }

  incoming.forEach(inc => {
    const i = list.findIndex(s => s.id === inc.id);
    if (i === -1) { list.push({ ...inc }); res.added++; return; }
    if (semContent(list[i]) === semContent(inc)) { res.same++; return; }
    if (inc === incActive || String(inc.updatedAt) > String(list[i].updatedAt)) {
      list[i] = { ...inc }; res.updated++;
    } else {
      res.same++;
    }
  });
  return { list: enforceSingleActive(list), ...res };
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.semesters)) {
      openModal({ title: 'No se pudo importar',
        body: '<p>El archivo no es un respaldo válido de esta calculadora. Usa un archivo generado con “Exportar respaldo”.</p>',
        actions: [{ label: 'Entendido', variant: 'secondary' }] });
      return;
    }
    const incoming = enforceSingleActive(parsed.semesters.map(normalizeSem));
    const m = mergeSemesters(state.semesters, incoming);
    const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
    const lines = [
      m.added ? `<li><strong>${plural(m.added, 'semestre nuevo', 'semestres nuevos')}</strong> se agregarán.</li>` : '',
      m.updated ? `<li><strong>${plural(m.updated, 'semestre', 'semestres')}</strong> se actualizará${m.updated === 1 ? '' : 'n'} con la versión más reciente del archivo.</li>` : '',
      m.same ? `<li>${plural(m.same, 'semestre ya estaba', 'semestres ya estaban')} y no cambia${m.same === 1 ? '' : 'n'}.</li>` : '',
    ].join('');
    const semTxt = x => `${esc(semLabel(x))}${x.periodo ? ` (${esc(x.periodo)})` : ''}`;
    const activeInfo = m.newActive
      ? `<div class="callout info">${semTxt(m.newActive)} del archivo quedará en la Calculadora.${m.movedToHistory ? ` Tu semestre activo actual, ${semTxt(m.movedToHistory)}, pasará a Historial con sus notas.` : ''}</div>`
      : '';
    const nothing = !m.added && !m.updated && !m.movedToHistory;
    openModal({
      title: 'Importar respaldo',
      body: `<p>El archivo tiene <strong>${plural(incoming.length, 'semestre', 'semestres')}</strong>. Al combinarlo no se borra nada de lo que tienes:</p>
        ${activeInfo}
        ${lines ? `<ul class="import-list">${lines}</ul>` : ''}
        ${nothing ? '<p>No hay nada nuevo que agregar.</p>' : ''}
        <p class="import-note">“Reemplazar todo” descarta tus datos actuales y deja solo los del archivo.</p>`,
      actions: [
        { label: 'Cancelar', variant: 'ghost' },
        { label: 'Reemplazar todo', variant: 'danger', onClick: () => {
            openModal({
              title: '¿Reemplazar todos tus datos?',
              body: `<p>Se borrarán tus <strong>${plural(state.semesters.length, 'semestre', 'semestres')}</strong> actuales y quedarán solo los <strong>${incoming.length}</strong> del archivo. No se puede deshacer.</p>`,
              actions: [
                { label: 'Cancelar', variant: 'secondary' },
                { label: 'Reemplazar todo', variant: 'danger', onClick: () => {
                    state.semesters = incoming;
                    ui.histId = null; ui.editing = false; ui.tab = 'calc';
                    save(); render(); toast('Datos reemplazados');
                  } },
              ],
            });
          } },
        { label: 'Combinar', variant: 'primary', onClick: () => {
            state.semesters = m.list;
            ui.histId = null; ui.editing = false;
            if (m.newActive) ui.tab = 'calc';
            save(); render();
            toast(nothing ? 'No había cambios que importar' : 'Respaldo combinado');
          } },
      ],
    });
  };
  reader.readAsText(file);
}

/* ═════════════════════════ EDITOR DE MATERIAS (compartido) ═════════════════════════ */
function mountMateriasEditor(container, list, onChange) {
  let addTipo = 'cortes';
  container.innerHTML = `
    <div class="me">
      <div class="me-add">
        <label class="field grow"><span class="label">Nombre</span><input type="text" data-me="name" placeholder="Ej. Bases de Datos II" maxlength="80"></label>
        <label class="field w-cred"><span class="label">Créditos</span><input type="number" data-me="cred" min="1" max="10" value="3"></label>
        <div class="field"><span class="label">Evaluación</span>
          <div class="seg" role="group" aria-label="Forma de evaluación">
            <button type="button" class="seg-btn" data-me-tipo="cortes" aria-pressed="true">3 cortes</button>
            <button type="button" class="seg-btn" data-me-tipo="unico" aria-pressed="false">Nota única</button>
          </div>
        </div>
        <button class="btn btn-primary" data-me="add">Agregar</button>
      </div>
      <div class="me-list" data-me="list"></div>
    </div>`;
  const listEl = $('[data-me="list"]', container);
  const nameEl = $('[data-me="name"]', container);
  const credEl = $('[data-me="cred"]', container);

  const row = m => `
    <div class="me-row" data-id="${esc(m.id)}">
      <input class="me-name" type="text" value="${esc(m.nombre)}" placeholder="Nombre de la materia" data-f="nombre" aria-label="Nombre de la materia" maxlength="80">
      <input class="me-cred" type="number" min="1" max="10" value="${m.creditos}" data-f="creditos" aria-label="Créditos">
      <div class="seg" role="group" aria-label="Forma de evaluación">
        <button type="button" class="seg-btn" data-f="tipo" data-t="cortes" aria-pressed="${m.tipo === 'cortes'}">3 cortes</button>
        <button type="button" class="seg-btn" data-f="tipo" data-t="unico" aria-pressed="${m.tipo === 'unico'}">Única</button>
      </div>
      <button type="button" class="icon-btn del" data-f="del" aria-label="Eliminar ${esc(m.nombre || 'materia')}">${ICON.x}</button>
    </div>`;

  const draw = () => {
    const creds = list.reduce((s, m) => s + m.creditos, 0);
    listEl.innerHTML = list.length
      ? list.map(row).join('') + `<p class="me-total">${list.length} materia${list.length !== 1 ? 's' : ''}, ${creds} créditos</p>`
      : '<p class="me-empty">Todavía no hay materias. Agrega la primera con el formulario de arriba.</p>';
  };
  const findM = el => { const r = el.closest('.me-row'); return r ? list.find(m => m.id === r.dataset.id) : null; };

  const add = () => {
    const nombre = nameEl.value.trim();
    if (!nombre) { nameEl.setAttribute('aria-invalid', 'true'); nameEl.focus(); return; }
    nameEl.removeAttribute('aria-invalid');
    list.push(normalizeMat({ id: uid('mat'), nombre, creditos: int(credEl.value, 3), tipo: addTipo, notas: [] }));
    nameEl.value = ''; credEl.value = '3';
    draw(); onChange();
    listEl.scrollTop = listEl.scrollHeight;
    nameEl.focus();
  };

  container.onclick = e => {
    const t = e.target.closest('button'); if (!t || !container.contains(t)) return;
    if (t.dataset.me === 'add') return add();
    if (t.dataset.meTipo) {
      addTipo = t.dataset.meTipo;
      $$('[data-me-tipo]', container).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.meTipo === addTipo)));
      return;
    }
    const m = findM(t); if (!m) return;
    if (t.dataset.f === 'del') {
      list.splice(list.indexOf(m), 1); draw(); onChange();
    } else if (t.dataset.f === 'tipo' && m.tipo !== t.dataset.t) {
      m.tipo = t.dataset.t; m.notas = m.tipo === 'unico' ? [null] : [null, null, null];
      draw(); onChange();
    }
  };
  container.oninput = e => {
    const t = e.target;
    if (t === nameEl) { nameEl.removeAttribute('aria-invalid'); return; }
    const m = findM(t); if (!m) return;
    if (t.dataset.f === 'nombre') { m.nombre = t.value; onChange(); }
    else if (t.dataset.f === 'creditos') {
      m.creditos = clamp(int(t.value, 1), 1, 10); onChange();
      const tot = $('.me-total', listEl);
      if (tot) tot.textContent = `${list.length} materia${list.length !== 1 ? 's' : ''}, ${list.reduce((s, x) => s + x.creditos, 0)} créditos`;
    }
  };
  container.onchange = e => {
    const t = e.target; const m = findM(t);
    if (m && t.dataset.f === 'creditos') t.value = m.creditos;
  };
  container.onkeydown = e => { if (e.key === 'Enter' && (e.target === nameEl || e.target === credEl)) { e.preventDefault(); add(); } };

  draw();
  return { focus: () => nameEl.focus() };
}

/* ═════════════════════════ VISTA COMPLETA DE MATERIAS ═════════════════════════ */
function openMaterias(sem) {
  $('#mat-title').textContent = `Materias, ${semLabel(sem).toLowerCase()}`;
  const ed = mountMateriasEditor($('#mat-body'), sem.materias, () => { touch(sem); save(); render(); });
  $('#mat-overlay').hidden = false;
  lockScroll();
  ed.focus();
}
function closeMaterias() {
  $('#mat-overlay').hidden = true;
  lockScroll();
  render();
}

/* ═════════════════════════ WIZARD ═════════════════════════ */
let wiz = null;

function openWizard() {
  if (activeSem()) return;
  const last = lastClosed();
  const vals = { numero: '', periodo: guessPeriod(), prev: '', prevCreds: '', plan: '', aprobados: '', meta: '4.2' };
  let note = null;
  if (last) {
    const r = compute(last);
    const lc = last.cfg;
    Object.assign(vals, {
      numero: last.numero ? String(last.numero + 1) : '',
      periodo: nextPeriod(last.periodo) || guessPeriod(),
      prev: String(lc.prev), prevCreds: String(lc.prevCreds),
      plan: String(lc.plan), aprobados: String(lc.aprobados), meta: String(lc.meta),
    });
    if (r.allComplete) {
      const aprob = last.materias.reduce((s, m) => { const f = r.finals[m.id]; return s + (f.complete && f.final >= 3 ? m.creditos : 0); }, 0);
      vals.prev = trunc4(r.acum).toFixed(4);
      vals.prevCreds = String(lc.prevCreds + r.actual);
      vals.aprobados = String(lc.aprobados + aprob);
      note = { kind: 'info', text: `Valores calculados con el cierre de ${semLabel(last).toLowerCase()}: promedio anterior ${vals.prev}, se sumaron ${r.actual} créditos cursados y ${aprob} aprobados. Ajústalos si tus datos oficiales son distintos.` };
    } else {
      note = { kind: 'warn', text: `${semLabel(last)} quedó con notas pendientes, así que sus valores se copiaron sin actualizar. Revísalos con tus datos oficiales.` };
    }
  } else {
    note = { kind: 'info', text: 'Si es tu primer semestre, pon 0 en el promedio anterior y en los créditos cursados antes.' };
  }
  wiz = { step: 0, materias: [], vals, note, basedOn: last ? semLabel(last) : null };
  $('#wiz-sub').textContent = last ? `Basado en ${semLabel(last).toLowerCase()}${last.periodo ? ', ' + last.periodo : ''}.` : 'Configura tu semestre en tres pasos.';
  $('#wizard').hidden = false;
  lockScroll();
  drawWizard();
}

function closeWizard() {
  wiz = null;
  $('#wizard').hidden = true;
  $('#wiz-body').onclick = $('#wiz-body').oninput = $('#wiz-body').onchange = $('#wiz-body').onkeydown = null;
  lockScroll();
  render();
}

function cancelWizard() {
  if (!wiz) return;
  if (!wiz.materias.length) return closeWizard();
  openModal({
    title: '¿Descartar el nuevo semestre?',
    body: '<p>Se perderán las materias y la configuración que llevas en el asistente.</p>',
    actions: [
      { label: 'Seguir editando', variant: 'secondary' },
      { label: 'Descartar', variant: 'danger', onClick: closeWizard },
    ],
  });
}

function drawWizard() {
  const s = wiz.step;
  $('#wiz-steps').innerHTML = STEPS.map((label, i) => {
    const st = i < s ? 'done' : i === s ? 'current' : 'todo';
    return `<li class="step" data-state="${st}" ${i === s ? 'aria-current="step"' : ''}>
      <span class="step-num">${i < s ? ICON.check : i + 1}</span><span class="step-label">${label}</span></li>`;
  }).join('');
  $('#wiz-error').textContent = '';
  const body = $('#wiz-body');
  body.onclick = body.oninput = body.onchange = body.onkeydown = null;
  body.scrollTop = 0;

  if (s === 0) {
    const ed = mountMateriasEditor(body, wiz.materias, () => { $('#wiz-error').textContent = ''; });
    ed.focus();
  } else if (s === 1) {
    drawWizConfig(body);
  } else {
    drawWizSummary(body);
  }
  $('[data-wiz="back"]').disabled = s === 0;
  $('[data-wiz="next"]').textContent = s === 2 ? 'Crear semestre' : 'Siguiente';
}

function drawWizConfig(body) {
  const v = wiz.vals;
  const actual = wiz.materias.reduce((a, m) => a + m.creditos, 0);
  const f = (label, key, attrs, hint = '') => fieldHTML(label, 'w', key, { ...attrs, value: v[key] }, false, hint);
  body.innerHTML = `
    <div class="wiz-form">
      ${wiz.note ? `<div class="callout ${wiz.note.kind}">${esc(wiz.note.text)}</div>` : ''}
      <div class="form">
        <div class="grid2">
          ${f('Semestre', 'numero', { type: 'number', min: 1, max: 20, step: 1, placeholder: '7' })}
          ${f('Periodo', 'periodo', { type: 'text', placeholder: '2026-2', maxlength: 6 })}
        </div>
        ${f('Promedio acumulado anterior', 'prev', { type: 'number', min: 0, max: 5, step: '0.0001', placeholder: '4.2000' })}
        <div class="grid2">
          ${f('Créditos cursados antes', 'prevCreds', { type: 'number', min: 0, step: 1, placeholder: '91' })}
          <div class="field"><span class="label">Créditos del semestre</span><output class="computed">${actual}</output></div>
        </div>
        <div class="field"><span class="label">Créditos inscritos totales</span><output class="computed" data-wz="total"></output></div>
        <div class="grid2">
          ${f('Créditos plan carrera', 'plan', { type: 'number', min: 1, step: 1, placeholder: '175' })}
          ${f('Créditos aprobados', 'aprobados', { type: 'number', min: 0, step: 1, placeholder: '91' })}
        </div>
        ${f('Meta de promedio (beca o distinción)', 'meta', { type: 'number', min: 0, max: 5, step: '0.1' })}
      </div>
    </div>`;
  const upd = () => { $('[data-wz="total"]', body).textContent = Math.max(0, int(v.prevCreds, 0)) + actual; };
  body.oninput = e => {
    const k = e.target.dataset.w; if (!k) return;
    v[k] = e.target.value;
    e.target.removeAttribute('aria-invalid');
    $('#wiz-error').textContent = '';
    upd();
  };
  upd();
  $('[data-w="numero"]', body).focus();
}

function drawWizSummary(body) {
  const v = wiz.vals;
  const creds = wiz.materias.reduce((a, m) => a + m.creditos, 0);
  const row = (k, val) => `<dt>${k}</dt><dd>${val}</dd>`;
  body.innerHTML = `
    <div class="summary">
      <section>
        <div class="sum-sec-head"><h3>Semestre</h3><button class="btn btn-ghost btn-sm" data-goto="1">Cambiar</button></div>
        <p class="sum-big">${int(v.numero)}° semestre<span>${esc(v.periodo.trim())}</span></p>
      </section>
      <section>
        <div class="sum-sec-head"><h3>Materias (${wiz.materias.length}, ${creds} créditos)</h3><button class="btn btn-ghost btn-sm" data-goto="0">Cambiar</button></div>
        <table class="sum-table"><tbody>
          ${wiz.materias.map(m => `<tr><td>${esc(m.nombre)}</td><td class="r mono">${m.creditos} cr</td><td class="r mono">${m.tipo === 'unico' ? 'Nota única' : '3 cortes'}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section>
        <div class="sum-sec-head"><h3>Configuración</h3><button class="btn btn-ghost btn-sm" data-goto="1">Cambiar</button></div>
        <dl class="sum-dl">
          ${row('Promedio acumulado anterior', fmt4(num(v.prev)))}
          ${row('Créditos cursados antes', int(v.prevCreds))}
          ${row('Créditos inscritos totales', int(v.prevCreds) + creds)}
          ${row('Créditos plan carrera', int(v.plan))}
          ${row('Créditos aprobados', int(v.aprobados))}
          ${row('Meta de promedio', num(v.meta).toFixed(2))}
        </dl>
      </section>
    </div>`;
  body.onclick = e => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    wiz.step = +b.dataset.goto; drawWizard();
  };
}

function validateWizMaterias() {
  if (!wiz.materias.length) return 'Agrega al menos una materia para continuar.';
  if (wiz.materias.some(m => !m.nombre.trim())) return 'Hay materias sin nombre. Escríbelo o elimínalas.';
  return null;
}

function validateWizConfig() {
  const v = wiz.vals;
  const errs = [];
  const n = int(v.numero, NaN);
  if (!(n >= 1 && n <= 20)) errs.push(['numero', 'Indica el número de semestre (de 1 a 20).']);
  if (!isPeriod(v.periodo)) errs.push(['periodo', PERIOD_MSG]);
  const p = num(v.prev, NaN);
  if (!(p >= 0 && p <= 5)) errs.push(['prev', 'El promedio anterior debe estar entre 0 y 5.']);
  const pc = int(v.prevCreds, NaN);
  if (!(pc >= 0)) errs.push(['prevCreds', 'Indica los créditos cursados antes (0 si es tu primer semestre).']);
  const pl = int(v.plan, NaN);
  if (!(pl >= 1)) errs.push(['plan', 'Indica los créditos del plan de carrera.']);
  const ap = int(v.aprobados, NaN);
  if (!(ap >= 0)) errs.push(['aprobados', 'Indica los créditos aprobados (0 si aún no tienes).']);
  else if (pl >= 1 && ap > pl) errs.push(['aprobados', 'Los créditos aprobados no pueden superar los del plan.']);
  const mt = num(v.meta, NaN);
  if (!(mt > 0 && mt <= 5)) errs.push(['meta', 'La meta debe estar entre 0 y 5.']);
  return errs;
}

function wizNext() {
  if (!wiz) return;
  const errEl = $('#wiz-error');
  if (wiz.step === 0) {
    const err = validateWizMaterias();
    if (err) { errEl.textContent = err; return; }
  } else if (wiz.step === 1) {
    const errs = validateWizConfig();
    $$('[data-w]', $('#wiz-body')).forEach(i => i.removeAttribute('aria-invalid'));
    if (errs.length) {
      errs.forEach(([k]) => $(`[data-w="${k}"]`, $('#wiz-body'))?.setAttribute('aria-invalid', 'true'));
      errEl.textContent = errs[0][1];
      $(`[data-w="${errs[0][0]}"]`, $('#wiz-body'))?.focus();
      return;
    }
  } else {
    return createFromWizard();
  }
  wiz.step++;
  drawWizard();
}

function createFromWizard() {
  const v = wiz.vals;
  const sem = normalizeSem({
    id: uid('sem'),
    numero: int(v.numero),
    periodo: String(v.periodo).trim(),
    closed: false,
    cfg: { prev: num(v.prev), prevCreds: int(v.prevCreds), plan: int(v.plan), aprobados: int(v.aprobados), meta: num(v.meta) },
    materias: wiz.materias,
  });
  state.semesters.push(sem);
  save();
  ui.tab = 'calc';
  closeWizard();
  toast(`${semLabel(sem)} creado`);
}

/* ═════════════════════════ CIERRE DE SEMESTRE ═════════════════════════ */
function startCloseFlow() {
  const sem = activeSem(); if (!sem) return;
  if (!sem.materias.length) {
    openModal({ title: 'No hay nada que cerrar',
      body: '<p>Agrega al menos una materia antes de cerrar el semestre.</p>',
      actions: [{ label: 'Entendido', variant: 'secondary' }] });
    return;
  }
  const r = compute(sem);
  const pend = sem.materias.filter(m => !r.finals[m.id].complete).length;
  const body = `
    <p>${esc(semLabel(sem))}${sem.periodo ? ` (${esc(sem.periodo)})` : ''} pasará a Historial con sus notas y resultados, y la calculadora quedará libre para un semestre nuevo.</p>
    ${pend
      ? `<div class="callout warn"><strong>${pend} materia${pend !== 1 ? 's' : ''} sin nota final.</strong> Si cierras ahora, el semestre se guardará sin resultado ni análisis. Podrás completar las notas después desde Historial con Editar.</div>`
      : `<p>Acumulado final: <strong>${fmt4(r.acum)}</strong>. Promedio del semestre: <strong>${fmt4(r.semProm)}</strong>.</p>`}`;
  openModal({
    title: '¿Cerrar el semestre?',
    body,
    actions: [
      { label: 'Cancelar', variant: 'secondary' },
      { label: pend ? 'Cerrar con notas pendientes' : 'Cerrar semestre', variant: pend ? 'danger' : 'primary', onClick: () => closeSemester(sem) },
    ],
  });
}

function closeSemester(sem) {
  sem.closed = true;
  sem.closedAt = new Date().toISOString();
  touch(sem);
  save(); render();
  const next = sem.numero ? `${sem.numero + 1}° semestre` : 'el siguiente semestre';
  openModal({
    title: `${semLabel(sem)} cerrado`,
    body: `<p>Lo encuentras en Historial cuando quieras revisarlo. ¿Configuramos ${next} ahora?</p>`,
    actions: [
      { label: 'Más tarde', variant: 'secondary' },
      { label: `Iniciar ${next}`, variant: 'primary', onClick: () => { openWizard(); } },
    ],
  });
}

/* ═════════════════════════ MIGRACIÓN DESDE LA VERSIÓN ANTERIOR ═════════════════════════ */
function askMigrationInfo() {
  const sem = activeSem(); if (!sem) return;
  openModal({
    title: 'Tus datos se conservaron',
    dismissible: false,
    body: `<p>Tu calculadora anterior ahora es el semestre activo. Indica qué semestre y periodo es para ordenarlo en el historial.</p>
      <div class="grid2">
        <label class="field"><span class="label">Semestre</span><input type="number" min="1" max="20" data-mig="numero" placeholder="7"></label>
        <label class="field"><span class="label">Periodo</span><input type="text" maxlength="6" data-mig="periodo" value="${esc(guessPeriod())}"></label>
      </div>
      <p class="wiz-error" data-mig="err"></p>`,
    actions: [{ label: 'Guardar', variant: 'primary', onClick: wrap => {
      const nEl = $('[data-mig="numero"]', wrap), pEl = $('[data-mig="periodo"]', wrap), err = $('[data-mig="err"]', wrap);
      const n = int(nEl.value, NaN), p = pEl.value.trim();
      nEl.removeAttribute('aria-invalid'); pEl.removeAttribute('aria-invalid');
      if (!(n >= 1 && n <= 20)) { nEl.setAttribute('aria-invalid', 'true'); err.textContent = 'Indica el número de semestre (de 1 a 20).'; nEl.focus(); return false; }
      if (!isPeriod(p)) { pEl.setAttribute('aria-invalid', 'true'); err.textContent = PERIOD_MSG; pEl.focus(); return false; }
      sem.numero = n; sem.periodo = p; touch(sem);
      save(); render();
    } }],
  });
}

/* ═════════════════════════ MODAL, TOAST, SCROLL ═════════════════════════ */
function openModal({ title, body, actions = [], dismissible = true }) {
  const root = $('#modal-root');
  const lastFocus = document.activeElement;
  const id = uid('mt');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${id}">
      <div class="modal-head"><h2 id="${id}">${esc(title)}</h2></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    </div>`;
  const close = () => { wrap.remove(); lockScroll(); lastFocus?.focus?.(); };
  wrap.__dismiss = dismissible ? close : null;
  const foot = $('.modal-foot', wrap);
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = `btn btn-${a.variant || 'secondary'}`;
    b.textContent = a.label;
    b.onclick = () => {
      if (a.onClick && a.onClick(wrap) === false) return;
      close();
    };
    foot.appendChild(b);
  });
  if (dismissible) wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  root.appendChild(wrap);
  lockScroll();
  ($('input', wrap) || foot.lastElementChild)?.focus();
  return close;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function lockScroll() {
  const open = !$('#mat-overlay').hidden || !$('#wizard').hidden || $('#modal-root').children.length > 0;
  document.body.classList.toggle('locked', open);
}

/* ═════════════════════════ INICIO ═════════════════════════ */
(function init() {
  bindView($('#view-calc'));
  bindView($('#view-hist'));

  $$('.tab').forEach(t => t.addEventListener('click', () => {
    if (ui.tab === t.dataset.tab) {
      if (ui.tab === 'hist' && ui.histId) { ui.histId = null; ui.editing = false; render(); }
      return;
    }
    ui.tab = t.dataset.tab;
    ui.editing = false;
    render();
    window.scrollTo(0, 0);
  }));

  $('#fab').addEventListener('click', startCloseFlow);
  $('[data-mat="close"]').addEventListener('click', closeMaterias);
  $('#mat-overlay').addEventListener('mousedown', e => { if (e.target.id === 'mat-overlay') closeMaterias(); });

  $$('[data-wiz="cancel"]').forEach(b => b.addEventListener('click', cancelWizard));
  $('[data-wiz="back"]').addEventListener('click', () => { if (wiz && wiz.step > 0) { wiz.step--; drawWizard(); } });
  $('[data-wiz="next"]').addEventListener('click', wizNext);

  $('#import-input').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) handleImportFile(f);
    e.target.value = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const top = $('#modal-root').lastElementChild;
    if (top) { top.__dismiss?.(); return; }
    if (!$('#wizard').hidden) return cancelWizard();
    if (!$('#mat-overlay').hidden) return closeMaterias();
  });

  const status = load();
  render();
  if (status === 'migrated') askMigrationInfo();
  else if (!state.semesters.length) openWizard();
})();
