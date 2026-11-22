// Área de desenho: bandas, elementos, réguas e mouse
(function () {
  const { get, kid, content } = J;
  const num = (v, d = 0) => (v === '' || v == null || !Number.isFinite(+v) ? d : +v);
  const PAPER_GAP = 28;
  const NAMED = { black: '#000', white: '#fff', red: '#f00', green: '#0f0', blue: '#00f', yellow: '#ff0', gray: '#808080', darkGray: '#404040', lightGray: '#c0c0c0', orange: '#ffc800', pink: '#ffafaf', cyan: '#0ff', magenta: '#f0f' };
  const color = (v, d) => !v ? d : NAMED[v] || (/^-?\d+$/.test(v) ? `#${((+v >>> 0) & 0xffffff).toString(16).padStart(6, '0')}` : v);
  let layout = { width: 0, height: 0, left: 0, bands: [], items: [] };
  let cancelDrag = null;

  function measure() {
    const r = App.draft.report;
    const left = num(get(r, 'leftMargin'), 20);
    const width = num(get(r, 'pageWidth'), 595);
    let y = num(get(r, 'topMargin'), 30);
    const items = [];
    const bands = S.bands(r).map(({ node, label }) => {
      const band = { node, label, x: left, y, w: width - left - num(get(r, 'rightMargin'), 20), h: num(get(node, 'height')) };
      const add = (parent, ox, oy) => S.elements(parent).forEach((el) => {
        const re = S.reportElement(el);
        const item = { node: el, band, parent, ox, oy, x: ox + num(get(re, 'x')), y: oy + num(get(re, 'y')), w: num(get(re, 'width')), h: num(get(re, 'height')) };
        items.push(item);
        if (el.name === 'frame') add(el, item.x, item.y);
        const list = el.name === 'componentElement' && kid(kid(el, 'list'), 'listContents');
        if (list) add(list, item.x, item.y);
      });
      add(node, left, y);
      y += band.h;
      return band;
    });
    layout = { left, width, height: Math.max(y + num(get(r, 'bottomMargin'), 30), 80), bands, items };
  }

  function paint(item) {
    const { node } = item;
    const s = S.resolveStyle(App.draft.report, node);
    const z = App.zoom;
    const el = h('div', { class: `element kind-${node.name}`, 'data-path': node.path });
    Object.assign(el.style, { left: `${item.x * z}px`, top: `${item.y * z}px`, width: `${Math.max(item.w * z, 2)}px`, height: `${Math.max(item.h * z, 2)}px` });
    el.title = `${node.name}  ${item.w} × ${item.h}`;
    const fore = color(s.forecolor, '#000');
    const shape = node.name === 'rectangle' || node.name === 'ellipse';
    el.style.color = fore;
    if (s.mode === 'Opaque' || (shape && !s.mode)) el.style.backgroundColor = color(s.backcolor, '#fff');

    const penWidth = num(s.pen.lineWidth, 1);
    const css = (v) => ({ Dashed: 'dashed', Dotted: 'dotted', Double: 'double' })[v] || 'solid';
    if (node.name === 'line') {
      const c = color(s.pen.lineColor, fore);
      const w = `${Math.max(penWidth * z, 1)}px ${css(s.pen.lineStyle)} ${c}`;
      const line = h('i', { class: 'stroke' });
      if (item.w > 1 && item.h > 1) {
        line.style.width = `${Math.hypot(item.w, item.h) * z}px`;
        const up = get(node, 'direction') === 'BottomUp';
        if (up) line.style.top = `${item.h * z}px`;
        line.style.transform = `rotate(${(up ? -1 : 1) * Math.atan2(item.h, item.w)}rad)`;
        line.style.borderTop = w;
      } else if (item.h <= 1) Object.assign(line.style, { width: '100%', borderTop: w });
      else Object.assign(line.style, { height: '100%', borderLeft: w });
      el.append(line);
    } else if (shape) {
      if (penWidth) el.style.border = `${Math.max(penWidth * z, 1)}px ${css(s.pen.lineStyle)} ${color(s.pen.lineColor, fore)}`;
      if (node.name === 'ellipse') el.style.borderRadius = '50%';
      else if (s.radius) el.style.borderRadius = `${num(s.radius) * z}px`;
    } else {
      for (const side of ['top', 'left', 'bottom', 'right']) {
        const p = s.sides[side];
        const Side = side[0].toUpperCase() + side.slice(1);
        if (num(p.lineWidth)) el.style[`border${Side}`] = `${Math.max(num(p.lineWidth) * z, 1)}px ${css(p.lineStyle)} ${color(p.lineColor, fore)}`;
        el.style[`padding${Side}`] = `${num(s.box[`${side}Padding`], num(s.box.padding)) * z}px`;
      }
      const text = node.name === 'staticText' ? content(kid(node, 'text')) : node.name === 'textField' ? content(kid(node, 'textFieldExpression')) : null;
      if (text !== null) {
        const span = h('span', { class: node.name === 'textField' ? 'label expression' : 'label' }, text);
        Object.assign(span.style, {
          fontFamily: `"${s.fontName && s.fontName !== 'SansSerif' ? s.fontName : 'Arial'}", sans-serif`,
          fontSize: `${num(s.fontSize, 10) * z}px`,
          fontWeight: s.isBold === 'true' ? 'bold' : 'normal',
          fontStyle: s.isItalic === 'true' ? 'italic' : 'normal',
          textDecoration: [s.isUnderline === 'true' && 'underline', s.isStrikeThrough === 'true' && 'line-through'].filter(Boolean).join(' '),
          textAlign: ({ Center: 'center', Right: 'right', Justified: 'justify' })[s.hAlign] || 'left'
        });
        el.style.justifyContent = ({ Middle: 'safe center', Bottom: 'safe flex-end' })[s.vAlign] || 'flex-start';
        const turn = ({ Left: -90, Right: 90, UpsideDown: 180 })[s.rotation];
        if (turn) {
          const side = Math.abs(turn) === 90;
          Object.assign(span.style, { position: 'absolute', left: '50%', top: '50%', width: `${(side ? item.h : item.w) * z}px`, transform: `translate(-50%,-50%) rotate(${turn}deg)` });
        }
        el.append(span);
      } else if (node.name !== 'frame' && node.name !== 'break') {
        const inner = node.name === 'componentElement' ? node.kids.find((k) => k.name !== 'reportElement')?.name : node.name;
        if (inner !== 'list') el.append(h('span', { class: 'placeholder' }, inner === 'image' ? `▧ ${content(kid(node, 'imageExpression'))}` : inner));
      }
    }
    return el;
  }

  function render() {
    cancelDrag?.();
    measure();
    const z = App.zoom;
    const paper = App.ui.paper;
    paper.replaceChildren();
    paper.style.width = `${layout.width * z}px`;
    paper.style.height = `${layout.height * z}px`;
    paper.classList.toggle('grid', App.grid);
    paper.style.backgroundSize = `${10 * z}px ${10 * z}px`;
    for (const b of layout.bands) {
      const el = h('div', { class: 'band', 'data-band': b.node.path }, h('span', {}, b.label));
      Object.assign(el.style, { left: `${b.x * z}px`, top: `${b.y * z}px`, width: `${b.w * z}px`, height: `${b.h * z}px` });
      paper.append(el);
    }
    layout.items.forEach((i) => paper.append(paint(i)));
    for (const x of [layout.left, layout.width - num(get(App.draft.report, 'rightMargin'), 20)]) {
      const line = h('i', { class: 'margin' });
      line.style.left = `${x * z}px`;
      paper.append(line);
    }
    for (const b of layout.bands) {
      const bar = h('div', { class: 'divider', 'data-resize-band': b.node.path, title: `${b.label}: arraste para mudar a altura` });
      bar.style.top = `${(b.y + b.h) * z - 3}px`;
      paper.append(bar);
    }
    paper.append(App.ui.overlay = h('div', { class: 'overlay' }));
    selection();
    rulers();
  }

  function selection() {
    const layer = App.ui.overlay;
    if (!layer) return;
    layer.replaceChildren();
    const z = App.zoom;
    const picked = selected();
    for (const item of picked) {
      const box = h('div', { class: 'selection' });
      Object.assign(box.style, { left: `${item.x * z}px`, top: `${item.y * z}px`, width: `${Math.max(item.w * z, 2)}px`, height: `${Math.max(item.h * z, 2)}px` });
      if (picked.length === 1) {
        const corners = item.h * z < 8 ? ['e', 'w', 's'] : item.w * z < 8 ? ['n', 's', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        corners.forEach((c) => box.append(h('b', { class: `handle ${c}`, 'data-handle': c })));
      }
      layer.append(box);
    }
    for (const el of App.ui.paper.querySelectorAll('.band')) el.classList.toggle('selected', App.selection.includes(el.dataset.band));
  }

  function rulers() {
    const { scroll, paper, rulerX, rulerY } = App.ui;
    for (const [canvas, horizontal] of [[rulerX, true], [rulerY, false]]) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = width;
      canvas.height = height;
      const c = canvas.getContext('2d');
      const origin = horizontal ? paper.offsetLeft - scroll.scrollLeft : paper.offsetTop - scroll.scrollTop;
      c.fillStyle = c.strokeStyle = getComputedStyle(canvas).color;
      c.font = '9px sans-serif';
      const step = App.zoom < 0.6 ? 100 : 50;
      const max = horizontal ? layout.width : layout.height;
      for (let v = 0; v <= max; v += 10) {
        const p = Math.round(origin + v * App.zoom) + 0.5;
        const size = v % step ? 4 : 10;
        c.beginPath();
        if (horizontal) { c.moveTo(p, height - size); c.lineTo(p, height); } else { c.moveTo(width - size, p); c.lineTo(width, p); }
        c.stroke();
        if (v % step) continue;
        if (horizontal) c.fillText(v, p + 2, 9);
        else { c.save(); c.translate(8, p - 2); c.rotate(-Math.PI / 2); c.fillText(v, 0, 0); c.restore(); }
      }
    }
  }

  const point = (e) => {
    const r = App.ui.paper.getBoundingClientRect();
    return { x: (e.clientX - r.left) / App.zoom, y: (e.clientY - r.top) / App.zoom };
  };
  const bandAt = (y) => layout.bands.find((b) => y >= b.y && y < b.y + b.h);
  const selected = () => layout.items.filter((i) => App.selection.includes(i.node.path));
  const within = (path, root) => path.startsWith(`${root}.`);

  // encaixe nas bordas dos outros elementos e das bandas
  function snap(values, axis, ignored) {
    if (!App.snap) return { shift: 0 };
    const size = axis === 'x' ? 'w' : 'h';
    let best = { shift: 0, distance: 5 / App.zoom };
    for (const t of layout.bands.concat(layout.items.filter((i) => !ignored.some((p) => i.node.path === p || within(i.node.path, p))))) {
      for (const edge of [t[axis], t[axis] + t[size]]) {
        for (const v of values) if (Math.abs(edge - v) < best.distance) best = { shift: edge - v, distance: Math.abs(edge - v), guide: edge };
      }
    }
    return best;
  }

  function guide(axis, value) {
    if (value === undefined) return;
    const line = h('i', { class: `guide ${axis}` });
    line.style[axis === 'x' ? 'left' : 'top'] = `${value * App.zoom}px`;
    App.ui.overlay.append(line);
  }

  function track(e, move, done) {
    const from = point(e);
    let active = false;
    let last;
    const onMove = (ev) => {
      const p = point(ev);
      if (!active && Math.hypot(p.x - from.x, p.y - from.y) * App.zoom < 3) return;
      active = true;
      last = move(p.x - from.x, p.y - from.y, p, ev);
    };
    const stop = () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', up);
      cancelDrag = null;
    };
    const up = () => { stop(); done(active, last); };
    cancelDrag = stop;
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', up);
  }

  function moving(e, clicked, narrow) {
    const every = selected();
    const roots = every.filter((i) => !every.some((o) => within(i.node.path, o.node.path)));
    const paths = roots.map((i) => i.node.path);
    const parts = [...App.ui.paper.querySelectorAll('.element')]
      .filter((el) => paths.some((p) => el.dataset.path === p || within(el.dataset.path, p)));
    track(e, (dx, dy, p, ev) => {
      let x = Math.round(dx);
      let y = Math.round(dy);
      App.ui.overlay.querySelectorAll('.guide').forEach((g) => g.remove());
      if (!ev.altKey) {
        const sx = snap([clicked.x + x, clicked.x + clicked.w + x], 'x', paths);
        const sy = snap([clicked.y + y, clicked.y + clicked.h + y], 'y', paths);
        x += sx.shift; y += sy.shift;
        guide('x', sx.guide); guide('y', sy.guide);
      }
      const shift = `translate(${x * App.zoom}px, ${y * App.zoom}px)`;
      parts.forEach((el) => { el.style.transform = shift; });
      App.ui.overlay.querySelectorAll('.selection').forEach((el) => { el.style.transform = shift; });
      App.status(`Δx ${x}   Δy ${y}`);
      return { x, y };
    }, (active, d) => {
      if (!active) return narrow && App.select([clicked.node.path]);
      App.move(roots, Math.round(d.x), Math.round(d.y));
      render();
    });
  }

  function resizing(e, dir) {
    const item = selected()[0];
    const el = App.ui.paper.querySelector(`.element[data-path="${item.node.path}"]`);
    const box = App.ui.overlay.querySelector('.selection');
    track(e, (dx, dy, p, ev) => {
      let { x, y } = item;
      let right = x + item.w;
      let bottom = y + item.h;
      const edge = (value, axis) => Math.round(value + (ev.altKey ? 0 : snap([value], axis, [item.node.path]).shift));
      if (dir.includes('e')) right = Math.max(x + 1, edge(right + dx, 'x'));
      if (dir.includes('w')) x = Math.min(right - 1, edge(x + dx, 'x'));
      if (dir.includes('s')) bottom = Math.max(y + 1, edge(bottom + dy, 'y'));
      if (dir.includes('n')) y = Math.min(bottom - 1, edge(y + dy, 'y'));
      const r = { x, y, w: right - x, h: bottom - y };
      for (const target of [el, box]) Object.assign(target.style, { left: `${x * App.zoom}px`, top: `${y * App.zoom}px`, width: `${r.w * App.zoom}px`, height: `${r.h * App.zoom}px` });
      App.status(`${r.w} × ${r.h}`);
      return r;
    }, (active, r) => {
      if (!active) return;
      App.resize(item, r);
      render();
    });
  }

  function dividing(e, band) {
    const start = band.h;
    const bar = e.target;
    track(e, (dx, dy) => {
      const height = Math.max(0, Math.round(start + dy));
      bar.style.top = `${(band.y + height) * App.zoom - 3}px`;
      App.status(`${band.label}: ${height}`);
      return height;
    }, (active, height) => {
      if (!active) return App.select([band.node.path]);
      App.bandHeight(band, height);
      render();
    });
  }

  function marquee(e) {
    const keep = e.ctrlKey || e.shiftKey ? App.selection.slice() : [];
    const start = point(e);
    const band = bandAt(start.y);
    const box = h('i', { class: 'marquee' });
    track(e, (dx, dy, p) => {
      const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
      Object.assign(box.style, { left: `${r.x * App.zoom}px`, top: `${r.y * App.zoom}px`, width: `${r.w * App.zoom}px`, height: `${r.h * App.zoom}px` });
      App.ui.overlay.append(box);
      return r;
    }, (active, r) => {
      box.remove();
      if (!active) return App.select(band ? [band.node.path] : [App.draft.report.path]);
      const hit = layout.items.filter((i) => i.x >= r.x && i.y >= r.y && i.x + i.w <= r.x + r.w && i.y + i.h <= r.y + r.h).map((i) => i.node.path);
      App.select([...new Set(keep.concat(hit))]);
    });
  }

  function down(e) {
    if (e.button !== 0 || !App.draft) return;
    const { scroll } = App.ui;
    const r = scroll.getBoundingClientRect();
    if (e.clientX > r.left + scroll.clientWidth || e.clientY > r.top + scroll.clientHeight) return; // barra de rolagem
    document.activeElement?.blur();
    e.preventDefault();
    scroll.focus({ preventScroll: true });
    if (e.target.dataset.handle) return resizing(e, e.target.dataset.handle);
    if (e.target.dataset.resizeBand) return dividing(e, layout.bands.find((b) => b.node.path === e.target.dataset.resizeBand));
    const path = e.target.closest('.element')?.dataset.path;
    if (!path) return marquee(e);
    const picked = selected().map((i) => i.node.path);
    if (e.ctrlKey || e.shiftKey) return App.select(picked.includes(path) ? picked.filter((p) => p !== path) : picked.concat(path));
    const was = picked.includes(path);
    if (!was) App.select([path]);
    // a seleção pode ter regravado o campo que estava em edição
    const item = layout.items.find((i) => i.node.path === path);
    if (item) moving(e, item, was && picked.length > 1);
  }

  function drop(e) {
    e.preventDefault();
    const p = point(e);
    const band = bandAt(p.y);
    if (!band) return App.status('Solte o item dentro de uma banda.');
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    const host = layout.items.filter((i) => i.node.name === 'frame' && p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h).pop();
    App.add(data, host ? { node: host.node, x: host.x, y: host.y, w: host.w, h: host.h, band } : { ...band, band }, p);
  }

  window.Canvas = {
    render, selection, rulers, down, drop, selected, bandAt, color, num,
    fit: () => (App.ui.scroll.clientWidth - PAPER_GAP * 2) / layout.width,
    get layout() { return layout; }
  };
})();
