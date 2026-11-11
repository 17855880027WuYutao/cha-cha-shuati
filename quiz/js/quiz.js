/* 刷题闭环 v0.4 —— 多题库 / 随机·顺序·错题 / 限时模拟考 / 错题本 / 本机续刷 */
(function (global) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LS = { lib: 'quiz.library.v1', wrong: 'quiz.wrong.v1', sessions: 'quiz.sessions.v1', marks: 'quiz.marks.v1', history: 'quiz.history.v1', legacyBank: 'quiz.bank.v1', legacySession: 'quiz.session.v1' };
  const AMOUNT_PRESETS = [20, 50, 100, 0];
  const DURATIONS = [15, 30, 60, 90, 120];
  const TYPE_NAME = { single: '单选', multi: '多选', judge: '判断', fill: '填空', short: '简答', unknown: '其他' };
  const LETTERS = 'ABCDEFGHIJ';

  let deps = null;
  let lib = { current: null, banks: {} };
  let bank = null;
  let wrongBook = {};
  let marks = {};
  let history = {};
  let session = null;
  let pendingResume = null;
  let timerId = null;
  let setup = { mode: 'random', amount: 0, duration: 30, shuffle: true, customDur: false, amountCustom: false, amountValue: 50, types: null };
  const expanded = new Set();

  // ---------------------------------------------------------------- 基础
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plain = (nodes) => deps.plainOf(nodes || []);
  const rich = (nodes) => deps.rich(nodes || []);
  const buzz = (p) => { try { if (deps && deps.buzz) setTimeout(() => deps.buzz(p), 0); } catch (e) { /* ignore */ } };
  const toast = (m) => { if (deps && deps.toast) deps.toast(m); };

  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  function norm(s) {
    let t = String(s || '');
    t = t.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    t = t.replace(/\u3000/g, ' ').replace(/\s+/g, '');
    t = t.replace(/[，,。.、；;：:！!？?（）()【】\[\]“”"'‘’《》<>·…\-—_/\\|]/g, '');
    return t.toLowerCase();
  }
  function splitParts(s) { return String(s || '').split(/[；;、|]/).map((x) => x.trim()).filter(Boolean); }
  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    return b;
  }
  function remapLetters(ansLetters, order) {
    const pos = {};
    order.forEach((k, i) => { pos[k] = LETTERS[i]; });
    return ansLetters.map((k) => pos[k]).filter(Boolean);
  }

  // ---------------------------------------------------------------- 题库库
  function bankKeyOf(res) {
    const qs = res.questions || [];
    return [res.fileName || '', qs.length, qs[0] ? qs[0].id : '', qs[qs.length - 1] ? qs[qs.length - 1].id : ''].join('|');
  }
  function loadLibrary() {
    lib = lsGet(LS.lib) || { current: null, banks: {} };
    if (!lib.banks) lib.banks = {};
    // 迁移老版本：单题库 + 单会话
    if (!Object.keys(lib.banks).length) {
      const old = lsGet(LS.legacyBank);
      if (old && old.questions && old.questions.length) {
        lib.banks[old.key] = old;
        lib.current = old.key;
        persistLibrary();
        lsDel(LS.legacyBank);
      }
    }
    const legacySession = lsGet(LS.legacySession);
    if (legacySession && legacySession.bankKey && lib.banks[legacySession.bankKey]) {
      const ss = lsGet(LS.sessions) || {};
      if (!ss[legacySession.bankKey]) { ss[legacySession.bankKey] = legacySession; lsSet(LS.sessions, ss); }
      lsDel(LS.legacySession);
    }
  }
  function persistLibrary() {
    if (lsSet(LS.lib, lib)) return true;
    toast('本机存不下更多题库了，先删掉一个旧的');
    return false;
  }
  function loadWrong() { wrongBook = lsGet(LS.wrong) || {}; }
  function saveWrong() { lsSet(LS.wrong, wrongBook); }
  function wrongOf(key) { return wrongBook[key || (bank && bank.key)] || {}; }
  function loadMarks() { marks = lsGet(LS.marks) || {}; }
  function loadHistory() { history = lsGet(LS.history) || {}; }
  function saveHistory() { lsSet(LS.history, history); }
  function pushHistory(rec) {
    if (!bank) return;
    const arr = history[bank.key] || (history[bank.key] = []);
    arr.unshift(rec);
    if (arr.length > 60) arr.length = 60;
    saveHistory();
  }
  function marksOf(qid) {
    if (!bank) return {};
    const m = marks[bank.key] || {};
    return m[qid] || {};
  }
  function setMark(qid, kind, val) {
    if (!bank) return;
    const m = marks[bank.key] || (marks[bank.key] = {});
    const rec = m[qid] || (m[qid] = {});
    if (val) rec[kind] = true; else delete rec[kind];
    lsSet(LS.marks, marks);
  }
  function sessionsMap() { return lsGet(LS.sessions) || {}; }
  let saveTimer = null;
  function saveSessionNow() {
    if (!session) return;
    const m = sessionsMap();
    m[session.bankKey] = session;
    lsSet(LS.sessions, m);
  }
  // App 里写的是 SharedPreferences，每次答题都整段写会卡，合并一下
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveSessionNow(); }, 500);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveSessionNow();
  }
  function dropSession(bankKey) {
    const m = sessionsMap();
    delete m[bankKey];
    lsSet(LS.sessions, m);
  }

  function setActiveBank(key) {
    lib.current = key;
    bank = (key && lib.banks[key]) || null;
    session = null;
    pendingResume = null;
    setup.types = null;
    if (bank) {
      const s = sessionsMap()[bank.key];
      if (s && s.bankKey === bank.key && !s.finished) pendingResume = s;
    }
    persistLibrary();
    if (deps && deps.onBankChange) deps.onBankChange(bank);
    render();
  }

  function addBank(res) {
    if (!res || !res.questions || !res.questions.length) return;
    const key = bankKeyOf(res);
    const prevKey = lib.current;
    lib.banks[key] = {
      key, fileName: res.fileName, title: res.title || '',
      sections: res.sections || [], questions: res.questions,
      report: res.report, lines: res.lines || [], addedAt: Date.now(),
    };
    lib.current = key;
    if (!persistLibrary()) { if (prevKey && lib.banks[prevKey]) lib.current = prevKey; }
    bank = lib.banks[lib.current] || null;
    session = null;
    pendingResume = null;
    setup.types = null;
    if (deps && deps.onBankChange) deps.onBankChange(bank);
    render();
  }

  function deleteBank(key) {
    if (!lib.banks[key]) return;
    const wasCurrent = lib.current === key;
    delete lib.banks[key];
    delete wrongBook[key];
    saveWrong();
    delete marks[key]; lsSet(LS.marks, marks);
    delete history[key]; saveHistory();
    dropSession(key);
    if (wasCurrent) {
      const keys = Object.keys(lib.banks).sort((a, b) => (lib.banks[b].addedAt || 0) - (lib.banks[a].addedAt || 0));
      lib.current = keys.length ? keys[0] : null;
      bank = lib.current ? lib.banks[lib.current] : null;
      session = null;
      pendingResume = null;
      if (deps && deps.onBankChange) deps.onBankChange(bank);
    }
    persistLibrary();
    render();
    renderSheet();
    if (!bank) { const w = $('#wrongroot'); if (w) renderWrong(w); }
  }

  // ---------------------------------------------------------------- 题库浮层
  function renderSheet() {
    const box = $('#banklist');
    if (!box) return;
    const keys = Object.keys(lib.banks).sort((a, b) => (lib.banks[b].addedAt || 0) - (lib.banks[a].addedAt || 0));
    if (!keys.length) {
      box.innerHTML = '<div class="sheet-empty">还没有题库。<br>点下面「导入 Word」选一份 .docx</div>';
      return;
    }
    box.innerHTML = keys.map((k) => {
      const b = lib.banks[k];
      const n = (b.questions || []).length;
      const w = Object.keys(wrongBook[k] || {}).length;
      const cur = k === lib.current;
      return `<div class="bank ${cur ? 'cur' : ''}" data-k="${esc(k)}">
        <div class="b-main" data-pick="${esc(k)}">
          <div class="b-nm">${esc(b.fileName || b.title || '题库')}</div>
          <div class="b-meta">${n} 题${w ? ' · 错题 ' + w : ''}${cur ? ' · 当前' : ''}</div>
        </div>
        ${cur ? '<span class="b-cur">使用中</span>' : '<button class="b-pick" data-pick2="' + esc(k) + '">用这个</button>'}
        <button class="b-del" data-del="${esc(k)}">删</button>
      </div>`;
    }).join('');
    $$('#banklist [data-pick]', box).forEach((el) => el.addEventListener('click', () => {
      if (el.dataset.pick !== lib.current) { buzz(10); setActiveBank(el.dataset.pick); renderSheet(); }
      closeSheet();
    }));
    $$('#banklist [data-pick2]', box).forEach((el) => el.addEventListener('click', () => {
      buzz(10); setActiveBank(el.dataset.pick2); renderSheet(); closeSheet();
    }));
    $$('#banklist [data-del]', box).forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = el.dataset.del;
      const b = lib.banks[k];
      if (!confirm('删除「' + (b.fileName || '题库') + '」？进度和错题也会一起删掉。')) return;
      buzz([0, 15, 30, 15]);
      deleteBank(k);
    }));
  }
  function openSheet() { renderSheet(); $('#sheet').hidden = false; buzz(6); }
  function closeSheet() { $('#sheet').hidden = true; }

  // ---------------------------------------------------------------- 会话
  function buildItems(questions, shuffleOptions) {
    return questions.map((q) => {
      const opts = (q.options || []).map((o) => ({ key: o.key, content: o.content }));
      let order = opts.map((o) => o.key);
      if (shuffleOptions && opts.length > 1 && q.type !== 'judge') order = shuffle(order);
      const display = order.map((k, i) => {
        const src = opts.find((o) => o.key === k);
        return { key: LETTERS[i], content: src ? src.content : [] };
      });
      const ansLetters = q.answer && q.answer.letters ? q.answer.letters : [];
      return {
        qid: q.id, key: q.type, options: display,
        ansKeys: shuffleOptions && opts.length > 1 && q.type !== 'judge' ? remapLetters(ansLetters, order) : ansLetters.slice(),
      };
    });
  }

  function resumeCandidate() {
    if (!pendingResume || !bank || pendingResume.bankKey !== bank.key) return null;
    const items = pendingResume.items || [];
    let i = pendingResume.idx || 0;
    while (i < items.length && pendingResume.results && pendingResume.results[items[i].qid]) i++;
    if (i >= items.length) return null;
    return { data: pendingResume, idx: i };
  }

  function startSession(mode, amount, shuffleOpts, duration) {
    if (!bank) { toast('先导入或选择一个题库'); return; }
    const types = selectedTypes();
    if (!types.length) { toast('至少选一种题型'); return; }
    let pool = bank.questions.filter((q) => types.includes(q.type));
    const wk = wrongOf();
    if (mode === 'wrong') {
      pool = pool.filter((q) => wk[q.id]).sort((a, b) => (wk[b.id] || 0) - (wk[a.id] || 0));
      if (!pool.length) { toast('这个题库还没有错题'); return; }
    } else if (mode === 'random') {
      pool = shuffle(pool);
    }
    const n = mode === 'exam' ? (amount > 0 ? amount : pool.length) : amount;
    if (n > 0) pool = pool.slice(0, n);
    const items = buildItems(pool, shuffleOpts);
    pendingResume = null;
    const base = {
      bankKey: bank.key, mode, amount, shuffle: shuffleOpts, ids: pool.map((q) => q.id),
      idx: 0, finished: false, results: {}, skipped: [], startedAt: Date.now(), items,
    };
    if (mode === 'exam') {
      base.durationSec = (duration || 20) * 60;
      base.deadline = Date.now() + base.durationSec * 1000;
      base.picked = {};
    }
    session = base;
    saveSessionNow();
    render();
  }

  function availTypes() {
    const m = {};
    (bank ? bank.questions : []).forEach((q) => { m[q.type] = (m[q.type] || 0) + 1; });
    return m;
  }
  function selectedTypes() {
    const avail = availTypes();
    const all = Object.keys(avail);
    if (!setup.types) return all;
    const sel = setup.types.filter((t) => avail[t]);
    return sel.length ? sel : all;
  }

  function currentItem() { return session ? session.items[session.idx] || null : null; }
  function questionOf(id) { return bank ? bank.questions.find((q) => q.id === id) : null; }

  // ---------------------------------------------------------------- 判分
  function judge(q, item, pickedKeys, fillText) {
    if (q.type === 'fill' || q.type === 'short') return judgeFill(q, fillText);
    const right = (item.ansKeys || []).slice().sort().join('');
    const got = (pickedKeys || []).slice().sort().join('');
    return { ok: right !== '' && right === got, right, got };
  }
  function judgeFill(q, input) {
    const ans = q.answer || {};
    const ansText = ans.text || '';
    const userParts = splitParts(input);
    const ansParts = splitParts(ansText);
    let ok;
    if (ansParts.length > 1) ok = userParts.length === ansParts.length && ansParts.every((p, i) => norm(p) === norm(userParts[i]));
    else ok = ansParts.length === 1 && norm(ansText) === norm(input);
    return { ok, right: ansParts.length ? ansParts.join(' / ') : ansText };
  }

  // ---------------------------------------------------------------- 渲染总入口
  function syncChrome() {
    const pane = document.getElementById('pane-quiz');
    const onQuiz = !pane || !pane.hidden;
    const inSession = onQuiz && !!(session && !session.finished && session.idx < session.items.length);
    document.body.classList.toggle('quiz-session', inSession);
  }

  function markFinished() {
    if (!session || session.finished) return;
    session.finished = true;
    if (!session.recorded) {
      const results = session.results || {};
      const total = session.items.length || 0;
      const right = Object.values(results).filter((r) => r.ok).length;
      const sec = Math.round((session.elapsed != null ? session.elapsed : (Date.now() - (session.startedAt || Date.now())) / 1000));
      pushHistory({
        at: Date.now(), mode: session.mode, total, right, wrong: Math.max(0, total - right),
        skipped: (session.skipped || []).length, sec,
        pct: total ? Math.round((right / total) * 100) : 0,
      });
      session.recorded = true;
    }
    flushSave();
  }

  function render() {
    const root = $('#quizroot');
    if (!root) return;
    syncChrome();
    if (!bank) {
      stopTimer();
      root.innerHTML = '<div class="empty"><b>还没有题库</b><br>点右上角「导入」选一份 .docx，<br>或点「题库 → 加载示例」先看看。</div>';
      return;
    }
    if (!session) { stopTimer(); renderSetup(root); return; }
    if (session.finished) { stopTimer(); renderDone(root); return; }
    if (session.idx >= session.items.length) {
      if (session.mode === 'exam') { submitExam(true); return; }
      markFinished(); stopTimer(); renderDone(root); return;
    }
    renderQuestion(root);
  }

  function renderSetup(root) {
    const total = bank.questions.length;
    const wk = wrongOf();
    const wrongN = Object.keys(wk).length;
    const cand = resumeCandidate();
    const isExam = setup.mode === 'exam';
    const avail = availTypes();
    const sel = selectedTypes();
    const poolCount = bank.questions.filter((q) => sel.includes(q.type)).length;
    const typeChips = Object.keys(avail).map((t) =>
      `<button class="amon ${sel.includes(t) ? 'on' : ''}" data-type="${t}">${TYPE_NAME[t] || t} ${avail[t]}</button>`).join('');
    const amountBtns = AMOUNT_PRESETS.map((n) =>
      `<button class="amon ${!setup.amountCustom && setup.amount === n ? 'on' : ''}" data-amount="${n}">${n === 0 ? '全部 ' + poolCount : n + ' 题'}</button>`).join('')
      + `<button class="amon ${setup.amountCustom ? 'on' : ''}" data-amount="custom">自定义</button>`;
    const custom = !DURATIONS.includes(setup.duration) || setup.customDur;
    const durationBtns = DURATIONS.map((m) => `<button class="amon ${!custom && setup.duration === m ? 'on' : ''}" data-dur="${m}">${m} 分钟</button>`).join('')
      + `<button class="amon ${custom ? 'on' : ''}" data-dur="custom">自定义</button>`;
    root.innerHTML = `
      <div class="setup">
        <div class="bank-row">
          <span class="nm">${esc(bank.fileName || '题库')}</span>
          <button class="chg" id="qz-banks">换题库</button>
          <button class="chg" id="qz-wrongbook">错题本${wrongN ? ' ' + wrongN : ''}</button>
        </div>
        ${cand ? `<div class="qz-resume">上一组刷到 ${cand.idx}/${cand.data.items.length}，要继续吗？
          <div class="row"><button class="qz-btn" id="qz-resume">继续</button><button class="qz-btn ghost" id="qz-drop">重新开始</button></div>
        </div>` : ''}
        <div class="row">
          <button class="mode ${setup.mode === 'random' ? 'on' : ''}" data-mode="random">随机刷</button>
          <button class="mode ${setup.mode === 'order' ? 'on' : ''}" data-mode="order">顺序刷</button>
          <button class="mode ${setup.mode === 'wrong' ? 'on' : ''}" data-mode="wrong">只刷错题</button>
          <button class="mode ${setup.mode === 'exam' ? 'on' : ''}" data-mode="exam">模拟考</button>
        </div>
        <div class="row">${typeChips}</div>
        <div class="row">${amountBtns}</div>
        ${setup.amountCustom ? `<div class="row"><input class="num" id="qz-amt-input" type="number" min="1" max="1000" value="${setup.amountValue}" placeholder="题数"> <span style="font-size:12px;color:var(--muted);align-self:center">题（1–1000）</span></div>` : ''}
        ${isExam ? `<div class="row">${durationBtns}</div>` : ''}
        ${isExam && custom ? `<div class="row"><input class="num" id="qz-dur-input" type="number" min="1" max="300" value="${setup.duration}" placeholder="分钟"> <span style="font-size:12px;color:var(--muted);align-self:center">分钟（1–300）</span></div>` : ''}
        <label class="sw"><input type="checkbox" id="qz-shuffle" ${setup.shuffle ? 'checked' : ''}> 打乱选项顺序</label>
        <button class="go" id="qz-start">${isExam ? '开始考试' : '开始刷题'}</button>
        <div class="sub">${isExam
          ? `从 ${poolCount} 题里抽题，限时 ${setup.duration} 分钟，不即时判，交卷统一出分。`
          : `筛出 ${poolCount} 题${wrongN ? `（全库错题 ${wrongN} 题）` : ''}。答错自动进错题本，进度存本机。`}</div>
      </div>`;
    $$('.mode', root).forEach((b) => b.addEventListener('click', () => { buzz(6); setup.mode = b.dataset.mode; render(); }));
    $$('.amon', root).forEach((b) => b.addEventListener('click', () => {
      buzz(5);
      if (b.dataset.type) {
        const t = b.dataset.type;
        let arr = setup.types ? setup.types.slice() : Object.keys(avail);
        if (arr.includes(t)) {
          if (arr.length <= 1) { toast('至少留一个题型'); return; }
          arr = arr.filter((x) => x !== t);
        } else {
          arr.push(t);
        }
        setup.types = arr;
      } else if (b.dataset.dur === 'custom') {
        setup.customDur = true;
      } else if (b.dataset.dur) {
        setup.customDur = false; setup.duration = +b.dataset.dur;
      } else if (b.dataset.amount === 'custom') {
        setup.amountCustom = true;
      } else {
        setup.amountCustom = false; setup.amount = +b.dataset.amount;
      }
      render();
    }));
    const amtInput = $('#qz-amt-input', root);
    if (amtInput) {
      const applyAmt = () => {
        setup.amountValue = Math.max(1, Math.min(1000, parseInt(amtInput.value, 10) || 50));
        setup.amountCustom = true;
      };
      amtInput.addEventListener('change', applyAmt);
      amtInput.addEventListener('blur', applyAmt);
      setTimeout(() => { try { amtInput.focus(); amtInput.select(); } catch (e) { /* ignore */ } }, 60);
    }
    const durInput = $('#qz-dur-input', root);
    if (durInput) {
      const applyDur = () => {
        const v = Math.max(1, Math.min(300, parseInt(durInput.value, 10) || 30));
        setup.duration = v; setup.customDur = true;
      };
      durInput.addEventListener('change', applyDur);
      durInput.addEventListener('blur', applyDur);
      setTimeout(() => { try { durInput.focus(); durInput.select(); } catch (e) { /* ignore */ } }, 60);
    }
    $('#qz-shuffle', root).addEventListener('change', (e) => { setup.shuffle = e.target.checked; });
    $('#qz-start', root).addEventListener('click', () => {
      buzz(12);
      const amt = setup.amountCustom ? setup.amountValue : setup.amount;
      startSession(setup.mode, amt, setup.shuffle, setup.duration);
    });
    $('#qz-banks', root).addEventListener('click', () => openSheet());
    $('#qz-wrongbook', root).addEventListener('click', () => { if (deps.gotoWrong) deps.gotoWrong(); });
    if (cand) {
      $('#qz-resume', root).addEventListener('click', () => { session = cand.data; session.idx = cand.idx; pendingResume = null; buzz(10); render(); });
      $('#qz-drop', root).addEventListener('click', () => { dropSession(bank.key); pendingResume = null; buzz(8); render(); });
    }
  }

  function topBar(total, extraHtml) {
    const done = session.idx;
    const results = session.results || {};
    const right = Object.values(results).filter((r) => r.ok).length;
    const wrongN = Object.values(results).filter((r) => !r.ok).length;
    const exam = session.mode === 'exam';
    return `<div class="qz-top">
      ${exam ? '<span class="qz-timer" id="qz-timer">--:--</span>' : ''}
      <span>${done + 1}/${total}</span>
      ${exam ? '' : `<span>对 ${right} · 错 ${wrongN}</span>`}
      <span class="qz-bar"><i style="width:${(done / total * 100).toFixed(1)}%"></i></span>
      ${extraHtml || ''}
      <button class="jump" id="qz-quit">${exam ? '交卷' : '退出'}</button>
    </div>`;
  }

  function renderQuestion(root) {
    const item = currentItem();
    const q = questionOf(item.qid);
    if (!q) { session.idx++; render(); return; }
    const total = session.items.length;
    const isFill = q.type === 'fill' || q.type === 'short';
    const isMulti = q.type === 'multi';
    const exam = session.mode === 'exam';
    const savedPick = exam ? (session.picked && session.picked[q.id]) || [] : [];
    const savedText = exam ? (session.picked && session.picked[q.id + ':t']) || '' : '';
    const m = marksOf(q.id);
    const cardHtml = `
      <div class="qz-card ${q.type}" id="qzcard">
        <div class="qhead">
          <span class="pill t-${q.type}">${TYPE_NAME[q.type] || '题'}</span>
          <span class="qid">${esc(q.id)}</span>
          ${m.flag ? '<span class="conf">已标记</span>' : ''}
          ${m.fav ? '<span class="conf" style="color:#b26a1f">★ 收藏</span>' : ''}
        </div>
        <div class="stem">${rich(q.stem)}</div>
        ${isFill ? `
          <div class="qz-fill"><input id="qz-input" type="text" placeholder="输入答案，多空用；隔开" autocomplete="off" value="${esc(savedText)}"></div>
          ${exam
            ? `<div class="qz-cta"><button class="qz-prev" id="qz-prev">上一题</button><button class="qz-next" id="qz-next">${session.idx + 1 >= total ? '交卷' : '下一题'}</button></div>`
            : '<div id="qz-fb"></div><div class="qz-cta"><button class="qz-btn" id="qz-submit">提交答案</button></div>'}
        ` : `
          <div class="qz-opts">
            ${item.options.map((o) => `<button class="qz-opt ${savedPick.includes(o.key) ? 'sel' : ''}" data-k="${o.key}"><span class="k">${o.key}</span><span>${rich(o.content)}</span></button>`).join('')}
          </div>
          ${exam
            ? `<div class="qz-cta"><button class="qz-prev" id="qz-prev">上一题</button><button class="qz-next" id="qz-next">${session.idx + 1 >= total ? '交卷' : '下一题'}</button></div>`
            : `<div id="qz-fb"></div>${(isMulti) ? '<div class="qz-cta"><button class="qz-btn" id="qz-submit">提交答案</button></div>' : '<div class="qz-cta"></div>'}`}
        `}
      </div>`;
    root.innerHTML = `
      <div class="qz-screen">
        ${topBar(total)}
        <div class="qz-main">${cardHtml}</div>
        <div class="qz-bottom">
          <button class="qz-cardbtn" id="qz-openmap"><span>答题卡</span><span class="hintx" id="qz-meta">${session.idx + 1}/${total}</span></button>
          <div class="qz-tools">
            <button class="qz-tool ${m.fav ? 'fav' : ''}" id="qz-fav"><span class="ic">${m.fav ? '★' : '☆'}</span><span>收藏</span></button>
            <button class="qz-tool ${m.flag ? 'flag' : ''}" id="qz-flag"><span class="ic">⚑</span><span>标记</span></button>
            <button class="qz-tool" id="qz-skip"><span class="ic">⏭</span><span>跳过</span></button>
          </div>
        </div>
      </div>`;
    wireBottom(root, q);

    const optButtons = $$('.qz-opt', root);
    if (exam) { renderExamQuestion(root, q, item, optButtons, isFill, isMulti, total); return; }

    // ---- 练习模式
    const picked = new Set();
    const showResult = (res) => {
      const fb = $('#qz-fb', root);
      if (!fb) return;
      const rightStr = String(res.right == null ? '' : res.right);
      fb.className = 'qz-fb ' + (res.ok ? 'ok' : 'no');
      fb.innerHTML = `<span class="lbl">${res.ok ? '✓ 对了' : '✗ 错了'}</span>正确答案：<b>${esc(rightStr)}</b>`
        + (q.explanation ? `<div class="exp">解析：${esc(plain(q.explanation))}</div>` : '');
      optButtons.forEach((b) => {
        b.disabled = true;
        if (rightStr.split('').includes(b.dataset.k)) b.classList.add('ok');
        if (picked.has(b.dataset.k) && !rightStr.split('').includes(b.dataset.k)) b.classList.add('no');
      });
      const cta = $('.qz-cta', root);
      if (cta) {
        cta.innerHTML = `<button class="qz-next" id="qz-next">${session.idx + 1 >= total ? '看结果' : '下一题'}</button>`;
        const nb = $('#qz-next', root);
        nb.addEventListener('click', () => { if (nb.disabled) return; nb.disabled = true; buzz(6); nextQuestion(); });
      }
    };
    if (isFill) {
      const input = $('#qz-input', root);
      const sb = $('#qz-submit', root);
      const submit = () => {
        if (!input.value.trim()) { toast('先写答案'); return; }
        const res = judge(q, item, [], input.value);
        record(q, res); input.disabled = true; sb.disabled = true;
        showResult(res); buzz(res.ok ? [0, 10] : [0, 20, 40, 20]);
      };
      sb.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 60);
    } else if (isMulti) {
      optButtons.forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        const k = b.dataset.k;
        if (picked.has(k)) { picked.delete(k); b.classList.remove('sel'); }
        else { picked.add(k); b.classList.add('sel'); }
        buzz(6);
      }));
      $('#qz-submit', root).addEventListener('click', () => {
        if (!picked.size) { toast('至少选一个'); return; }
        optButtons.forEach((b) => (b.disabled = true));
        const res = judge(q, item, [...picked], '');
        record(q, res);
        showResult(res); buzz(res.ok ? [0, 10] : [0, 20, 40, 20]);
      });
    } else {
      optButtons.forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        picked.add(b.dataset.k);
        b.classList.add('sel');
        optButtons.forEach((x) => (x.disabled = true));
        const res = judge(q, item, [b.dataset.k], '');
        record(q, res);
        showResult(res); buzz(res.ok ? [0, 10] : [0, 20, 40, 20]);
      }));
    }
    $('#qz-quit', root).addEventListener('click', () => {
      if (!confirm('退出这一组？进度会保留。')) return;
      buzz(8); flushSave(); session = null; pendingResume = null; render();
    });
  }

  // ---- 底部条：答题卡 / 收藏 / 标记 / 跳过
  function wireBottom(root, q) {
    const fav = $('#qz-fav', root);
    const flag = $('#qz-flag', root);
    const skip = $('#qz-skip', root);
    const openmap = $('#qz-openmap', root);
    if (fav) fav.addEventListener('click', () => {
      const on = !marksOf(q.id).fav;
      setMark(q.id, 'fav', on);
      buzz(8);
      fav.classList.toggle('fav', on);
      const ic = fav.querySelector('.ic');
      if (ic) ic.textContent = on ? '★' : '☆';
      toast(on ? '已收藏' : '取消收藏');
    });
    if (flag) flag.addEventListener('click', () => {
      const on = !marksOf(q.id).flag;
      setMark(q.id, 'flag', on);
      buzz(8);
      flag.classList.toggle('flag', on);
      toast(on ? '已标记' : '取消标记');
    });
    if (skip) skip.addEventListener('click', () => { buzz(10); skipCurrent(); });
    if (openmap) openmap.addEventListener('click', openMap);
  }

  function skipCurrent() {
    if (!session) return;
    const it = currentItem();
    if (it) {
      session.skipped = session.skipped || [];
      if (!session.skipped.includes(it.qid)) session.skipped.push(it.qid);
    }
    if (session.idx + 1 >= session.items.length) {
      if (session.mode === 'exam') { submitExam(); return; }
      markFinished(); render(); return;
    }
    session.idx++;
    scheduleSave();
    render();
  }

  // ---- 答题卡
  function openMap() {
    if (!session) return;
    const grid = $('#qs-grid');
    if (!grid) return;
    const answered = Object.keys(session.results || {}).length;
    grid.innerHTML = session.items.map((it, i) => {
      const r = (session.results || {})[it.qid];
      let cls = 'qs-cell';
      if (r && r.ok) cls += ' ok';
      else if (r) cls += ' no';
      if (i === session.idx) cls += ' cur';
      const skip = (session.skipped || []).includes(it.qid);
      return `<button class="${cls}" data-i="${i}">${i + 1}${skip ? '<small style="font-size:9px;opacity:.7">跳</small>' : ''}</button>`;
    }).join('');
    const meta = $('#qs-meta');
    if (meta) meta.textContent = `${session.idx + 1}/${session.items.length} · 已答 ${answered}`;
    $$('#qs-grid .qs-cell').forEach((b) => b.addEventListener('click', () => {
      session.idx = +b.dataset.i;
      closeMap();
      buzz(6);
      scheduleSave();
      render();
    }));
    $('#qz-sheet').classList.add('open');
    $('#qz-mask').classList.add('on');
    buzz(6);
  }
  function closeMap() {
    $('#qz-sheet').classList.remove('open');
    $('#qz-mask').classList.remove('on');
  }

  // ---- 考试模式
  function renderExamQuestion(root, q, item, optButtons, isFill, isMulti, total) {
    const pickedSet = new Set((session.picked && session.picked[q.id]) || []);
    const savePick = () => {
      session.picked = session.picked || {};
      if (isFill) {
        const v = ($('#qz-input', root) || {}).value || '';
        session.picked[q.id + ':t'] = v;
        session.picked[q.id] = v.trim() ? ['__text__'] : [];
      } else {
        session.picked[q.id] = [...pickedSet];
      }
    };
    if (!isFill) {
      optButtons.forEach((b) => b.addEventListener('click', () => {
        if (isMulti) {
          if (pickedSet.has(b.dataset.k)) { pickedSet.delete(b.dataset.k); b.classList.remove('sel'); }
          else { pickedSet.add(b.dataset.k); b.classList.add('sel'); }
        } else {
          pickedSet.clear(); pickedSet.add(b.dataset.k);
          optButtons.forEach((x) => x.classList.remove('sel'));
          b.classList.add('sel');
        }
        buzz(6); savePick();
      }));
    } else {
      const input = $('#qz-input', root);
      input.addEventListener('input', () => { savePick(); });
    }
    $('#qz-next', root).addEventListener('click', () => {
      buzz(8); savePick();
      if (session.idx + 1 >= total) { submitExam(); return; }
      session.idx++; scheduleSave(); render();
    });
    const prev = $('#qz-prev', root);
    if (prev) prev.addEventListener('click', () => {
      buzz(6); savePick(); session.idx = Math.max(0, session.idx - 1); scheduleSave(); render();
    });
    $('#qz-quit', root).addEventListener('click', () => {
      if (!confirm('提前交卷？没答的题按错算。')) return;
      buzz(12); savePick(); submitExam();
    });
    startTimer();
    updateTimer();
  }

  // ---- 计时
  function startTimer() {
    stopTimer();
    if (!session || session.mode !== 'exam' || session.finished) return;
    timerId = setInterval(updateTimer, 500);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function updateTimer() {
    if (!session || session.mode !== 'exam') return;
    const el = $('#qz-timer');
    if (!el) return;
    const left = Math.max(0, Math.round((session.deadline - Date.now()) / 1000));
    el.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    el.classList.toggle('warn', left <= 60);
    if (left <= 0) { stopTimer(); toast('时间到，自动交卷'); buzz([0, 40, 60, 40]); submitExam(true); }
  }

  function submitExam(auto) {
    if (!session || session.mode !== 'exam') return;
    stopTimer();
    const results = {};
    for (const item of session.items) {
      const q = questionOf(item.qid);
      if (!q) continue;
      const pk = (session.picked && session.picked[item.qid]) || [];
      let res;
      if (q.type === 'fill' || q.type === 'short') res = judgeFill(q, (session.picked && session.picked[item.qid + ':t']) || '');
      else res = judge(q, item, pk, '');
      results[item.qid] = { ok: !!res.ok, right: res.right };
      if (!res.ok) {
        wrongBook[bank.key] = wrongBook[bank.key] || {};
        wrongBook[bank.key][item.qid] = (wrongBook[bank.key][item.qid] || 0) + 1;
      }
    }
    saveWrong();
    let answered = 0;
    for (const item of session.items) {
      const q = questionOf(item.qid);
      if (!q) continue;
      if (q.type === 'fill' || q.type === 'short') {
        if (((session.picked || {})[item.qid + ':t'] || '').trim()) answered++;
      } else if (((session.picked || {})[item.qid] || []).length) answered++;
    }
    session.answeredCount = answered;
    session.results = results;
    session.elapsed = Math.round((Date.now() - session.startedAt) / 1000);
    markFinished();
    flushSave();
    if (auto) toast('已交卷');
    render();
  }

  function nextQuestion() {
    const card = document.getElementById('qzcard');
    const go = () => { session.idx++; saveSessionNow(); render(); };
    if (!card) { go(); return; }
    card.classList.add('leave');
    setTimeout(go, 150);
  }

  function record(q, res) {
    session.results[q.id] = res.ok ? { ok: true } : { ok: false, right: res.right, got: res.got };
    if (session.skipped) session.skipped = session.skipped.filter((id) => id !== q.id);
    if (!res.ok) {
      wrongBook[bank.key] = wrongBook[bank.key] || {};
      wrongBook[bank.key][q.id] = (wrongBook[bank.key][q.id] || 0) + 1;
      saveWrong();
    }
    scheduleSave();
  }

  // ---------------------------------------------------------------- 结束页
  function renderDone(root) {
    if (!session) { renderSetup(root); return; }
    const total = session.items.length;
    const results = session.results || {};
    const right = Object.values(results).filter((r) => r.ok).length;
    const answered = session.mode === 'exam' ? (session.answeredCount || 0) : Object.keys(results).length;
    const pct = total ? Math.round(right / total * 100) : 0;
    const mins = session.mode === 'exam'
      ? Math.max(1, Math.round((session.elapsed || 0) / 60))
      : Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    const exam = session.mode === 'exam';
    const skippedIds = session.skipped || [];
    const wrongIds = session.items.map((it) => it.qid).filter((id) => !(results[id] && results[id].ok) && !skippedIds.includes(id));
    const review = exam ? `<div class="exam-review">${session.items.map((it) => {
      const q = questionOf(it.qid); if (!q) return '';
      const r = results[it.qid];
      const ok = r && r.ok;
      return `<div class="er"><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'}</span><span class="id">${esc(q.id)}</span><span class="a">${esc((q.answer && q.answer.text) || '')}</span></div>`;
    }).join('')}</div>` : '';
    const wk = wrongOf();
    root.innerHTML = `
      <div class="qz-done">
        <div class="big">${pct}%</div>
        <div class="sm">${exam ? '交卷' : '本组结束'} · ${right} 对 · ${total - right} 错${exam ? ` · 未答 ${Math.max(0, total - answered)}` : ''}${skippedIds.length ? ` · 跳过 ${skippedIds.length}` : ''} · ${mins} 分钟</div>
        <div class="row">
          ${wrongIds.length ? `<button id="qz-again-wrong" class="qz-btn">重刷错的 ${wrongIds.length} 题</button>` : ''}
          <button id="qz-again" class="qz-btn ghost">${exam ? '再考一次' : '再来一组'}</button>
        </div>
        <div class="row"><button id="qz-wrongbook2" class="qz-btn ghost">错题本（${Object.keys(wk).length}）</button></div>
        ${skippedIds.length ? `<div class="row"><button id="qz-redo-skip" class="qz-btn ghost">重刷跳过的 ${skippedIds.length} 题</button></div>` : ''}
        ${review}
      </div>`;
    const b1 = $('#qz-again-wrong', root);
    if (b1) b1.addEventListener('click', () => { buzz(10); startWrongOnly(wrongIds); });
    $('#qz-again', root).addEventListener('click', () => { buzz(8); dropSession(bank.key); session = null; pendingResume = null; render(); });
    const b2 = $('#qz-wrongbook2', root);
    if (b2) b2.addEventListener('click', () => { buzz(6); if (deps.gotoWrong) deps.gotoWrong(); });
    const b3 = $('#qz-redo-skip', root);
    if (b3) b3.addEventListener('click', () => { buzz(10); startWrongOnly(skippedIds); });
  }

  function startWrongOnly(ids) {
    const qs = ids.map((id) => bank.questions.find((q) => q.id === id)).filter(Boolean);
    if (!qs.length) return;
    const items = buildItems(qs, setup.shuffle);
    session = { bankKey: bank.key, mode: 'wrong', amount: ids.length, shuffle: setup.shuffle, ids: qs.map((q) => q.id), idx: 0, finished: false, results: {}, startedAt: Date.now(), items };
    saveSessionNow();
    render();
  }

  // ---------------------------------------------------------------- 错题本页
  function renderWrong(root) {
    if (!root) root = $('#wrongroot');
    if (!root) return;
    if (!bank) { root.innerHTML = '<div class="empty"><b>还没有题库</b><br>导入一份 .docx 再来。</div>'; return; }
    const wk = wrongOf();
    const list = Object.keys(wk).sort((a, b) => wk[b] - wk[a])
      .map((id) => ({ q: questionOf(id), n: wk[id] })).filter((x) => x.q);
    if (!list.length) {
      root.innerHTML = `<div class="wrong-h"><span class="t">错题本</span><span style="font-size:12px;color:var(--muted)">0 题</span></div>
        <div class="empty">还没有错题。<br>刷题答错的会自动收进来。</div>`;
      return;
    }
    root.innerHTML = `<div class="wrong-h"><span class="t">错题本 · ${list.length} 题</span>
        <span><button class="ghost" id="wq-all">刷全部</button> <button class="ghost" id="wq-clear">清空</button></span>
      </div>
      ${list.map(({ q, n }) => {
        const open = expanded.has(q.id);
        const opts = (q.options || []).map((o) => `<div class="wq-opt"><b>${o.key}</b>${rich(o.content)}</div>`).join('');
        return `<div class="wq ${open ? 'open' : ''}" data-id="${esc(q.id)}">
          <div class="wq-h"><span class="pill t-${q.type}">${TYPE_NAME[q.type] || '题'}</span><span class="qid">${esc(q.id)}</span><span class="wq-n">错 ${n} 次</span></div>
          <div class="wq-stem">${rich(q.stem)}</div>
          <div class="wq-ans">答案：${esc((q.answer && q.answer.text) || '（缺）')}</div>
          <div class="wq-more">${opts}${q.explanation ? `<div class="hint">解析：${esc(plain(q.explanation))}</div>` : ''}</div>
        </div>`;
      }).join('')}`;
    $$('.wq', root).forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.id;
      buzz(5);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      el.classList.toggle('open');
    }));
    $('#wq-all', root).addEventListener('click', () => {
      buzz(12);
      startWrongOnly(list.map((x) => x.q.id));
      if (deps.gotoQuiz) deps.gotoQuiz();
    });
    $('#wq-clear', root).addEventListener('click', () => {
      if (!confirm('清空这个题库的错题本？')) return;
      buzz([0, 20, 40, 20]);
      delete wrongBook[bank.key]; saveWrong();
      renderWrong(root); render();
    });
  }

  // ---------------------------------------------------------------- 对外
  function mount(d) {
    deps = d;
    loadLibrary();
    loadWrong();
    loadMarks();
    loadHistory();
    if (lib.current && lib.banks[lib.current]) bank = lib.banks[lib.current];
    else {
      const keys = Object.keys(lib.banks);
      if (keys.length) { lib.current = keys[0]; bank = lib.banks[lib.current]; }
    }
    if (bank) {
      const s = sessionsMap()[bank.key];
      if (s && s.bankKey === bank.key && !s.finished) pendingResume = s;
    }
    const qsm = $('#qz-mask');
    if (qsm) qsm.addEventListener('click', closeMap);
    const qsx = $('#qs-close');
    if (qsx) qsx.addEventListener('click', closeMap);
    try {
      window.addEventListener('pagehide', flushSave);
      document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
    } catch (e) { /* ignore */ }
    if (deps.onBankChange) deps.onBankChange(bank);
    render();
  }

  global.QuizUI = {
    mount, addBank, render, syncChrome, renderWrong, openSheet, closeSheet, renderSheet,
    startSession, deleteBank,
    getCurrentBank: () => bank,
    getLibrary: () => lib,
    getMarks: () => (bank ? (marks[bank.key] || {}) : {}),
    setMark,
    getHistory: () => (bank ? (history[bank.key] || []) : []),
    clearHistory: () => { if (bank) { delete history[bank.key]; saveHistory(); } },
    __test: { judge, judgeFill, norm, buildItems, splitParts, wrongOf },
  };
})(typeof window !== 'undefined' ? window : globalThis);
