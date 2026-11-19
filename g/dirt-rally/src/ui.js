// Menus: main, stage select, how to play, settings, pause, results.
import { SCHEMA, S, setSetting, resetTab, isDefault } from './settings.js';
import { STAGES, custom, CAR } from './stages.js';
import { COND } from './world.js';
import { DS } from './track.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
export const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export function initUI(h) {
  const menu = $('menu'), screens = {};
  for (const s of menu.querySelectorAll('section')) screens[s.id.slice(4)] = s;
  let current = null, settingsBack = 'main', sel = STAGES[0], cond = localStorage.getItem('bf.cond') || 'dusk', customStage = null;
  if (!COND[cond]) cond = 'dusk';

  function show(name) {
    current = name; menu.style.display = name ? 'block' : 'none';
    for (const k in screens) screens[k].style.display = k === name ? 'flex' : 'none';
    $('pause').style.display = 'none';
    if (name === 'stage') renderStage();
    if (name === 'settings') renderSettings();
  }

  // ----- main -----
  screens.main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { settingsBack = 'main'; show(b.dataset.go); }));
  menu.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));
  function back() {
    if (current === 'settings' && settingsBack === 'pause') { menu.style.display = 'none'; current = null; $('pause').style.display = 'flex'; return; }
    if (current && current !== 'main') show('main');
  }

  // ----- stage select -----
  const list = $('stageList'), tracks = new Map();
  const trackOf = (st) => { if (!tracks.has(st.id)) tracks.set(st.id, h.track(st)); return tracks.get(st.id); };
  function drawMap(cv, T, pad = 14) {
    const g = cv.getContext('2d'), w = cv.width, hh = cv.height;
    g.clearRect(0, 0, w, hh);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = T.startI; i <= T.finishI; i += 3) { x0 = Math.min(x0, T.px[i]); x1 = Math.max(x1, T.px[i]); z0 = Math.min(z0, T.pz[i]); z1 = Math.max(z1, T.pz[i]); }
    const sc = Math.min((w - pad * 2) / (x1 - x0), (hh - pad * 2) / (z1 - z0 || 1));
    const X = (i) => pad + (T.px[i] - x0) * sc + ((w - pad * 2) - (x1 - x0) * sc) / 2, Z = (i) => pad + (T.pz[i] - z0) * sc + ((hh - pad * 2) - (z1 - z0) * sc) / 2;
    g.strokeStyle = '#efe9dc'; g.lineWidth = Math.max(1.5, w / 160); g.lineJoin = 'round'; g.beginPath();
    for (let i = T.startI; i <= T.finishI; i += 3) (i === T.startI ? g.moveTo(X(i), Z(i)) : g.lineTo(X(i), Z(i)));
    g.stroke();
    g.fillStyle = '#5fd07a'; g.beginPath(); g.arc(X(T.startI), Z(T.startI), w / 70 + 2, 0, 7); g.fill();
    g.fillStyle = '#e8b21c'; g.beginPath(); g.arc(X(T.finishI), Z(T.finishI), w / 70 + 2, 0, 7); g.fill();
  }
  function renderStage() {
    list.innerHTML = '';
    const all = customStage ? [...STAGES, customStage] : STAGES;
    for (const st of all) {
      const T = trackOf(st), b = el('button', 'stage' + (st === sel ? ' on' : ''));
      const cv = el('canvas'); cv.width = 120; cv.height = 60; drawMap(cv, T, 8); b.appendChild(cv);
      const best = h.best(st.id);
      b.appendChild(el('div', '', `<b>${st.name}</b><span>${(T.length / 1000).toFixed(1)} km · Gravel${best ? ' · <i>Best ' + fmtTime(best) + '</i>' : ''}</span>`));
      b.addEventListener('click', () => { sel = st; renderStage(); h.preview(sel, cond); });
      list.appendChild(b);
    }
    const T = trackOf(sel), best = h.best(sel.id);
    drawMap($('stageMap'), T);
    $('stageName').textContent = sel.name; $('stageBlurb').textContent = sel.blurb;
    $('stageStats').innerHTML = [[(T.length / 1000).toFixed(1) + ' km', 'Length'], [T.notes.length, 'Notes'], [T.notes.filter((n) => n.sev === 1).length, 'Hairpins'], ['Gravel', 'Surface'], [COND[cond].name, 'Conditions'], [best ? fmtTime(best) : '—', 'Your best']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const chips = $('condChips'); chips.innerHTML = '';
    for (const k in COND) { const c = el('button', 'chip' + (k === cond ? ' on' : ''), COND[k].name); c.addEventListener('click', () => { cond = k; localStorage.setItem('bf.cond', k); renderStage(); h.preview(sel, cond); }); chips.appendChild(c); }
    $('carLine').innerHTML = `<b>${CAR.name}</b><span>${CAR.spec}</span>`;
    $('startLine').textContent = `${sel.name} · ${COND[cond].name} · ${CAR.name}`;
  }
  $('customGo').addEventListener('click', () => { const n = Math.max(1, Math.min(9999, parseInt($('customN').value, 10) || 1)); customStage = custom(n); sel = customStage; renderStage(); h.preview(sel, cond); });
  $('startBtn').addEventListener('click', () => h.start(sel, cond));

  // ----- settings -----
  let tab = SCHEMA[0].tab;
  function renderSettings() {
    const nav = $('setTabs'), body = $('setBody'); nav.innerHTML = ''; body.innerHTML = '';
    for (const t of SCHEMA) { const b = el('button', t.tab === tab ? 'on' : '', t.tab); b.addEventListener('click', () => { tab = t.tab; renderSettings(); }); nav.appendChild(b); }
    for (const it of SCHEMA.find((t) => t.tab === tab).items) {
      const row = el('div', 'set');
      if (typeof it.def === 'boolean') {
        const lab = el('label', 'chk'), inp = el('input'); inp.type = 'checkbox'; inp.checked = S[it.k];
        inp.addEventListener('change', () => setSetting(it.k, inp.checked));
        lab.appendChild(inp); lab.appendChild(el('span', '', `<b>${it.label}</b><small>${it.hint}</small>`)); row.appendChild(lab);
      } else if (it.options) {
        row.appendChild(el('div', 'lbl', `<b>${it.label}</b>`));
        const sl = el('select'); for (const [v, t] of it.options) { const o = el('option', '', t); o.value = v; sl.appendChild(o); }
        sl.value = S[it.k]; sl.addEventListener('change', () => setSetting(it.k, sl.value)); row.appendChild(sl);
        row.appendChild(el('small', '', it.hint));
      } else {
        const val = el('span'), head = el('div', 'lbl', `<b>${it.label}</b>`); head.appendChild(val); row.appendChild(head);
        const inp = el('input'); inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step; inp.value = S[it.k];
        const upd = () => { val.textContent = it.fmt(S[it.k]) + (isDefault(it) ? ' · default' : ''); inp.style.setProperty('--f', ((S[it.k] - it.min) / (it.max - it.min) * 100) + '%'); };
        inp.addEventListener('input', () => { setSetting(it.k, parseFloat(inp.value)); upd(); });
        inp.addEventListener('dblclick', () => { setSetting(it.k, it.def); inp.value = it.def; upd(); });
        upd(); row.appendChild(inp); if (it.hint) row.appendChild(el('small', '', it.hint));
      }
      body.appendChild(row);
    }
    const rs = el('button', 'ghost', 'Reset ' + tab.toLowerCase() + ' to defaults'); rs.addEventListener('click', () => { resetTab(tab); renderSettings(); }); body.appendChild(rs);
  }

  // ----- pause / results -----
  const act = { resume: h.resume, restart: h.restart, settings: () => { settingsBack = 'pause'; $('pause').style.display = 'none'; show('settings'); }, stages: () => h.quit('stage'), quit: () => h.quit('main') };
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act[b.dataset.act]()));
  function showPause(on) { $('pause').style.display = on ? 'flex' : 'none'; if (!on) { menu.style.display = 'none'; current = null; } }
  function showFinish(d) {
    $('finalTime').textContent = d ? fmtTime(d.time) : '';
    if (d) $('finalBest').textContent = (d.isBest ? 'New personal best' : 'Best ' + fmtTime(d.best)) + (d.penalty ? ` · includes ${d.penalty} s of penalties` : '');
    $('panel').style.display = d ? 'flex' : 'none';
  }
  const setLoading = (on, txt) => { $('loading').style.display = on ? 'flex' : 'none'; if (txt) $('loadTxt').textContent = txt; };

  return { show, back, showPause, showFinish, setLoading, drawMap, get current() { return current; }, get inSettingsFromPause() { return current === 'settings' && settingsBack === 'pause'; } };
}
export { DS };
