// 用 jsdom 跑一遍界面：node test/ui-test.js（需要 /tmp/jsdomtest 里装了 jsdom）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/jsdomtest/node_modules/jsdom');

const ROOT = path.resolve(__dirname, '..');
const NodeZip = require('../vendor/jszip.min.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

(async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:8100/', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom 里 node 的 ArrayBuffer 与 window 不同源，转一下再交给 JSZip
  window.fetch = async (u) => {
    const r = await fetch(new URL(u, 'http://127.0.0.1:8100/').href);
    const buf = await r.arrayBuffer();
    return { ok: r.ok, status: r.status, arrayBuffer: async () => window.Uint8Array.from(new Uint8Array(buf)).buffer };
  };
  window.URL.createObjectURL = () => 'blob:fake';
  window.console = console;

  // jsdom 里直接跑 JSZip 的浏览器版会卡在调度器上，这里用 Node 版 JSZip 包一层；
  // 真实浏览器里没有这个问题（index.html 直接引 vendor/jszip.min.js）。
  window.JSZip = {
    loadAsync: (data) => NodeZip.loadAsync(Buffer.from(new Uint8Array(data))),
  };
  const load = (p) => window.eval(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  load('js/parse.js');
  load('js/quiz.js');
  load('js/app.js');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sessionCountGuess = () => 20; // 测试里开的是一组 20 题
  await wait(2500);

  const q = (s) => window.document.querySelector(s);
  const qa = (s) => Array.from(window.document.querySelectorAll(s));
  const fail = [];
  const ok = (cond, msg) => { if (!cond) fail.push(msg); };

  const cards = qa('#qlist .q');
  ok(cards.length === 180, `题目卡片数量 ${cards.length}（期望 180）`);
  ok(qa('#stats').length === 0, '统计栏应该删掉了');

  // 原文面板
  qa('#tabs button').find((b) => b.dataset.tab === 'src').click();
  await wait(50);
  const srcLines = qa('#srclist .srcline');
  ok(srcLines.length >= 150 && srcLines.length <= 260, `原文首屏行数 ${srcLines.length}（期望 200 左右）`);
  ok(!!q('#srcmore'), '原文没有「显示更多」');
  q('#srcmore').click();
  await wait(60);
  ok(qa('#srclist .srcline').length > srcLines.length, '「显示更多」没有追加行');

  // 报告面板
  qa('#tabs button').find((b) => b.dataset.tab === 'rep').click();
  await wait(50);
  const rep = q('#report').textContent;
  ok(/题型分布/.test(rep) && /分节/.test(rep), '报告面板内容缺块：' + rep.slice(0, 80));

  // 筛选
  qa('#tabs button').find((b) => b.dataset.tab === 'q').click();
  await wait(20);
  const multiChip = qa('#filters .chip').find((c) => c.dataset.f === 'multi');
  ok(!!multiChip, '没有多选题筛选');
  if (multiChip) { multiChip.click(); await wait(30); ok(qa('#qlist .q').length === 70, `多选筛选后 ${qa('#qlist .q').length} 题`); }

  // 搜索
  qa('#filters .chip').find((c) => c.dataset.f === 'all').click();
  const search = q('#search');
  search.value = '赤字率';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  const hits = qa('#qlist .q').length;
  ok(hits >= 1 && hits < 30, `搜索「赤字率」命中 ${hits} 题`);

  // 答案/选项渲染
  const sampleCard = qa('#qlist .q')[0];
  ok(sampleCard && /答案/.test(sampleCard.textContent), '题目卡片没有答案');

  // 页签顺序：题目 → 原文 → 刷题 → 报告
  const tabOrder = qa('#tabs button').map((b) => b.dataset.tab).join(',');
  ok(tabOrder === 'q,src,quiz,wrong,rep', '页签顺序不对：' + tabOrder);

  // ---- 刷题闭环
  qa('#tabs button').find((b) => b.dataset.tab === 'quiz').click();
  await wait(60);
  ok(!!q('#quizroot .setup'), '刷题页没有初始设置面板');
  ok(!!q('#quizroot #qz-start'), '没有开始按钮');
  // 题型按钮：这份样例只有 单选/多选/填空 三类，不能显示判断/简答
  const typeChips = qa('#quizroot [data-type]');
  ok(typeChips.length === 3, '题型按钮数量不对：' + typeChips.map((c) => c.textContent));
  // 自定义题量
  const customAmt = qa('#quizroot [data-amount]').find((b) => b.dataset.amount === 'custom');
  ok(!!customAmt, '没有自定义题量按钮');
  if (customAmt) { customAmt.click(); await wait(40); ok(!!q('#quizroot #qz-amt-input'), '自定义题量输入框没出来'); }

  // 选「顺序刷 20 题」，确保第一题是选择题（随机模式可能抽到填空）
  const orderMode = qa('#quizroot .mode').find((b) => b.dataset.mode === 'order');
  if (orderMode) orderMode.click();
  await wait(30);
  const amon = qa('#quizroot .amon').find((b) => b.dataset.amount === '20');
  if (amon) amon.click();
  await wait(30);
  q('#quizroot #qz-start').click();
  await wait(60);
  ok(!!q('#quizroot .qz-card'), '开始后没有题目卡片');
  ok(window.document.body.classList.contains('quiz-session'), '刷题会话没有进入沉浸模式（顶栏应隐藏）');
  ok(!!q('#quizroot .qz-bottom'), '没有底部答题卡/工具条');
  ok(!!q('#quizroot #qz-skip'), '没有跳过按钮');
  // 收藏变黄、标记变绿
  q('#quizroot #qz-fav').click(); await wait(20);
  ok(q('#quizroot #qz-fav').classList.contains('fav'), '收藏按下没变黄');
  q('#quizroot #qz-flag').click(); await wait(20);
  ok(q('#quizroot #qz-flag').classList.contains('flag'), '标记按下没变绿');
  // 答题卡
  q('#quizroot #qz-openmap').click(); await wait(40);
  ok(q('#qz-sheet').classList.contains('open'), '答题卡没打开');
  ok(qa('#qs-grid .qs-cell').length === sessionCountGuess(), '答题卡格子数不对');
  q('#qs-close').click(); await wait(20);
  ok(qa('#quizroot .qz-opt').length === 4, `选项按钮数量 ${qa('#quizroot .qz-opt').length}`);
  // 点第一个选项
  qa('#quizroot .qz-opt')[0].click();
  await wait(50);
  ok(!!q('#quizroot .qz-fb'), '答完没有反馈区');
  ok(window.document.body.classList.contains('quiz-session'), '会话中沉浸模式丢了');
  ok(/对了|错了/.test(q('#quizroot .qz-fb').textContent), '反馈区没有判定');
  ok(!!q('#quizroot #qz-next'), '没有下一题按钮');
  const firstStem = q('#quizroot .stem').textContent;
  q('#quizroot #qz-next').click();
  await wait(300);
  ok(!!q('#quizroot .qz-card'), '下一题没渲染');
  ok(q('#quizroot .stem').textContent !== firstStem || q('#quizroot .qz-top').textContent.includes('2/'), '下一题没有前进');
  // 续刷数据是否落到 localStorage
  // 跳过：前进一题，对错不变
  const beforeSkip = q('#quizroot .qz-top').textContent;
  q('#quizroot #qz-skip').click();
  await wait(80);
  ok(q('#quizroot .qz-top').textContent !== beforeSkip, '跳过没有切到下一题');

  const savedSessions = window.localStorage.getItem('quiz.sessions.v1');
  ok(!!savedSessions && Object.keys(JSON.parse(savedSessions)).length > 0, '刷题进度没有存到 localStorage');
  ok(!!window.localStorage.getItem('quiz.library.v1'), '题库没有存进题库库');

  // ---- 题库浮层
  q('#btn-banks').click();
  await wait(60);
  ok(!q('#sheet').hidden, '题库浮层没打开');
  ok(qa('#banklist .bank').length >= 1, '题库列表是空的');
  q('#sheet-x').click();
  await wait(30);
  ok(q('#sheet').hidden, '题库浮层没关闭');

  // ---- 错题本页
  qa('#tabs button').find((b) => b.dataset.tab === 'wrong').click();
  await wait(80);
  ok(/错题本/.test(q('#wrongroot').textContent), '错题本页没渲染');

  // ---- 限时模拟考
  qa('#tabs button').find((b) => b.dataset.tab === 'quiz').click();
  await wait(80);
  window.QuizUI.startSession('exam', 2, false, 10);
  await wait(80);
  ok(!!q('#quizroot .qz-timer'), '模拟考没有倒计时');
  ok(!!q('#quizroot #qz-next'), '模拟考没有下一题/交卷按钮');
  qa('#quizroot .qz-opt')[0].click();
  q('#quizroot #qz-next').click();
  await wait(120);
  qa('#quizroot .qz-opt')[0].click();
  q('#quizroot #qz-next').click();
  await wait(400);
  ok(/交卷/.test(q('#quizroot').textContent), '交卷后没有结果页');
  ok(!!q('#quizroot .exam-review'), '交卷后没有逐题回顾');
  ok(window.QuizUI.getHistory().length >= 1, '考试没有进刷题记录');

  // ---- 1 题小刷 + 收藏/标记 + 报告入口
  window.QuizUI.startSession('order', 1, false, 30);
  await wait(60);
  const oneOpts = qa('#quizroot .qz-opt');
  ok(oneOpts.length > 0, '1 题小刷没有选项');
  if (oneOpts.length) {
    oneOpts[0].click();
    await wait(50);
    const nb = q('#quizroot #qz-next');
    if (nb) nb.click();
    await wait(300);
  }
  ok(window.QuizUI.getHistory().length >= 2, '练习没有进刷题记录');
  window.QuizUI.setMark('单选题-1', 'fav', true);
  window.QuizUI.setMark('单选题-2', 'flag', true);

  qa('#tabs button').find((b) => b.dataset.tab === 'rep').click();
  await wait(150);
  ok(!!q('#rep-fav') && /收藏 1/.test(q('#rep-fav').textContent), '报告里收藏入口不对：' + (q('#rep-fav') || {}).textContent);
  ok(!!q('#rep-flag') && /标记 \d+/.test(q('#rep-flag').textContent), '报告里标记入口不对：' + (q('#rep-flag') || {}).textContent);
  ok(/刷题记录/.test(q('#rep-hist').textContent), '报告里没有刷题记录入口');
  q('#rep-fav').click(); await wait(80);
  ok(q('#list-sheet').classList.contains('open'), '收藏列表没打开');
  ok(qa('#list-body .mk').length === 1, '收藏列表条数不对');
  q('#list-body .mk-del').click(); await wait(120);
  ok(/还没有/.test(q('#list-body').textContent), '取消收藏后列表没变空');
  q('#list-close').click(); await wait(50);
  q('#rep-hist').click(); await wait(80);
  ok(qa('#list-body .hist').length >= 2, '刷题记录条数不对');
  ok(/对\d+错\d+/.test(q('#list-body').textContent), '刷题记录缺对错');
  ok(/%/.test(q('#list-body').textContent), '刷题记录缺正确率');
  q('#list-close').click(); await wait(50);

  // ---- 判分逻辑单测
  const T = window.QuizUI.__test;
  const fillQ = { id: 'f1', type: 'fill', answer: { text: '北京' } };
  ok(T.judgeFill(fillQ, ' 北 京 ').ok, '填空：空格应忽略');
  ok(T.judgeFill(fillQ, '北京。').ok, '填空：标点应忽略');
  ok(!T.judgeFill(fillQ, '上海').ok, '填空：错答案不该判对');
  const multiQ = { id: 'f2', type: 'multi', answer: { letters: ['A', 'C'] } };
  ok(T.judge(multiQ, { ansKeys: ['A', 'C'] }, ['C', 'A'], '').ok, '多选：顺序无关');
  ok(!T.judge(multiQ, { ansKeys: ['A', 'C'] }, ['A'], '').ok, '多选：少选算错');
  ok(!T.judge(multiQ, { ansKeys: ['A', 'C'] }, ['A', 'B', 'C'], '').ok, '多选：多选算错');
  // 打乱选项后答案要跟着搬家
  const sq = { id: 'f3', type: 'single', options: [
    { key: 'A', content: [{ t: 'text', v: '甲' }] }, { key: 'B', content: [{ t: 'text', v: '乙' }] },
    { key: 'C', content: [{ t: 'text', v: '丙' }] }, { key: 'D', content: [{ t: 'text', v: '丁' }] }],
    answer: { letters: ['C'] } };
  for (let i = 0; i < 8; i++) {
    const it = T.buildItems([sq], true)[0];
    const rightIdx = it.ansKeys[0];
    const opt = it.options.find((o) => o.key === rightIdx);
    ok(opt && opt.content[0].v === '丙', '打乱选项后答案字母没跟着搬：' + JSON.stringify(it.options.map((o) => o.key + o.content[0].v)) + ' ans=' + it.ansKeys);
  }

  if (fail.length) { console.log('✗ 失败', fail.length); fail.forEach((f) => console.log('  -', f)); process.exit(1); }
  console.log('✓ 界面冒烟通过：卡片 180、原文 685 行、筛选/搜索/报告正常');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
