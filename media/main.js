// Estado e comandos do designer
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

(function () {
  const vscode = acquireVsCodeApi();
  const { get, kid, all, content, position, walk } = J;
  const saved = vscode.getState() || {};
  let seq = 0;
  let clipboard = [];

  const App = window.App = {
    draft: null, selection: [], ui: {},
    zoom: saved.zoom || 1, zoomed: !!saved.zoom, grid: saved.grid || false, snap: saved.snap ?? true, layout: saved.layout
  };
  const int = (v) => Math.round(Canvas.num(v));
  const persist = () => vscode.setState({ zoom: App.zoomed ? App.zoom : undefined, grid: App.grid, snap: App.snap, layout: App.layout });

  App.status = (text) => { App.ui.status.textContent = text; };

  function refresh() {
    Canvas.render();
    Panels.tree();
    Panels.highlight();
    Panels.properties();
  }

  App.select = (paths) => {
    App.selection = paths.filter((p) => App.draft.at(p));
    Canvas.selection();
    Panels.highlight();
    Panels.properties();
    const picked = Canvas.selected();
    if (picked.length === 1) {
      const i = picked[0];
      App.status(`${i.node.name}   x ${i.x - i.ox}  y ${i.y - i.oy}  largura ${i.w}  altura ${i.h}   |   ${i.band.label}`);
    } else App.status(picked.length ? `${picked.length} elementos` : '');
  };

  // cada commit vira uma única operação de desfazer
  function commit(change) {
    const before = App.draft.text;
    const next = new J.Draft(before);
    let picked;
    try { picked = change(next); } catch (e) { App.status(`Não foi possível alterar: ${e.message}`); return; }
    if (next.text === before) return;
    App.draft = next;
    if (Array.isArray(picked)) App.selection = picked;
    App.selection = App.selection.filter((p) => next.at(p));
    vscode.postMessage({ type: 'edit', before, seq: ++seq, ...J.patch(before, next.text) });
    refresh();
  }

  App.resolve = (node, route) => (route ? route.split('/') : []).reduce(
    (n, part) => n && (part === '@re' ? S.reportElement(n) : kid(n, part)), node);

  function ensureRoute(draft, path, route) {
    let at = path;
    for (const part of route ? route.split('/') : []) {
      const node = draft.at(at);
      at = part === '@re' ? S.reportElement(node).path : draft.ensure(at, part, S.ORDER[node.name]?.concat(part) || [part]);
    }
    return at;
  }

  // paths mudam quando um nó anterior é criado: editar de baixo para cima
  const descending = (paths) => paths.slice().sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));

  App.setProperty = (paths, p, value) => {
    if (p.attr === 'name' && paths.length === 1) {
      const node = App.draft.at(paths[0]);
      if (node.name !== 'jasperReport') return rename(node, value);
    }
    commit((d) => {
      for (const path of descending(paths)) {
        if (value === '' && !App.resolve(d.at(path), p.route)) continue;
        d.attr(ensureRoute(d, path, p.route), p.attr, value);
      }
      const page = ['pageWidth', 'leftMargin', 'rightMargin', 'columnCount', 'columnSpacing'];
      if (paths[0] === d.report.path && page.includes(p.attr)) {
        const n = (name, fallback) => int(get(d.report, name, fallback));
        const count = Math.max(1, n('columnCount', 1));
        const usable = n('pageWidth', 595) - n('leftMargin', 20) - n('rightMargin', 20) - (count - 1) * n('columnSpacing', 0);
        if (usable >= count) d.attr(d.report.path, 'columnWidth', Math.floor(usable / count));
      }
    });
  };

  function rename(node, name) {
    const old = get(node, 'name');
    const { path, name: kind } = node;
    if (!name || name === old) return Panels.properties();
    if (all(node.parent, kind).some((n) => get(n, 'name') === name)) {
      Panels.properties();
      return App.status(`Já existe ${kind} com o nome ${name}.`);
    }
    commit((d) => {
      d.attr(path, 'name', name);
      const letter = { field: 'F', parameter: 'P', variable: 'V' }[kind];
      const bodies = [];
      const attrs = [];
      // subDatasets têm campos, parâmetros e variáveis próprios
      const visit = (n) => {
        if (n.name === 'subDataset' && kind !== 'style') return;
        const text = content(n);
        let next = text;
        if (letter) {
          next = text.split(`$${letter}{${old}}`).join(`$${letter}{${name}}`);
          if (kind === 'parameter') next = next.split(`$P!{${old}}`).join(`$P!{${name}}`);
        }
        if (kind === 'group') next = text.split(`$V{${old}_COUNT}`).join(`$V{${name}_COUNT}`);
        if (next !== text) bodies.push([n.path, next]);
        for (const [key, a] of Object.entries(n.attrs)) {
          const styleRef = kind === 'style' && key === 'style';
          const groupRef = kind === 'group' && ['resetGroup', 'incrementGroup', 'evaluationGroup', 'printWhenGroupChanges'].includes(key);
          if ((styleRef || groupRef) && a.value === old) attrs.push([n.path, key]);
        }
        n.kids.forEach(visit);
      };
      visit(d.report);
      for (const [at, next] of bodies) d.body(at, next);
      for (const [at, key] of attrs) d.attr(at, key, name);
    });
  }

  App.editBody = (path, p) => {
    const node = App.resolve(App.draft.at(path), p.route);
    const plain = ['Text', 'Query', 'Description'].includes(p.label);
    const opened = App.draft.text;
    Panels.dialog({
      title: p.label, value: content(node), multiline: true, expression: !plain || p.label === 'Query',
      onSave: (value) => {
        if (App.draft.text !== opened) return App.status('O relatório mudou enquanto o diálogo estava aberto. Edite novamente.');
        if (value.replace(/\r/g, '') === content(node).replace(/\r/g, '')) return;
        commit((d) => {
          const target = App.resolve(d.at(path), p.route);
          if (!value.trim() && target && /printWhen|defaultValue|initialValue|Description/.test(target.name)) d.remove(target.path);
          else d.body(ensureRoute(d, path, p.route), value);
        });
      }
    });
  };

  App.edit = (path) => {
    const node = App.draft.at(path);
    const target = {
      staticText: ['Text', 'text'], textField: ['Text Field Expression', 'textFieldExpression'],
      image: ['Image Expression', 'imageExpression'], subreport: ['Subreport Expression', 'subreportExpression']
    }[node?.name];
    if (target) App.editBody(path, { label: target[0], route: target[1] });
  };

  App.query = () => {
    const root = App.draft.report.path;
    App.editBody(root, { label: 'Query', route: 'queryString' });
  };

  const grow = (d, band, bottom) => {
    if (band && bottom > int(get(d.at(band.node.path), 'height', 0))) d.attr(band.node.path, 'height', bottom);
  };

  App.move = (items, dx, dy) => {
    if (!dx && !dy) return;
    commit((d) => {
      const transfers = [];
      for (const i of items) {
        const x = i.x + dx;
        const y = i.y + dy;
        const direct = i.parent.name === 'band';
        const to = direct ? Canvas.bandAt(y + Math.min(i.h / 2, 5)) || i.band : i.band;
        const re = S.reportElement(d.at(i.node.path)).path;
        const changed = direct && to !== i.band;
        const left = Math.max(0, x - (changed ? to.x : i.ox));
        const top = Math.max(0, y - (changed ? to.y : i.oy));
        d.attr(re, 'x', left);
        d.attr(re, 'y', top);
        if (direct) grow(d, to, top + i.h);
        if (changed) transfers.push({ from: i.node.path, to: to.node.path });
      }
      if (!transfers.length) return items.map((i) => i.node.path);
      return relocate(d, transfers);
    });
  };

  // marca os nós para achá-los depois que os índices mudarem
  function relocate(d, transfers) {
    const mark = 'designerMove';
    const bands = [...new Set(transfers.map((t) => t.to))];
    const jobs = transfers.map((t) => ({ xml: d.source(t.from), band: bands.indexOf(t.to) }));
    bands.forEach((path, i) => d.attr(path, mark, i));
    descending(transfers.map((t) => t.from)).forEach((path) => d.remove(path));
    const find = (value) => {
      let found;
      walk(d.report, (n) => { if (get(n, mark) === String(value)) found = n.path; });
      return found;
    };
    const added = jobs.map((job) => d.insert(find(job.band), job.xml));
    bands.forEach((_, i) => d.attr(find(i), mark, ''));
    return added;
  }

  App.resize = (item, r) => commit((d) => {
    const re = S.reportElement(d.at(item.node.path)).path;
    const x = Math.max(0, r.x - item.ox);
    const y = Math.max(0, r.y - item.oy);
    for (const [key, value] of Object.entries({ x, y, width: r.w, height: r.h })) d.attr(re, key, value);
    if (item.parent.name === 'band') grow(d, item.band, y + r.h);
  });

  App.bandHeight = (band, height) => {
    const used = Canvas.layout.items.filter((i) => i.parent === band.node).reduce((max, i) => Math.max(max, i.y + i.h - band.y), 0);
    if (height < used) App.status(`Altura mínima desta banda: ${used}, por causa dos elementos.`);
    commit((d) => {
      d.attr(band.node.path, 'height', Math.max(height, used));
      return [band.node.path];
    });
  };

  App.add = (data, host, p) => {
    const size = S.PALETTE.find((t) => t[0] === data.type);
    if (!size) return;
    const w = Math.min(size[3], host.w);
    const x = Math.max(0, Math.min(Math.round(p.x - host.x), host.w - w));
    const y = Math.max(0, Math.round(p.y - host.y));
    commit((d) => {
      const path = d.insert(host.node.path, S.create(data.type, { x, y, w, h: size[4] }, data));
      if (host.node.name === 'band') grow(d, host.band, y + size[4]);
      // como no iReport: campo solto no detail ganha título no columnHeader
      if (data.label && host.node.parent?.name === 'detail') {
        const header = kid(kid(d.report, 'columnHeader'), 'band');
        if (header && int(get(header, 'height', 0)) > 0) {
          d.insert(header.path, S.create('staticText', { x, y: 0, w, h: Math.min(20, int(get(header, 'height'))) }, { text: data.label }));
        }
      }
      return [path];
    });
  };

  App.addToBand = (data) => {
    const b = Canvas.layout.bands.find((band) => App.selection.includes(band.node.path));
    if (b) App.add(data, { ...b, band: b }, { x: b.x, y: b.y });
    else App.status('Selecione uma banda antes, ou arraste o item para ela.');
  };

  App.addBand = (ownerPath, name) => commit((d) => {
    const owner = d.at(ownerPath);
    const order = S.ORDER[owner.name];
    const section = kid(owner, name);
    const repeats = ['detail', 'groupHeader', 'groupFooter'].includes(name);
    const empty = section && all(section, 'band').find((b) => !int(get(b, 'height', 0)));
    if (empty) { d.attr(empty.path, 'height', 50); return [empty.path]; }
    if (section && (repeats || !kid(section, 'band'))) return [d.insert(section.path, '<band height="50" splitType="Stretch"/>')];
    if (!section) return [`${d.insert(ownerPath, `<${name}>\n\t<band height="50" splitType="Stretch"/>\n</${name}>`, position(owner, name, order))}.0`];
  });

  App.declare = (kind) => Panels.dialog({
    title: `Novo ${kind}: nome`,
    onSave: (raw) => {
      const name = raw.trim();
      if (!name) return;
      if (/[{}"<>]/.test(name)) return App.status('O nome não pode ter { } " < >.');
      if (all(App.draft.report, kind).some((n) => get(n, 'name') === name)) return App.status(`O nome ${name} já existe.`);
      const n = `name="${J.attrText(name)}"`;
      const xml = {
        field: `<field ${n} class="java.lang.String"/>`,
        parameter: `<parameter ${n} class="java.lang.String"/>`,
        style: `<style ${n}/>`,
        variable: `<variable ${n} class="java.lang.String">\n\t<variableExpression><![CDATA[""]]></variableExpression>\n</variable>`,
        group: `<group ${n}>\n\t<groupExpression><![CDATA[""]]></groupExpression>\n\t<groupHeader>\n\t\t<band height="30"/>\n\t</groupHeader>\n\t<groupFooter>\n\t\t<band height="30"/>\n\t</groupFooter>\n</group>`
      }[kind];
      commit((d) => [d.insert(d.report.path, xml, position(d.report, kind, S.ORDER.jasperReport))]);
    }
  });

  function chosen() {
    return Canvas.selected().filter((i, _, list) => !list.some((o) => i.node.path.startsWith(`${o.node.path}.`)));
  }

  function remove() {
    const removable = ['band', 'field', 'parameter', 'variable', 'group', 'style', 'queryString'];
    const nodes = App.selection.map((p) => App.draft.at(p))
      .filter((n) => n && (removable.includes(n.name) || S.reportElement(n)))
      .filter((n, _, list) => !list.some((o) => n.path.startsWith(`${o.path}.`)));
    if (!nodes.length) return;
    for (const n of nodes) {
      const letter = { field: 'F', parameter: 'P', variable: 'V' }[n.name];
      const name = get(n, 'name');
      let used = false;
      if (letter || n.name === 'style') walk(App.draft.report, (x) => {
        if (x === n) return;
        if (letter ? content(x).includes(`$${letter}{${name}}`) : get(x, 'style') === name) used = true;
      });
      if (used) return App.status(`${name} ainda está em uso e não foi excluído.`);
    }
    commit((d) => {
      for (const path of descending(nodes.map((n) => n.path))) {
        const parent = d.at(path).parent;
        // seção sem banda não faz sentido: remove junto
        const whole = d.at(path).name === 'band' && parent.kids.length === 1;
        d.remove(whole ? parent.path : path);
      }
      return [];
    });
  }

  function copy() {
    const items = chosen().map((i) => ({ xml: App.draft.source(i.node.path) }));
    if (!items.length) return;
    clipboard = items;
    vscode.postMessage({ type: 'copy', items });
    App.status(`${items.length} elemento(s) copiado(s).`);
  }

  function paste(items = clipboard) {
    if (!items.length) return;
    const first = chosen()[0];
    const band = Canvas.layout.bands.find((b) => App.selection.includes(b.node.path));
    const parent = first?.parent || band?.node;
    if (!parent) return App.status('Selecione a banda onde quer colar.');
    commit((d) => items.map(({ xml }) => {
      const path = d.insert(parent.path, xml);
      const re = S.reportElement(d.at(path));
      const y = int(get(re, 'y', 0)) + (first ? 5 : 0);
      const bottom = y + int(get(re, 'height', 0));
      if (first) {
        const at = re.path;
        d.attr(at, 'x', int(get(re, 'x', 0)) + 5);
        d.attr(at, 'y', y);
      }
      if (parent.name === 'band') grow(d, band || first.band, bottom);
      return path;
    }));
  }

  function arrange(kind) {
    const list = chosen();
    if (!list.length) return;
    const ref = list.length > 1 ? list[0] : list[0].parent.name === 'band' ? list[0].band : null;
    if (!ref) return;
    let targets = list.length > 1 ? list.slice(1) : list;
    const next = new Map();
    if (kind === 'dh' || kind === 'dv') {
      if (list.length < 3) return App.status('Selecione pelo menos 3 elementos para distribuir.');
      const [axis, size] = kind === 'dh' ? ['x', 'w'] : ['y', 'h'];
      const sorted = list.slice().sort((a, b) => a[axis] - b[axis]);
      const last = sorted[sorted.length - 1];
      const gap = (last[axis] + last[size] - sorted[0][axis] - sorted.reduce((t, i) => t + i[size], 0)) / (sorted.length - 1);
      let at = sorted[0][axis];
      for (const i of sorted) { next.set(i, { [axis]: Math.round(at) }); at += i[size] + gap; }
      targets = sorted;
    } else {
      for (const i of targets) next.set(i, {
        left: { x: ref.x }, center: { x: Math.round(ref.x + (ref.w - i.w) / 2) }, right: { x: ref.x + ref.w - i.w },
        top: { y: ref.y }, middle: { y: Math.round(ref.y + (ref.h - i.h) / 2) }, bottom: { y: ref.y + ref.h - i.h },
        width: { w: ref.w }, height: { h: ref.h }
      }[kind]);
    }
    commit((d) => {
      for (const i of targets) {
        const v = next.get(i);
        const re = S.reportElement(d.at(i.node.path)).path;
        if ('x' in v) d.attr(re, 'x', Math.max(0, v.x - i.ox));
        if ('y' in v) d.attr(re, 'y', Math.max(0, v.y - i.oy));
        if ('w' in v) d.attr(re, 'width', v.w);
        if ('h' in v) d.attr(re, 'height', v.h);
        if (i.parent.name === 'band') grow(d, i.band, Math.max(0, (v.y ?? i.y) - i.oy) + (v.h ?? i.h));
      }
    });
  }

  function layer(front) {
    const list = chosen();
    if (list.length !== 1) return App.status('Selecione um único elemento.');
    const { node } = list[0];
    commit((d) => {
      const parent = d.at(node.parent.path);
      const first = parent.kids.indexOf(S.elements(parent)[0]);
      const xml = d.source(node.path);
      d.remove(node.path);
      return [d.insert(node.parent.path, xml, front ? Infinity : first)];
    });
  }

  function nudge(dx, dy, resize) {
    const list = chosen();
    if (!list.length) return;
    commit((d) => {
      for (const i of list) {
        const re = S.reportElement(d.at(i.node.path)).path;
        const x = Math.max(0, i.x - i.ox + (resize ? 0 : dx));
        const y = Math.max(0, i.y - i.oy + (resize ? 0 : dy));
        const height = Math.max(1, i.h + (resize ? dy : 0));
        if (dx) d.attr(re, resize ? 'width' : 'x', resize ? Math.max(1, i.w + dx) : x);
        if (dy) d.attr(re, resize ? 'height' : 'y', resize ? height : y);
        if (i.parent.name === 'band') grow(d, i.band, y + height);
      }
    });
  }

  function zoom(value) {
    App.zoomed = true;
    App.zoom = Math.min(4, Math.max(0.25, value));
    App.ui.zoom.textContent = `${Math.round(App.zoom * 100)}%`;
    persist();
    if (App.draft) Canvas.render();
  }

  function keys(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') {
      e.preventDefault();
      e.stopPropagation();
      // grava o campo em edição antes de salvar
      if (e.target.matches('input')) e.target.blur();
      vscode.postMessage({ type: 'save' });
      return;
    }
    if (!App.draft || e.target.closest('input, textarea, select, dialog')) return;
    const actions = { c: copy, v: () => paste(), x: () => { if (chosen().length) { copy(); remove(); } },
      d: () => paste(chosen().map((i) => ({ xml: App.draft.source(i.node.path) }))),
      a: () => App.select(Canvas.layout.items.map((i) => i.node.path)) };
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (mod && actions[key]) actions[key]();
    else if (key === 'delete') remove();
    else if (key === 'f2' && App.selection.length === 1) App.edit(App.selection[0]);
    else if (key === 'escape') App.select([App.draft.report.path]);
    else if (arrows[key] && chosen().length) {
      const step = mod ? 10 : 1;
      nudge(arrows[key][0] * step, arrows[key][1] * step, e.shiftKey);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function build() {
    const button = (label, title, run) => h('button', { title, onclick: run }, label);
    const sep = () => h('i', { class: 'sep' });
    const toggle = (label, key) => {
      const el = button(label, label, () => {
        App[key] = !App[key];
        el.classList.toggle('on', App[key]);
        persist();
        if (App.draft) Canvas.render();
      });
      el.classList.toggle('on', App[key]);
      return el;
    };
    const ui = App.ui;
    ui.zoom = h('span', { class: 'zoom' }, `${Math.round(App.zoom * 100)}%`);
    const align = [['⇤', 'Alinhar à esquerda', 'left'], ['↔', 'Centralizar na horizontal', 'center'], ['⇥', 'Alinhar à direita', 'right'],
      ['⤒', 'Alinhar no topo', 'top'], ['↕', 'Centralizar na vertical', 'middle'], ['⤓', 'Alinhar embaixo', 'bottom'],
      ['=L', 'Mesma largura', 'width'], ['=A', 'Mesma altura', 'height'], ['⋯', 'Distribuir na horizontal', 'dh'], ['⋮', 'Distribuir na vertical', 'dv']];
    const bar = h('nav', { class: 'toolbar' },
      button('↶', 'Desfazer (Ctrl+Z)', () => vscode.postMessage({ type: 'undo' })),
      button('↷', 'Refazer (Ctrl+Y)', () => vscode.postMessage({ type: 'redo' })), sep(),
      button('−', 'Menos zoom', () => zoom(App.zoom / 1.2)), ui.zoom, button('+', 'Mais zoom', () => zoom(App.zoom * 1.2)),
      button('Ajustar', 'Ajustar à largura', () => App.draft && zoom(Canvas.fit())), sep(),
      ...align.map(([label, title, kind]) => button(label, title, () => arrange(kind))), sep(),
      button('Frente', 'Trazer para frente', () => layer(true)), button('Trás', 'Enviar para trás', () => layer(false)), sep(),
      toggle('Grade', 'grid'), toggle('Encaixe', 'snap'), sep(),
      button('Query', 'Editar a consulta SQL', () => App.draft && App.query()),
      button('XML', 'Abrir o XML ao lado', () => vscode.postMessage({ type: 'xml', offset: App.draft?.at(App.selection[0] ?? '0')?.start })));

    ui.tree = h('div', { class: 'scroller tree' });
    ui.palette = h('div', { class: 'palette' });
    ui.props = h('div', { class: 'scroller props' });
    ui.paper = h('div', { class: 'paper' });
    ui.rulerX = h('canvas', { class: 'ruler-x' });
    ui.rulerY = h('canvas', { class: 'ruler-y' });
    ui.scroll = h('div', { class: 'stage', tabindex: '0' }, ui.paper);
    ui.status = h('footer', { class: 'status' });
    ui.error = h('div', { class: 'error', hidden: '' });
    const left = h('aside', { class: 'left' }, h('h2', {}, 'Report Inspector'), ui.tree);
    const right = h('aside', { class: 'right' }, h('h2', {}, 'Palette'), ui.palette, h('h2', {}, 'Properties'), ui.props);
    const center = h('main', {}, h('div', { class: 'corner' }), ui.rulerX, ui.rulerY, ui.scroll, ui.error);
    document.body.append(bar, h('div', { class: 'workspace' }, left, center, right), ui.status);

    Layout.setup({
      left, right,
      // a escolha feita nesta aba vale sobre a preferência geral
      initial: App.layout || JSON.parse(decodeURIComponent(document.body.dataset.layout)),
      save: (value) => {
        App.layout = value;
        persist();
        vscode.postMessage({ type: 'layout', value });
      }
    });
    Panels.palette();
    ui.scroll.addEventListener('pointerdown', Canvas.down);
    ui.scroll.addEventListener('dblclick', (e) => {
      // o primeiro clique redesenha as alças por cima do elemento
      const path = e.target.closest('.element')?.dataset.path || document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.classList.contains('element'))?.dataset.path;
      if (path) App.edit(path);
    });
    ui.scroll.addEventListener('dragover', (e) => e.preventDefault());
    ui.scroll.addEventListener('drop', Canvas.drop);
    ui.scroll.addEventListener('scroll', Canvas.rulers);
    ui.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(App.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    new ResizeObserver(() => App.draft && Canvas.rulers()).observe(ui.scroll);
    addEventListener('keydown', keys, true);
  }

  function load(text) {
    try {
      const draft = new J.Draft(text);
      if (draft.report.kids.some((k) => k.name === 'element' || (k.name === 'query' && !k.kids.length))) {
        throw Error('O formato do JasperReports 7 não é suportado; use JRXML até a versão 6');
      }
      const first = !App.draft;
      // um índice só continua válido se ainda apontar para o mesmo tipo de nó
      const kept = first ? [draft.report.path] : App.selection.filter((p) => draft.at(p) && draft.at(p).name === App.draft.at(p)?.name);
      App.draft = draft;
      App.selection = kept;
      App.ui.error.hidden = true;
      refresh();
      if (first && !saved.zoom) zoom(Math.min(1.5, Canvas.fit()));
    } catch (e) {
      App.ui.error.textContent = `${e.message}. Corrija pelo XML (ícone <> no alto da aba).`;
      App.ui.error.hidden = false;
    }
  }

  addEventListener('message', ({ data }) => {
    if (data.type === 'clipboard') clipboard = data.items;
    if (data.type !== 'document') return;
    if (data.force) seq = data.seq;
    else if (data.seq < seq) return; // resposta de uma edição já superada
    if (data.force || data.text !== App.draft?.text || !App.ui.error.hidden) load(data.text);
  });

  build();
  vscode.postMessage({ type: 'ready' });
})();
