/**
 * 极简 YAML 子集解析器。
 *
 * 为什么不引 js-yaml：这个仓库的零依赖层是宪法（clone 下来 node 就能跑），
 * 为了一份配置文件破例，下一次就会为别的东西破例。
 *
 * 支持的子集（够写适配器规格，不够写诗）：
 *   - 块映射：`key: value` / `key:` 后跟缩进块
 *   - 块序列：`- value` / `- key: value`（后续同缩进行视为同一项的键）
 *   - 标量：裸字符串、整数、浮点、true/false/null、单双引号字符串
 *   - 流式：`[a, b]` 与 `{a: b}`（一层，值为标量）
 *   - 注释：整行 `#` 与行尾 ` #`（引号内不算）
 * 不支持（报清楚，不猜）：多行字符串、锚点、标签、文档流、制表符缩进。
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message}（第 ${line} 行）` : message);
    this.name = 'YamlError';
    this.line = line ?? null;
  }
}

function stripComment(raw) {
  let out = '';
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) break;
    out += ch;
  }
  return out.replace(/\s+$/, '');
}

function parseScalar(text, line) {
  const t = text.trim();
  if (t === '') return null;
  if (t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((x) => parseScalar(x, line));
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const inner = t.slice(1, -1).trim();
    const obj = {};
    if (inner === '') return obj;
    for (const part of splitFlow(inner)) {
      const ci = part.indexOf(':');
      if (ci < 0) throw new YamlError(`流式映射里缺冒号：${part}`, line);
      obj[part.slice(0, ci).trim()] = parseScalar(part.slice(ci + 1), line);
    }
    return obj;
  }
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return t;
}

/** 按顶层逗号切流式内容，引号内的逗号不算。 */
function splitFlow(inner) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts;
}

function indentOf(line) {
  const m = line.match(/^ */);
  return m[0].length;
}

/**
 * 解析 YAML 子集文本。返回 JS 值。
 * @param {string} text
 */
export function parseYaml(text) {
  const rawLines = String(text).split(/\r?\n/);
  const lines = [];
  rawLines.forEach((raw, i) => {
    if (raw.includes('\t')) throw new YamlError('缩进不许用制表符', i + 1);
    const stripped = stripComment(raw);
    if (stripped.trim() === '') return;
    lines.push({ n: i + 1, indent: indentOf(stripped), text: stripped.trim() });
  });
  if (lines.length === 0) return {};
  const { value } = parseBlock(lines, 0, lines[0].indent);
  return value;
}

/** 解析从 idx 起、缩进为 indent 的一个块；返回 {value, next}。 */
function parseBlock(lines, idx, indent) {
  if (idx >= lines.length) return { value: null, next: idx };
  if (lines[idx].text.startsWith('- ') || lines[idx].text === '-') {
    return parseSequence(lines, idx, indent);
  }
  return parseMapping(lines, idx, indent);
}

function parseMapping(lines, idx, indent) {
  const obj = {};
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError(`缩进跳层：${line.text}`, line.n);
    if (line.text.startsWith('- ')) break;
    const ci = colonIndex(line.text);
    if (ci < 0) throw new YamlError(`映射行缺冒号：${line.text}`, line.n);
    const key = unquoteKey(line.text.slice(0, ci).trim());
    const rest = line.text.slice(ci + 1).trim();
    if (rest === '') {
      const childIndent = lines[i + 1] ? lines[i + 1].indent : null;
      if (childIndent !== null && childIndent > indent) {
        const r = parseBlock(lines, i + 1, childIndent);
        obj[key] = r.value;
        i = r.next;
      } else if (childIndent === indent && lines[i + 1] && (lines[i + 1].text.startsWith('- ') || lines[i + 1].text === '-')) {
        const r = parseSequence(lines, i + 1, indent);
        obj[key] = r.value;
        i = r.next;
      } else {
        obj[key] = null;
        i += 1;
      }
    } else {
      obj[key] = parseScalar(rest, line.n);
      i += 1;
    }
  }
  return { value: obj, next: i };
}

function parseSequence(lines, idx, indent) {
  const arr = [];
  let i = idx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError(`序列缩进跳层：${line.text}`, line.n);
    if (!(line.text.startsWith('- ') || line.text === '-')) break;
    const item = line.text === '-' ? '' : line.text.slice(2).trim();
    if (item === '') {
      const childIndent = lines[i + 1] ? lines[i + 1].indent : null;
      if (childIndent === null || childIndent <= indent) {
        arr.push(null);
        i += 1;
      } else {
        const r = parseBlock(lines, i + 1, childIndent);
        arr.push(r.value);
        i = r.next;
      }
      continue;
    }
    const ci = colonIndex(item);
    if (ci >= 0 && !item.startsWith('[') && !item.startsWith('{')) {
      // `- key: value`：这一行是映射的第一行，后续同缩进+2 的行属于同一项。
      const innerIndent = line.indent + 2;
      const synthetic = [{ n: line.n, indent: innerIndent, text: item }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= innerIndent && !(lines[j].indent === indent && (lines[j].text.startsWith('- ') || lines[j].text === '-'))) {
        if (lines[j].indent === innerIndent || lines[j].indent > innerIndent) synthetic.push(lines[j]);
        j += 1;
      }
      const r = parseMapping(synthetic, 0, innerIndent);
      arr.push(r.value);
      i = j;
      continue;
    }
    arr.push(parseScalar(item, line.n));
    i += 1;
  }
  return { value: arr, next: i };
}

/** 找映射行的冒号：引号内与流式括号内的冒号不算。 */
function colonIndex(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ':' && depth === 0) {
      if (i + 1 >= text.length || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function unquoteKey(key) {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) return key.slice(1, -1);
  return key;
}

/** 把 JS 值写回本解析器能读回来的 YAML 子集（供 learn 产出 adapter.yml）。 */
export function stringifyYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const body = stringifyYaml(item, indent + 1);
          const first = body.slice(pad.length + 2);
          return `${pad}- ${first}` + body.slice(pad.length + 2 + first.length);
        }
        return `${pad}- ${scalarOut(item)}\n`;
      })
      .join('');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}{}\n`;
    return keys
      .map((k) => {
        const v = value[k];
        if (v !== null && typeof v === 'object') {
          const empty = Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
          if (empty) return `${pad}${k}: ${Array.isArray(v) ? '[]' : '{}'}\n`;
          return `${pad}${k}:\n${stringifyYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${scalarOut(v)}\n`;
      })
      .join('');
  }
  return `${pad}${scalarOut(value)}\n`;
}

function scalarOut(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || /[:#{}\[\]]/.test(s) || /^\s|\s$/.test(s) || /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}
