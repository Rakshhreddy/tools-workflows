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
let STAGES = [];
let company = null;   // level 2
let person = null;    // level 3
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
    if (i % 2) gBands.appendChild(el('rect', {
      x: st.x0, y: 20, width: st.w, height: H - 42,
      fill: 'rgba(237, 237, 237, 0.026)'
    }));
    if (i) gBands.appendChild(el('line', {
      x1: st.x0, y1: 24, x2: st.x0, y2: H - 22,
      stroke: 'var(--line)', 'stroke-width': '1'
    }));
    const lab = el('text', { class: 'band-label', x: st.x0 + 16, y: 34 });
    lab.textContent = `${i + 1} ${st.label}`;
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

  nodes.forEach((n, i) => {
    const g = el('g', { class: 'node', tabindex: '0', role: 'button', transform: `translate(${n.x},${n.y})` });
    g.setAttribute('aria-label', `${n.name}, used by ${n.by.length} of ${DATA.designers.length} designers`);
    g.style.animationDelay = `${i * 22}ms`;

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

  // Play the entrance once, on first paint only.
  if (!draw.booted) {
    draw.booted = true;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      svg.classList.add('intro');
      setTimeout(() => svg.classList.remove('intro'), 1300);
    }
  }
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
    c.addEventListener('click', () => {
      const id = c.dataset.company;
      company = company === id ? null : id;
      person = null;
      draw();
    });
  });
  document.querySelectorAll('[data-person]').forEach((c) => {
    c.addEventListener('click', () => {
      const id = c.dataset.person;
      person = person === id ? null : id;
      draw();
    });
  });
}

function renderSummary() {
  const el2 = $('mode');
  if (person) {
    const p = who(person);
    el2.innerHTML = `<b>${p.name}</b><span class="role">, ${p.role} at ${firmOf(person).name}.</span> ${p.thesis}`;
    return;
  }
  if (company) {
    const c = byId(DATA.companies, company);
    const staff = staffOf(company);
    if (staff.length === 1) {
      const p = staff[0];
      el2.innerHTML = `<b>${c.name}</b><span class="role">, ${p.name}, ${p.role}.</span> ${p.thesis}`;
    } else {
      el2.innerHTML = `<b>${c.name}</b><span class="role">, ${staff.length} designers.</span> Pick one to narrow the workflow.`;
    }
    return;
  }
  el2.innerHTML = '';
}

/* ---------- tooltip ---------- */

const tipRow = (text, designerId) =>
  `<span class="tip-row"><span class="dot"></span>${text} <i>${firstName(who(designerId).name)}, ${firmOf(designerId).name}</i></span>`;

function tipNode(ev, n) {
  const uses = DATA.uses.filter((u) => u.toolId === n.id && inScope(u.designerId));
  const shown = uses.slice(0, 3).map((u) => tipRow(u.purpose, u.designerId)).join('');
  const more = uses.length > 3 ? `<span class="tip-more micro">plus ${uses.length - 3} more</span>` : '';
  const count = focused()
    ? `${firmOf(scope()[0]).name}`
    : `${n.by.length} of ${DATA.designers.length} designers`;
  $('tip').innerHTML = `<b>${n.name}</b><span class="tip-count micro">${count}</span>${shown ||
    '<span class="tip-row">Named as a step between other tools.</span>'}${more}`;
  $('tip').hidden = false;
  moveTip(ev);
}

function tipEdge(ev, e) {
  const by = e.by.filter((m) => inScope(m.designerId));
  const rows = by.map((m) => tipRow(m.reason, m.designerId)).join('');
  $('tip').innerHTML =
    `<b>${byId(NODES, e.from).name} to ${byId(NODES, e.to).name}</b>` +
    `<span class="tip-count micro">${by.length === 1 ? '1 designer' : `${by.length} designers`}</span>${rows}`;
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
  if (!m) return `<span style="font-weight:700;font-size:13px">${n.mono}</span>`;
  if (m.type === 'img') return `<img src="${m.src}" alt="">`;
  return `<svg viewBox="${m.viewBox}" style="color:${m.mono ? '#2a2a2a' : 'inherit'}">${m.inner}</svg>`;
}

function openPanel(n) {
  const uses = DATA.uses.filter((u) => u.toolId === n.id && inScope(u.designerId));
  const choices = DATA.choices.filter((c) => (c.a === n.id || c.b === n.id) && inScope(c.designerId));
  const rel = (e) => e.by.some((m) => inScope(m.designerId));
  const outs = EDGES.filter((e) => e.from === n.id && rel(e));
  const ins = EDGES.filter((e) => e.to === n.id && rel(e));

  const row = (text, designerId, at) => {
    const p = who(designerId);
    return `<div class="item"><p>${text}</p><div class="by">` +
      `<span class="swatch"></span>${p.name}, ${firmOf(designerId).name}` +
      ` &middot; <a href="${deepLink(p, at)}" target="_blank" rel="noopener">${stamp(at)}</a></div></div>`;
  };
  const edgeRows = (list, dir) => list.flatMap((e) =>
    e.by.filter((m) => inScope(m.designerId))
      .map((m) => row(`<b>${byId(NODES, dir === 'out' ? e.to : e.from).name}</b>: ${m.reason}`, m.designerId, m.at))
  ).join('');

  const st = STAGES.find((s) => s.id === n.stage);
  const scopeLabel = focused() ? firmOf(scope()[0]).name : `${n.by.length} of ${DATA.designers.length}`;
  let html = `<div class="panel-head"><div class="panel-mark">${markHTML(n)}</div>` +
    `<div><h2>${n.name}</h2><p class="kind micro">${st ? st.label : ''} &middot; ${scopeLabel}</p></div></div>`;

  html += `<div class="sect"><h3 class="micro">What it is used for</h3>`;
  html += uses.length ? uses.map((u) => row(u.purpose, u.designerId, u.at)).join('')
    : `<p class="empty">Named as a step between other tools, with no direct use described.</p>`;
  html += `</div>`;

  if (choices.length) {
    html += `<div class="sect"><h3 class="micro">When to reach for it</h3>` + choices.map((c) => {
      const other = byId(NODES, c.a === n.id ? c.b : c.a);
      return row(`<em>versus ${other ? other.name : ''}</em>: ${c.criterion}`, c.designerId, c.at);
    }).join('') + `</div>`;
  }
  if (outs.length) html += `<div class="sect"><h3 class="micro">Leads to</h3>${edgeRows(outs, 'out')}</div>`;
  if (ins.length) html += `<div class="sect"><h3 class="micro">Fed by</h3>${edgeRows(ins, 'in')}</div>`;

  $('panelBody').innerHTML = html;
  $('panel').hidden = false;
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

  $('footNote').innerHTML = DATA.designers.map((p) =>
    `<a href="${p.source.url}" target="_blank" rel="noopener">${p.name}</a>`
  ).join('<span class="sep">/</span>');

  draw();
  $('panelClose').addEventListener('click', () => { $('panel').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('panel').hidden = true; hideTip(); }
  });

  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 180); });
}

boot();
