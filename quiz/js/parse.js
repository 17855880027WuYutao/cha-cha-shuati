/*
 * parse.js —— Word 题库解析器（浏览器 / Node 通用）
 *
 * 目标：把格式不标准的 .docx 题库尽量准地拆成题目 JSON。
 * 原则：结构信号（样式/颜色/编号/表格）> 文本模式 > 语义猜；每条结果带置信度和问题列表。
 *
 * 用法：
 *   const res = await DocxParser.parseDocx(arrayBuffer, { fileName, jszip, mediaUrl });
 *   mediaUrl(target, bytes) => string|null   // 浏览器里可以返回 blob URL；Node 里不传
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- utils
  const REDS = /^(FF0000|EE0000|C00000|CC0000|E60000|FF3333|D9001B)$/i;
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
  const LETTERS = 'ABCDEFGHIJ';

  function isCircled(ch) { return CIRCLED.indexOf(ch) >= 0; }
  function circledToLetter(ch) {
    const i = CIRCLED.indexOf(ch);
    return i >= 0 ? LETTERS[i] : ch.toUpperCase();
  }
  function decodeEntities(s) {
    if (!s || s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, e) => {
      if (e[0] === '#') {
        const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
      }
      switch (e) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'nbsp': return ' ';
      }
      return m;
    });
  }
  const local = (n) => (n && n.indexOf(':') >= 0 ? n.slice(n.indexOf(':') + 1) : n);

  // ---------------------------------------------------------------- XML（够用就好，不做完整校验）
  function parseXml(src) {
    const root = { name: '#root', attrs: {}, children: [] };
    const stack = [root];
    const pushText = (t) => {
      if (t && t.length) stack[stack.length - 1].children.push({ name: '#text', text: decodeEntities(t) });
    };
    let i = 0;
    const n = src.length;
    while (i < n) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { pushText(src.slice(i)); break; }
      if (lt > i) pushText(src.slice(i, lt));
      if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', lt)) {
        const e = src.indexOf(']]>', lt + 9);
        pushText(src.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue;
      }
      if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
      if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }

      let j = lt + 1, q = null;
      for (; j < n; j++) {
        const c = src[j];
        if (q) { if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === '>') break;
      }
      const raw = src.slice(lt + 1, Math.min(j, n));
      i = j + 1;

      if (raw[0] === '/') {
        const nm = raw.slice(1).trim();
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].name === nm) { stack.length = s; break; }
        }
        continue;
      }
      const self = raw.endsWith('/');
      const core = self ? raw.slice(0, -1) : raw;
      let k = 0;
      while (k < core.length && !/\s/.test(core[k])) k++;
      const name = core.slice(0, k) || '#unknown';
      const attrs = {};
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let m;
      const attrStr = core.slice(k);
      while ((m = re.exec(attrStr))) attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
      const node = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!self) stack.push(node);
    }
    return root;
  }

  function kids(node, name) {
    const out = [];
    if (!node || !node.children) return out;
    for (const c of node.children) {
      if (c.name === '#text') continue;
      if (name === undefined || local(c.name) === name) out.push(c);
    }
    return out;
  }
  function kid(node, name) {
    if (!node || !node.children) return null;
    for (const c of node.children) if (c.name !== '#text' && local(c.name) === name) return c;
    return null;
  }
  function deep(node, name, out) {
    out = out || [];
    if (!node || !node.children) return out;
    for (const c of node.children) {
      if (c.name === '#text') continue;
      if (local(c.name) === name) out.push(c);
      deep(c, name, out);
    }
    return out;
  }
  function attr(node, ...names) {
    if (!node || !node.attrs) return undefined;
    for (const nm of names) {
      if (node.attrs[nm] !== undefined) return node.attrs[nm];
      const key = Object.keys(node.attrs).find((k) => local(k) === nm);
      if (key !== undefined) return node.attrs[key];
    }
    return undefined;
  }
  function textOf(node) {
    if (!node) return '';
    if (node.name === '#text') return node.text || '';
    let s = '';
    for (const c of node.children || []) s += textOf(c);
    return s;
  }
  function rootOf(docXml) {
    return kid(docXml, 'document');
  }

  // ---------------------------------------------------------------- 中文数字（自动编号用）
  const CN_DIGITS = '零一二三四五六七八九';
  function cnNumber(n) {
    if (n <= 0) return String(n);
    if (n < 10) return CN_DIGITS[n];
    if (n < 20) return '十' + (n % 10 ? CN_DIGITS[n % 10] : '');
    if (n < 100) return CN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGITS[n % 10] : '');
    return String(n);
  }
  function fmtNumber(n, fmt) {
    switch (fmt) {
      case 'chineseCounting':
      case 'chineseCountingThousand':
      case 'chineseLegalSimplified': return cnNumber(n);
      case 'decimalZero': return n < 10 ? '0' + n : String(n);
      case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
      case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
      case 'upperRoman': return roman(n);
      case 'lowerRoman': return roman(n).toLowerCase();
      default: return String(n);
    }
  }
  function roman(num) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, sym] of map) while (num >= v) { s += sym; num -= v; }
    return s;
  }

  // ---------------------------------------------------------------- 样式 / 编号
  function parseStyles(xml) {
    const map = new Map();
    if (!xml) return map;
    const doc = parseXml(xml);
    const root = kid(doc, 'styles') || doc;
    for (const st of kids(root, 'style')) {
      const id = attr(st, 'styleId');
      if (!id) continue;
      const nm = attr(kid(st, 'name'), 'val') || '';
      const pPr = kid(st, 'pPr');
      const outline = attr(kid(pPr, 'outlineLvl'), 'val');
      const based = attr(kid(st, 'basedOn'), 'val') || null;
      map.set(id, { id, name: nm, outline: outline !== undefined ? parseInt(outline, 10) : null, based });
    }
    // 沿着 basedOn 补名字（很多中文模板的样式名是 "heading 1" 在英文里，中文界面用 "标题 1"）
    const nameOf = (id, depth) => {
      const s = map.get(id);
      if (!s || depth > 5) return '';
      return s.name + (s.based ? ' ' + nameOf(s.based, depth + 1) : '');
    };
    for (const [id, s] of map) s.fullName = nameOf(id, 0);
    return map;
  }

  function parseNumbering(xml) {
    const nums = new Map();      // numId -> abstractNumId
    const abstracts = new Map(); // abstractNumId -> {levels: {ilvl: {fmt, start, text}}}
    if (!xml) return { nums, abstracts };
    const doc = parseXml(xml);
    const root = kid(doc, 'numbering') || doc;
    for (const an of kids(root, 'abstractNum')) {
      const id = attr(an, 'abstractNumId');
      const levels = {};
      for (const lvl of kids(an, 'lvl')) {
        const il = parseInt(attr(lvl, 'ilvl') || '0', 10);
        levels[il] = {
          start: parseInt(attr(kid(lvl, 'start'), 'val') || '1', 10),
          fmt: attr(kid(lvl, 'numFmt'), 'val') || 'decimal',
          text: attr(kid(lvl, 'lvlText'), 'val') || '',
        };
      }
      abstracts.set(id, { levels });
    }
    for (const num of kids(root, 'num')) {
      const id = attr(num, 'numId');
      const ab = attr(kid(num, 'abstractNumId'), 'val');
      nums.set(id, ab);
    }
    return { nums, abstracts };
  }

  // ---------------------------------------------------------------- 文档块
  function buildBlocks(body, ctx) {
    const blocks = [];
    walk(body, blocks, ctx);
    blocks.forEach((b, i) => { if (b.idx === undefined) b.idx = i; });
    return blocks;
  }
  const DESCEND = new Set(['body', 'txbxContent', 'sdt', 'sdtContent', 'customXml', 'smartTag', 'ins']);
  function walk(container, out, ctx) {
    if (!container || !container.children) return;
    for (const node of container.children) {
      if (node.name === '#text') continue;
      const ln = local(node.name);
      if (ln === 'p') out.push(makeParagraph(node, out.length, ctx));
      else if (ln === 'tbl') out.push(makeTable(node, out.length, ctx));
      else if (ln === 'sectPr' || ln === 'bookmarkStart' || ln === 'bookmarkEnd' || ln === 'pPr') continue;
      else if (DESCEND.has(ln) || kid(node, 'p') || kid(node, 'tbl')) walk(node, out, ctx);
    }
  }

  function makeParagraph(p, idx, ctx) {
    const pPr = kid(p, 'pPr');
    const styleId = attr(kid(pPr, 'pStyle'), 'val') || '';
    const style = ctx.styles.get(styleId);
    const numPr = kid(pPr, 'numPr');
    let numId = null, ilvl = 0, numText = '';
    if (numPr) {
      numId = attr(kid(numPr, 'numId'), 'val');
      ilvl = parseInt(attr(kid(numPr, 'ilvl'), 'val') || '0', 10);
      if (numId && ctx.numbering) numText = nextNumber(ctx, numId, ilvl);
    }
    const outline = attr(kid(pPr, 'outlineLvl'), 'val');
    const para = {
      kind: 'p', idx, styleId,
      styleName: style ? style.name : '',
      styleFull: style ? (style.fullName || style.name) : '',
      outline: outline !== undefined ? parseInt(outline, 10) : null,
      numId, ilvl, numText,
      jc: attr(kid(pPr, 'jc'), 'val'),
      inlines: [],
      flags: { redRatio: 0, hidden: false, white: false, boldRatio: 0 },
    };
    collectInlines(p, para.inlines, ctx, {});
    computeFlags(para);
    return para;
  }

  function nextNumber(ctx, numId, ilvl) {
    const n = ctx.numbering;
    if (!n || !n.nums) return '';
    const abId = n.nums.get(numId);
    const ab = n.abstracts.get(abId);
    if (!ab) return '';
    const key = numId;
    if (!ctx.counters[key]) ctx.counters[key] = {};
    const c = ctx.counters[key];
    c[ilvl] = (c[ilvl] || (ab.levels[ilvl] ? ab.levels[ilvl].start - 1 : 0)) + 1;
    for (const l of Object.keys(c)) if (+l > ilvl) delete c[l];
    const lvl = ab.levels[ilvl] || { text: '', fmt: 'decimal' };
    let out = lvl.text || ('%' + (ilvl + 1) + '.');
    out = out.replace(/%([1-9])/g, (m, d) => {
      const v = c[(+d) - 1] || 1;
      return fmtNumber(v, lvl.fmt);
    });
    return out;
  }

  function runProps(r) {
    const rPr = kid(r, 'rPr');
    const props = { b: false, i: false, u: false, color: null, highlight: null, hidden: false, sz: null };
    if (!rPr) return props;
    if (kid(rPr, 'b')) props.b = attr(kid(rPr, 'b'), 'val') !== '0' && attr(kid(rPr, 'b'), 'val') !== 'false';
    if (kid(rPr, 'i')) props.i = true;
    if (kid(rPr, 'u')) props.u = attr(kid(rPr, 'u'), 'val') !== 'none';
    props.color = attr(kid(rPr, 'color'), 'val') || null;
    const hl = kid(rPr, 'highlight');
    props.highlight = hl ? attr(hl, 'val') : null;
    const vanish = kid(rPr, 'vanish');
    props.hidden = !!vanish && attr(vanish, 'val') !== '0';
    props.sz = attr(kid(rPr, 'sz'), 'val') || null;
    return props;
  }

  function collectInlines(node, out, ctx, inheritProps) {
    for (const c of node.children || []) {
      if (c.name === '#text') {
        if (c.text && c.text.trim()) out.push({ t: 'text', v: c.text, mark: inheritProps });
        else if (c.text) out.push({ t: 'text', v: c.text, mark: inheritProps });
        continue;
      }
      const ln = local(c.name);
      if (ln === 'r') {
        const props = runProps(c);
        for (const rc of c.children) {
          if (rc.name === '#text') continue;
          const rl = local(rc.name);
          if (rl === 't') out.push({ t: 'text', v: textOf(rc), mark: props });
          else if (rl === 'tab') out.push({ t: 'tab' });
          else if (rl === 'br' || rl === 'cr') out.push({ t: 'br' });
          else if (rl === 'drawing' || rl === 'pict' || rl === 'object') addImages(rc, out, ctx, props);
          else if (rl === 'delText') continue;
          else if (rl === 'sym') {
            const ch = attr(rc, 'char');
            if (ch) out.push({ t: 'text', v: String.fromCharCode(parseInt(ch, 16)), mark: props });
          }
        }
      } else if (ln === 'ins' || ln === 'hyperlink' || ln === 'smartTag' || ln === 'sdt' || ln === 'sdtContent' || ln === 'fldSimple') {
        collectInlines(c, out, ctx, inheritProps);
      } else if (ln === 'del') {
        continue;
      } else if (ln === 'oMath' || ln === 'oMathPara') {
        const t = textOf(c).trim();
        if (t) out.push({ t: 'math', v: t });
      } else if (ln === 'pPr' || ln === 'rPr' || ln === 'bookmarkStart' || ln === 'bookmarkEnd') {
        continue;
      } else if (c.children && c.children.length) {
        collectInlines(c, out, ctx, inheritProps);
      }
    }
  }

  function addImages(node, out, ctx, props) {
    const blips = deep(node, 'blip');
    const vml = deep(node, 'imagedata');
    const docPr = deep(node, 'docPr')[0];
    const alt = docPr ? attr(docPr, 'descr') || attr(docPr, 'title') || '' : '';
    for (const b of blips) {
      const rid = attr(b, 'embed') || attr(b, 'link');
      if (rid) out.push({ t: 'img', rid, target: ctx.rels.get(rid) || null, alt, mark: props });
    }
    for (const v of vml) {
      const rid = attr(v, 'id') || attr(v, 'relid');
      if (rid) out.push({ t: 'img', rid, target: ctx.rels.get(rid) || null, alt, mark: props });
    }
    if (!blips.length && !vml.length) out.push({ t: 'text', v: '[图]', mark: props });
  }

  function makeTable(tbl, idx, ctx) {
    const rows = [];
    for (const tr of kids(tbl, 'tr')) {
      const cells = [];
      for (const tc of kids(tr, 'tc')) {
        const cellBlocks = [];
        walk(tc, cellBlocks, ctx);
        const txt = cellBlocks.map(blockText).join('\n').trim();
        cells.push({ blocks: cellBlocks, text: txt, span: parseInt(attr(kid(tc, 'tcPr'), 'gridSpan') || '1', 10) });
      }
      rows.push(cells);
    }
    return { kind: 'table', idx, rows, text: '' };
  }

  function blockText(b) {
    if (!b) return '';
    if (b.kind === 'table') return b.rows.map((r) => r.map((c) => c.text).join(' | ')).join('\n');
    return b.inlines.map((i) => (i.t === 'text' ? i.v : i.t === 'tab' ? '\t' : i.t === 'br' ? '\n' : i.t === 'img' ? '[图]' : i.t === 'math' ? i.v : '')).join('');
  }

  function computeFlags(para) {
    let total = 0, red = 0, bold = 0, white = 0, hidden = 0;
    for (const i of para.inlines) {
      if (i.t !== 'text' || !i.v) continue;
      const len = i.v.length;
      total += len;
      const m = i.mark || {};
      if (m.color && REDS.test(m.color)) red += len;
      if (m.color && /^FFFFFF$/i.test(m.color)) white += len;
      if (m.b) bold += len;
      if (m.hidden) hidden += len;
    }
    para.flags.redRatio = total ? red / total : 0;
    para.flags.boldRatio = total ? bold / total : 0;
    para.flags.whiteRatio = total ? white / total : 0;
    para.flags.hidden = total > 0 && hidden / total > 0.6;
    para.flags.white = total > 0 && white / total > 0.8;
  }

  // ---------------------------------------------------------------- 逻辑行
  function inlinesText(inls) {
    let s = '';
    for (const i of inls) {
      if (i.t === 'text') s += i.v;
      else if (i.t === 'tab') s += '\t';
      else if (i.t === 'br') s += '\n';
      else if (i.t === 'img') s += '[图]';
      else if (i.t === 'math') s += i.v;
    }
    return s;
  }
  function toLines(blocks) {
    const lines = [];
    for (const b of blocks) {
      if (b.kind === 'table') {
        lines.push({ kind: 'table', block: b, text: '', no: lines.length });
        continue;
      }
      let cur = [];
      const flush = () => {
        if (!cur.length) return;
        const text = inlinesText(cur);
        lines.push({
          kind: 'p', block: b, inlines: cur, text, no: lines.length,
          redRatio: b.flags.redRatio, boldRatio: b.flags.boldRatio,
          white: b.flags.white, hidden: b.flags.hidden,
          styleName: b.styleName, styleFull: b.styleFull, outline: b.outline,
          numText: b.numText,
        });
        cur = [];
      };
      for (const i of b.inlines) {
        if (i.t === 'br') flush();
        else cur.push(i);
      }
      flush();
    }
    return lines;
  }

  // ---------------------------------------------------------------- 行分类
  const RE_Q_NUM = /^\s*(\d{1,3})\s*[.．、)）]\s*(?=\S)/;
  const RE_Q_NUM2 = /^\s*第\s*(\d{1,3})\s*题\s*[.．、:：]?\s*/;
  const RE_SECTION = /^\s*[（(]?([一二三四五六七八九十]{1,3})[)）]?\s*[、.．]\s*(.+)$/;
  const RE_SECTION2 = /^\s*第\s*([一二三四五六七八九十\d]{1,3})\s*(部分|章|单元|篇|节|块)\s*[、.．:：]?\s*(.*)$/;
  const RE_ANS = /^\s*[【\[(（]?\s*(参考答案|正确答案|答\s*案|答案)\s*[】\])）]?\s*[:：]?\s*([\s\S]*)$/;
  const RE_EXP = /^\s*[【\[]?\s*(答案解析|试题解析|解析|分析|详解|点评)\s*[】\]]?\s*[:：]?\s*([\s\S]*)$/;
  const RE_OPT_HEAD = /^\s*[（(\[【]?\s*([A-Ha-h])\s*[）)\]】]?\s*[.．、:：)）]\s*/;
  const RE_CIRCLED_HEAD = /^\s*([①-⑩])\s*[.．、:：)）]?\s*/;
  const JUDGE_WORDS = /^(对|错|正确|错误|√|×|✓|✗|T|F|是|否|True|False)$/i;

  function typeFromName(name) {
    const s = (name || '').replace(/\s/g, '');
    if (/单选|单项选择|单选题/.test(s)) return 'single';
    if (/不定项|多项选择|多选题|多选/.test(s)) return 'multi';
    if (/判断|是非|对错|判断题/.test(s)) return 'judge';
    if (/填空/.test(s)) return 'fill';
    if (/简答|问答|论述|名词解释|案例分析|材料分析|辨析|计算|综合题|阅读/.test(s)) return 'short';
    return null;
  }
  function looksLikeOptionLine(t) {
    return /^[（(\[【]?\s*[A-Ha-h]\s*[）)\]】]?\s*[.．、:：)）]/.test(t) || /^[①-⑩]/.test(t);
  }
  function isSectionLine(line) {
    const t = line.text.trim();
    if (!t || t.length > 40) return false;
    // 选项行、题号行永远不是节标题（「A、 判断产品合格与否」这种最容易误判）
    if (looksLikeOptionLine(t) || RE_Q_NUM.test(t) || /^第\s*\d/.test(t)) return false;
    const m1 = t.match(RE_SECTION);
    if (m1) {
      const tail = m1[2].trim();
      return tail.length <= 30 && (typeFromName(tail) || /题|部分|篇|章/.test(tail) || t.length <= 8);
    }
    const m2 = t.match(RE_SECTION2);
    if (m2) return true;
    // 纯题型名单独成行：「判断题」「一、单选题」之类，必须整行只有题型词
    if (t.length <= 12 && /^[（(]?\s*(单项选择|多项选择|单选|多选|判断|填空|简答|问答|论述)题?\s*([（(][^)）]{0,10}[)）])?\s*$/.test(t)) return true;
    return false;
  }
  function isExplanationLine(line) {
    return RE_EXP.test(line.text.trim());
  }
  function isAnswerLine(line) {
    return RE_ANS.test(line.text.trim());
  }

  // 把一个选项行拆成若干选项（A/B/C/D 或 ①②③④）
  function splitOptions(rawText, expectedFirstKey) {
    const t = rawText.replace(/\u3000/g, ' ').replace(/\t/g, ' ');
    const marks = [];
    // 字母标记：A. / A、 / A) / （A）
    const re = /[（(\[【]?\s*([A-Ha-h])\s*[）)\]】]?\s*[.．、:：)）]|([①-⑩])/g;
    let m;
    while ((m = re.exec(t))) {
      const key = m[1] ? m[1].toUpperCase() : circledToLetter(m[2]);
      const pos = m.index;
      const prev = pos > 0 ? t[pos - 1] : '';
      const prevOk = pos === 0 || /[\s\t，,；;。：:]/.test(prev) || /[）)\]】]/.test(prev);
      if (!prevOk && marks.length === 0) continue;
      if (!prevOk && marks.length > 0) {
        const last = marks[marks.length - 1].key;
        const li = LETTERS.indexOf(last), ci = LETTERS.indexOf(key);
        if (ci !== li + 1) continue;
      }
      marks.push({ key, pos, end: re.lastIndex });
    }
    if (!marks.length) return null;
    // 首标记：要么从 A 开始，要么接着上一行的字母往下排
    const firstKey = marks[0].key;
    const fi = LETTERS.indexOf(firstKey);
    if (expectedFirstKey !== undefined) {
      if (fi !== LETTERS.indexOf(expectedFirstKey)) return null;
    } else if (fi > 1) {
      return null;
    }
    const prefix = t.slice(0, marks[0].pos).trim();
    const opts = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].end;
      const stop = i + 1 < marks.length ? marks[i + 1].pos : t.length;
      let body = t.slice(start, stop).trim();
      body = body.replace(/\s+$/, '');
      if (!body && i === marks.length - 1) opts.push({ key: marks[i].key, text: '' });
      else opts.push({ key: marks[i].key, text: body });
    }
    // 字母要连续升序
    for (let i = 1; i < opts.length; i++) {
      if (LETTERS.indexOf(opts[i].key) !== LETTERS.indexOf(opts[i - 1].key) + 1) return null;
    }
    return { prefix, options: opts };
  }

  function parseAnswerRaw(raw) {
    let s = (raw || '').trim();
    let explanation = '';
    let cut = -1, cutLen = 0;
    let em = s.match(/【\s*(?:解析|答案解析|分析|详解)\s*】/);
    if (em) { cut = em.index; cutLen = em[0].length; }
    if (cut < 0) {
      em = s.match(/(?:^|[\s，,；;。])(?:解析|答案解析|分析|详解)\s*[:：]/);
      if (em) { cut = em.index; cutLen = em[0].length; }
    }
    if (cut > 0) {
      explanation = s.slice(cut + cutLen).trim();
      s = s.slice(0, cut).trim();
    }
    s = s.replace(/^[:：]\s*/, '').trim();
    let judge = null;
    if (JUDGE_WORDS.test(s)) {
      const v = s.toUpperCase();
      judge = ['对', '正确', '√', '✓', 'T', '是', 'TRUE'].includes(v) ? 'T' : 'F';
    }
    // 纯字母答案
    let letters = null;
    if (/^[A-Ha-h][A-Ha-h\s、,，和及;；\/]{0,20}$/.test(s)) {
      const ls = (s.toUpperCase().match(/[A-H]/g) || []);
      if (ls.length && /^[A-Ha-h\s、,，和及;；\/]+$/.test(s)) letters = [...new Set(ls)];
    }
    return { letters, judge, text: s, explanation };
  }

  // ---------------------------------------------------------------- 主分割
  function segment(doc, ctx) {
    const lines = toLines(ctx.blocks);
    const out = { titleLines: [], sections: [], questions: [], strayLines: [], tableBank: false };
    let curSection = null;
    let curQ = null;
    let lastNum = 0;
    let pendingAnswerMode = false;
    const answerKey = [];   // {sectionKey, number, answer}
    const consumed = new Array(lines.length).fill(false);

    const flushQ = () => {
      if (!curQ) return;
      finishQuestion(curQ, out);
      out.questions.push(curQ);
      curQ = null;
    };
    const startSection = (name, type) => {
      flushQ();
      const key = name.replace(/[（(].*?[)）]/g, '').replace(/\s/g, '');
      curSection = {
        key, name, type: type || typeFromName(name) || 'unknown',
        count: 0, numIds: [],
      };
      out.sections.push(curSection);
      lastNum = 0;
    };

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const t = (line.text || '').replace(/\u3000/g, ' ').trim();

      if (line.kind === 'table') {
        // 表格：要么是题目自带表格，要么是「题号/答案」答案表
        const tbl = line.block;
        const header = (tbl.rows[0] || []).map((c) => c.text);
        if (isAnswerTable(header)) {
          parseAnswerTable(tbl, answerKey);
          consumed[li] = true;
          continue;
        }
        if (curQ) {
          curQ.stem.push({ t: 'table', rows: tableToAst(tbl) });
          consumed[li] = true;
          continue;
        }
        out.strayLines.push({ no: line.no, text: '[表格] ' + header.join(' | ').slice(0, 60) });
        consumed[li] = true;
        continue;
      }

      if (!t && !tblHasImages(line)) continue;

      // 1. 大节标题
      if (isSectionLine(line)) {
        const m = t.match(RE_SECTION) || t.match(RE_SECTION2);
        const name = m ? (m[3] !== undefined ? (m[3] || m[2]) : m[2]) : t;
        if (/^答案|^参考答案/.test(t)) {
          pendingAnswerMode = true;
          flushQ();
          consumed[li] = true;
          continue;
        }
        startSection(name || t, typeFromName(name) || typeFromName(t));
        consumed[li] = true;
        continue;
      }

      // 1.5 独立的「参考答案 / 答案 / 答案与解析」标题 → 进入文末答案区
      if (t.length <= 14 && /^[（(]?[一二三四五六七八九十\d]{0,2}[)）]?[、.．]?\s*(参考答案|答案与解析|答案及解析|答案|标准答案)\s*$/.test(t)) {
        pendingAnswerMode = true;
        flushQ();
        consumed[li] = true;
        continue;
      }

      // 2. 答案行
      if (isAnswerLine(line) && !pendingAnswerMode) {
        const m = t.match(RE_ANS);
        const raw = m ? m[2] : '';
        const parsed = parseAnswerRaw(raw);
        if (curQ) {
          applyAnswer(curQ, parsed);
          consumed[li] = true;
          continue;
        }
        consumed[li] = true;
        continue;
      }

      // 3. 解析行
      if (isExplanationLine(line) && curQ) {
        const m = t.match(RE_EXP);
        const txt = m ? m[2].trim() : t;
        if (txt) (curQ.explanation || (curQ.explanation = [])).push({ t: 'text', v: txt });
        consumed[li] = true;
        continue;
      }

      // 4. 新题目
      const qm = t.match(RE_Q_NUM2) || t.match(RE_Q_NUM);
      if (qm) {
        let num = parseInt(qm[1], 10);
        const rest = t.slice(qm[0].length).trim();
        const okNum = num === lastNum + 1 || num === 1 || (lastNum === 0) || (num > lastNum && num - lastNum <= 30);
        const looksQ = rest.length > 0 || line.block.inlines.some((i) => i.t === 'img');
        if (okNum && looksQ && !pendingAnswerMode) {
          flushQ();
          curQ = {
            number: num,
            sectionKey: curSection ? curSection.key : '题目',
            sectionName: curSection ? curSection.name : '题目',
            sectionType: curSection ? curSection.type : 'unknown',
            stem: [], options: [], answer: null, explanation: null,
            issues: [], source: { from: li, to: li, blockFrom: line.block.idx, blockTo: line.block.idx },
            redRatio: line.redRatio,
          };
          lastNum = num;
          pushLineRich(curQ.stem, line, rest);
          consumed[li] = true;
          continue;
        }
      }

      // 5. 选项
      const lastKey = curQ && curQ.options.length ? curQ.options[curQ.options.length - 1].key : null;
      const expectKey = lastKey ? LETTERS[LETTERS.indexOf(lastKey) + 1] : undefined;
      const optRes = splitOptions(t, expectKey);
      if (curQ && optRes && optRes.options.length) {
        if (optRes.prefix) pushText(curQ.stem, optRes.prefix, line, li);
        for (const o of optRes.options) {
          if (!o.text) continue;
          curQ.options.push({ key: o.key, content: [{ t: 'text', v: o.text }] });
        }
        consumed[li] = true;
        continue;
      }

      // 6. 答案表模式里的条目
      if (pendingAnswerMode) {
        const pairs = parseAnswerPairs(t);
        if (pairs.length) {
          for (const p of pairs) answerKey.push({ sectionKey: curSection ? curSection.key : null, number: p.number, answer: p.answer });
          consumed[li] = true;
          continue;
        }
        consumed[li] = true;
        continue;
      }

      // 7. 红字/白字/隐藏字兜底当答案
      const looksLikeAns = t.length > 0 && t.length <= 24 && (line.redRatio > 0.6 || line.white || line.hidden);
      if (curQ && looksLikeAns && !curQ.answer) {
        const parsed = parseAnswerRaw(t.replace(/^[【\[(（]?\s*答\s*案\s*[】\])）]?\s*[:：]?\s*/, ''));
        if (parsed.letters || parsed.judge || parsed.text.length <= 20) {
          applyAnswer(curQ, parsed);
          consumed[li] = true;
          continue;
        }
      }

      // 8. 归到题干 / 上一个选项
      if (curQ) {
        const lastOpt = curQ.options[curQ.options.length - 1];
        const candidates = [lastOpt && lastOpt.content, curQ.stem];
        // 选项还没收完且最后一行像接续
        if (lastOpt && !/[。？?]$/.test(lastOptText(lastOpt.content)) && t.length < 60 && curQ.answer === null) {
          lastOpt.content.push({ t: 'text', v: t });
        } else {
          pushLineRich(curQ.stem, line, t);
        }
        consumed[li] = true;
        continue;
      }

      // 9. 章节前的标题
      if (!curSection && out.questions.length === 0) {
        out.titleLines.push(t);
        consumed[li] = true;
        continue;
      }
      out.strayLines.push({ no: line.no, text: t.slice(0, 80) });
      consumed[li] = true;
    }
    flushQ();
    // 回填答案并重新打分
    backfillAnswers(out.questions, answerKey);
    for (const q of out.questions) rescore(q);
    return { out, lines, consumed };
  }

  function tblHasImages(line) { return line.block && line.block.inlines && line.block.inlines.some((i) => i.t === 'img'); }
  function lastOptText(opt) {
    const content = Array.isArray(opt) ? opt : (opt && opt.content) || [];
    return content.map((c) => (c.t === 'text' ? c.v : '')).join('');
  }
  function pushText(arr, text, line, li) {
    if (!text) return;
    arr.push({ t: 'text', v: text, mark: undefined });
  }
  // 续行：文字之外把图片、公式节点也带上
  function pushLineRich(arr, line, text) {
    if (text) arr.push({ t: 'text', v: text });
    for (const inl of line.inlines) {
      if (inl.t === 'img' || inl.t === 'math') arr.push(inl);
    }
  }

  function applyAnswer(q, parsed) {
    if (!q.answer) {
      q.answer = parsed;
    } else if (parsed.letters && !q.answer.letters) {
      q.answer = parsed;
    }
    if (parsed.explanation) {
      (q.explanation || (q.explanation = [])).push({ t: 'text', v: parsed.explanation });
    }
  }

  function isAnswerTable(headerTexts) {
    const h = headerTexts.join(' ').replace(/\s/g, '');
    if (!h) return false;
    return /题号|序号/.test(h) && /答案|正确选项/.test(h) && h.length <= 40;
  }
  function parseAnswerTable(tbl, answerKey) {
    let numCol = 0, ansCol = 1;
    const head = tbl.rows[0].map((c) => c.text);
    head.forEach((t, i) => {
      if (/题号|序号/.test(t)) numCol = i;
      if (/答案|正确选项/.test(t)) ansCol = i;
    });
    for (let r = 1; r < tbl.rows.length; r++) {
      const row = tbl.rows[r];
      const n = parseInt((row[numCol] || {}).text || '', 10);
      const a = (row[ansCol] || {}).text || '';
      if (!isNaN(n) && a) {
        const p = parseAnswerRaw(a);
        answerKey.push({ sectionKey: null, number: n, answer: p });
      }
    }
  }
  function tableToAst(tbl) {
    return tbl.rows.map((r) => r.map((c) => c.blocks.map((b) => (b.kind === 'p' ? b.inlines : [{ t: 'text', v: blockText(b) }]))));
  }

  function parseAnswerPairs(text) {
    const out = [];
    // 1.B 2.A 3.C   或   1、B 2、A
    const re = /(\d{1,3})\s*[.．、:：)）]\s*([A-Ha-h]{1,8}|对|错|正确|错误|√|×)/g;
    let m;
    while ((m = re.exec(text))) {
      const p = parseAnswerRaw(m[2]);
      out.push({ number: parseInt(m[1], 10), answer: p });
    }
    if (out.length) return out;
    // 单独一行 "B" 前面没有题号 → 忽略
    return out;
  }

  function backfillAnswers(questions, answerKey) {
    if (!answerKey.length) return;
    const noAns = questions.filter((q) => !q.answer);
    if (!noAns.length) return;
    // 把答案条目按「题号重新从 1 开始」切成若干段
    const runs = [];
    let cur = [];
    for (const k of answerKey) {
      if (cur.length && k.number <= cur[cur.length - 1].number) { runs.push(cur); cur = []; }
      cur.push(k);
    }
    if (cur.length) runs.push(cur);
    // 有缺答案的分节（按题目出现顺序）
    const secOrder = [];
    const secMap = new Map();
    for (const q of noAns) {
      if (!secMap.has(q.sectionKey)) { secMap.set(q.sectionKey, []); secOrder.push(q.sectionKey); }
      secMap.get(q.sectionKey).push(q);
    }
    const bySection = runs.length === secOrder.length;
    runs.forEach((run, i) => {
      const sec = bySection ? secOrder[i] : null;
      for (const k of run) {
        const cands = noAns.filter((q) => q.number === k.number && (!k.sectionKey || k.sectionKey === q.sectionKey));
        let target = null;
        if (sec) target = cands.find((q) => q.sectionKey === sec) || null;
        else if (cands.length === 1) target = cands[0];
        else if (cands.length) target = cands.find((q) => !q.answer) || null;
        if (target && !target.answer) target.answer = k.answer;
      }
    });
    for (const q of noAns) {
      if (q.answer) continue;
      const hit = answerKey.find((k) => k.number === q.number && (!k.sectionKey || k.sectionKey === q.sectionKey));
      if (hit) q.answer = hit.answer;
    }
  }

  // ---------------------------------------------------------------- 成型与质检
  function finishQuestion(q, out) {
    const section = out.sections.find((s) => s.key === q.sectionKey);
    if (section) section.count++;
    inferType(q);
    scoreQuestion(q);
    q.id = (q.sectionKey || '题') + '-' + q.number;
  }

  function rescore(q) {
    if (!q.answer) return;
    q.issues = q.issues.filter((x) => !['无答案', '填空无答案'].includes(x));
    const keep = q.issues;
    scoreQuestion(q, keep);
  }

  function inferType(q) {
    // 题干里混进来的「答案：」再抽一次
    const stemText = stemPlain(q.stem);
    const inlineAns = stemText.match(/[【\[]?\s*答\s*案\s*[】\]]?\s*[:：]\s*([^\n]{1,24})/);
    if (inlineAns && !q.answer) {
      const p = parseAnswerRaw(inlineAns[1]);
      q.answer = p;
      q.stem = q.stem.map((n) => (n.t === 'text' ? { ...n, v: n.v.replace(inlineAns[0], '') } : n));
    }
    // 题干里带「（多选）」提示
    if (/[（(]\s*(多选|多选题|不定项)\s*[)）]/.test(stemText)) q.typeHint = 'multi';
    if (/[（(]\s*(单选|单选题)\s*[)）]/.test(stemText)) q.typeHint = 'single';
    if (/[（(]\s*判断\s*[)）]/.test(stemText)) q.typeHint = 'judge';
    // 判断题自动补选项
    const optTexts = q.options.map((o) => lastOptText(o.content).trim());
    if (!q.options.length && q.answer && q.answer.judge) {
      q.options = [{ key: 'A', content: [{ t: 'text', v: '对' }] }, { key: 'B', content: [{ t: 'text', v: '错' }] }];
    }
    // 题型
    let type = q.sectionType;
    if (q.typeHint) type = q.typeHint;
    if (!type || type === 'unknown') {
      if (q.options.length >= 2) {
        type = q.answer && q.answer.letters && q.answer.letters.length > 1 ? 'multi' : 'single';
        if (q.options.length === 2 && optTexts.every((x) => JUDGE_WORDS.test(x))) type = 'judge';
      } else if (!q.options.length) {
        type = q.answer && q.answer.judge ? 'judge' : (q.answer && q.answer.text && q.answer.text.length > 16 ? 'short' : 'fill');
      } else {
        type = 'single';
      }
    }
    q.type = type;
    // 答案归一
    if (q.answer) {
      if (q.type === 'judge' && !q.answer.judge && q.answer.letters) {
        const idx = LETTERS.indexOf(q.answer.letters[0]);
        q.answer.judge = idx === 0 ? 'T' : idx === 1 ? 'F' : null;
      }
      if ((q.type === 'single' || q.type === 'multi' || q.type === 'judge') && !q.answer.letters && q.answer.judge) {
        q.answer.letters = [q.answer.judge === 'T' ? 'A' : 'B'];
      }
      if (!q.answer.text) q.answer.text = (q.answer.letters || []).join('');
    }
  }

  function scoreQuestion(q, existingIssues) {
    const issues = Array.isArray(existingIssues) ? existingIssues : [];
    const add = (msg) => { if (!issues.includes(msg)) issues.push(msg); };
    const stemText = stemPlain(q.stem);
    let conf = 1;
    if (!q.answer) { conf -= 0.35; add('无答案'); }
    if (['single', 'multi', 'judge'].includes(q.type)) {
      if (q.options.length === 0 && !(q.type === 'judge' && q.answer)) { conf -= 0.4; add('无选项'); }
      else if (q.options.length === 1) { conf -= 0.25; add('选项不足'); }
      const keys = q.options.map((o) => o.key);
      if (q.answer && q.answer.letters) {
        const bad = q.answer.letters.filter((l) => !keys.includes(l));
        if (bad.length && keys.length) { conf -= 0.25; add('答案不在选项内'); }
        if (q.type === 'single' && q.answer.letters.length > 1) { conf -= 0.15; add('单选多答案'); }
      }
    }
    if (q.type === 'fill' && (!q.answer || !q.answer.text)) { conf -= 0.2; add('填空无答案'); }
    if (!stemText && !q.stem.some((n) => n.t === 'img' || n.t === 'table')) { conf -= 0.4; add('题干空'); }
    if (q.stem.length && stemText.length < 4) { conf -= 0.1; add('题干过短'); }
    q.confidence = Math.max(0, Math.min(1, conf));
    q.issues = issues;
  }

  function stemPlain(stem) {
    return stem.map((n) => (n.t === 'text' ? n.v : n.t === 'img' ? '[图]' : n.t === 'table' ? '[表]' : n.t === 'math' ? n.v : '')).join('');
  }

  // ---------------------------------------------------------------- 表格题库模式
  function tableBankQuestions(blocks) {
    const out = [];
    for (const b of blocks) {
      if (b.kind !== 'table' || !b.rows.length) continue;
      const head = b.rows[0].map((c) => c.text.trim());
      const h = head.join('|');
      if (!/题目|题干|问题|试题/.test(h)) continue;
      const cols = { stem: -1, answer: -1, explanation: -1, type: -1, opts: {} };
      head.forEach((t, i) => {
        const s = t.replace(/\s/g, '');
        if (/题目|题干|问题|试题/.test(s)) cols.stem = i;
        else if (/答案|正确选项/.test(s)) cols.answer = i;
        else if (/解析/.test(s)) cols.explanation = i;
        else if (/题型|类型/.test(s)) cols.type = i;
        else if (/选项/.test(s) || /^[A-H]$/.test(s)) {
          const m = s.match(/[A-H]/);
          if (m) cols.opts[m[0]] = i;
        }
      });
      if (cols.stem < 0) continue;
      for (let r = 1; r < b.rows.length; r++) {
        const row = b.rows[r];
        const cell = (i) => (i >= 0 && row[i] ? row[i].text.trim() : '');
        const stemTxt = cell(cols.stem);
        if (!stemTxt) continue;
        const q = {
          number: r, sectionKey: '表格题库', sectionName: '表格题库',
          sectionType: typeFromName(cell(cols.type)) || 'unknown',
          stem: [{ t: 'text', v: stemTxt }], options: [], answer: null, explanation: null,
          issues: [], source: { from: 0, to: 0, blockFrom: b.idx, blockTo: b.idx },
          fromTable: true,
        };
        const optKeys = Object.keys(cols.opts).sort();
        for (const k of optKeys) {
          const v = cell(cols.opts[k]);
          if (v) q.options.push({ key: k, content: [{ t: 'text', v }] });
        }
        // 选项挤在一列里
        if (!q.options.length) {
          const merged = head.map((t, i) => (/选项/.test(t) ? cell(i) : '')).join(' ');
          const sp = splitOptions(merged);
          if (sp) q.options = sp.options.map((o) => ({ key: o.key, content: [{ t: 'text', v: o.text }] }));
        }
        const ansTxt = cell(cols.answer);
        if (ansTxt) q.answer = parseAnswerRaw(ansTxt);
        const expTxt = cell(cols.explanation);
        if (expTxt) q.explanation = [{ t: 'text', v: expTxt }];
        out.push(q);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 入口
  async function parseDocx(input, opts) {
    opts = opts || {};
    const JSZip = opts.jszip || (typeof global.JSZip !== 'undefined' ? global.JSZip : null);
    if (!JSZip) throw new Error('需要 JSZip');
    const zip = opts.zip || await JSZip.loadAsync(input);
    const read = async (p) => {
      const f = zip.file(p);
      return f ? f.async('string') : null;
    };
    const [docXml, stylesXml, numberingXml, relsXml] = await Promise.all([
      read('word/document.xml'), read('word/styles.xml'),
      read('word/numbering.xml'), read('word/_rels/document.xml.rels'),
    ]);
    if (!docXml) throw new Error('不是 .docx（找不到 word/document.xml）');

    const rels = new Map();
    if (relsXml) {
      const rdoc = parseXml(relsXml);
      const rroot = kid(rdoc, 'Relationships') || rdoc;
      for (const r of kids(rroot, 'Relationship')) {
        const id = attr(r, 'Id');
        let target = attr(r, 'Target') || '';
        if (!id || !target) continue;
        if (target.startsWith('/')) target = target.slice(1);
        else if (!target.startsWith('word/')) target = 'word/' + target.replace(/^\.\//, '');
        rels.set(id, target);
      }
    }

    const styles = parseStyles(stylesXml);
    const numbering = parseNumbering(numberingXml);
    const doc = parseXml(docXml);
    const body = rootOf(doc);
    if (!body) throw new Error('文档结构异常');
    const ctx = { styles, numbering, rels, counters: {} };
    const blocks = buildBlocks(body, ctx);

    // 表格题库：文档主体就是一张表
    let questions = [];
    let sections = [];
    let titleLines = [];
    let strayLines = [];
    let usedTableBank = false;

    const seg = segment(doc, { blocks });
    if (seg.out.questions.length === 0) {
      const bank = tableBankQuestions(blocks);
      if (bank.length) {
        usedTableBank = true;
        questions = bank;
        sections = [{ key: '表格题库', name: '表格题库', type: 'unknown', count: bank.length }];
      }
    } else {
      questions = seg.out.questions;
      sections = seg.out.sections;
      titleLines = seg.out.titleLines;
      strayLines = seg.out.strayLines;
    }

    // 题号连续性检查
    const bySection = new Map();
    for (const q of questions) {
      if (!bySection.has(q.sectionKey)) bySection.set(q.sectionKey, []);
      bySection.get(q.sectionKey).push(q);
    }
    for (const [key, list] of bySection) {
      list.sort((a, b) => a.number - b.number);
      let prev = null;
      for (const q of list) {
        if (prev !== null && q.number !== prev + 1) {
          q.issues.push('题号不连续');
          q.confidence = Math.max(0, q.confidence - 0.05);
        }
        prev = q.number;
      }
    }

    // 图片：交给调用方决定怎么变成 URL
    const mediaTargets = new Set();
    const collectImgs = (arr) => {
      for (const n of arr || []) {
        if (n.t === 'img' && n.target) mediaTargets.add(n.target);
        else if (n.t === 'table') for (const row of n.rows) for (const cell of row) for (const blk of cell) collectImgs(blk);
      }
    };
    for (const q of questions) {
      collectImgs(q.stem);
      for (const o of q.options) collectImgs(o.content);
      collectImgs(q.explanation);
    }
    if (opts.mediaUrl) {
      for (const target of mediaTargets) {
        const f = zip.file(target);
        if (!f) continue;
        try {
          const bytes = await f.async('uint8array');
          const url = await opts.mediaUrl(target, bytes);
          if (url) ctx.mediaUrls = ctx.mediaUrls || new Map(), ctx.mediaUrls.set(target, url);
        } catch (e) { /* ignore */ }
      }
      const fix = (arr) => {
        for (const n of arr || []) {
          if (n.t === 'img' && n.target && ctx.mediaUrls && ctx.mediaUrls.has(n.target)) n.src = ctx.mediaUrls.get(n.target);
          else if (n.t === 'table') for (const row of n.rows) for (const cell of row) for (const blk of cell) fix(blk);
        }
      };
      for (const q of questions) {
        fix(q.stem);
        for (const o of q.options) fix(o.content);
        fix(q.explanation);
      }
    }

    // 题干重复检查（题库本身可能有问题）
    const dupMap = new Map();
    for (const q of questions) {
      const k = stemPlain(q.stem).replace(/\s/g, '').replace(/[（(]\s*[)）]/g, '').slice(0, 60);
      if (k.length < 6) continue;
      if (!dupMap.has(k)) dupMap.set(k, []);
      dupMap.get(k).push(q);
    }
    const duplicates = [];
    for (const [k, list] of dupMap) {
      if (list.length < 2) continue;
      const ansSet = new Set(list.map((q) => (q.answer && (q.answer.text || (q.answer.letters || []).join(''))) || ''));
      const conflict = ansSet.size > 1;
      duplicates.push({ stem: k, ids: list.map((q) => q.id), answers: list.map((q) => (q.answer && q.answer.text) || ''), conflict });
      for (const q of list) {
        if (conflict) { q.issues.push('重复题(答案不一致)'); q.confidence = Math.max(0, q.confidence - 0.1); }
      }
    }

    // 统计
    const byType = {};
    for (const q of questions) byType[q.type] = (byType[q.type] || 0) + 1;
    const low = questions.filter((q) => q.confidence < 0.75 || q.issues.length);
    const stats = {
      blocks: blocks.length,
      paragraphs: blocks.filter((b) => b.kind === 'p').length,
      tables: blocks.filter((b) => b.kind === 'table').length,
      images: mediaTargets.size,
      lines: seg.lines.length,
      tableBank: usedTableBank,
    };
    // 原文行流（给「原文」面板用）
    const sourceLines = seg.lines.map((l) => ({
      no: l.no,
      kind: l.kind,
      block: l.block ? l.block.idx : -1,
      text: (l.text || '').replace(/\t/g, ' ').slice(0, 400),
      num: l.numText || '',
      style: l.styleName || '',
      red: (l.redRatio || 0) > 0.6,
      bold: (l.boldRatio || 0) > 0.6,
      hidden: !!l.hidden,
      white: !!l.white,
    }));
    return {
      lines: sourceLines,
      fileName: opts.fileName || '未命名.docx',
      title: titleLines.join(' ').trim(),
      meta: { parsedAt: new Date().toISOString(), tables: stats.tables, images: stats.images },
      sections: sections.map((s) => ({ key: s.key, name: s.name, type: s.type, count: s.count })),
      questions,
      report: {
        total: questions.length,
        byType,
        stats,
        lowConfidence: low.map((q) => q.id),
        issues: low.map((q) => ({ id: q.id, confidence: q.confidence, issues: q.issues })),
        strayLines: strayLines.slice(0, 30),
        duplicates,
        titleLines,
      },
    };
  }

  const api = { parseDocx, parseXml, splitOptions, parseAnswerRaw, typeFromName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DocxParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
