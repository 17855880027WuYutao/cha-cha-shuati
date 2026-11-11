/* 刷题解析台 —— 前端逻辑 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const TYPE = {
    single: { label: '单选', cls: 'single' },
    multi: { label: '多选', cls: 'multi' },
    judge: { label: '判断', cls: 'judge' },
    fill: { label: '填空', cls: 'fill' },
    short: { label: '简答', cls: 'short' },
    unknown: { label: '其他', cls: 'unknown' },
  };
  const state = { data: null, filter: 'all', search: '', tab: 'q', qStartLines: new Set(), srcKey: null, srcRows: [], srcRendered: 0 };

  // 老 WebView 不认 100dvh，用 JS 量真实高度
  function syncAppHeight() {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight;
    if (h > 0) document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  }

  function buzz(pattern) {
    try { setTimeout(() => { if (navigator.vibrate) navigator.vibrate(pattern); }, 0); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- 渲染富内容
  function rich(nodes) {
    let h = '';
    for (const n of nodes || []) {
      if (n.t === 'text') {
        let v = esc(n.v);
        const m = n.mark || {};
        if (m.b) v = '<b>' + v + '</b>';
        if (m.i) v = '<i>' + v + '</i>';
        if (m.u) v = '<u>' + v + '</u>';
        h += v;
      } else if (n.t === 'br') h += '<br>';
      else if (n.t === 'tab') h += ' ';
      else if (n.t === 'math') h += '<span class="math">' + esc(n.v) + '</span>';
      else if (n.t === 'img') {
        h += n.src
          ? '<img src="' + esc(n.src) + '" alt="' + esc(n.alt || '题图') + '">'
          : '<span style="color:#b26a1f">[图片' + (n.target ? '：' + esc(n.target.split('/').pop()) : '') + ']</span>';
      } else if (n.t === 'table') h += tableHtml(n.rows);
    }
    return h;
  }
  function tableHtml(rows) {
    let h = '<table class="rich">';
    for (const row of rows || []) {
      h += '<tr>';
      for (const cell of row || []) {
        h += '<td>' + (cell || []).map((blk) => rich(blk)).join('<br>') + '</td>';
      }
      h += '</tr>';
    }
    return h + '</table>';
  }
  function plainOf(nodes) {
    return (nodes || []).map((n) => (n.t === 'text' ? n.v : n.t === 'img' ? '[图]' : n.t === 'table' ? '[表]' : n.t === 'math' ? n.v : n.t === 'tab' ? ' ' : '')).join('');
  }
  function answerText(q) {
    if (!q.answer) return '';
    if (q.answer.text) return q.answer.text;
    if (q.answer.judge) return q.answer.judge === 'T' ? '对' : '错';
    if (q.answer.letters) return q.answer.letters.join('');
    return '';
  }

  // ---------------------------------------------------------------- 面板

  function renderFilters() {
    const d = state.data;
    const box = $('#filters');
    if (!d) { box.innerHTML = ''; return; }
    const by = d.report.byType || {};
    const items = [
      ['all', '全部', d.report.total],
      ['single', '单选', by.single || 0],
      ['multi', '多选', by.multi || 0],
      ['judge', '判断', by.judge || 0],
      ['fill', '填空', by.fill || 0],
      ['short', '简答', by.short || 0],
      ['low', '待确认', d.report.issues.length],
    ].filter((x) => x[0] === 'all' || x[2] > 0);
    box.innerHTML = items.map(([k, label, n]) =>
      `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${label}<span class="n">${n}</span></button>`).join('');
    $$('.chip', box).forEach((b) => b.addEventListener('click', () => {
      state.filter = b.dataset.f;
      renderFilters(); renderQuestions();
      $('#main').scrollTop = 0;
    }));
  }

  function questionMatches(q) {
    if (state.filter === 'low') {
      if (!(q.confidence < 0.75 || q.issues.length)) return false;
    } else if (state.filter !== 'all' && q.type !== state.filter) return false;
    const kw = state.search.trim().toLowerCase();
    if (!kw) return true;
    const hay = (plainOf(q.stem) + ' ' + q.options.map((o) => o.key + ' ' + plainOf(o.content)).join(' ') + ' ' + answerText(q) + ' ' + plainOf(q.explanation)).toLowerCase();
    return hay.indexOf(kw) >= 0;
  }

  function renderQuestions() {
    const d = state.data;
    const box = $('#qlist');
    if (!d) { box.innerHTML = ''; return; }
    const list = d.questions.filter(questionMatches);
    box.innerHTML = list.map((q) => {
      const tp = TYPE[q.type] || TYPE.unknown;
      const conf = Math.round((q.confidence == null ? 1 : q.confidence) * 100);
      const confCls = conf < 60 ? 'bad' : conf < 75 ? 'low' : '';
      const ans = answerText(q);
      const exp = plainOf(q.explanation).trim();
      return `<div class="q ${tp.cls}" data-id="${esc(q.id)}">
        <div class="qhead">
          <span class="pill t-${tp.cls}">${tp.label}</span>
          <span class="qid">${esc(q.id)}</span>
          <span class="conf ${confCls}">${conf}%</span>
          <button class="jump" data-jump="${q.source ? q.source.from : -1}">原文</button>
        </div>
        <div class="stem">${rich(q.stem)}</div>
        ${q.options.length ? `<ul class="opts">${q.options.map((o) => `<li><span class="k">${esc(o.key)}</span><span>${rich(o.content)}</span></li>`).join('')}</ul>` : ''}
        <div class="ans ${ans ? '' : 'miss'}"><span class="lbl">答案</span><b>${ans ? esc(ans) : '缺'}</b>${exp ? `<span class="exp">解析：${esc(exp)}</span>` : ''}</div>
        ${q.issues.length ? `<div class="issues">⚠ ${esc(q.issues.join('、'))}</div>` : ''}
      </div>`;
    }).join('');
    const empty = $('#qempty');
    if (!list.length) { empty.hidden = false; empty.innerHTML = '没有符合筛选的题目。'; }
    else empty.hidden = true;
    $$('.jump', box).forEach((b) => b.addEventListener('click', () => jumpTo(+b.dataset.jump)));
  }

  function renderSource(force) {
    const d = state.data;
    const box = $('#srclist');
    const more = $('#srcmorewrap');
    if (!d) return;
    const lines = d.lines || [];
    const hint = $('#srchint');
    if (!lines.length) {
      box.innerHTML = '';
      if (more) more.innerHTML = '';
      state.srcKey = null;
      state.srcRows = [];
      state.srcRendered = 0;
      if (hint) {
        hint.innerHTML = '这份题库没有存原文（老版本存的题库没保存行数据）。<br><button class="jump" id="reimport">重新导入原始 docx</button>';
        const btn = document.getElementById('reimport');
        if (btn) btn.addEventListener('click', () => $('#file').click());
      }
      return;
    }
    const key = (d.fileName || '') + '|' + lines.length;
    if (!force && state.srcKey === key && state.srcRendered) return;
    state.srcKey = key;
    state.qStartLines = new Set(d.questions.map((q) => q.source && q.source.from).filter((x) => x != null));
    if (hint) hint.textContent = `共 ${lines.length} 行。标黄的是识别成题目开头的行，红字是原文里的答案行。`;
    state.srcRows = lines.map((l) => {
      const cls = ['srcline'];
      if (state.qStartLines.has(l.no)) cls.push('qa');
      if (l.red) cls.push('red');
      if (l.hidden) cls.push('hid');
      if (l.bold && !l.red) cls.push('sec');
      if (l.kind === 'table') cls.push('sect');
      const tag = l.kind === 'table' ? '表格' : (state.qStartLines.has(l.no) ? '题' : '');
      const text = l.kind === 'table' ? '[表格]' + (l.text ? ' ' + l.text : '') : (l.num ? l.num + ' ' : '') + l.text;
      return `<div class="${cls.join(' ')}" id="ln-${l.no}"><span class="no">${l.no}</span><span class="tx">${esc(text)}</span><span class="tag">${tag}</span></div>`;
    });
    state.srcRendered = 0;
    box.innerHTML = '';
    appendSourceRows(200);
  }

  function appendSourceRows(n) {
    const box = $('#srclist');
    const more = $('#srcmorewrap');
    const rows = state.srcRows || [];
    if (!box) return;
    const end = Math.min(rows.length, state.srcRendered + n);
    if (end > state.srcRendered) {
      box.insertAdjacentHTML('beforeend', rows.slice(state.srcRendered, end).join(''));
      state.srcRendered = end;
    }
    if (more) {
      const left = rows.length - state.srcRendered;
      if (left > 0) {
        more.innerHTML = `<div class="hint" id="srcmore">还有 ${left} 行 · 点这里继续显示</div>`;
        const b = document.getElementById('srcmore');
        if (b) b.addEventListener('click', () => appendSourceRows(600));
      } else {
        more.innerHTML = '';
      }
    }
  }

  function renderReport() {
    const d = state.data;
    const box = $('#report');
    if (!d) { box.innerHTML = ''; return; }
    const r = d.report;
    const by = r.byType || {};
    const marks = (window.QuizUI && window.QuizUI.getMarks) ? window.QuizUI.getMarks() : {};
    const favCount = Object.keys(marks).filter((id) => marks[id] && marks[id].fav).length;
    const flagCount = Object.keys(marks).filter((id) => marks[id] && marks[id].flag).length;
    const histArr = (window.QuizUI && window.QuizUI.getHistory) ? window.QuizUI.getHistory() : [];
    const histCount = histArr.length;
    const maxN = Math.max(1, ...Object.values(by));
    const total = r.total || 1;
    const bars = Object.keys(TYPE).filter((k) => by[k]).map((k) => {
      const n = by[k];
      return `<div class="bar"><span class="nm">${TYPE[k].label}</span><span class="tr"><span class="fl" style="width:${(n / maxN * 100).toFixed(1)}%"></span></span><span class="vl">${n}</span></div>`;
    }).join('');
    const issues = r.issues.length
      ? r.issues.map((it) => `<div class="issue"><span class="id">${esc(it.id)}</span><span class="ms">${esc(it.issues.join('、'))}</span><button class="jump" data-jump="${jumpLineOf(it.id)}">定位</button></div>`).join('')
      : '<div class="hint">没有待确认的题目。</div>';
    const strays = r.strayLines.length
      ? r.strayLines.slice(0, 20).map((s) => `<div class="stray">${s.no}：${esc(s.text)}</div>`).join('')
      : '<div class="hint">没有未归类的行。</div>';
    box.innerHTML = `
      <div class="grid">
        <div class="cell"><b>${r.total}</b><span>题目</span></div>
        <div class="cell"><b>${d.sections.length}</b><span>分节</span></div>
        <div class="cell"><b>${r.stats.paragraphs}</b><span>段落</span></div>
        <div class="cell"><b>${r.stats.tables}</b><span>表格</span></div>
        <div class="cell"><b>${r.stats.images}</b><span>图片</span></div>
        <div class="cell"><b>${Math.round(r.total && (1 - r.issues.length / r.total) * 100)}%</b><span>自动通过率</span></div>
      </div>
      <h3>我的标记</h3>
      <div class="rep-actions">
        <button class="favbtn" id="rep-fav">收藏 ${favCount}</button>
        <button class="flagbtn" id="rep-flag">标记 ${flagCount}</button>
        <button id="rep-hist">刷题记录 ${histCount}</button>
      </div>
      <h3>题型分布</h3><div class="bars">${bars}</div>
      <h3>分节<small>${esc(d.title || '')}</small></h3>
      ${d.sections.map((s) => `<div class="bar"><span class="nm">${esc(s.name.slice(0, 6))}</span><span class="tr"><span class="fl" style="width:${(s.count / total * 100).toFixed(1)}%"></span></span><span class="vl">${s.count}</span></div>`).join('')}
      <h3>待确认<small>${r.issues.length} 题</small></h3>${issues}
      <h3>重复题<small>${(r.duplicates || []).length} 组</small></h3>
      ${(r.duplicates || []).length ? r.duplicates.map((d) => `<div class="issue"><span class="id">${esc(d.ids.join(' / '))}</span><span class="ms">${d.conflict ? '答案不一致：' + esc(d.answers.join(' vs ')) : '题干重复'}</span><button class="jump" data-jump="${jumpLineOf(d.ids[0])}">定位</button></div>`).join('') : '<div class="hint">没有重复题。</div>'}
      <h3>未归类<small>${r.strayLines.length} 行</small></h3>${strays}
      <div class="hint">解析耗时 ${d._ms || '?'} ms · 文件 ${esc(d.fileName || '')}</div>`;
    $$('.jump', box).forEach((b) => b.addEventListener('click', () => jumpTo(+b.dataset.jump)));
    const bf = $('#rep-fav', box); if (bf) bf.addEventListener('click', () => openMarkSheet('fav'));
    const bg = $('#rep-flag', box); if (bg) bg.addEventListener('click', () => openMarkSheet('flag'));
    const bh = $('#rep-hist', box); if (bh) bh.addEventListener('click', () => openHistSheet());
  }

  // ---------------------------------------------------------------- 标记 / 记录浮层
  function openListSheet(title, html) {
    const sheet = $('#list-sheet');
    if (!sheet) return;
    $('#list-title').textContent = title;
    $('#list-body').innerHTML = html;
    sheet.classList.add('open');
    $('#list-mask').classList.add('on');
  }
  function closeListSheet() {
    const sheet = $('#list-sheet');
    if (sheet) sheet.classList.remove('open');
    const mask = $('#list-mask');
    if (mask) mask.classList.remove('on');
  }
  function markItemHtml(q, kind) {
    return `<div class="mk" data-id="${esc(q.id)}">
      <div class="mk-h">
        <span class="pill t-${q.type}">${TYPE[q.type] ? TYPE[q.type].label : '题'}</span>
        <span class="qid">${esc(q.id)}</span>
        <button class="mk-del" data-del="${esc(q.id)}" data-kind="${kind}">取消${kind === 'fav' ? '收藏' : '标记'}</button>
      </div>
      <div class="mk-stem">${rich(q.stem)}</div>
      <div class="mk-a">答案：${esc(answerText(q))}</div>
    </div>`;
  }
  function openMarkSheet(kind) {
    if (!state.data) return;
    const marks = (window.QuizUI && window.QuizUI.getMarks) ? window.QuizUI.getMarks() : {};
    const ids = Object.keys(marks).filter((id) => marks[id] && marks[id][kind]);
    const qs = ids.map((id) => state.data.questions.find((q) => q.id === id)).filter(Boolean);
    const title = kind === 'fav' ? `收藏的题（${qs.length}）` : `标记的题（${qs.length}）`;
    const body = qs.length ? qs.map((q) => markItemHtml(q, kind)).join('') : '<div class="hint">还没有。刷题时点底部「' + (kind === 'fav' ? '收藏' : '标记') + '」就会收进来。</div>';
    openListSheet(title, body);
    $$('.mk-del', $('#list-body')).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.del;
      if (window.QuizUI && window.QuizUI.setMark) window.QuizUI.setMark(id, kind, false);
      buzz(10);
      openMarkSheet(kind);
      renderReport();
    }));
  }
  function fmtWhen(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function openHistSheet() {
    const MODE = { random: '随机', order: '顺序', wrong: '错题', exam: '模拟考' };
    const arr = (window.QuizUI && window.QuizUI.getHistory) ? window.QuizUI.getHistory() : [];
    let body;
    if (!arr.length) {
      body = '<div class="hint">还没有刷题记录。刷完一组就会记一条。</div>';
    } else {
      body = `<div class="hint" style="margin:0 0 6px">本机保存最近 ${arr.length} 次</div>`
        + arr.map((r) => {
          const mm = Math.floor((r.sec || 0) / 60);
          const ss = (r.sec || 0) % 60;
          const dur = mm ? `${mm}分${ss ? ss + '秒' : ''}` : `${ss}秒`;
          return `<div class="hist">
            <span class="when">${fmtWhen(r.at)}</span>
            <span class="md">${MODE[r.mode] || r.mode}</span>
            <span class="num">${r.total}题 · 对${r.right}错${r.wrong}${r.skipped ? ' · 跳过' + r.skipped : ''} · ${dur}</span>
            <span class="pct ${r.pct >= 60 ? 'good' : 'bad'}">${r.pct}%</span>
          </div>`;
        }).join('')
        + `<div style="margin-top:14px"><button class="mk-del" id="hist-clear">清空记录</button></div>`;
    }
    openListSheet(`刷题记录（${arr.length}）`, body);
    const clr = $('#hist-clear');
    if (clr) clr.addEventListener('click', () => {
      if (!confirm('清空这个题库的刷题记录？')) return;
      if (window.QuizUI && window.QuizUI.clearHistory) window.QuizUI.clearHistory();
      buzz([0, 15, 30, 15]);
      openHistSheet();
      renderReport();
    });
  }

  function jumpLineOf(id) {
    const d = state.data;
    const q = d && d.questions.find((x) => x.id === id);
    return q && q.source ? q.source.from : -1;
  }

  // ---------------------------------------------------------------- 跳转到原文
  function jumpTo(lineNo) {
    if (lineNo == null || lineNo < 0) return;
    switchTab('src');
    while (!document.getElementById('ln-' + lineNo) && state.srcRendered < (state.srcRows || []).length) {
      appendSourceRows(600);
    }
    const el = document.getElementById('ln-' + lineNo);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 1600);
  }
  function switchTab(tab) {
    state.tab = tab;
    buzz(4);
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#pane-q').hidden = tab !== 'q';
    $('#pane-src').hidden = tab !== 'src';
    $('#pane-rep').hidden = tab !== 'rep';
    $('#pane-quiz').hidden = tab !== 'quiz';
    $('#pane-wrong').hidden = tab !== 'wrong';
    if (window.QuizUI) {
      window.QuizUI.syncChrome();
      if (tab === 'quiz') window.QuizUI.render();
      if (tab === 'wrong') window.QuizUI.renderWrong($('#wrongroot'));
      if (tab === 'rep') renderReport();
    }
  }

  // ---------------------------------------------------------------- 导入
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function withTimeout(p, ms, msg) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  }

  async function importFile(file) {
    if (!file) return;
    const fname = file.name || '导入的题库.docx';
    // App 里从系统文件选择器拿到的文件，名字偶尔不带扩展名，所以只拦老版 .doc，其它先试着解析
    if (/\.doc$/i.test(fname)) { toast('这是老版 .doc，先用 Word/WPS 另存为 .docx'); return; }
    toast('正在解析…');
    const t0 = performance.now();
    try {
      const buf = await file.arrayBuffer();
      const res = await withTimeout(DocxParser.parseDocx(buf, {
        fileName: fname,
        jszip: JSZip,
        mediaUrl: (target, bytes) => URL.createObjectURL(new Blob([bytes])),
      }), 30000, '解析超时（30 秒），换个浏览器或把文件发茶茶看看');
      res._ms = Math.round(performance.now() - t0);
      buzz(12);
      if (window.QuizUI) window.QuizUI.addBank(res);
      toast(`解析完成：${res.report.total} 题，${res.report.issues.length} 题待确认`);
    } catch (e) {
      console.error(e);
      toast('解析失败：' + (e && e.message ? e.message : e));
    }
  }

  function applyBank(b) {
    if (!b) {
      state.data = null;
      $('#qlist').innerHTML = '';
      $('#filters').innerHTML = '';
      $('#srclist').innerHTML = '';
      $('#report').innerHTML = '';
      const e = $('#qempty');
      e.hidden = false;
      e.innerHTML = '<b>还没有题库</b><br>点右上角「导入」选一份 .docx<br>或点「题库 → 加载示例」';
      const hint = $('#srchint');
      if (hint) hint.textContent = '导入题库后，这里显示 Word 的原始行。';
      return;
    }
    const report = b.report || {
      total: (b.questions || []).length, byType: {}, stats: { paragraphs: 0, tables: 0, images: 0 },
      issues: [], strayLines: [], duplicates: [], titleLines: [],
    };
    if (!report.stats) report.stats = { paragraphs: 0, tables: 0, images: 0 };
    if (!report.issues) report.issues = [];
    if (!report.strayLines) report.strayLines = [];
    if (!report.duplicates) report.duplicates = [];
    state.data = {
      fileName: b.fileName, title: b.title, sections: b.sections || [],
      questions: b.questions || [], report, lines: b.lines || [], _ms: 0,
    };
    state.filter = 'all';
    state.search = '';
    state.srcKey = null;
    $('#search').value = '';
    $('#qempty').hidden = true;
    renderFilters(); renderQuestions(); renderSource(); renderReport();
    $('#main').scrollTop = 0;
  }

  // ---------------------------------------------------------------- 导出 JSON
  function exportJson() {
    const d = state.data;
    if (!d) { toast('还没有题库'); return; }
    const out = {
      fileName: d.fileName, title: d.title, sections: d.sections,
      report: { total: d.report.total, byType: d.report.byType, issues: d.report.issues, stats: d.report.stats },
      questions: d.questions,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (d.fileName || '题库').replace(/\.docx$/i, '') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 JSON');
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    syncAppHeight();
    window.addEventListener('resize', syncAppHeight);
    window.addEventListener('orientationchange', () => setTimeout(syncAppHeight, 200));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', syncAppHeight);
    $('#btn-import').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => {
      importFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-banks').addEventListener('click', () => { if (window.QuizUI) window.QuizUI.openSheet(); });
    $('#sheet-x').addEventListener('click', () => window.QuizUI && window.QuizUI.closeSheet());
    $('#sheet-bg').addEventListener('click', () => window.QuizUI && window.QuizUI.closeSheet());
    $('#sheet-import').addEventListener('click', () => { window.QuizUI && window.QuizUI.closeSheet(); $('#file').click(); });
    $('#sheet-sample').addEventListener('click', () => { window.QuizUI && window.QuizUI.closeSheet(); loadSample(); });
    const lm = $('#list-mask'); if (lm) lm.addEventListener('click', closeListSheet);
    const lc = $('#list-close'); if (lc) lc.addEventListener('click', closeListSheet);
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); exportJson(); }
    });
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
      switchTab(b.dataset.tab);
      if (b.dataset.tab === 'src') renderSource();
      $('#main').scrollTop = 0;
    }));
    // 搜索
    let st = null;
    $('#search').addEventListener('input', (e) => {
      state.search = e.target.value;
      clearTimeout(st);
      st = setTimeout(renderQuestions, 120);
    });
    // 拖拽
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').style.display = 'flex'; });
    document.addEventListener('dragover', (e) => { e.preventDefault();
      const dd = e.dataTransfer;
      if (dd) dd.dropEffect = 'copy';
      $('#drop').style.display = 'flex';
    });
    document.addEventListener('dragleave', (e) => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('#drop').style.display = 'none';
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; $('#drop').style.display = 'none';
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importFile(f);
    });
    // 导出按钮：长按标题或快捷键；手机加一个隐藏入口——点「刷题解析台」标题导出
    let tapCount = 0, tapTimer = null;
    $('.brand').addEventListener('click', () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 700);
      if (tapCount >= 3) { tapCount = 0; exportJson(); }
    });
    // 刷题模块
    if (window.QuizUI) {
      window.QuizUI.mount({
        rich, plainOf, toast, buzz,
        onBankChange: applyBank,
        importFile: () => $('#file').click(),
        loadSample: () => loadSample(),
        gotoWrong: () => switchTab('wrong'),
        gotoQuiz: () => switchTab('quiz'),
      });
      // 第一次用（还没有任何题库）才自动加载示例
      if (!window.QuizUI.getCurrentBank()) {
        const sp = new URLSearchParams(location.search).get('sample');
        const sampleMap = { dirty: 'samples/dirty.docx' };
        loadSample(true, sampleMap[sp] || undefined);
      }
    }
  }

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  async function loadSample(silent, file) {
    const src = file || 'samples/dirty.docx';
    try {
      // 单文件版把示例题库直接嵌在页面里，不需要服务器
      const emb = window.__EMBEDDED_SAMPLE__;
      const resp = emb ? { ok: true, arrayBuffer: async () => b64ToBuffer(emb.b64) } : await fetch(src);
      if (!resp.ok) throw new Error('示例文件读不到');
      const buf = await resp.arrayBuffer();
      const t0 = performance.now();
      const res = await withTimeout(DocxParser.parseDocx(buf, {
        fileName: emb && emb.name ? emb.name : decodeURIComponent(String(src).split('/').pop()),
        jszip: JSZip,
        mediaUrl: (target, bytes) => URL.createObjectURL(new Blob([bytes])),
      }), 30000, '解析超时（30 秒）');
      res._ms = Math.round(performance.now() - t0);
      if (window.QuizUI) window.QuizUI.addBank(res);
      if (!silent) toast('已加载示例题库');
    } catch (e) {
      console.error(e);
      if (!silent) toast('示例加载失败：' + (e && e.message ? e.message : e));
      $('#qempty').hidden = false;
      $('#qempty').innerHTML = '<b>把 .docx 拖进来</b><br>或点右上角「导入 Word」';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
