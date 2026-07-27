const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const FORMATS = ['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif'];
const TOP = 104;
const BOT = 92;
const PAD_X = 8;

let DATA = null;
let NODES = [];
let EDGES = [];
let MARKS = {};
// One <g> per tool, built once and reused across every render. Detaching them
// with innerHTML does not invalidate these references, so the logos survive.
const TILES = new Map();
let STAGES = [];
let company = null;   // level 2
let person = null;    // level 3
let SEARCH = [];
let openTool = null;    // tool panel currently open, so the URL can carry it
let openFindingId = null;
let W = 1200, H = 700;

const $ = (id) => document.getElementById(id);
const svg = $('graph');

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

const stamp = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
           : `${m}:${String(sec).padStart(2, '0')}`;
};

const byId = (list, id) => list.find((d) => d.id === id);
const who = (id) => byId(DATA.designers, id);
const firmOf = (designerId) => byId(DATA.companies, who(designerId).companyId);
const staffOf = (companyId) => DATA.designers.filter((p) => p.companyId === companyId);
const deepLink = (p, at) => `${p.source.url}&t=${at}s`;
const firstName = (n) => n.split(' ')[0];
const stageOf = (n) => STAGES.find((s) => s.id === n.stage);
const stageLabel = (n) => (stageOf(n) || {}).label || '';
const andList = (items) => items.length < 2
  ? items.join('')
  : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/* ---------- shareable state ----------
 * Any view can be linked to and cited, which is also how a finding points at
 * its own evidence on the map. replaceState, not pushState: filtering is not
 * navigation, and it should not fill up the back button. */

function writeURL() {
  const q = new URLSearchParams();
  if (person) q.set('designer', person);
  else if (company) q.set('company', company);
  // Whatever is open is part of the view, so a copied URL reopens it.
  if (openTool) q.set('tool', openTool);
  if (openFindingId) q.set('finding', openFindingId);
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

function readURL() {
  const q = new URLSearchParams(location.search);
  const d = q.get('designer');
  if (d && who(d)) { person = d; company = who(d).companyId; }
  else {
    const c = q.get('company');
    if (c && byId(DATA.companies, c)) company = c;
  }
  return { tool: q.get('tool'), finding: q.get('finding') };
}

/** Everyone currently in scope: all, one company's people, or one person. */
function scope() {
  if (person) return [person];
  if (company) return staffOf(company).map((p) => p.id);
  return DATA.designers.map((p) => p.id);
}
const inScope = (designerId) => scope().includes(designerId);
const focused = () => !!(company || person);

function toolsInScope() {
  const s = new Set();
  const live = scope();
  DATA.uses.forEach((u) => { if (live.includes(u.designerId)) s.add(u.toolId); });
  DATA.moves.forEach((m) => {
    if (live.includes(m.designerId)) { s.add(m.from); s.add(m.to); }
  });
  return s;
}

/* ---------- layout: logo tiles packed into stage columns ---------- */

function computeLayout(nodes) {
  const bandW = (W - PAD_X * 2) / STAGES.length;
  STAGES.forEach((st, i) => {
    st.x0 = PAD_X + bandW * i;
    st.x = st.x0 + bandW / 2;
    st.w = bandW;
  });

  // Dispersed, not gridded. Tools scatter within their stage band and drift
  // toward whatever they connect to, so it reads as a canvas rather than a
  // table, while the bands still carry the meaning.
  const LANES = 5;
  const space = H - TOP - BOT;
  const laneY = (i) => TOP + (i / (LANES - 1)) * space;
  const jitter = (i) => { const x = Math.sin(i * 91.7) * 4371.3; return x - Math.floor(x); };

  const adj = new Map();
  EDGES.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  });

  const placed = [];
  const clear = (n, lane, x) => !placed.some((p) =>
    p !== n && p.lane === lane && Math.abs(x - p.x) < n.r + p.r + 54);

  // Filtered view (a company or one person). The corpus scatter is built for
  // 24 tools; with only a handful it reads as lonely islands and long stray
  // lines. So here we lay each stage out cleanly: horizontally centred in its
  // band, evenly stacked and vertically centred as a group. Calm and ordered.
  if (focused()) {
    const cy = TOP + (H - TOP - BOT) / 2;
    STAGES.forEach((st) => {
      const list = nodes.filter((n) => n.stage === st.id)
        .sort((a, b) => b.by.length - a.by.length);
      if (!list.length) return;
      const gap = Math.min(150, (H - TOP - BOT) / (list.length + 0.5));
      const total = (list.length - 1) * gap;
      list.forEach((n, i) => {
        n.x = st.x;
        n.y = cy - total / 2 + i * gap;
        n.lane = i;
      });
    });
    return;
  }

  STAGES.forEach((st, si) => {
    const ranked = nodes.filter((n) => n.stage === st.id)
      .sort((a, b) => b.by.length - a.by.length);

    // Interleave big-to-small outward from the centre so the largest tiles
    // land mid-column (never jammed under the stage label) and each band uses
    // its full height instead of stacking top-heavy.
    const list = [];
    ranked.forEach((n, k) => (k % 2 ? list.push(n) : list.unshift(n)));

    // Spread each column across the full canvas height so no quadrant is
    // starved. Nodes bias toward what they connect to, but the base
    // distribution fills the frame evenly instead of clustering.
    list.forEach((n, i) => {
      const seed = si * 7 + i;
      n.x = st.x0 + st.w * (0.26 + jitter(seed) * 0.48);

      const links = (adj.get(n.id) || [])
        .map((id) => byId(nodes, id))
        .filter((m) => m && m.lane !== undefined);
      // Even spread across lanes as the anchor, nudged toward connections.
      const spread = list.length > 1 ? (i / (list.length - 1)) * (LANES - 1) : (LANES - 1) / 2;
      const pull = links.length
        ? links.reduce((s, m) => s + m.lane, 0) / links.length
        : spread;
      const target = spread * 0.72 + pull * 0.28;

      let best = 0, bestScore = Infinity;
      for (let lane = 0; lane < LANES; lane++) {
        let score = Math.abs(lane - target) * 1.1 + (clear(n, lane, n.x) ? 0 : 80);
        if (score < bestScore) { bestScore = score; best = lane; }
      }
      n.lane = best;
      n.y = laneY(best);
      placed.push(n);
    });
  });

  // Anything still crowding a neighbour moves to open space, first sideways
  // within its own band, then to an adjacent lane. Offsets are wide enough to
  // clear the same-lane spacing threshold even for two large tiles.
  for (let pass = 0; pass < 6; pass++) {
    placed.forEach((n) => {
      if (clear(n, n.lane, n.x)) return;
      const st = STAGES.find((s) => s.id === n.stage);
      for (const dx of [40, -40, 80, -80, 120, -120]) {
        const x = n.x + dx;
        if (x > st.x0 + n.r + 8 && x < st.x0 + st.w - n.r - 8 && clear(n, n.lane, x)) { n.x = x; return; }
      }
      for (const lane of [n.lane - 1, n.lane + 1, n.lane - 2, n.lane + 2]) {
        if (lane < 0 || lane >= LANES) continue;
        if (clear(n, lane, n.x)) { n.lane = lane; n.y = laneY(lane); return; }
      }
    });
  }

  // Guaranteed no-overlap pass. The lane logic above is best-effort and can
  // still leave two tiles touching (e.g. a crowded column). This does real
  // geometric collision resolution: any overlapping pair is pushed apart until
  // clear, so on the default screen no two logos ever sit on one another.
  const GAP = 26; // breathing room between tiles, on top of their radii
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r + GAP;
        let dist = Math.hypot(dx, dy);
        if (dist >= min) continue;
        if (dist < 0.01) { dx = 0; dy = (j % 2 ? 1 : -1); dist = 1; } // exact stack
        const push = (min - dist) / 2;
        const ux = dx / dist, uy = dy / dist;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    // Keep everyone inside their stage band and the vertical canvas.
    placed.forEach((n) => {
      const st = STAGES.find((s) => s.id === n.stage);
      n.x = Math.max(st.x0 + n.r + 8, Math.min(st.x0 + st.w - n.r - 8, n.x));
      n.y = Math.max(TOP + n.r, Math.min(H - BOT - n.r, n.y));
    });
    if (!moved) break;
  }
}

