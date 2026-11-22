// Report Inspector, paleta, propriedades e diálogos
(function () {
  const { get, kid, all, content } = J;
  const open = new Set(['fields', 'bands']);
  const VARS = { PAGE_NUMBER: 'Integer', COLUMN_NUMBER: 'Integer', REPORT_COUNT: 'Integer', PAGE_COUNT: 'Integer', COLUMN_COUNT: 'Integer' };
  const PARAMS = {
    REPORT_CONNECTION: 'java.sql.Connection', REPORT_LOCALE: 'java.util.Locale',
    REPORT_PARAMETERS_MAP: 'java.util.Map', IS_IGNORE_PAGINATION: 'java.lang.Boolean'
  };
  const KINDS = { parameter: ['Parameters', 'P'], field: ['Fields', 'F'], variable: ['Variables', 'V'] };

  function symbols(kind) {
    const r = App.draft.report;
    const own = all(r, kind).map((node) => ({ node, name: get(node, 'name'), cls: get(node, 'class', 'java.lang.String') }));
    if (kind === 'parameter') for (const name in PARAMS) own.push({ name, cls: PARAMS[name] });
    if (kind === 'variable') {
      const names = Object.keys(VARS).concat(all(r, 'group').map((g) => `${get(g, 'name')}_COUNT`));
      names.forEach((name) => own.push({ name, cls: 'java.lang.Integer' }));
    }
    return own;
  }

  function row(depth, options) {
    const el = h('div', {
      class: `row ${options.muted ? 'muted' : ''}`, title: options.hint || options.label, draggable: options.drag ? 'true' : undefined,
      'data-select': options.node?.path, onclick: options.click, ondblclick: options.edit,
      ondragstart: options.drag && ((e) => e.dataTransfer.setData('text/plain', JSON.stringify(options.drag)))
    }, h('span', { class: 'twist' }, options.twist || ''), h('span', { class: `icon ${options.tone || ''}` }, options.icon || ''), h('span', { class: 'name' }, options.label));
    el.style.paddingLeft = `${4 + depth * 12}px`;
    if (options.add) el.append(h('button', { class: 'add', title: 'Adicionar', onclick: (e) => { e.stopPropagation(); options.add(); } }, '+'));
    return el;
  }

  function tree() {
    const out = [];
    const r = App.draft.report;
    const folder = (key, depth, options, children) => {
      const expanded = open.has(key);
      const toggle = () => { if (expanded) open.delete(key); else open.add(key); tree(); highlight(); };
      out.push(row(depth, { ...options, twist: expanded ? '▾' : '▸', click: (e) => {
        if (options.node && !e.target.closest('.twist')) App.select([options.node.path]);
        else toggle();
      }, edit: options.node && toggle }));
      if (expanded) children();
    };
    const leaf = (depth, node, options) => out.push(row(depth, {
      node, click: (e) => App.select(e.ctrlKey ? [...new Set(App.selection.concat(node.path))] : [node.path]), ...options
    }));
    const element = (node, depth) => {
      const icon = S.PALETTE.find((p) => p[0] === node.name)?.[2] || '◇';
      const text = content(kid(node, 'text') || kid(node, 'textFieldExpression') || kid(node, 'imageExpression'));
      const options = { icon, label: text || node.name, edit: () => App.edit(node.path) };
      if (node.name === 'frame') folder(node.path, depth, { ...options, node }, () => S.elements(node).forEach((k) => element(k, depth + 1)));
      else leaf(depth, node, options);
    };

    leaf(0, r, { icon: '▤', label: get(r, 'name', 'Relatório') });
    folder('styles', 1, { icon: 'S', label: 'Styles', add: () => App.declare('style') }, () =>
      all(r, 'style').forEach((node) => leaf(2, node, { icon: 'S', label: get(node, 'name') })));

    for (const [kind, [title, letter]] of Object.entries(KINDS)) {
      folder(`${kind}s`, 1, { icon: letter, tone: kind, label: title, add: () => App.declare(kind) }, () => {
        for (const { node, name, cls } of symbols(kind)) {
          const options = { icon: letter, tone: kind, label: name, hint: `${name}: ${cls}`, drag: { type: 'textField', expr: `$${letter}{${name}}`, cls, label: kind === 'field' ? name : null } };
          if (node) leaf(2, node, options);
          else out.push(row(2, { ...options, muted: true }));
        }
      });
    }

    const query = kid(r, 'queryString');
    out.push(row(1, { node: query, icon: 'Q', label: 'Query', click: () => query && App.select([query.path]), edit: () => App.query() }));
    folder('groups', 1, { icon: 'G', label: 'Report Groups', add: () => App.declare('group') }, () =>
      all(r, 'group').forEach((node) => leaf(2, node, { icon: 'G', label: get(node, 'name') })));
    folder('bands', 1, { icon: '☰', label: 'Bandas' }, () => {
      const list = S.bands(r);
      const slot = (owner, name, label) => {
        const section = kid(owner, name);
        const found = list.filter((b) => b.node.parent === section);
        const add = () => App.addBand(owner.path, name);
        if (!found.length) out.push(row(2, { icon: '▱', label, muted: true, hint: 'Duplo clique para criar a banda', edit: add }));
        found.forEach(({ node, label: text }, i) => {
          const multi = ['detail', 'groupHeader', 'groupFooter'].includes(name) && i === found.length - 1;
          folder(node.path, 2, { node, icon: '▰', label: text, add: multi ? add : null }, () => S.elements(node).forEach((k) => element(k, 3)));
        });
      };
      const groups = all(r, 'group');
      for (const name of S.SECTIONS) {
        if (name === 'detail') groups.forEach((g) => slot(g, 'groupHeader', `${get(g, 'name')} Header`));
        if (name === 'columnFooter') groups.slice().reverse().forEach((g) => slot(g, 'groupFooter', `${get(g, 'name')} Footer`));
        slot(r, name, name);
      }
    });
    App.ui.tree.replaceChildren(...out);
  }

  function highlight() {
    App.ui.tree.querySelectorAll('[data-select]').forEach((el) => el.classList.toggle('selected', App.selection.includes(el.dataset.select)));
  }

  function palette() {
    App.ui.palette.replaceChildren(...S.PALETTE.map(([type, label, icon]) => h('div', {
      class: 'tool', draggable: 'true', title: 'Arraste para uma banda, ou dê duplo clique',
      ondblclick: () => App.addToBand({ type }),
      ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ type }))
    }, h('span', { class: 'icon' }, icon), label)));
  }

  // route: caminho relativo ao elemento; '@re' é o reportElement
  const prop = (label, route, attr, type = 'text', options) => ({ label, route, attr, type, options });
  const FONTS = ['Arial', 'SansSerif', 'Serif', 'Monospaced', 'Times New Roman', 'Verdana', 'Tahoma', 'Calibri', 'DejaVu Sans'];
  const H = ['Left', 'Center', 'Right', 'Justified'];
  const V = ['Top', 'Middle', 'Bottom'];
  const PEN = ['Solid', 'Dashed', 'Dotted', 'Double'];
  const EVAL = ['Now', 'Report', 'Page', 'Column', 'Group', 'Band', 'Auto'];
  const RESET = ['None', 'Report', 'Page', 'Column', 'Group'];
  const body = (label, route = '', cls = null) => [prop(label, route, null, 'body')].concat(cls ? [prop('Expression Class', route, 'class', 'list', cls)] : []);

  function border(prefix) {
    const route = prefix.concat('box');
    const out = [prop('Padding', route.join('/'), 'padding', 'int')];
    for (const side of ['top', 'left', 'bottom', 'right']) out.push(prop(`Padding ${side}`, route.join('/'), `${side}Padding`, 'int'));
    for (const pen of ['pen', 'topPen', 'leftPen', 'bottomPen', 'rightPen']) {
      const at = route.concat(pen).join('/');
      const name = pen === 'pen' ? 'Todas' : pen.replace('Pen', '');
      out.push(prop(`${name}: espessura`, at, 'lineWidth', 'num'), prop(`${name}: cor`, at, 'lineColor', 'color'), prop(`${name}: traço`, at, 'lineStyle', PEN));
    }
    return out;
  }

  function spec(node) {
    const p = (label, attr, type, options) => prop(label, '', attr, type, options);
    switch (node.name) {
      case 'jasperReport': return [
        ['Relatório', [p('Report name', 'name'), p('Language', 'language', ['java', 'groovy']), p('When no data', 'whenNoDataType', ['NoPages', 'BlankPage', 'AllSectionsNoDetail', 'NoDataSection'])]],
        ['Página', [p('Page width', 'pageWidth', 'int'), p('Page height', 'pageHeight', 'int'), p('Orientation', 'orientation', ['Portrait', 'Landscape']),
          ...['left', 'right', 'top', 'bottom'].map((s) => p(`${s} margin`, `${s}Margin`, 'int'))]],
        ['Colunas', [p('Columns', 'columnCount', 'int'), p('Column width', 'columnWidth', 'int'), p('Column spacing', 'columnSpacing', 'int'), p('Print order', 'printOrder', ['Vertical', 'Horizontal'])]],
        ['Opções', ['isTitleNewPage', 'isSummaryNewPage', 'isSummaryWithPageHeaderAndFooter', 'isFloatColumnFooter', 'isIgnorePagination'].map((a) => p(a, a, 'bool'))]
      ];
      case 'band': return [['Banda', [p('Band height', 'height', 'int'), p('Split type', 'splitType', ['Stretch', 'Prevent', 'Immediate']), ...body('Print When Expression', 'printWhenExpression')]]];
      case 'field': return [['Field', [p('Name', 'name'), p('Class', 'class', 'list', S.CLASSES)]]];
      case 'parameter': return [['Parameter', [p('Name', 'name'), p('Class', 'class', 'list', S.CLASSES), p('For prompting', 'isForPrompting', 'bool'), ...body('Description', 'parameterDescription'), ...body('Default Value Expression', 'defaultValueExpression')]]];
      case 'variable': return [['Variable', [p('Name', 'name'), p('Class', 'class', 'list', S.CLASSES),
        p('Calculation', 'calculation', ['Nothing', 'Count', 'DistinctCount', 'Sum', 'Average', 'Lowest', 'Highest', 'StandardDeviation', 'Variance', 'System', 'First']),
        p('Reset type', 'resetType', RESET), p('Reset group', 'resetGroup'), p('Increment type', 'incrementType', RESET), p('Increment group', 'incrementGroup'),
        ...body('Variable Expression', 'variableExpression'), ...body('Initial Value Expression', 'initialValueExpression')]]];
      case 'group': return [['Group', [p('Name', 'name'), ...body('Group Expression', 'groupExpression'),
        ...['isStartNewPage', 'isStartNewColumn', 'isResetPageNumber', 'isReprintHeaderOnEachPage', 'keepTogether'].map((a) => p(a, a, 'bool')), p('Min height to start new page', 'minHeightToStartNewPage', 'int')]]];
      case 'queryString': return [['Query', [p('Language', 'language'), ...body('Query')]]];
      case 'style': return [
        ['Style', [p('Name', 'name'), p('Default style', 'isDefault', 'bool'), p('Parent style', 'style'), p('Mode', 'mode', ['Opaque', 'Transparent']), p('Forecolor', 'forecolor', 'color'), p('Backcolor', 'backcolor', 'color')]],
        ['Texto', [p('Font', 'fontName', 'list', FONTS), p('Size', 'fontSize', 'int'), p('Bold', 'isBold', 'bool'), p('Italic', 'isItalic', 'bool'), p('Underline', 'isUnderline', 'bool'), p('Horizontal', 'hAlign', H), p('Vertical', 'vAlign', V), p('Pattern', 'pattern')]],
        ['Bordas', border([])]
      ];
    }
    if (!S.reportElement(node)) return [];
    const re = (label, attr, type, options) => prop(label, '@re', attr, type, options);
    const out = [
      ['Posição e tamanho', [re('Left', 'x', 'int'), re('Top', 'y', 'int'), re('Width', 'width', 'int'), re('Height', 'height', 'int')]],
      ['Aparência', [re('Forecolor', 'forecolor', 'color'), re('Backcolor', 'backcolor', 'color'), re('Mode', 'mode', ['Opaque', 'Transparent']),
        re('Style', 'style', [...new Set(all(App.draft.report, 'style').map((s) => get(s, 'name')))])]]
    ];
    if (node.name === 'staticText') out.unshift(['Static Text', body('Text', 'text')]);
    if (node.name === 'textField') out.unshift(['Text Field', [...body('Text Field Expression', 'textFieldExpression', S.TEXT_CLASSES),
      p('Pattern', 'pattern', 'list', ['dd/MM/yyyy', 'dd/MM/yyyy HH:mm', 'HH:mm', '#,##0', '#,##0.00', '¤ #,##0.00', '#,##0.00 %']),
      p('Blank when null', 'isBlankWhenNull', 'bool'), p('Stretch with overflow', 'isStretchWithOverflow', 'bool'), p('Evaluation time', 'evaluationTime', EVAL), p('Evaluation group', 'evaluationGroup')]]);
    if (node.name === 'image') out.unshift(['Image', [...body('Image Expression', 'imageExpression', ['java.lang.String', 'java.io.InputStream', 'java.net.URL', 'java.io.File', 'java.awt.Image']),
      p('Scale image', 'scaleImage', ['Clip', 'FillFrame', 'RetainShape', 'RealHeight', 'RealSize']), p('Horizontal', 'hAlign', H.slice(0, 3)), p('Vertical', 'vAlign', V), p('On error', 'onErrorType', ['Error', 'Blank', 'Icon']), p('Using cache', 'isUsingCache', 'bool')]]);
    if (node.name === 'subreport') out.unshift(['Subreport', [...body('Subreport Expression', 'subreportExpression'), ...body('Connection Expression', 'connectionExpression')]]);
    if (node.name === 'line') out.unshift(['Line', [p('Direction', 'direction', ['TopDown', 'BottomUp'])]]);
    if (node.name === 'break') out.unshift(['Break', [p('Type', 'type', ['Page', 'Column'])]]);
    if (node.name === 'rectangle') out.unshift(['Rectangle', [p('Radius', 'radius', 'int')]]);
    if (kid(node, 'textElement') || ['textField', 'staticText'].includes(node.name)) {
      const t = (label, attr, type, options) => prop(label, 'textElement', attr, type, options);
      const f = (label, attr, type, options) => prop(label, 'textElement/font', attr, type, options);
      out.push(['Texto', [f('Font', 'fontName', 'list', FONTS), f('Size', 'size', 'int'), f('Bold', 'isBold', 'bool'), f('Italic', 'isItalic', 'bool'), f('Underline', 'isUnderline', 'bool'), f('Strike through', 'isStrikeThrough', 'bool'),
        t('Horizontal', 'textAlignment', H), t('Vertical', 'verticalAlignment', V), t('Rotation', 'rotation', ['None', 'Left', 'Right', 'UpsideDown']), t('Markup', 'markup', ['none', 'styled', 'html', 'rtf']), f('PDF font', 'pdfFontName')]]);
    }
    if (['line', 'rectangle', 'ellipse'].includes(node.name)) {
      const pen = 'graphicElement/pen';
      out.push(['Traço', [prop('Espessura', pen, 'lineWidth', 'num'), prop('Cor', pen, 'lineColor', 'color'), prop('Estilo', pen, 'lineStyle', PEN)]]);
    }
    if (['staticText', 'textField', 'image', 'frame'].includes(node.name)) out.push(['Bordas', border([])]);
    out.push(['Impressão', [re('Position type', 'positionType', ['Float', 'FixRelativeToTop', 'FixRelativeToBottom']), re('Stretch type', 'stretchType', ['NoStretch', 'RelativeToTallestObject', 'RelativeToBandHeight']),
      re('Print repeated values', 'isPrintRepeatedValues', 'bool'), re('Remove line when blank', 'isRemoveLineWhenBlank', 'bool'), re('Print in first whole band', 'isPrintInFirstWholeBand', 'bool'),
      re('Print when detail overflows', 'isPrintWhenDetailOverflows', 'bool'), re('Key', 'key'), ...body('Print When Expression', '@re/printWhenExpression')]]);
    return out;
  }

  const collapsed = new Set(['Bordas']);

  function properties() {
    const host = App.ui.props;
    const nodes = App.selection.map((p) => App.draft.at(p)).filter(Boolean);
    if (!nodes.length) return host.replaceChildren(h('p', { class: 'empty' }, 'Selecione um item.'));
    const key = (p) => `${p.route}|${p.attr}|${p.label}`;
    let groups = spec(nodes[0]);
    // seleção múltipla: só as propriedades comuns
    for (const node of nodes.slice(1)) {
      const shared = new Set(spec(node).flatMap(([, list]) => list.map(key)));
      groups = groups.map(([title, list]) => [title, list.filter((p) => shared.has(key(p)) && p.type !== 'body')]).filter(([, list]) => list.length);
    }
    const title = nodes.length > 1 ? `${nodes.length} itens` : nodes[0].name;
    const sections = groups.map(([name, list]) => {
      const details = h('details', {}, h('summary', {}, name), ...list.map((p) => control(p, nodes)));
      details.open = !collapsed.has(name);
      details.addEventListener('toggle', () => { if (details.open) collapsed.delete(name); else collapsed.add(name); });
      return details;
    });
    host.replaceChildren(h('div', { class: 'object' }, title), ...sections);
  }

  function control(p, nodes) {
    const paths = nodes.map((n) => n.path);
    const values = nodes.map((node) => {
      const target = App.resolve(node, p.route);
      return p.attr ? get(target, p.attr) : content(target);
    });
    const mixed = values.some((v) => v !== values[0]);
    const value = mixed ? '' : values[0];
    const save = (v) => App.setProperty(paths, p, v);
    let input;
    if (p.type === 'body') {
      input = h('button', { class: 'body', title: value, onclick: () => App.editBody(paths[0], p) }, h('span', {}, value || '(vazio)'), '…');
    } else if (p.type === 'bool' || Array.isArray(p.type)) {
      const list = p.type === 'bool' ? ['true', 'false'] : p.type.slice();
      if (value && !list.includes(value)) list.push(value);
      input = h('select', { onchange: (e) => save(e.target.value) }, h('option', { value: '' }, mixed ? '(vários)' : '(padrão)'), ...list.map((v) => h('option', { value: v }, v)));
      input.value = value;
    } else {
      const numeric = p.type === 'int' || p.type === 'num';
      const id = p.type === 'list' ? `list-${p.route}-${p.attr}`.replace(/\W/g, '-') : undefined;
      const field = h('input', {
        type: numeric ? 'number' : 'text', step: p.type === 'num' ? '0.25' : undefined, list: id, value, placeholder: mixed ? '(vários)' : '',
        onchange: (e) => {
          let v = e.target.value.trim();
          if (numeric && e.target.validity.badInput) return;
          if (p.type === 'int' && v) v = String(Math.round(+v));
          if (p.type === 'color' && v && !/^#[0-9a-f]{6}$/i.test(v)) return App.status('Use uma cor no formato #RRGGBB.');
          save(v);
        }
      });
      input = field;
      if (id) input = h('span', { class: 'pair' }, field, h('datalist', { id }, ...p.options.map((v) => h('option', { value: v }))));
      if (p.type === 'color') {
        const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff', onchange: (e) => save(e.target.value.toUpperCase()) });
        input = h('span', { class: 'pair' }, picker, field);
      }
    }
    return h('label', { class: 'prop' }, h('span', { title: p.label }, p.label), input);
  }

  function dialog({ title, value = '', multiline = false, expression = false, onSave }) {
    const before = document.activeElement;
    const input = multiline ? h('textarea', { spellcheck: 'false' }) : h('input', { type: 'text' });
    input.value = value;
    const box = h('dialog', { class: multiline ? 'large' : '' });
    const close = () => { box.close(); box.remove(); before?.focus?.(); };
    const accept = () => { const v = input.value; close(); onSave(v); };
    const main = h('div', { class: 'dialog-main' }, input);
    if (expression) {
      main.append(h('div', { class: 'symbols' }, ...Object.entries(KINDS).flatMap(([kind, [, letter]]) => symbols(kind).map(({ name }) =>
        h('button', { onclick: () => { input.setRangeText(`$${letter}{${name}}`, input.selectionStart, input.selectionEnd, 'end'); input.focus(); } },
          h('span', { class: `icon ${kind}` }, letter), name)))));
    }
    box.append(h('h3', {}, title), main, h('footer', {}, h('button', { onclick: close }, 'Cancelar'), h('button', { class: 'primary', onclick: accept }, 'OK')));
    box.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); accept(); }
    });
    document.body.append(box);
    box.showModal();
    input.focus();
  }

  window.Panels = { tree, highlight, palette, properties, dialog };
})();
