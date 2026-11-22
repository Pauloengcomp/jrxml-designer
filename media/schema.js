// Regras do formato JRXML (compatíveis com JasperReports 4.0.2)
(function (global) {
  const J = typeof module === 'object' ? require('./model.js') : global.J;

  const ORDER = {
    jasperReport: ['property', 'import', 'template', 'reportFont', 'style', 'subDataset', 'scriptlet', 'parameter', 'queryString', 'field', 'sortField', 'variable', 'filterExpression', 'group', 'background', 'title', 'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData'],
    group: ['groupExpression', 'groupHeader', 'groupFooter'],
    band: ['printWhenExpression'],
    reportElement: ['property', 'propertyExpression', 'printWhenExpression'],
    staticText: ['reportElement', 'box', 'textElement', 'text'],
    textField: ['reportElement', 'box', 'textElement', 'textFieldExpression', 'patternExpression', 'anchorNameExpression', 'hyperlinkReferenceExpression'],
    image: ['reportElement', 'box', 'graphicElement', 'imageExpression', 'anchorNameExpression'],
    line: ['reportElement', 'graphicElement'],
    rectangle: ['reportElement', 'graphicElement'],
    ellipse: ['reportElement', 'graphicElement'],
    frame: ['reportElement', 'box', 'elementGroup'],
    textElement: ['font', 'paragraph'],
    graphicElement: ['pen'],
    box: ['pen', 'topPen', 'leftPen', 'bottomPen', 'rightPen'],
    style: ['pen', 'box', 'paragraph', 'conditionalStyle'],
    parameter: ['property', 'parameterDescription', 'defaultValueExpression'],
    variable: ['variableExpression', 'initialValueExpression'],
    subreport: ['reportElement', 'parametersMapExpression', 'subreportParameter', 'connectionExpression', 'dataSourceExpression', 'returnValue', 'subreportExpression']
  };
  const SECTIONS = ORDER.jasperReport.slice(ORDER.jasperReport.indexOf('background'));
  const PALETTE = [
    ['staticText', 'Static Text', 'A', 100, 20], ['textField', 'Text Field', 'F', 100, 20],
    ['image', 'Image', '▧', 100, 50], ['line', 'Line', '╱', 150, 1],
    ['rectangle', 'Rectangle', '▭', 100, 30], ['ellipse', 'Ellipse', '◯', 60, 40],
    ['frame', 'Frame', '⊞', 200, 60], ['subreport', 'Subreport', '❐', 200, 60],
    ['break', 'Break', '⇟', 100, 1],
    ['date', 'Data atual', 'D', 100, 20], ['page', 'Nº da página', '#', 80, 20], ['total', 'Total de páginas', 'N', 80, 20]
  ];
  const TEXT_CLASSES = ['String', 'Boolean', 'Byte', 'Double', 'Float', 'Integer', 'Long', 'Short', 'Number'].map((x) => `java.lang.${x}`)
    .concat('java.math.BigDecimal', 'java.util.Date', 'java.sql.Timestamp', 'java.sql.Time');
  const CLASSES = TEXT_CLASSES.concat('java.lang.Object', 'java.io.InputStream', 'java.util.Collection', 'java.sql.Connection');

  function reportElement(node) {
    return J.kid(node, 'reportElement') || J.kid(J.kid(node, 'chart'), 'reportElement');
  }
  function elements(parent) {
    return parent.kids.flatMap((k) => k.name === 'elementGroup' ? elements(k) : reportElement(k) ? [k] : []);
  }
  function bands(report) {
    const out = [];
    const add = (section, label) => J.all(section, 'band').forEach((node, i, list) =>
      out.push({ node, label: list.length > 1 ? `${label} ${i + 1}` : label }));
    const plain = (name) => add(J.kid(report, name), name);
    const groups = J.all(report, 'group');
    ['background', 'title', 'pageHeader', 'columnHeader'].forEach(plain);
    groups.forEach((g) => add(J.kid(g, 'groupHeader'), `${J.get(g, 'name')} Header`));
    plain('detail');
    groups.slice().reverse().forEach((g) => add(J.kid(g, 'groupFooter'), `${J.get(g, 'name')} Footer`));
    ['columnFooter', 'pageFooter', 'lastPageFooter', 'summary', 'noData'].forEach(plain);
    return out;
  }

  function create(type, box, options = {}) {
    const re = `\t<reportElement x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;
    const field = (expr, cls, extra = '') =>
      `<textField${extra}>\n${re}\n\t<textElement/>\n\t<textFieldExpression class="${J.attrText(cls)}">${J.cdata(expr)}</textFieldExpression>\n</textField>`;
    switch (type) {
      case 'staticText': return `<staticText>\n${re}\n\t<textElement/>\n\t<text>${J.cdata(options.text ?? 'Texto')}</text>\n</staticText>`;
      case 'textField': {
        const cls = options.cls || 'java.lang.String';
        const known = TEXT_CLASSES.includes(cls);
        const expr = options.expr ?? '""';
        return field(known ? expr : `String.valueOf(${expr})`, known ? cls : 'java.lang.String', ' isBlankWhenNull="true"');
      }
      case 'date': return field('new java.util.Date()', 'java.util.Date', ' pattern="dd/MM/yyyy"');
      case 'page': return field('$V{PAGE_NUMBER}', 'java.lang.Integer');
      case 'total': return field('$V{PAGE_NUMBER}', 'java.lang.Integer', ' evaluationTime="Report"');
      case 'image': return `<image onErrorType="Blank">\n${re}\n\t<imageExpression class="java.lang.String">${J.cdata('"imagem.png"')}</imageExpression>\n</image>`;
      case 'subreport': return `<subreport>\n${re}\n\t<connectionExpression>${J.cdata('$P{REPORT_CONNECTION}')}</connectionExpression>\n\t<subreportExpression class="java.lang.String">${J.cdata('"subreport.jasper"')}</subreportExpression>\n</subreport>`;
      default: return `<${type}>\n${re}\n</${type}>`;
    }
  }

  function resolveStyle(report, node) {
    const styles = J.all(report, 'style');
    const re = reportElement(node);
    let style = styles.find((s) => J.get(s, 'name') === J.get(re, 'style'));
    if (!style && !J.get(re, 'style')) style = styles.find((s) => J.get(s, 'isDefault') === 'true');
    const chain = [];
    while (style && !chain.includes(style)) {
      chain.unshift(style);
      const parent = J.get(style, 'style');
      style = styles.find((s) => J.get(s, 'name') === parent);
    }
    const result = { box: {}, pen: {}, sides: { top: {}, left: {}, bottom: {}, right: {} } };
    const merge = (target, source) => {
      if (source) for (const [key, a] of Object.entries(source.attrs)) target[key] = a.value;
    };
    const box = (b) => {
      if (!b) return;
      merge(result.box, b);
      for (const side in result.sides) {
        merge(result.sides[side], J.kid(b, 'pen'));
        merge(result.sides[side], J.kid(b, `${side}Pen`));
      }
    };
    for (const s of chain) {
      merge(result, s);
      merge(result.pen, J.kid(s, 'pen'));
      box(J.kid(s, 'box'));
    }
    merge(result, re);
    merge(result, node);
    const text = J.kid(node, 'textElement');
    if (text) {
      const f = J.kid(text, 'font');
      merge(result, f);
      if (J.get(f, 'size')) result.fontSize = J.get(f, 'size');
      if (J.get(text, 'textAlignment')) result.hAlign = J.get(text, 'textAlignment');
      if (J.get(text, 'verticalAlignment')) result.vAlign = J.get(text, 'verticalAlignment');
      if (J.get(text, 'rotation')) result.rotation = J.get(text, 'rotation');
    }
    merge(result.pen, J.kid(J.kid(node, 'graphicElement'), 'pen'));
    box(J.kid(node, 'box'));
    return result;
  }

  const api = { ORDER, SECTIONS, PALETTE, TEXT_CLASSES, CLASSES, reportElement, elements, bands, create, resolveStyle };
  if (typeof module === 'object') module.exports = api;
  else global.S = api;
})(globalThis);
