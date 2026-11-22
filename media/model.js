// Leitura e edição do JRXML por posição no texto: o que não foi editado fica intacto.
(function (global) {
  const local = (tag) => tag.replace(/^.*:/, '');
  const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, k) =>
    k[0] !== '#' ? entities[k] : String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1)));
  const attrText = (v) => String(v).replace(/[&<>"\n\r\t]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': '&#10;', '\r': '&#13;', '\t': '&#9;' })[c]);
  const cdata = (v) => `<![CDATA[${String(v).split(']]>').join(']]]]><![CDATA[>')}]]>`;

  function parse(text) {
    const root = { tag: '#document', kids: [], path: '', parts: [] };
    let node = root;
    let i = 0;
    const until = (token, from) => {
      const at = text.indexOf(token, from);
      if (at < 0) throw Error(`XML incompleto na linha ${text.slice(0, from).split('\n').length}`);
      return at;
    };
    while (i < text.length) {
      if (text[i] !== '<') {
        let j = text.indexOf('<', i);
        if (j < 0) j = text.length;
        node.parts.push({ value: decode(text.slice(i, j)) });
        i = j;
      } else if (text.startsWith('<!--', i)) i = until('-->', i) + 3;
      else if (text.startsWith('<![CDATA[', i)) {
        const j = until(']]>', i);
        node.parts.push({ value: text.slice(i + 9, j), cdata: true });
        i = j + 3;
      } else if (text.startsWith('<?', i)) i = until('?>', i) + 2;
      else if (text.startsWith('<!', i)) i = until('>', i) + 1;
      else if (text[i + 1] === '/') {
        const j = until('>', i);
        const tag = text.slice(i + 2, j).trim();
        if (node.tag !== tag) throw Error(`</${tag}> fora de lugar na linha ${text.slice(0, i).split('\n').length}`);
        node.closeStart = i;
        node.end = j + 1;
        node = node.parent;
        i = j + 1;
      } else {
        const m = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
        m.lastIndex = i;
        const found = m.exec(text);
        if (!found) throw Error(`Tag inválida na linha ${text.slice(0, i).split('\n').length}`);
        const [all, tag, raw, empty] = found;
        const child = {
          tag, name: local(tag), start: i, openEnd: i + all.length, empty: !!empty, attrs: {}, kids: [], parts: [],
          parent: node, path: node === root ? String(node.kids.length) : `${node.path}.${node.kids.length}`
        };
        for (const a of raw.matchAll(/(\s+)([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          const start = i + 1 + tag.length + a.index;
          child.attrs[a[2]] = { value: decode(a[3] ?? a[4]), start, end: start + a[0].length };
        }
        node.kids.push(child);
        i += all.length;
        if (empty) child.end = i;
        else node = child;
      }
    }
    if (node !== root) throw Error(`A tag <${node.tag}> não foi fechada`);
    if (root.kids.length !== 1 || root.kids[0].name !== 'jasperReport') throw Error('O arquivo não é um relatório JRXML');
    return root;
  }

  const get = (node, name, fallback = '') => node?.attrs[name]?.value ?? fallback;
  const kid = (node, name) => node?.kids.find((k) => k.name === name);
  const all = (node, name) => node ? node.kids.filter((k) => k.name === name) : [];
  function content(node) {
    if (!node) return '';
    const data = node.parts.filter((p) => p.cdata);
    return data.length ? data.map((p) => p.value).join('') : node.parts.map((p) => p.value).join('').trim();
  }
  function walk(node, visit) {
    visit(node);
    node.kids.forEach((k) => walk(k, visit));
  }

  class Draft {
    constructor(text) {
      this.eol = text.includes('\r\n') ? '\r\n' : '\n';
      this.unit = text.match(/\n([ \t]+)</)?.[1] || '\t';
      this.set(text);
    }
    set(text) {
      this.doc = parse(text);
      this.text = text;
      this.report = this.doc.kids[0];
    }
    at(path) {
      return String(path).split('.').reduce((n, i) => n?.kids[+i], this.doc);
    }
    splice(start, end, value) {
      this.set(this.text.slice(0, start) + value + this.text.slice(end));
    }
    attr(path, name, value) {
      const node = this.at(path);
      const old = node.attrs[name];
      const clear = value === '' || value == null;
      if (old) {
        if (clear) this.splice(old.start, old.end, '');
        else if (old.value !== String(value)) {
          const space = this.text.slice(old.start, old.end).match(/^\s+/)[0];
          this.splice(old.start, old.end, `${space}${name}="${attrText(value)}"`);
        }
      } else if (!clear) {
        const at = node.openEnd - (node.empty ? 2 : 1);
        this.splice(at, at, ` ${name}="${attrText(value)}"`);
      }
    }
    body(path, value) {
      const n = this.at(path);
      const data = cdata(String(value).replace(/\r?\n/g, this.eol));
      if (n.empty) this.splice(n.openEnd - 2, n.end, `>${data}</${n.tag}>`);
      else this.splice(n.openEnd, n.closeStart, data);
    }
    indent(at) {
      const line = this.text.lastIndexOf('\n', at - 1) + 1;
      return this.text.slice(line, at).match(/^[ \t]*/)[0];
    }
    // XML sem recuo externo, para copiar e mover
    source(path) {
      const n = this.at(path);
      const pad = this.indent(n.start);
      let inData = false;
      return this.text.slice(n.start, n.end).split(/\r?\n/).map((line, i) => {
        const result = i && !inData && line.startsWith(pad) ? line.slice(pad.length) : line;
        const open = line.lastIndexOf('<![CDATA[');
        const close = line.lastIndexOf(']]>');
        if (open > close) inData = true;
        else if (close > open) inData = false;
        return result;
      }).join('\n');
    }
    insert(parentPath, xml, index = Infinity) {
      const p = this.at(parentPath);
      const i = Math.min(index, p.kids.length);
      const base = this.indent(p.start);
      const pad = base + this.unit;
      let inData = false;
      const block = xml.split('\n').map((line) => {
        const result = inData ? line : pad + line.replace(/^\t+/, (t) => this.unit.repeat(t.length));
        const open = line.lastIndexOf('<![CDATA[');
        const close = line.lastIndexOf(']]>');
        if (open > close) inData = true;
        else if (close > open) inData = false;
        return result;
      }).join(this.eol);

      if (p.empty) this.splice(p.openEnd - 2, p.end, `>${this.eol}${block}${this.eol}${base}</${p.tag}>`);
      else {
        // depois do irmão anterior; assim comentários continuam junto do elemento seguinte
        const at = i ? p.kids[i - 1].end : p.openEnd;
        const closing = !p.kids.length && !this.text.slice(p.openEnd, p.closeStart).includes('\n') ? this.eol + base : '';
        this.splice(at, at, this.eol + block + closing);
      }
      return `${parentPath}.${i}`;
    }
    remove(path) {
      const n = this.at(path);
      const line = this.text.lastIndexOf('\n', n.start - 1);
      let start = line >= 0 && !this.text.slice(line, n.start).trim() ? line : n.start;
      if (start > 0 && this.text[start - 1] === '\r') start--;
      this.splice(start, n.end, '');
    }
    ensure(parentPath, name, order = [name]) {
      const p = this.at(parentPath);
      const found = kid(p, name);
      return found ? found.path : this.insert(parentPath, `<${name}/>`, position(p, name, order));
    }
  }

  function position(parent, name, order) {
    const rank = order.indexOf(name);
    const index = parent.kids.findIndex((k) => order.indexOf(k.name) > rank);
    return index < 0 ? parent.kids.length : index;
  }

  function patch(before, after) {
    let start = 0;
    while (start < before.length && before[start] === after[start]) start++;
    let end = before.length;
    let to = after.length;
    while (end > start && to > start && before[end - 1] === after[to - 1]) { end--; to--; }
    // não dividir um CRLF entre os lados da edição
    if (before[start - 1] === '\r') start--;
    if (before[end - 1] === '\r' && before[end] === '\n') { end++; to++; }
    return { start, end, insert: after.slice(start, to) };
  }

  const api = { Draft, parse, get, kid, all, content, walk, position, patch, attrText, cdata };
  if (typeof module === 'object') module.exports = api;
  else global.J = api;
})(globalThis);
