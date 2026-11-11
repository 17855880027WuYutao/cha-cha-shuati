// 刷题模块单测：node test/quiz-test.js
// 用假题库（填空/多选/单选各一题）验证提交按钮、判分、错题本
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/jsdomtest/node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

const QUESTIONS = [
  { id: 'f-1', type: 'fill', stem: [{ t: 'text', v: '中国的首都是 ▲ 。' }], options: [], answer: { text: '北京' }, explanation: null, issues: [] },
  { id: 'm-1', type: 'multi', stem: [{ t: 'text', v: '哪些是偶数？' }], options: [
    { key: 'A', content: [{ t: 'text', v: '2' }] }, { key: 'B', content: [{ t: 'text', v: '3' }] },
    { key: 'C', content: [{ t: 'text', v: '4' }] }, { key: 'D', content: [{ t: 'text', v: '5' }] },
  ], answer: { text: 'AC', letters: ['A', 'C'] }, explanation: null, issues: [] },
  { id: 's-1', type: 'single', stem: [{ t: 'text', v: '首都是？' }], options: [
    { key: 'A', content: [{ t: 'text', v: '北京' }] }, { key: 'B', content: [{ t: 'text', v: '上海' }] },
  ], answer: { text: 'A', letters: ['A'] }, explanation: null, issues: [] },
];
const BANK = { key: 'test|3|f-1|s-1', fileName: '测试题库.docx', title: '', questions: QUESTIONS, sections: [] };

(async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:8100/' });
  const { window } = dom;
  window.console = console;
  window.localStorage.setItem('quiz.bank.v1', JSON.stringify(BANK));
  const load = (p) => window.eval(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  load('js/quiz.js');
  // 简化富文本渲染：只拼文字
  const plainOf = (ns) => (ns || []).map((n) => (n.t === 'text' ? n.v : '')).join('');
  window.QuizUI.mount({
    rich: (ns) => plainOf(ns).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])),
    plainOf,
    toast: (m) => { window.__toast = m; },
  });
  // 让刷题面板可见
  const pane = window.document.getElementById('pane-quiz');
  pane.hidden = false;

  const fail = [];
  const ok = (c, m) => { if (!c) fail.push(m); };
  const q = (s) => window.document.querySelector(s);
  const qa = (s) => Array.from(window.document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. 设置页
  window.QuizUI.render();
  ok(!!q('#quizroot .setup'), '没有设置页');

  // 2. 顺序刷：第一题是填空
  window.QuizUI.startSession('order', 0, false);
  await wait(20);
  ok(!!q('#quizroot .qz-card'), '没有题目卡片');
  ok(!!q('#quizroot .qz-cta'), '填空题没有居中的提交按钮区');
  ok(qa('#quizroot .qz-fill input').length === 1, '填空题没有输入框');
  // 3. 填空判分：带空格和句号也该判对
  const input = q('#quizroot .qz-fill input');
  input.value = ' 北 京。';
  q('#quizroot #qz-submit').click();
  await wait(20);
  ok(/对了/.test(q('#quizroot .qz-fb').textContent), '填空宽松判分失败：' + q('#quizroot .qz-fb').textContent);
  q('#quizroot #qz-next').click();
  await wait(260);

  // 4. 第二题多选：要有居中提交按钮，选 AC 判对
  ok(!!q('#quizroot .qz-cta'), '多选题没有居中的提交按钮区');
  const opts = qa('#quizroot .qz-opt');
  ok(opts.length === 4, '多选选项数量不对：' + opts.length);
  opts.find((b) => b.textContent.includes('2')).click();
  opts.find((b) => b.textContent.includes('4')).click();
  q('#quizroot #qz-submit').click();
  await wait(20);
  ok(/对了/.test(q('#quizroot .qz-fb').textContent), '多选判分失败：' + q('#quizroot .qz-fb').textContent);
  q('#quizroot #qz-next').click();
  await wait(260);

  // 5. 第三题单选：点错，错题本要记上
  const wrongOpts = qa('#quizroot .qz-opt');
  wrongOpts.find((b) => b.textContent.includes('上海')).click();
  await wait(20);
  ok(/错了/.test(q('#quizroot .qz-fb').textContent), '单选错题判定失败');
  const wb = JSON.parse(window.localStorage.getItem('quiz.wrong.v1') || '{}');
  ok(wb[BANK.key] && wb[BANK.key]['s-1'] === 1, '错题本没记上：' + JSON.stringify(wb));

  // 6. 退出按钮存在
  ok(!!q('#quizroot #qz-quit'), '没有退出按钮');

  if (fail.length) { console.log('✗ 刷题单测失败', fail.length); fail.forEach((f) => console.log('  -', f)); process.exit(1); }
  console.log('✓ 刷题单测通过：填空宽松判 / 多选提交判 / 单选错题进本 / 提交按钮居中');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
