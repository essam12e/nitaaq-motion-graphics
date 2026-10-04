/**
 * Minimal, dependency-free XML reader/writer for SVG character files.
 * Well-formed XML only (SVG exports from Illustrator, Figma, Inkscape, Affinity).
 * Text, comments and CDATA are kept verbatim so re-serialised parts render the same.
 */
export interface XmlElement {
  type: 'element';
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export interface XmlText {
  type: 'text';
  raw: string;
}
export type XmlNode = XmlElement | XmlText;

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

export function parseXml(src: string): XmlElement {
  let i = 0;
  const root: XmlElement = { type: 'element', name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (src.slice(i).trim()) top().children.push({ type: 'text', raw: src.slice(i) });
      break;
    }
    if (lt > i) top().children.push({ type: 'text', raw: src.slice(i, lt) });
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end < 0) throw new Error('XML: unterminated comment');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end < 0) throw new Error('XML: unterminated CDATA');
      top().children.push({ type: 'text', raw: src.slice(lt, end + 3) });
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      // declarations / DOCTYPE (internal subsets with [...] supported)
      let j = lt + 2;
      let depth = 0;
      while (j < src.length) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = src.slice(lt + 2, end).trim();
      const el = stack.pop();
      if (!el || el.name !== name) throw new Error(`XML: mismatched </${name}>`);
      i = end + 1;
      continue;
    }
    NAME.lastIndex = lt + 1;
    const m = NAME.exec(src);
    if (!m) throw new Error(`XML: bad tag at ${lt}`);
    const el: XmlElement = { type: 'element', name: m[0], attrs: {}, children: [] };
    let j = NAME.lastIndex;
    for (;;) {
      while (/\s/.test(src[j])) j++;
      if (src[j] === '>' || (src[j] === '/' && src[j + 1] === '>')) break;
      NAME.lastIndex = j;
      const an = NAME.exec(src);
      if (!an) throw new Error(`XML: bad attribute in <${el.name}> at ${j}`);
      j = NAME.lastIndex;
      while (/\s/.test(src[j])) j++;
      if (src[j] !== '=') {
        el.attrs[an[0]] = '';
        continue;
      }
      j++;
      while (/\s/.test(src[j])) j++;
      const q = src[j];
      const end = src.indexOf(q, j + 1);
      el.attrs[an[0]] = src.slice(j + 1, end);
      j = end + 1;
    }
    top().children.push(el);
    if (src[j] === '/') i = j + 2;
    else {
      stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error(`XML: unclosed <${top().name}>`);
  return root;
}

const attrStr = (a: Record<string, string>) =>
  Object.entries(a)
    .map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`)
    .join('');

export function serialize(n: XmlNode): string {
  if (n.type === 'text') return n.raw;
  if (n.name === '#document') return n.children.map(serialize).join('');
  if (!n.children.length) return `<${n.name}${attrStr(n.attrs)}/>`;
  return `<${n.name}${attrStr(n.attrs)}>${n.children.map(serialize).join('')}</${n.name}>`;
}

export function elements(n: XmlElement): XmlElement[] {
  return n.children.filter((c): c is XmlElement => c.type === 'element');
}

export function findFirst(n: XmlElement, name: string): XmlElement | undefined {
  for (const c of elements(n)) {
    if (c.name === name) return c;
    const f = findFirst(c, name);
    if (f) return f;
  }
  return undefined;
}
