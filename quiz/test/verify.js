// 质量校验：node test/verify.js
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');
const P = require('../js/parse.js');

const file = process.argv[2] || path.join(__dirname, '../samples/dirty.docx');
const text = (n) => (n.t === 'text' ? n.v : n.t === 'img' ? '[图]' : n.t === 'table' ? '[表]' : n.t === 'math' ? n.v : '');
const stemText = (q) => q.stem.map(text).join('');
const optText = (o) => o.content.map(text).join('');

(async () => {
  const buf = fs.readFileSync(file);
  const res = await P.parseDocx(buf, { fileName: path.basename(file), jszip: JSZip });
  const qs = res.questions;
  const fail = [];
  const warn = [];
  const check = (cond, msg) => { if (!cond) fail.push(msg); };

  console.log('题目总数', qs.length, JSON.stringify(res.report.byType));
  check(qs.length > 0, '没有解析出题目');

  // 1. 每题必备字段
  for (const q of qs) {
    check(!!q.id && !!q.type, `${q.id}: 缺 id/type`);
    check(stemText(q).trim().length > 0 || q.stem.some((n) => n.t === 'img' || n.t === 'table'), `${q.id}: 题干空`);
    check(!!q.answer, `${q.id}: 没答案`);
    if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
      check(q.options.length >= 2, `${q.id}: 选项只有 ${q.options.length} 个`);
      const keys = q.options.map((o) => o.key);
      check(new Set(keys).size === keys.length, `${q.id}: 选项字母重复`);
      if (q.answer && q.answer.letters) {
        for (const l of q.answer.letters) check(keys.includes(l), `${q.id}: 答案 ${l} 不在选项 ${keys}`);
      }
    }
    if (q.type === 'fill' && q.answer) check((q.answer.text || '').trim().length > 0, `${q.id}: 填空答案空`);
    // 题干里不该残留答案/解析
    check(!/答\s*案\s*[:：]/.test(stemText(q)), `${q.id}: 题干残留「答案：」`);
    check(!/^\s*[A-H][.．、]/.test(stemText(q).trim()), `${q.id}: 题干里混进选项`);
  }

  // 2. 选项数量分布
  const optDist = {};
  for (const q of qs) if (q.options.length) optDist[q.options.length] = (optDist[q.options.length] || 0) + 1;
  console.log('选项个数分布', JSON.stringify(optDist));

  // 3. 答案分布
  const ansDist = {};
  for (const q of qs) {
    if (!q.answer) continue;
    const k = q.answer.letters ? q.answer.letters.join('') : '填空:' + (q.answer.text || '').slice(0, 6);
    ansDist[k] = (ansDist[k] || 0) + 1;
  }
  console.log('答案分布 top', Object.entries(ansDist).sort((a, b) => b[1] - a[1]).slice(0, 12));
  // 答案明显偏科（全选同一个字母）要怀疑
  const letterCount = {};
  for (const q of qs) if (q.answer && q.answer.letters) for (const l of q.answer.letters) letterCount[l] = (letterCount[l] || 0) + 1;
  console.log('答案字母计数', JSON.stringify(letterCount));
  if (Object.keys(letterCount).length === 1 && qs.length > 10) warn.push('答案全集中在同一个字母，可疑');

  // 4. 题干长度分布
  const lens = qs.map((q) => stemText(q).trim().length).sort((a, b) => a - b);
  const pick = (p) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))];
  console.log('题干长度 p10/p50/p90/max', pick(0.1), pick(0.5), pick(0.9), lens[lens.length - 1]);
  if (lens[lens.length - 1] > 1200) warn.push('有超长题干，可能把下一题吞进来了');

  // 5. 题目是否重复
  const seen = new Map();
  for (const q of qs) {
    const k = stemText(q).replace(/\s/g, '').slice(0, 40);
    if (k && seen.has(k)) warn.push(`疑似重复题：${q.id} 与 ${seen.get(k)}`);
    seen.set(k, q.id);
  }

  // 6. 未归类行
  if (res.report.strayLines.length) {
    warn.push(`有 ${res.report.strayLines.length} 行未归类`);
    for (const s of res.report.strayLines.slice(0, 8)) console.log('  未归类:', s.no, JSON.stringify(s.text));
  }

  // 7. 选项文本不该带解析/答案
  for (const q of qs) {
    for (const o of q.options) {
      const t = optText(o);
      check(!/答\s*案\s*[:：]/.test(t), `${q.id}: 选项 ${o.key} 里带答案`);
      check(t.trim().length > 0, `${q.id}: 选项 ${o.key} 空`);
    }
  }

  console.log('\n失败:', fail.length, '| 提醒:', warn.length);
  for (const f of fail.slice(0, 25)) console.log('  ✗', f);
  for (const w of warn.slice(0, 15)) console.log('  !', w);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
