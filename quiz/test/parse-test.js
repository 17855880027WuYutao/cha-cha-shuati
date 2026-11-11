// 解析器测试台：node test/parse-test.js [docx路径] [--json out.json] [--all]
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');
const P = require('../js/parse.js');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '../samples/dirty.docx');
const jsonIdx = args.indexOf('--json');
const outJson = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const showAll = args.includes('--all');

(async () => {
  const buf = fs.readFileSync(file);
  const t0 = Date.now();
  const res = await P.parseDocx(buf, { fileName: path.basename(file), jszip: JSZip });
  const ms = Date.now() - t0;

  console.log('文件:', res.fileName, '| 耗时', ms + 'ms');
  console.log('标题:', res.title || '(空)');
  console.log('分节:', res.sections.map((s) => `${s.name}(${s.type}=${s.count})`).join(' / '));
  console.log('总数:', res.report.total, '| 类型:', JSON.stringify(res.report.byType));
  console.log('原始块:', JSON.stringify(res.report.stats));
  const low = res.report.issues;
  console.log('待确认:', low.length, '| 未归类行:', res.report.strayLines.length);
  if (low.length) {
    for (const it of low.slice(0, showAll ? 1000 : 15)) {
      console.log('  !', it.id, it.confidence.toFixed(2), it.issues.join(','));
    }
  }
  if (res.report.strayLines.length) {
    console.log('未归类样例:');
    for (const s of res.report.strayLines.slice(0, 10)) console.log('   ', s.no, JSON.stringify(s.text));
  }
  // 抽样打印前 3 题和最后 2 题
  const sample = showAll ? res.questions : [...res.questions.slice(0, 3), ...res.questions.slice(-2)];
  for (const q of sample) {
    const stem = q.stem.map((n) => (n.t === 'text' ? n.v : `[${n.t}]`)).join('').replace(/\s+/g, ' ').slice(0, 70);
    const opts = q.options.map((o) => o.key + '.' + o.content.map((c) => c.v || '').join('').slice(0, 14)).join(' | ');
    const ans = q.answer ? (q.answer.letters ? q.answer.letters.join('') : q.answer.text) : '(无)';
    console.log(`\n[${q.id}] ${q.type} conf=${q.confidence.toFixed(2)}`);
    console.log('  Q:', stem);
    console.log('  O:', opts || '(无)');
    console.log('  A:', ans);
  }
  if (outJson) {
    fs.writeFileSync(outJson, JSON.stringify(res, null, 2));
    console.log('\nJSON 已写入', outJson);
  }
})().catch((e) => { console.error('解析失败:', e); process.exit(1); });