/* ---------- rendering ---------- */

function edgePath(e) {
  const a = byId(NODES, e.from), b = byId(NODES, e.to);
  if (!a || !b) return '';
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const sx = a.x + ux * (a.r + 6), sy = a.y + uy * (a.r + 6);
  const ex = b.x - ux * (b.r + 10), ey = b.y - uy * (b.r + 10);
  const bow = (e.dir || 1) * Math.min(38, d * 0.12);
  const mx = (sx + ex) / 2 - uy * bow, my = (sy + ey) / 2 + ux * bow;
  return `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

function appendMark(g, n, size) {
  const m = MARKS[n.id];
  if (!m) {
    const t = el('text', { class: 'node-mono', x: 0, y: n.r * 0.17 });
    t.setAttribute('font-size', Math.max(11, n.r * 0.5).toFixed(1));
    t.textContent = n.mono;
    g.appendChild(t);
    return;
  }
  if (m.type === 'img') {
    const img = el('image', {
      class: 'node-mark', x: -size / 2, y: -size / 2,
      width: size, height: size, preserveAspectRatio: 'xMidYMid meet'
    });
    img.setAttributeNS(XLINK, 'href', m.src);
    img.setAttribute('href', m.src);
    g.appendChild(img);
    return;
  }
  const holder = el('svg', {
    class: 'node-mark', x: -size / 2, y: -size / 2,
    width: size, height: size, viewBox: m.viewBox
  });
  // Monochrome marks are drawn dark, because the tile behind them is light.
  if (m.mono) holder.style.color = '#2a2a2a';
  holder.innerHTML = m.inner;
  g.appendChild(holder);
}

function render(nodes) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';

  const defs = el('defs');
  const marker = (id, fill) => {
    const m = el('marker', {
      id, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '7.5', markerHeight: '7.5', orient: 'auto-start-reverse'
    });
    m.appendChild(el('path', { d: 'M1,1.8 L9,5 L1,8.2 z', fill }));
    return m;
  };
  defs.appendChild(marker('arw', 'var(--edge)'));
  defs.appendChild(marker('arw-on', 'var(--accent)'));

  // Elevation is what stops the tiles reading as flat stickers.
  const lift = el('filter', { id: 'lift', x: '-60%', y: '-60%', width: '220%', height: '220%' });
  lift.appendChild(el('feDropShadow', {
    dx: '0', dy: '3', stdDeviation: '4', 'flood-color': '#000', 'flood-opacity': '0.55'
  }));
  defs.appendChild(lift);
  svg.appendChild(defs);

  const gBands = el('g');
  STAGES.forEach((st, i) => {
    // Faint alternating column fill so the five stages are felt as structure.
    // Tone, not rules. No dividers between columns, and the fill overshoots the
    // viewBox so the band has no top or bottom edge to read as a box. A phase
    // is felt as a change in surface, the way the header is.
    if (i % 2) gBands.appendChild(el('rect', {
      x: st.x0, y: -4, width: st.w, height: H + 8,
      fill: 'rgba(237, 237, 237, 0.032)'
    }));
    // No number on the label. These are phases, not steps, and people enter
    // wherever the work starts. Left to right already carries the flow.
    const lab = el('text', { class: 'band-label', x: st.x0 + 16, y: 34 });
    lab.textContent = st.label;
    gBands.appendChild(lab);
  });
  svg.appendChild(gBands);

  const gEdges = el('g');
  const gNodes = el('g');
  svg.appendChild(gEdges);
  svg.appendChild(gNodes);

  // Connections are always on. They carry the story of tool A into tool B,
  // which is the whole point. Focus just narrows and brightens them.
  const live = new Set(nodes.map((n) => n.id));
  const on = focused();
  EDGES.forEach((e) => {
    const mine = e.by.filter((m) => inScope(m.designerId));
    if (!mine.length || !live.has(e.from) || !live.has(e.to)) { e.el = null; e.hit = null; return; }
    const path = edgePath(e);
    const line = el('path', {
      class: 'edge', d: path,
      stroke: on ? 'var(--accent)' : 'var(--edge)',
      'stroke-width': on ? '1.3' : (0.9 + mine.length * 0.28).toFixed(2),
      'stroke-dasharray': '2 5',
      // Rest quietly; hover-focus and company filters do the storytelling.
      opacity: on ? '0.95' : '0.45',
      'marker-end': on ? 'url(#arw-on)' : 'url(#arw)'
    });
    const hit = el('path', { class: 'edge-hit', d: path });
    hit.addEventListener('mouseenter', (ev) => tipEdge(ev, e));
    hit.addEventListener('mousemove', moveTip);
    hit.addEventListener('mouseleave', hideTip);
    e.el = line; e.hit = hit;
    line.style.animationDelay = `${260 + Math.random() * 340}ms`;
    gEdges.appendChild(line);
    gEdges.appendChild(hit);
  });

  // Each tile is built once and kept. Filtering re-appends the same elements
  // rather than making new ones, because tearing down every <image> and
  // rebuilding it makes all 24 logos re-decode, and that is the flash you see
  // when picking a company. Only the transform changes between renders.
  nodes.forEach((n, i) => {
    let g = TILES.get(n.id);
    if (!g) {
      g = el('g', { class: 'node', tabindex: '0', role: 'button' });
      g.style.animationDelay = `${i * 22}ms`;   // stagger, for the boot intro only
      g.setAttribute('aria-label', `${n.name}, ${stageLabel(n)} stage`);

      g.appendChild(el('rect', {
        class: 'tile', x: -n.r, y: -n.r, width: n.r * 2, height: n.r * 2,
        rx: n.r * 0.32, filter: 'url(#lift)'
      }));
      appendMark(g, n, n.r * 1.16);

      const label = el('text', { class: 'node-label', x: 0, y: n.r + 16 });
      label.setAttribute('font-size', n.by.length >= 5 ? '12.5' : '11.5');
      label.textContent = n.name;
      g.appendChild(label);

      g.addEventListener('mouseenter', (ev) => { if (!n.dragging) { tipNode(ev, n); focusNode(n); } });
      g.addEventListener('mousemove', (ev) => { if (!n.dragging) moveTip(ev); });
      g.addEventListener('mouseleave', () => { hideTip(); clearFocus(); });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPanel(n); }
      });
      attachDrag(g, n);
      TILES.set(n.id, g);
    }
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.classList.remove('lit');
    n.el = g;
    gNodes.appendChild(g);
  });
}

/* ---------- drag ---------- */

function svgPoint(ev) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const i = ctm.inverse();
  return { x: ev.clientX * i.a + ev.clientY * i.c + i.e, y: ev.clientX * i.b + ev.clientY * i.d + i.f };
}

function refreshEdges(id) {
  EDGES.forEach((e) => {
    if (!e.el || (e.from !== id && e.to !== id)) return;
    const d = edgePath(e);
    e.el.setAttribute('d', d);
    if (e.hit) e.hit.setAttribute('d', d);
  });
}

function attachDrag(g, n) {
  let moved = false, ox = 0, oy = 0;
  g.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const p = svgPoint(ev);
    ox = p.x - n.x; oy = p.y - n.y;
    moved = false; n.dragging = true;
    hideTip();
    try { g.setPointerCapture(ev.pointerId); } catch (_) {}
    g.classList.add('dragging');
  });
  g.addEventListener('pointermove', (ev) => {
    if (!n.dragging) return;
    const p = svgPoint(ev);
    const nx = p.x - ox, ny = p.y - oy;
    if (Math.abs(nx - n.x) + Math.abs(ny - n.y) > 2) moved = true;
    n.x = Math.max(n.r, Math.min(W - n.r, nx));
    n.y = Math.max(n.r + 6, Math.min(H - n.r - 26, ny));
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    refreshEdges(n.id);
  });
  const end = (ev) => {
    if (!n.dragging) return;
    n.dragging = false;
    g.classList.remove('dragging');
    try { g.releasePointerCapture(ev.pointerId); } catch (_) {}
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
  g.addEventListener('click', () => { if (!moved) openPanel(n); moved = false; });
}

/* ---------- hover focus ---------- */

// Recede everything unrelated so the eye follows one tool's real handoffs.
function focusNode(n) {
  const related = new Set([n.id]);
  EDGES.forEach((e) => {
    if (!e.el) return;
    if (e.from === n.id || e.to === n.id) {
      e.el.classList.add('lit');
      related.add(e.from); related.add(e.to);
    }
  });
  NODES.forEach((m) => { if (m.el && related.has(m.id)) m.el.classList.add('lit'); });
  svg.classList.add('dimmed');
}

function clearFocus() {
  svg.classList.remove('dimmed');
  NODES.forEach((m) => m.el && m.el.classList.remove('lit'));
  EDGES.forEach((e) => e.el && e.el.classList.remove('lit'));
}

/* ---------- state ---------- */

function draw() {
  const box = $('canvasWrap').getBoundingClientRect();
  // Scale the coordinate space up relative to the real container so the fixed
  // size tiles render smaller with more breathing room, matching the calmer,
  // zoomed out feel of viewing the page at ~80% browser zoom, by default.
  const ZOOM_OUT = 1.25;
  W = Math.max(940, Math.round(box.width * ZOOM_OUT));
  H = Math.max(420, Math.round(box.height * ZOOM_OUT));

  const live = focused() ? toolsInScope() : null;
  const nodes = live ? NODES.filter((n) => live.has(n.id)) : NODES;

  computeLayout(nodes);
  render(nodes);
  renderRails();
  renderSummary();
  writeURL();

  // Play the entrance once, on first paint only.
  if (!draw.booted) {
    draw.booted = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      svg.classList.add('intro');
      setTimeout(() => svg.classList.remove('intro'), 1300);
    }
  }
}

/** Pick a company, or clear it by picking it again. */
function selectCompany(id, { toggle = true } = {}) {
  company = toggle && company === id ? null : id;
  person = null;
  draw();
}

function selectPerson(id) {
  const p = who(id);
  if (!p) return;
  if (person === id) { person = null; } else { person = id; company = p.companyId; }
  draw();
}

function renderRails() {
  $('who').innerHTML = DATA.companies.map((c) =>
    `<button class="chip" data-company="${c.id}" aria-pressed="${company === c.id}">${c.name}</button>`
  ).join('');

  const staff = company ? staffOf(company) : [];
  $('whoSub').innerHTML = staff.length > 1
    ? staff.map((p) =>
        `<button class="chip sub-chip" data-person="${p.id}" aria-pressed="${person === p.id}">${firstName(p.name)}<span class="role">${p.role}</span></button>`
      ).join('')
    : '';

  document.querySelectorAll('[data-company]').forEach((c) => {
    c.addEventListener('click', () => selectCompany(c.dataset.company));
  });
  document.querySelectorAll('[data-person]').forEach((c) => {
    c.addEventListener('click', () => selectPerson(c.dataset.person));
  });

  syncRail();
  // Keep the current company visible even when it sits off the end of the rail,
  // which is how you arrive here from search or a shared link.
  const active = $('who').querySelector('[aria-pressed="true"]');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/* ---------- rail ----------
 * The rail scrolls instead of wrapping, so the header keeps its shape however
 * many companies the corpus grows to. Arrows and edge fades only appear once
 * there is genuinely something out of view. */

function syncRail() {
  const box = $('whoScroll');
  if (!box) return;
  const max = box.scrollWidth - box.clientWidth;
  const overflowing = max > 1;
  const x = box.scrollLeft;
  const atStart = x <= 1;
  const atEnd = x >= max - 1;

  $('railPrev').hidden = !overflowing || atStart;
  $('railNext').hidden = !overflowing || atEnd;
  box.classList.toggle('fade-l', overflowing && !atStart);
  box.classList.toggle('fade-r', overflowing && !atEnd);
}

function pageRail(dir) {
  const box = $('whoScroll');
  box.scrollBy({ left: dir * Math.max(160, box.clientWidth * 0.8), behavior: 'smooth' });
}

/* ---------- search ----------
 * Companies and people share one field. Role is searchable too, so "Head of
 * Design" finds the people it should. */

function searchIndex() {
  const rows = DATA.companies.map((c) => ({
    kind: 'company', id: c.id, label: c.name,
    hint: andList(staffOf(c.id).map((p) => firstName(p.name))),
    hay: `${c.name} ${c.type} ${staffOf(c.id).map((p) => p.name + ' ' + p.role).join(' ')}`.toLowerCase()
  }));
  DATA.designers.forEach((p) => rows.push({
    kind: 'designer', id: p.id, label: p.name,
    hint: `${p.role}, ${firmOf(p.id).name}`,
    hay: `${p.name} ${p.role} ${firmOf(p.id).name}`.toLowerCase()
  }));
  return rows;
}

function runSearch(term) {
  const box = $('findResults');
  const q = term.trim().toLowerCase();
  if (!q) { box.hidden = true; box.innerHTML = ''; $('find').setAttribute('aria-expanded', 'false'); return; }

  // Prefix matches on the label first, then anything else that contains it.
  const hits = SEARCH.filter((r) => r.hay.includes(q)).sort((a, b) => {
    const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label);
  }).slice(0, 8);

  box.innerHTML = hits.length
    ? hits.map((r, i) => `<button class="find-hit" role="option" aria-selected="${i === 0}" ` +
        `data-kind="${r.kind}" data-id="${r.id}">${r.label}` +
        `<span class="find-hint">${r.hint}</span></button>`).join('')
    : `<p class="find-empty">Nothing matches that.</p>`;
  box.hidden = false;
  $('find').setAttribute('aria-expanded', 'true');
}

function closeSearch(clear) {
  $('findResults').hidden = true;
  $('find').setAttribute('aria-expanded', 'false');
  if (clear) $('find').value = '';
}

function takeHit(el) {
  if (!el) return;
  if (el.dataset.kind === 'company') selectCompany(el.dataset.id, { toggle: false });
  else selectPerson(el.dataset.id);
  closeSearch(true);
  $('find').blur();
}

function renderSummary() {
  const el2 = $('mode');
  if (person) {
    const p = who(person);
    el2.innerHTML = `<b>${p.name}</b><span class="role">, ${p.role} at ${firmOf(person).name}.</span> ${p.thesis}`;
    el2.classList.add('has-content');
    return;
  }
  if (company) {
    const c = byId(DATA.companies, company);
    const staff = staffOf(company);
    if (staff.length === 1) {
      const p = staff[0];
      el2.innerHTML = `<b>${c.name}</b><span class="role">, ${p.name}, ${p.role}.</span> ${p.thesis}`;
    } else {
      const names = andList(staff.map((p) => p.name));
      el2.innerHTML = `<b>${c.name}</b><span class="role">, ${names}.</span> Pick one to see their workflow.`;
    }
    el2.classList.add('has-content');
    return;
  }
  el2.innerHTML = '';
  el2.classList.remove('has-content');
}

/* ---------- tooltip ---------- */

// Nothing is counted or ranked in the copy. This is one designer's workflow at
// one company, not a popularity contest, so labels carry the stage and the
// people rather than a tally. Size stays the only quantitative encoding.

const tipRow = (text, designerId) =>
  `<span class="tip-row"><span class="dot"></span>${text} <i>${firstName(who(designerId).name)}, ${firmOf(designerId).name}</i></span>`;

function tipNode(ev, n) {
  const uses = DATA.uses.filter((u) => u.toolId === n.id && inScope(u.designerId));
  const shown = uses.slice(0, 3).map((u) => tipRow(u.purpose, u.designerId)).join('');
  const more = uses.length > 3 ? `<span class="tip-more micro">Click to read the rest</span>` : '';
  const kicker = focused()
    ? `${stageLabel(n)} &middot; ${firmOf(scope()[0]).name}`
    : stageLabel(n);
  $('tip').innerHTML = `<b>${n.name}</b><span class="tip-count micro">${kicker}</span>${shown ||
    '<span class="tip-row">Mentioned only as a step between other tools.</span>'}${more}`;
  $('tip').hidden = false;
  moveTip(ev);
}

function tipEdge(ev, e) {
  const from = byId(NODES, e.from), to = byId(NODES, e.to);
  const rows = e.by.filter((m) => inScope(m.designerId))
    .map((m) => tipRow(m.reason, m.designerId)).join('');
  const kicker = from.stage === to.stage
    ? `Within ${stageLabel(from)}`
    : `${stageLabel(from)} to ${stageLabel(to)}`;
  $('tip').innerHTML =
    `<b>${from.name} to ${to.name}</b>` +
    `<span class="tip-count micro">${kicker}</span>${rows}`;
  $('tip').hidden = false;
  moveTip(ev);
}

function moveTip(ev) {
  const tip = $('tip');
  const box = svg.parentElement.getBoundingClientRect();
  let x = ev.clientX - box.left + 18, y = ev.clientY - box.top + 18;
  if (x + 332 > box.width) x = ev.clientX - box.left - 340;
  if (y + tip.offsetHeight > box.height) y = Math.max(0, ev.clientY - box.top - tip.offsetHeight - 14);
  tip.style.left = `${Math.max(0, x)}px`;
  tip.style.top = `${y}px`;
}

const hideTip = () => { $('tip').hidden = true; };

/* ---------- panel ---------- */

function markHTML(n) {
  const m = MARKS[n.id];
  // Sizing lives in CSS, keyed off the tile class, because the same mark is
  // drawn at 40px in the header and 20px in a row. Playground has no logo
  // file, so the monogram fallback is a live case, not a theoretical one.
  if (!m) return `<span class="mono">${n.mono}</span>`;
  if (m.type === 'img') return `<img src="${m.src}" alt="">`;
  return `<svg viewBox="${m.viewBox}" style="color:${m.mono ? '#2a2a2a' : 'inherit'}">${m.inner}</svg>`;
}

/** A light tile carrying a tool's mark, which opens that tool when clicked. */
const toolTile = (n, cls) =>
  `<button class="${cls}" type="button" data-tool="${n.id}" aria-label="Open ${n.name}">${markHTML(n)}</button>`;

// The panel speaks the canvas language, so the connector is the same line the
// edges are: dotted, with the arrowhead carrying direction.
const flowArrow = () =>
  `<svg class="flow-arrow" viewBox="0 0 10 22" aria-hidden="true">` +
  `<line x1="5" y1="0" x2="5" y2="14" stroke="var(--edge)" stroke-width="1" stroke-dasharray="2 5"/>` +
  `<path d="M1.2,14 L8.8,14 L5,21 z" fill="var(--edge)"/></svg>`;

/** Distinct neighbour tools on one side of a node, in canvas order. */
function neighbours(edges, key) {
  const ids = [...new Set(edges.map((e) => e[key]))];
  return ids.map((id) => byId(NODES, id)).filter(Boolean)
    .sort((a, b) => STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage)
      || a.name.localeCompare(b.name));
}

// Long sections open folded, so every panel starts at a length you can take in.
// Only the hub tools (Figma, Cursor, Claude Code, Git) ever trip this.
const SHOWN = 5;

/* ---------- panel rows ----------
 * Shared by tool panels and findings, so a quote looks the same wherever it is
 * read and always carries its attribution and its timestamp back to the source.
 *
 * Three silhouettes, one per kind of claim. A quote is testimony and carries no
 * tile. A handoff is one tool, so it leads with that tool's mark. A choice is a
 * pair, so it leads with both. You can tell them apart at scroll speed without
 * reading the heading. */

const byline = (designerId, at) => {
  const p = who(designerId);
  return `<div class="by">${p.name}, ${firmOf(designerId).name}` +
    ` &middot; <a href="${deepLink(p, at)}" target="_blank" rel="noopener">${stamp(at)}</a></div>`;
};

const quoteRow = (text, designerId, at) =>
  `<div class="item"><p>${text}</p>${byline(designerId, at)}</div>`;

const toolRow = (other, text, designerId, at) =>
  `<div class="item item-tool">${toolTile(other, 'row-tile')}` +
  `<div><p class="item-name">${other.name}</p><p>${text}</p>${byline(designerId, at)}</div></div>`;

const pairRow = (subject, other, text, designerId, at) =>
  `<div class="item item-pair"><div class="pair">` +
  `<span class="row-tile">${markHTML(subject)}</span><span class="pair-name">${subject.name}</span>` +
  `<span class="pair-sep">or</span>` +
  `${toolTile(other, 'row-tile')}<span class="pair-name">${other.name}</span></div>` +
  `<p>${text}</p>${byline(designerId, at)}</div>`;

// Direction lives in the heading, which is pinned while you read the rows
// under it. That is what lets both handoff buckets share one row shape.
const section = (title, dir, rows) => {
  if (!rows.length) return '';
  const head = `<h3 class="micro">${title}${dir ? `<span class="dir">${dir}</span>` : ''}</h3>`;
  if (rows.length <= SHOWN) return `<div class="sect">${head}${rows.join('')}</div>`;
  return `<div class="sect">${head}${rows.slice(0, SHOWN).join('')}` +
    `<div class="rest" hidden>${rows.slice(SHOWN).join('')}</div>` +
    `<button class="more micro" type="button" aria-expanded="false">Show all</button></div>`;
};

function openPanel(n) {
  const uses = DATA.uses.filter((u) => u.toolId === n.id && inScope(u.designerId));
  const choices = DATA.choices.filter((c) => (c.a === n.id || c.b === n.id) && inScope(c.designerId));
  const rel = (e) => e.by.some((m) => inScope(m.designerId));
  const outs = EDGES.filter((e) => e.from === n.id && rel(e));
  const ins = EDGES.filter((e) => e.to === n.id && rel(e));

  const edgeRows = (list, key) => list.flatMap((e) =>
    e.by.filter((m) => inScope(m.designerId))
      .map((m) => toolRow(byId(NODES, e[key]), m.reason, m.designerId, m.at))
  );

  const tiles = (list, cls) => list.length
    ? `<div class="flow-row">${list.map((m) => toolTile(m, cls)).join('')}</div>` : '';

  // The header is a vertical slice of the graph: what feeds in, this tool,
  // where it goes. Answers "where does this sit" before a word is read.
  const kind = focused()
    ? `${stageLabel(n)} &middot; ${firmOf(scope()[0]).name}`
    : stageLabel(n);
  const feeds = neighbours(ins, 'from');
  const leads = neighbours(outs, 'to');

  let html = `<div class="panel-head">` +
    (feeds.length ? tiles(feeds, 'flow-tile') + flowArrow() : '') +
    `<div class="panel-id"><div class="panel-mark">${markHTML(n)}</div>` +
    `<div><h2>${n.name}</h2><p class="kind micro">${kind}</p></div></div>` +
    (leads.length ? flowArrow() + tiles(leads, 'flow-tile') : '') +
    `</div>`;

  html += uses.length
    ? section('Used for', '', uses.map((u) => quoteRow(u.purpose, u.designerId, u.at)))
    : `<div class="sect"><h3 class="micro">Used for</h3>` +
      `<p class="empty">Mentioned only as a step between other tools.</p></div>`;
  html += section('Fed by', '&larr;', edgeRows(ins, 'from'));
  html += section('Leads to', '&rarr;', edgeRows(outs, 'to'));
  html += section('Versus', '', choices.map((c) => {
    const other = byId(NODES, c.a === n.id ? c.b : c.a);
    return other ? pairRow(n, other, c.criterion, c.designerId, c.at) : '';
  }).filter(Boolean));

  $('panelBody').innerHTML = html;
  $('panelBody').scrollTop = 0;
  $('panelBackdrop').hidden = false;
  $('panel').scrollTop = 0;
  openTool = n.id; openFindingId = null;
  writeURL();
}

function closePanel() {
  $('panelBackdrop').hidden = true;
  hideTip();
  openTool = null; openFindingId = null;
  writeURL();
}

/* ---------- findings ----------
 * What the corpus shows, used as the way in rather than written up somewhere
 * else. Every one is computed from the data, so they stay true as designers are
 * added, and they stay corpus-wide even when the map is filtered: they are a
 * claim about the whole set, not about whoever is selected.
 *
 * They are also where handoff[] and choices[] finally surface. Both were
 * carrying the sharpest material in the project and neither was reachable. */

const FINDINGS = [
  { id: 'core', label: 'The shared core',
    blurb: 'A handful of tools recur across the corpus. Everything else belongs to one person.' },
  { id: 'handoff', label: 'How the work leaves the designer',
    blurb: 'The artifact people hand over is disappearing.' },
  { id: 'versus', label: 'Where designers disagree',
    blurb: 'The same two tools, opposite conclusions.' },
];

function findingCore() {
  // n.by is the distinct-designer set boot() already builds, and it is what
  // sizes the nodes. Reusing it keeps the finding and the map counting the
  // same thing, which a second implementation would eventually stop doing.
  const half = DATA.designers.length / 2;
  const sorted = [...NODES].sort((a, b) => b.by.length - a.by.length || a.name.localeCompare(b.name));
  const core = sorted.filter((n) => n.by.length >= half);

  // Only the core is drawn. The long tail is ten more tiles saying nothing the
  // blurb has not already said, and it turned the panel into a wall of logos.
  const tiles = core.length
    ? `<div class="grid-tiles">` + core.map((n) =>
        `<span class="grid-cell">${toolTile(n, 'row-tile')}<span>${n.name}</span></span>`).join('') + `</div>`
    : `<p class="empty">Nothing is shared that widely.</p>`;
  return `<div class="sect">${tiles}</div>`;
}

function findingHandoff() {
  const rows = [...DATA.handoff]
    .sort((a, b) => who(a.designerId).name.localeCompare(who(b.designerId).name))
    .map((h) => quoteRow(h.claim, h.designerId, h.at));
  return section('What they hand over', '', rows) ||
    `<p class="empty">No handoff claims recorded yet.</p>`;
}

function findingVersus() {
  // Group by tool pair, most-contested first: the pair the largest number of
  // independent designers weighed in on is the actual finding.
  const groups = new Map();
  DATA.choices.forEach((c) => {
    const key = [c.a, c.b].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  const voices = (list) => new Set(list.map((c) => c.designerId)).size;
  const ordered = [...groups.entries()].sort((x, y) => voices(y[1]) - voices(x[1]));

  const rowsFor = (list) => list.map((c) => {
    const subject = byId(NODES, c.a), other = byId(NODES, c.b);
    return subject && other ? pairRow(subject, other, c.criterion, c.designerId, c.at) : '';
  }).filter(Boolean);

  // A pair several designers independently weighed in on is the finding. One
  // pair mentioned once is an anecdote, so those collect under a single
  // heading rather than each getting their own and fragmenting the panel.
  let html = '';
  const singles = [];
  ordered.forEach(([key, list]) => {
    const [aId, bId] = key.split('|');
    const a = byId(NODES, aId), b = byId(NODES, bId);
    if (!a || !b) return;
    if (voices(list) > 1) html += section(`${a.name} or ${b.name}`, '', rowsFor(list));
    else singles.push(...list);
  });
  html += section('Named once each', '', rowsFor(singles));
  return html || `<p class="empty">No stated choices recorded yet.</p>`;
}

function openFinding(id) {
  const f = FINDINGS.find((x) => x.id === id);
  if (!f) return;
  const body = id === 'core' ? findingCore()
    : id === 'handoff' ? findingHandoff()
    : findingVersus();

  $('panelBody').innerHTML =
    `<div class="panel-head"><div class="panel-id finding-id">` +
    `<div><h2>${f.label}</h2><p class="kind micro">Across every interview</p></div></div>` +
    `<p class="finding-blurb">${f.blurb}</p></div>` + body;
  $('panelBody').scrollTop = 0;
  $('panelBackdrop').hidden = false;
  openFindingId = id; openTool = null;
  writeURL();
}

/* A list of sources, not a digest of everyone's philosophy. Two lines each and
 * the whole row is the link. The thesis already appears in the mode line when
 * you pick that designer, so repeating it here was the third line doing nothing. */
function openSources() {
  const rows = DATA.designers.map((p) =>
    `<a class="src" href="${p.source.url}" target="_blank" rel="noopener">` +
    `<span class="src-name">${p.name}</span>` +
    `<span class="src-role">${p.role}, ${firmOf(p.id).name}</span></a>`
  ).join('');

  $('panelBody').innerHTML =
    `<div class="panel-head"><div class="panel-id finding-id"><div><h2>Sources</h2></div></div>` +
    `<p class="finding-blurb">Every claim on the map is quoted from one of these ` +
    `interviews and timestamped.</p></div><div class="sect">${rows}</div>`;
  $('panelBody').scrollTop = 0;
  $('panelBackdrop').hidden = false;
  openTool = null; openFindingId = null;
}

function renderFindings() {
  $('findings').innerHTML = FINDINGS.map((f) =>
    `<button class="finding" type="button" data-finding="${f.id}">${f.label}</button>`).join('');
}

/* ---------- boot ---------- */

async function loadMarks(ids) {
  await Promise.all(ids.map(async (id) => {
    for (const ext of FORMATS) {
      try {
        const res = await fetch(`assets/logos/${id}.${ext}`);
        if (!res.ok) continue;
        if (ext === 'svg') {
          const text = await res.text();
          if (!/<svg/i.test(text)) continue;
          const vb = text.match(/viewBox="([^"]+)"/i);
          const inner = text.replace(/<\?xml[^>]*\?>/, '')
            .replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
          if (!inner.trim()) continue;
          MARKS[id] = { type: 'svg', viewBox: vb ? vb[1] : '0 0 24 24', inner, mono: /currentColor/.test(text) };
        } else {
          MARKS[id] = { type: 'img', src: `assets/logos/${id}.${ext}` };
        }
        return;
      } catch (_) { /* try next format */ }
    }
  }));
}

const monogram = (name) => {
  const w = name.split(/[\s.]+/).filter(Boolean);
  return w.length > 1 ? (w[0][0] + w[1][0]).toUpperCase()
                      : name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
};

async function boot() {
  DATA = await (await fetch('data/landscape.json')).json();
  STAGES = DATA.meta.stages.map((s) => ({ ...s }));
  const total = DATA.designers.length;

  const usedBy = {};
  const note = (id, p) => { (usedBy[id] = usedBy[id] || new Set()).add(p); };
  DATA.uses.forEach((u) => note(u.toolId, u.designerId));
  DATA.moves.forEach((m) => { note(m.from, m.designerId); note(m.to, m.designerId); });

  NODES = DATA.tools.map((t) => {
    const by = [...(usedBy[t.id] || [])];
    return { ...t, by, r: 20 + Math.pow(by.length / total, 0.8) * 20, mono: monogram(t.name) };
  });

  const map = new Map();
  DATA.moves.forEach((m) => {
    const key = `${m.from}|${m.to}`;
    if (!map.has(key)) map.set(key, { from: m.from, to: m.to, by: [] });
    map.get(key).by.push({ designerId: m.designerId, reason: m.reason, at: m.at });
  });
  const seen = new Set();
  EDGES = [...map.values()].map((e) => {
    const k = [e.from, e.to].sort().join('|');
    const dir = seen.has(k) ? -1 : 1;
    seen.add(k);
    return { ...e, dir };
  });

  await loadMarks(NODES.map((n) => n.id));

  SEARCH = searchIndex();
  renderFindings();
  const { tool, finding } = readURL();

  draw();

  // A shared link opens straight onto whatever it names, after the first paint
  // so the panel lands over a drawn map rather than an empty one.
  if (finding) openFinding(finding);
  else if (tool) { const n = byId(NODES, tool); if (n) openPanel(n); }

  $('panelClose').addEventListener('click', closePanel);
  $('panelBackdrop').addEventListener('click', (e) => {
    if (e.target === $('panelBackdrop')) closePanel();
  });

  $('findings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-finding]');
    if (b) openFinding(b.dataset.finding);
  });
  $('sourcesBtn').addEventListener('click', openSources);

  /* rail */
  $('railPrev').addEventListener('click', () => pageRail(-1));
  $('railNext').addEventListener('click', () => pageRail(1));
  $('whoScroll').addEventListener('scroll', syncRail, { passive: true });

  /* search */
  const find = $('find');
  find.addEventListener('input', () => runSearch(find.value));
  find.addEventListener('focus', () => { if (find.value) runSearch(find.value); });
  find.addEventListener('keydown', (e) => {
    const hits = [...$('findResults').querySelectorAll('.find-hit')];
    if (e.key === 'Enter') { e.preventDefault(); takeHit(hits.find((h) => h.getAttribute('aria-selected') === 'true') || hits[0]); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(true); find.blur(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!hits.length) return;
    const at = hits.findIndex((h) => h.getAttribute('aria-selected') === 'true');
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    hits.forEach((h, i) => h.setAttribute('aria-selected', String(i === next)));
    hits[next].scrollIntoView({ block: 'nearest' });
  });
  $('findResults').addEventListener('mousedown', (e) => {
    e.preventDefault();               // keep focus so blur does not race the click
    takeHit(e.target.closest('.find-hit'));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.find')) closeSearch(false);
  });

  // Every tile in the panel is a way through the graph, so the panel browses
  // like the canvas does.
  $('panelBody').addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-tool]');
    if (tile) {
      const next = byId(NODES, tile.dataset.tool);
      if (next) openPanel(next);
      return;
    }
    const more = ev.target.closest('.more');
    if (!more) return;
    const rest = more.previousElementSibling;
    const open = rest.hidden;
    rest.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Show less' : 'Show all';
  });

  // Cmd+K focuses search. It previously closed the panel, which meant a
  // browser shortcut was swallowed to do something unrelated to searching.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      find.focus();
      find.select();
      return;
    }
    if (e.key === 'Escape' && document.activeElement !== find) { closePanel(); hideTip(); }
  });

  // Watch the container, not just the window. The viewBox is built from the
  // container's box, so when the two drift apart the SVG letterboxes and every
  // band grows a visible top and bottom edge. A window listener alone misses
  // any layout change that is not a window resize.
  let t;
  const redraw = () => { clearTimeout(t); t = setTimeout(() => { draw(); syncRail(); }, 120); };
  new ResizeObserver(redraw).observe($('canvasWrap'));
  window.addEventListener('resize', redraw);
}

boot();
