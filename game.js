/* ============================================================
   许家印模拟器 · 终极版（网页版）
   玩法与数值规则移植自 许家印模拟器.py
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     常量
     --------------------------------------------------------- */
  const GOAL = 100;                 // 胜利目标：净资产 100 亿
  const INIT_REPUTATION = 50;
  const INIT_PRESTIGE = 50;
  const INIT_RATE = 0.08;           // 年化利率
  const INIT_LAND_PRICE = 1.0;      // 每块地价格（亿）
  const BUILD_COST = 0.5;           // 每栋楼建造成本（亿）
  const INIT_HOUSE_PRICE = 1.5;     // 每栋楼售价（亿）
  const MIN_LAND_PRICE = 0.3;
  const MIN_HOUSE_PRICE = 0.5;

  const RATING_LIMIT = { AAA: 50, AA: 30, A: 15, BBB: 8, B: 3 };

  // 结局判定用（原版为纯随机，这里让「已转移资产」产生实际收益）
  const BAILOUT_LUCK = 0.3;         // 临时技术性离婚并转移成功的概率
  const BAILOUT_RATIO_FRESH = 0.3;  // 临时转移：留下净值比例
  const BAILOUT_RATIO_READY = 0.5;  // 早已离婚：留下净值比例

  const STORE_BEST = 'xjy_sim_best_v1';
  const STORE_MUSIC = 'xjy_sim_music_v1';
  const STORE_VOLUME = 'xjy_sim_volume_v1';
  const BGM_SRC = 'bgm.mp3';          // 工作区自带的背景音乐（实际为单轨 AAC 的 MP4 容器）
  const DEFAULT_VOLUME = 0.45;
  const MAX_LOG_NODES = 240;

  /* ---------------------------------------------------------
     状态
     --------------------------------------------------------- */
  const state = {
    cash: 1.0,
    land: 0,
    buildings: 0,
    debt: 0,
    reputation: INIT_REPUTATION,
    prestige: INIT_PRESTIGE,
    day: 1,
    interestRate: INIT_RATE,
    landPrice: INIT_LAND_PRICE,
    housePrice: INIT_HOUSE_PRICE,
    creditRating: 'AAA',
    fraudExposed: false,
    wifeTransferred: false,
    dailyInterest: 0,
    over: false,
    companyName: '许总',
    stats: { events: 0, actions: 0, peakNet: 1, frauds: 0, transfers: 0, totalBorrowed: 0 }
  };

  /* ---------------------------------------------------------
     通用工具
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function fmt(n) {
    if (!isFinite(n)) return '0.00';
    const v = Math.abs(n) < 0.005 ? 0 : n;   // 抹掉 -0.00
    return v.toFixed(2);
  }
  function yi(n) { return fmt(n) + ' 亿'; }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }

  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  function totalAssets() {
    return state.cash + state.land * state.landPrice
         + state.buildings * (BUILD_COST + state.housePrice) / 2;
  }
  function netWorth() { return totalAssets() - state.debt; }

  function ratingOf(rep) {
    if (rep >= 80) return 'AAA';
    if (rep >= 50) return 'AA';
    if (rep >= 30) return 'A';
    if (rep >= 15) return 'BBB';
    return 'B';
  }
  function borrowLimit() { return RATING_LIMIT[state.creditRating] || 3; }
  function borrowAvailable() { return Math.max(0, borrowLimit() - state.debt); }
  function projectedDailyInterest() { return state.debt * state.interestRate / 365; }

  /* ---------------------------------------------------------
     日志
     --------------------------------------------------------- */
  const logScroll = $('logScroll');
  function log(msg, kind) {
    kind = kind || 'info';
    const el = document.createElement('div');
    el.className = 'log-entry ' + kind;
    const d = document.createElement('span');
    d.className = 'l-day';
    d.textContent = 'D' + state.day;
    const m = document.createElement('span');
    m.className = 'l-msg';
    m.innerHTML = msg;
    el.appendChild(d);
    el.appendChild(m);
    logScroll.appendChild(el);
    while (logScroll.children.length > MAX_LOG_NODES) logScroll.removeChild(logScroll.firstChild);
    requestAnimationFrame(() => { logScroll.scrollTop = logScroll.scrollHeight; });
  }

  /* ---------------------------------------------------------
     Toast 提示
     --------------------------------------------------------- */
  const toastsEl = $('toasts');
  function toast(msg, kind, icon) {
    kind = kind || 'info';
    if (!icon) {
      icon = { good: '✅', bad: '❌', warn: '⚠️', info: 'ℹ️' }[kind] || 'ℹ️';
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    const i = document.createElement('span'); i.className = 't-ico'; i.textContent = icon;
    const t = document.createElement('span'); t.className = 't-msg'; t.textContent = msg;
    el.appendChild(i); el.appendChild(t);
    toastsEl.appendChild(el);
    while (toastsEl.children.length > 4) toastsEl.removeChild(toastsEl.firstChild);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 240);
    }, 2600);
  }

  /* ---------------------------------------------------------
     数值看板渲染
     --------------------------------------------------------- */
  const watchEls = {};
  const lastVals = {};

  function registerWatch(name) {
    const node = document.querySelector('[data-watch="' + name + '"]');
    if (!node) return;
    watchEls[name] = { node: node, value: node.querySelector('.m-value, b') || node };
    lastVals[name] = null;
  }

  function flashValue(name, dir) {
    const w = watchEls[name];
    if (!w) return;
    w.value.classList.remove('value-up', 'value-down');
    void w.value.offsetWidth;
    w.value.classList.add(dir >= 0 ? 'value-up' : 'value-down');
    // 同时闪一下卡片边框
    const card = w.node.closest('.card');
    if (card) {
      card.classList.remove('flash');
      void card.offsetWidth;
      card.classList.add('flash');
    }
  }

  function render(silent) {
    const net = netWorth();
    const total = totalAssets();

    state.creditRating = ratingOf(state.reputation);

    // 顶部资金
    setText('statCash', fmt(state.cash) + '<i>亿</i>');
    setText('statDebt', fmt(state.debt) + '<i>亿</i>');
    setText('statNet', fmt(net) + '<i>亿</i>');
    setText('statLand', String(state.land));
    setText('statBuilding', String(state.buildings));
    setText('statLandPrice', fmt(state.landPrice) + ' 亿');
    setText('statHousePrice', fmt(state.housePrice) + ' 亿');
    setText('statRate', pct(state.interestRate));
    setText('statRating', state.creditRating);
    setText('dayNum', String(state.day));

    // 利息
    state.dailyInterest = projectedDailyInterest();
    const intBox = $('interestBox');
    intBox.querySelector('b').textContent = state.dailyInterest.toFixed(4) + ' 亿';
    const willBoom = state.debt > 0 && state.cash < state.dailyInterest;
    intBox.classList.toggle('safe', !willBoom);
    $('interestBox').firstElementChild.textContent = willBoom ? '💀 明日必爆' : '💸 日利息';

    // 进度条
    const gp = clamp(net / GOAL, 0, 1);
    $('goalFill').style.width = (gp * 100).toFixed(2) + '%';
    $('goalPct').textContent = (gp * 100).toFixed(1) + '%';
    document.querySelector('[data-watch="net"]').classList.toggle('negative', net < 0);

    // 信誉 / 声望
    setText('repVal', String(Math.round(state.reputation)));
    setText('presVal', String(Math.round(state.prestige)));
    $('repFill').style.width = clamp(state.reputation, 0, 100) + '%';
    $('presFill').style.width = clamp(state.prestige, 0, 100) + '%';

    // 差值高亮
    if (!silent) {
      if (lastVals.cash !== null && Math.abs(state.cash - lastVals.cash) > 1e-9) {
        flashValue('cash', state.cash - lastVals.cash);
      }
      if (lastVals.debt !== null && Math.abs(state.debt - lastVals.debt) > 1e-9) {
        // 负债增加对玩家是不利的，颜色反转
        flashValue('debt', lastVals.debt - state.debt);
      }
      if (lastVals.net !== null && Math.abs(net - lastVals.net) > 1e-9) {
        flashValue('net', net - lastVals.net);
      }
    }
    lastVals.cash = state.cash;
    lastVals.debt = state.debt;
    lastVals.net = net;
    lastVals.land = state.land;
    lastVals.building = state.buildings;

    document.title = 'D' + state.day + ' · 净资产 ' + fmt(net) + ' 亿 · 许家印模拟器';
  }

  function setText(id, html) {
    const el = $(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  /* ---------------------------------------------------------
     操作按钮定义
     --------------------------------------------------------- */
  const ACTIONS = [
    { key: '1', icon: '🏞️', name: '买地', desc: '囤地等涨价', accent: '#34d399', run: actBuyLand },
    { key: '2', icon: '🏗️', name: '盖楼', desc: '土地变房源', accent: '#38bdf8', run: actBuild },
    { key: '3', icon: '🏘️', name: '卖房', desc: '回款救现金', accent: '#f2c14e', run: actSell },
    { key: '4', icon: '💳', name: '借钱', desc: '加杠杆扩表', accent: '#fb923c', run: actBorrow },
    { key: '5', icon: '📢', name: '吸收资金', desc: '理财 / 商票 / 预售', accent: '#a78bfa', run: actAbsorb },
    { key: '6', icon: '💸', name: '还债', desc: '降负债涨信誉', accent: '#4ade80', run: actRepay },
    { key: '7', icon: '🛥️', name: '享乐', desc: '豪宅游艇球队', accent: '#f0abfc', run: actEnjoy },
    { key: '8', icon: '🎭', name: '欺骗系统', desc: '造假 / 转移 / 离婚', accent: '#f87171', run: actDeceive },
    { key: '9', icon: '💎', name: '买信誉', desc: '捐款与公关', accent: '#60a5fa', run: actBuyRep },
    { key: '10', icon: '⏭️', name: '跳过一天', desc: '静观其变', accent: '#94a3b8', run: actSkip, danger: false }
  ];

  function renderActions() {
    const grid = $('actionGrid');
    grid.innerHTML = '';
    ACTIONS.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action';
      btn.style.setProperty('--accent', a.accent);
      btn.style.setProperty('--accent-soft', hexA(a.accent, 0.22));
      btn.dataset.key = a.key;
      btn.innerHTML =
        '<span class="a-ico">' + a.icon + '</span>' +
        '<span class="a-body">' +
          '<span class="a-name">' + a.name + '</span>' +
          '<span class="a-desc">' + a.desc + '</span>' +
        '</span>' +
        '<span class="a-key">' + a.key + '</span>';
      btn.addEventListener('click', () => {
        if (state.over) return;
        a.run();
      });
      grid.appendChild(btn);
    });
  }

  function disableActions(flag) {
    document.querySelectorAll('.action').forEach((b) => { b.disabled = !!flag; });
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------------------------------------------------------
     弹窗系统
     --------------------------------------------------------- */
  const modalOverlay = $('modalOverlay');

  /** 打开弹窗；builder(api) 中用 api.option(...) 添加选项 */
  function openModal(title, build) {
    const panel = $('modalPanel');
    $('modalTitle').textContent = title;
    const body = $('modalBody');
    body.innerHTML = '';
    panel.classList.remove('shake');

    let closed = false;
    const api = {
      text(html) {
        const p = document.createElement('p');
        p.className = 'modal-text';
        p.innerHTML = html;
        body.appendChild(p);
        return p;
      },
      raw(node) { body.appendChild(node); return node; },
      option(o) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'opt' + (o.danger ? ' danger' : '');
        if (o.disabled) btn.disabled = true;
        btn.innerHTML =
          '<span class="o-ico">' + (o.icon || '•') + '</span>' +
          '<span class="o-body">' +
            '<span class="o-name">' + o.name + '</span>' +
            (o.desc ? '<span class="o-desc">' + o.desc + '</span>' : '') +
          '</span>' +
          (o.cost ? '<span class="o-cost">' + o.cost + '</span>' : '');
        btn.addEventListener('click', () => { if (!o.disabled) o.onPick(); });
        body.appendChild(btn);
        return btn;
      },
      body() { return body; },
      close() {
        if (closed) return;
        closed = true;
        modalOverlay.hidden = true;
        document.removeEventListener('keydown', onKey);
        if (api._onClose) api._onClose();
      },
      onClose(fn) { api._onClose = fn; },
      cancel(label) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-actions';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ghost';
        b.textContent = label || '取消';
        b.addEventListener('click', () => api.close());
        wrap.appendChild(b);
        body.appendChild(wrap);
        return b;
      }
    };

    // 构建弹窗内容（必须在使用 api 的闭包里调用）
    build(api);

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); api.close(); }
    }
    document.addEventListener('keydown', onKey);
    modalOverlay.hidden = false;
    return api;
  }

  function closeModal() {
    modalOverlay.hidden = true;
  }

  /* ---------------------------------------------------------
     数量选择弹窗（买地 / 盖楼 / 卖房 / 借钱 / 还债）
     --------------------------------------------------------- */
  function askAmount(cfg) {
    const modal = openModal(cfg.title, (ui) => {
      ui.text(cfg.note);

      const box = document.createElement('div');
      box.className = 'qty-box';
      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'step-btn'; minus.textContent = '−';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(cfg.min);
      input.max = String(cfg.max);
      input.step = String(cfg.step || 1);
      input.value = String(cfg.initial);
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'step-btn'; plus.textContent = '+';
      box.appendChild(minus); box.appendChild(input); box.appendChild(plus);
      ui.raw(box);

      const quick = document.createElement('div');
      quick.className = 'qty-row';
      (cfg.quick || []).forEach((q) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn tiny ghost';
        b.textContent = q.label;
        b.addEventListener('click', () => { input.value = String(q.value()); update(); });
        quick.appendChild(b);
      });
      if (quick.children.length) ui.raw(quick);

      const calc = document.createElement('div');
      calc.className = 'calc';
      ui.raw(calc);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn ghost'; cancel.textContent = '取消';
      const ok = document.createElement('button');
      ok.type = 'button'; ok.className = 'btn primary'; ok.textContent = cfg.confirmLabel || '确认';
      actions.appendChild(cancel); actions.appendChild(ok);
      ui.raw(actions);

      function value() {
        const v = Number(input.value);
        if (!isFinite(v)) return cfg.min;
        return v;
      }
      function update() {
        let v = value();
        const valid = v >= cfg.min - 1e-9 && v <= cfg.max + 1e-9;
        ok.disabled = !valid;
        const info = cfg.calc(v, valid);
        calc.innerHTML = info;
        calc.classList.toggle('bad', !valid);
      }

      minus.addEventListener('click', () => {
        input.value = String(clamp(Number((value() - (cfg.step || 1)).toFixed(4)), cfg.min, cfg.max));
        update();
      });
      plus.addEventListener('click', () => {
        input.value = String(clamp(Number((value() + (cfg.step || 1)).toFixed(4)), cfg.min, cfg.max));
        update();
      });
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); submit(); }
      });
      cancel.addEventListener('click', () => ui.close());
      ok.addEventListener('click', submit);

      function submit() {
        const v = value();
        if (v < cfg.min - 1e-9 || v > cfg.max + 1e-9) {
          $('modalPanel').classList.remove('shake');
          void $('modalPanel').offsetWidth;
          $('modalPanel').classList.add('shake');
          return;
        }
        ui.close();
        cfg.onConfirm(v);
      }

      update();
      setTimeout(() => { input.focus(); input.select(); }, 40);
    });
    return modal;
  }

  /* ---------------------------------------------------------
     动作实现
     --------------------------------------------------------- */

  // 1. 买地（不需要额外土地，上限由现金决定）
  function actBuyLand() {
    const max = Math.floor(state.cash / state.landPrice + 1e-9);
    if (max < 1) {
      log('想买地，但现金 ' + yi(state.cash) + ' 连一块（' + yi(state.landPrice) + '）都买不起。', 'warn');
      toast('现金不足，买不起地', 'warn');
      return;
    }
    askAmount({
      title: '🏞️ 买地 · 扩充土储',
      note: '当前地价 <b>' + yi(state.landPrice) + '</b>/块，可用现金 <b>' + yi(state.cash) + '</b>。',
      min: 1, max: max, initial: Math.min(3, max),
      confirmLabel: '签合同买地',
      quick: [
        { label: '1 块', value: () => 1 },
        { label: '5 块', value: () => Math.min(5, max) },
        { label: '一半现金', value: () => Math.max(1, Math.floor(max / 2)) },
        { label: '全部现金', value: () => max }
      ],
      calc: (v) => '花费 <b>' + yi(v * state.landPrice) + '</b> · 剩余现金 <b>'
        + yi(Math.max(0, state.cash - v * state.landPrice)) + '</b>',
      onConfirm: (v) => {
        const cost = v * state.landPrice;
        state.cash -= cost;
        state.land += v;
        state.stats.actions++;
        log('拍下 <b>' + v + '</b> 块地，花费 ' + yi(cost) + '，土储增至 ' + state.land + ' 块。', 'good');
        toast('买入 ' + v + ' 块地，花费 ' + yi(cost), 'good');
        endDay();
      }
    });
  }

  // 2. 盖楼
  function actBuild() {
    if (state.land <= 0) {
      log('没有土地，无法开工。先去买地吧。', 'warn');
      toast('没有土地，无法盖楼', 'warn');
      return;
    }
    const maxByCash = Math.floor(state.cash / BUILD_COST + 1e-9);
    const max = Math.min(state.land, maxByCash);
    if (max < 1) {
      log('现金 ' + yi(state.cash) + ' 不足以开工一栋（成本 ' + yi(BUILD_COST) + '）。', 'warn');
      toast('现金不足，无法开工', 'warn');
      return;
    }
    askAmount({
      title: '🏗️ 盖楼 · 开工建项目',
      note: '每栋建造成本 <b>' + yi(BUILD_COST) + '</b>，最多可开工 <b>' + max + '</b> 栋（土地 ' + state.land + ' 块 / 现金 ' + yi(state.cash) + '）。',
      min: 1, max: max, initial: max,
      confirmLabel: '开工',
      quick: [
        { label: '1 栋', value: () => 1 },
        { label: '一半', value: () => Math.max(1, Math.floor(max / 2)) },
        { label: '全部土地', value: () => max }
      ],
      calc: (v) => '建造成本 <b>' + yi(v * BUILD_COST) + '</b> · 可售房源 <b>'
        + (state.buildings + v) + '</b> 栋 · 剩余土地 <b>' + (state.land - v) + '</b> 块',
      onConfirm: (v) => {
        const cost = v * BUILD_COST;
        state.cash -= cost;
        state.land -= v;
        state.buildings += v;
        state.stats.actions++;
        log('开工 <b>' + v + '</b> 栋楼，投入 ' + yi(cost) + '，在建/可售 ' + state.buildings + ' 栋。', 'good');
        toast('开工 ' + v + ' 栋，投入 ' + yi(cost), 'good');
        endDay();
      }
    });
  }

  // 3. 卖房
  function actSell() {
    if (state.buildings <= 0) {
      log('手上没有可售房源，卖了个寂寞。', 'warn');
      toast('没有可售房源', 'warn');
      return;
    }
    askAmount({
      title: '🏘️ 卖房 · 回笼资金',
      note: '每栋售价 <b>' + yi(state.housePrice) + '</b>，可售 <b>' + state.buildings + '</b> 栋。',
      min: 1, max: state.buildings, initial: state.buildings,
      confirmLabel: '开卖',
      quick: [
        { label: '1 栋', value: () => 1 },
        { label: '一半', value: () => Math.max(1, Math.ceil(state.buildings / 2)) },
        { label: '全部', value: () => state.buildings }
      ],
      calc: (v) => '回款 <b>' + yi(v * state.housePrice) + '</b> · 剩余房源 <b>'
        + (state.buildings - v) + '</b> 栋 · 现金将达 <b>' + yi(state.cash + v * state.housePrice) + '</b>',
      onConfirm: (v) => {
        const rev = v * state.housePrice;
        state.cash += rev;
        state.buildings -= v;
        state.stats.actions++;
        log('售出 <b>' + v + '</b> 栋，回款 ' + yi(rev) + '，现金 ' + yi(state.cash) + '。', 'good');
        toast('卖出 ' + v + ' 栋，回款 ' + yi(rev), 'good');
        endDay();
      }
    });
  }

  // 4. 借钱
  function actBorrow() {
    const avail = borrowAvailable();
    if (avail <= 0.001) {
      log('信用评级 <b>' + state.creditRating + '</b>，额度已用尽（上限 ' + yi(borrowLimit()) + '，负债 ' + yi(state.debt) + '）。', 'bad');
      toast('借款额度已用尽', 'bad');
      return;
    }
    askAmount({
      title: '💳 借钱 · 银行开发贷',
      note: '信用评级 <b>' + state.creditRating + '</b>，负债上限 ' + yi(borrowLimit())
          + '，还可再借 <b>' + yi(avail) + '</b>。年化利率 ' + pct(state.interestRate) + '。',
      min: 0.1, max: avail, initial: Math.min(avail, Math.max(0.1, Number(avail.toFixed(2)))),
      step: 0.5, confirmLabel: '签字放款',
      quick: [
        { label: '1 亿', value: () => Math.min(1, avail) },
        { label: '5 亿', value: () => Math.min(5, avail) },
        { label: '一半额度', value: () => Math.max(0.1, Number((avail / 2).toFixed(2))) },
        { label: '全部额度', value: () => Number(avail.toFixed(2)) }
      ],
      calc: (v) => '到账 <b>' + yi(v) + '</b> · 总负债 <b>' + yi(state.debt + v)
        + '</b> · 日利息将增至 <b>' + ((state.debt + v) * state.interestRate / 365).toFixed(4) + ' 亿</b>',
      onConfirm: (v) => {
        state.cash += v;
        state.debt += v;
        state.stats.totalBorrowed += v;
        state.stats.actions++;
        log('银行放款 <b>' + yi(v) + '</b>，总负债 ' + yi(state.debt) + '，现金 ' + yi(state.cash) + '。', 'info');
        toast('借款 ' + yi(v) + '，总负债 ' + yi(state.debt), 'info', '🏦');
        endDay();
      }
    });
  }

  // 5. 吸收资金
  const ABSORB_METHODS = [
    {
      id: '1', icon: '💰', name: '高息理财', danger: true,
      desc: '承诺高回报快速吸金，未来需偿还 130%，信誉 −5',
      note: '到手 100%，但要还 130%。',
      run: (v) => ({
        cash: v, debt: v * 1.3, rep: -5,
        msg: '高息理财吸收 <b>' + yi(v) + '</b>，未来需偿还 <b>' + yi(v * 1.3) + '</b>，信誉 −5。',
        kind: 'warn', toast: '高息理财 +' + yi(v) + '（要还 ' + yi(v * 1.3) + '）'
      })
    },
    {
      id: '2', icon: '🧾', name: '商业承兑汇票', danger: true,
      desc: '拖延付款，只到手 80%，负债按全额计，信誉 −3',
      note: '开到手的票只有八成现金。',
      run: (v) => ({
        cash: v * 0.8, debt: v, rep: -3,
        msg: '商票融资实际到手 <b>' + yi(v * 0.8) + '</b>，负债增加 <b>' + yi(v) + '</b>，信誉 −3。',
        kind: 'warn', toast: '商票融资 +' + yi(v * 0.8) + '（负债 +' + yi(v) + '）'
      })
    },
    {
      id: '3', icon: '🏬', name: '预售房', danger: false,
      desc: '提前回款，负债仅计 50%，信誉 +3，但未来要交付',
      note: '购房者的钱最好拿，但楼得盖出来。',
      run: (v) => ({
        cash: v, debt: v * 0.5, rep: 3,
        msg: '预售回款 <b>' + yi(v) + '</b>，未来需交付，负债 +' + yi(v * 0.5) + '，信誉 +3。',
        kind: 'good', toast: '预售回款 +' + yi(v) + '，信誉 +3'
      })
    }
  ];

  function actAbsorb() {
    const ui = openModal('📢 吸收资金', (ui) => {
      ui.text('空手套白狼的艺术，选择你的融资方式：');
      ABSORB_METHODS.forEach((m) => {
        ui.option({
          icon: m.icon, name: m.name, desc: m.desc, danger: m.danger,
          onPick: () => { ui.close(); askAbsorbAmount(m); }
        });
      });
      ui.cancel('算了');
    });
    return ui;
  }

  function askAbsorbAmount(m) {
    askAmount({
      title: '📢 ' + m.name,
      note: m.note,
      min: 0.1, max: 999, initial: 5, step: 0.5,
      confirmLabel: '执行',
      quick: [
        { label: '1 亿', value: () => 1 },
        { label: '5 亿', value: () => 5 },
        { label: '20 亿', value: () => 20 }
      ],
      calc: (v) => {
        const r = m.run(v);
        return '现金 <b>+' + fmt(r.cash) + ' 亿</b> · 负债 <b>+' + fmt(r.debt) + ' 亿</b> · 信誉 <b>'
          + (r.rep >= 0 ? '+' : '') + r.rep + '</b>';
      },
      onConfirm: (v) => {
        const r = m.run(v);
        state.cash += r.cash;
        state.debt += r.debt;
        state.reputation = clamp(state.reputation + r.rep, 0, 100);
        state.stats.actions++;
        log(r.msg, r.kind);
        toast(r.toast, r.kind === 'good' ? 'good' : 'warn');
        endDay();
      }
    });
  }

  // 6. 还债
  function actRepay() {
    if (state.debt <= 0.001) {
      log('目前没有负债，难得清静。', 'info');
      toast('没有负债', 'info');
      return;
    }
    if (state.cash <= 0.001) {
      log('现金见底，想还也还不了。', 'bad');
      toast('现金不足', 'bad');
      return;
    }
    const max = Math.min(state.cash, state.debt);
    askAmount({
      title: '💸 还债 · 修复资产负债表',
      note: '现金 <b>' + yi(state.cash) + '</b>，负债 <b>' + yi(state.debt) + '</b>。还款可提升信誉（每笔 +2）。',
      min: 0.1, max: Number(max.toFixed(2)), initial: Number(max.toFixed(2)), step: 0.5,
      confirmLabel: '还款',
      quick: [
        { label: '1 亿', value: () => Math.min(1, max) },
        { label: '一半负债', value: () => Number((Math.min(state.debt, state.cash) / 2).toFixed(2)) },
        { label: '全部还清', value: () => Number(max.toFixed(2)) }
      ],
      calc: (v) => '剩余负债 <b>' + yi(Math.max(0, state.debt - v)) + '</b> · 剩余现金 <b>'
        + yi(Math.max(0, state.cash - v)) + '</b> · 信誉 <b>+' + (v > 0 ? 2 : 0) + '</b>',
      onConfirm: (v) => {
        state.cash -= v;
        state.debt -= v;
        if (state.debt < 0.005) state.debt = 0;
        state.reputation = clamp(state.reputation + 2, 0, 100);
        state.stats.actions++;
        log('偿还债务 <b>' + yi(v) + '</b>，剩余负债 ' + yi(state.debt) + '，信誉 +2。', 'good');
        toast('还债 ' + yi(v) + '，信誉 +2', 'good');
        endDay();
      }
    });
  }

  // 7. 享乐
  const LUXURIES = [
    { icon: '🏰', name: '买豪宅', cost: 1,   pres: 10, rep: 0, desc: '顶级大平层，面子里子都有' },
    { icon: '🛥️', name: '买游艇', cost: 0.5, pres: 5,  rep: 0, desc: '出海吹风，顺便避避风头' },
    { icon: '⚽', name: '买足球队', cost: 5, pres: 25, rep: 5, desc: '夺冠之夜，声望暴涨' },
    { icon: '💃', name: '养歌舞团', cost: 0.3, pres: 8,  rep: 0, desc: '文娱事业，陶冶情操' }
  ];

  function actEnjoy() {
    openModal('🌟 享乐系统', (ui) => {
      ui.text('现金 <b>' + yi(state.cash) + '</b>，声望 <b>' + Math.round(state.prestige) + '</b>。');
      LUXURIES.forEach((l) => {
        const can = state.cash >= l.cost;
        ui.option({
          icon: l.icon, name: l.name,
          desc: l.desc + ' · 声望 +' + l.pres + (l.rep ? ' · 信誉 +' + l.rep : ''),
          cost: can ? yi(l.cost) : '需 ' + yi(l.cost),
          disabled: !can,
          onPick: () => {
            ui.close();
            state.cash -= l.cost;
            state.prestige = clamp(state.prestige + l.pres, 0, 100);
            state.reputation = clamp(state.reputation + l.rep, 0, 100);
            state.stats.actions++;
            log('花 ' + yi(l.cost) + ' ' + l.name + '，声望 +' + l.pres + (l.rep ? '，信誉 +' + l.rep : '') + '。', 'good');
            toast(l.name + '成功，声望 +' + l.pres, 'good', l.icon);
            endDay();
          }
        });
      });
      ui.cancel('克制一下');
    });
  }

  // 8. 欺骗系统
  function actDeceive() {
    openModal('🎭 欺骗系统', (ui) => {
      ui.text('高风险高回报。一旦被查，信誉崩盘、暴雷时罪加一等。');

      ui.option({
        icon: '📄', name: '财务造假', danger: true,
        desc: '50% 成功：虚增现金 2 亿、信誉 −10｜50% 被查出：信誉 −30 并留案底',
        onPick: () => {
          ui.close();
          state.stats.actions++;
          if (Math.random() < 0.5) {
            state.cash += 2;
            state.reputation = clamp(state.reputation - 10, 0, 100);
            state.stats.frauds++;
            log('财务造假过关，虚增现金 <b>2.00 亿</b>，信誉 −10。', 'warn');
            toast('造假成功，虚增现金 2 亿', 'warn', '📄');
          } else {
            state.fraudExposed = true;
            state.reputation = clamp(state.reputation - 30, 0, 100);
            log('财务造假被会计师事务所查出！信誉 −30，<b>暴雷时罪加一等</b>。', 'bad');
            toast('造假被查出！信誉 −30', 'bad');
          }
          endDay();
        }
      });

      ui.option({
        icon: '✈️', name: '转移资产', danger: true,
        desc: '70% 成功：转移 30% 现金到海外、声望 +5｜30% 被发现：信誉 −15',
        onPick: () => {
          ui.close();
          state.stats.actions++;
          if (Math.random() < 0.7) {
            const t = state.cash * 0.3;
            state.cash -= t;
            state.prestige = clamp(state.prestige + 5, 0, 100);
            state.stats.transfers += t;
            log('通过离岸账户转移 <b>' + yi(t) + '</b> 资产，声望 +5。', 'warn');
            toast('成功转移 ' + yi(t) + ' 到海外', 'warn', '✈️');
          } else {
            state.reputation = clamp(state.reputation - 15, 0, 100);
            log('跨境资金流动被监测到，转移失败，信誉 −15。', 'bad');
            toast('转移资产被发现，信誉 −15', 'bad');
          }
          endDay();
        }
      });

      const done = state.wifeTransferred;
      ui.option({
        icon: '💔', name: '技术性离婚', danger: true,
        desc: done ? '已经离过了，不能再离一次' : '把资产转到配偶名下，信誉 −10；暴雷时可保住 50% 净值',
        disabled: done,
        cost: done ? '已完成' : '信誉 −10',
        onPick: () => {
          ui.close();
          state.wifeTransferred = true;
          state.reputation = clamp(state.reputation - 10, 0, 100);
          state.stats.actions++;
          log('办完<b>技术性离婚</b>手续，资产已部分转移至配偶名下，信誉 −10。', 'warn');
          toast('技术性离婚完成，信誉 −10', 'warn', '💔');
          endDay();
        }
      });

      ui.cancel('做个好人');
    });
  }

  // 9. 买信誉
  const MERCY = [
    { icon: '🤝', name: '慈善捐款', cost: 0.5, rep: 10, desc: '上新闻联播的那种' },
    { icon: '📺', name: '公关公关', cost: 1, rep: 20, desc: '媒体关系维护费用' }
  ];

  function actBuyRep() {
    openModal('💎 买信誉', (ui) => {
      ui.text('信誉影响信用评级，也就是你还能借到多少钱。当前评级 <b>' + state.creditRating + '</b>。');
      MERCY.forEach((m) => {
        const can = state.cash >= m.cost;
        ui.option({
          icon: m.icon, name: m.name, desc: m.desc,
          cost: can ? yi(m.cost) : '需 ' + yi(m.cost),
          disabled: !can,
          onPick: () => {
            ui.close();
            state.cash -= m.cost;
            state.reputation = clamp(state.reputation + m.rep, 0, 100);
            state.stats.actions++;
            log(m.name + '花费 ' + yi(m.cost) + '，信誉 +' + m.rep
                + '（现 ' + Math.round(state.reputation) + '，评级 ' + ratingOf(state.reputation) + '）。', 'good');
            toast(m.name + '，信誉 +' + m.rep, 'good', m.icon);
            endDay();
          }
        });
      });
      ui.cancel('算了');
    });
  }

  // 10. 跳过
  function actSkip() {
    log('按兵不动，静观市场变化。', 'muted');
    endDay();
  }

  /* ---------------------------------------------------------
     背景音乐
     --------------------------------------------------------- */
  function readNumStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      // 注意 Number(null) === 0，必须先判空再转换，否则读不到时不会回退到默认值
      if (raw === null || raw === '') return fallback;
      const v = Number(raw);
      return isFinite(v) ? v : fallback;
    } catch (e) { return fallback; }
  }
  function writeStore(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (e) { /* 隐私模式忽略 */ }
  }

  const music = {
    el: null,
    ready: false,          // 音频是否可用（文件缺失/解码失败则置 false）
    /* 默认开启：进入游戏（用户手势内）即播放，右上角 🎵 可关闭并记住选择 */
    wantPlay: readNumStore(STORE_MUSIC, 1) === 1,
    volume: clamp(readNumStore(STORE_VOLUME, DEFAULT_VOLUME), 0, 1)
  };

  function initMusic() {
    const btn = $('musicBtn');
    const slider = $('volume');
    if (!btn || !slider) return;

    slider.value = String(Math.round(music.volume * 100));
    paintVolume();

    // 音频元素延迟创建：避免在打不开音频时拖慢开局，也让「首次播放」发生在用户手势内
    btn.addEventListener('click', () => {
      if (!music.ready) music.ready = true;
      ensureAudio();
      music.wantPlay = !music.wantPlay;
      writeStore(STORE_MUSIC, music.wantPlay ? 1 : 0);
      if (music.wantPlay) playBgm(true); else pauseBgm();
      syncMusicUI();
      log(music.wantPlay ? '🎵 背景音乐已开启。' : '🔇 背景音乐已关闭。', 'muted');
    });

    slider.addEventListener('input', () => {
      music.volume = clamp(Number(slider.value) / 100, 0, 1);
      writeStore(STORE_VOLUME, music.volume);
      if (music.el) music.el.volume = music.volume;
      paintVolume();
      syncMusicUI();
    });

    const volBtn = $('volBtn');
    if (volBtn) volBtn.addEventListener('click', () => { music.el && (music.el.muted = !music.el.muted); syncMusicUI(); });

    syncMusicUI();
  }

  function paintVolume() {
    const slider = $('volume');
    if (slider) slider.style.setProperty('--vol', Math.round(music.volume * 100) + '%');
    const volBtn = $('volBtn');
    if (volBtn) volBtn.textContent = music.volume === 0 ? '🔇' : (music.volume < 0.5 ? '🔉' : '🔊');
  }

  function ensureAudio() {
    if (music.el) return music.el;
    const a = document.createElement('audio');
    a.src = BGM_SRC;
    a.loop = true;
    a.preload = 'auto';
    a.volume = music.volume;
    a.addEventListener('error', () => {
      music.ready = false;
      music.wantPlay = false;
      syncMusicUI();
      log('⚠️ 没能加载背景音乐 <b>' + BGM_SRC + '</b>（请确认文件与 index.html 在同一目录）。游戏可正常进行。', 'warn');
      toast('背景音乐加载失败，游戏不受影响', 'warn', '🎵');
    });
    music.el = a;
    // 挂进 DOM：避免某些浏览器对游离 audio 元素的播放/回收策略差异
    if (document.body && document.body.appendChild) document.body.appendChild(a);
    return a;
  }

  function playBgm(fromGesture) {
    const a = ensureAudio();
    const p = a.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 浏览器的自动播放限制：首次必须由用户手势触发
        if (fromGesture) {
          log('🔇 浏览器拦截了自动播放，点一下页面或右上角 🎵 即可开始播放。', 'muted');
        }
        syncMusicUI();
      });
    }
    syncMusicUI();
    return p;
  }

  function pauseBgm() {
    if (music.el) { try { music.el.pause(); } catch (e) { /* 忽略 */ } }
    syncMusicUI();
  }

  function syncMusicUI() {
    const btn = $('musicBtn');
    const ico = $('musicIco');
    if (!btn) return;
    const playing = !!(music.el && !music.el.paused && !music.el.ended);
    btn.classList.toggle('playing', playing);
    btn.classList.toggle('muted', !music.wantPlay || !music.ready);
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.title = playing ? '背景音乐：播放中（点击暂停）' : '背景音乐：已关闭（点击播放）';
    if (ico) ico.textContent = playing ? '🎶' : '🎵';
  }

  function startMusicFromGesture() {
    if (!music.wantPlay) { syncMusicUI(); return; }
    music.ready = true;
    writeStore(STORE_MUSIC, 1);   // 首次开局即记录「开启」意图，复访时开局也会自动播放
    playBgm(true);
  }

  /* ---------------------------------------------------------
     市场事件
     --------------------------------------------------------- */
  const EVENTS = [
    { icon: '🏦', name: '央行降准降息，信贷宽松！', kind: 'good',
      apply() { state.interestRate = Math.max(0.03, state.interestRate - 0.01);
                return '利率降至 <b>' + pct(state.interestRate) + '</b>，融资更容易了。'; } },
    { icon: '📉', name: '楼市调控加码，限购限贷！', kind: 'bad',
      apply() { state.housePrice *= 0.9;
                return '房价下跌，当前售价 <b>' + yi(state.housePrice) + '</b>/栋。'; } },
    { icon: '🏗️', name: '政府鼓励基建，土地供应增加！', kind: 'good',
      apply() { state.landPrice *= 0.85;
                return '地价下降，当前地价 <b>' + yi(state.landPrice) + '</b>/块。'; } },
    { icon: '📈', name: '房价上涨，销售回暖！', kind: 'good',
      apply() { state.housePrice *= 1.15;
                return '房价上涨，当前售价 <b>' + yi(state.housePrice) + '</b>/栋。'; } },
    { icon: '💀', name: '某房企暴雷，市场信心崩溃！', kind: 'bad',
      apply() { state.housePrice *= 0.8; state.landPrice *= 0.8;
                state.reputation = clamp(state.reputation - 10, 0, 100);
                return '资产贬值，信誉下降至 <b>' + Math.round(state.reputation) + '</b>。'; } },
    { icon: '🤝', name: '银行抽贷，融资渠道收紧！', kind: 'bad',
      apply() { state.interestRate += 0.02;
                return '融资困难，利率升至 <b>' + pct(state.interestRate) + '</b>。'; } },
    { icon: '📰', name: '媒体曝光房企高负债，舆论哗然！', kind: 'warn',
      apply() { state.reputation = clamp(state.reputation - 5, 0, 100);
                state.prestige = clamp(state.prestige - 5, 0, 100);
                return '舆论压力大，信誉降至 <b>' + Math.round(state.reputation)
                     + '</b>，声望降至 <b>' + Math.round(state.prestige) + '</b>。'; } }
  ];

  function rollEvent() {
    if (Math.random() >= 0.2) return;
    const ev = EVENTS[ri(0, EVENTS.length - 1)];
    const detail = ev.apply();
    state.stats.events++;
    log('📰 <b>市场事件：' + ev.name + '</b><br>' + ev.icon + ' ' + detail, 'big');
    toast(ev.name, ev.kind === 'good' ? 'good' : (ev.kind === 'bad' ? 'bad' : 'warn'), ev.icon);
  }

  /* ---------------------------------------------------------
     推进一天
     --------------------------------------------------------- */
  function endDay() {
    if (state.over) return;

    // 1) 暴雷判定（用当日起息前的现金 / 当日利息，与原版一致）
    const dailyInterest = state.debt * state.interestRate / 365;
    state.dailyInterest = dailyInterest;

    if (state.cash < dailyInterest && state.debt > 0) {
      return gameOver('boom');
    }

    // 2) 胜利判定
    if (netWorth() >= GOAL) {
      return gameOver('win');
    }

    // 3) 扣息
    state.cash -= dailyInterest;

    // 4) 市场事件
    rollEvent();

    // 5) 价格波动
    state.landPrice = Math.max(MIN_LAND_PRICE, Number((state.landPrice * (0.97 + Math.random() * 0.06)).toFixed(2)));
    state.housePrice = Math.max(MIN_HOUSE_PRICE, Number((state.housePrice * (0.97 + Math.random() * 0.06)).toFixed(2)));

    // 6) 信誉自然衰减
    state.reputation = Math.max(0, state.reputation - 1);

    state.day++;
    state.stats.peakNet = Math.max(state.stats.peakNet, netWorth());

    // 爆雷预警
    const nextInterest = state.debt * state.interestRate / 365;
    if (state.debt > 0 && state.cash < nextInterest * 2 && state.cash >= nextInterest) {
      log('⚠️ <b>现金 ' + yi(state.cash) + ' 已逼近日利息 ' + nextInterest.toFixed(4) + ' 亿，资金链命悬一线。</b>', 'warn');
      toast('资金链告急，尽快卖房或借钱！', 'warn', '🚨');
    }

    render();

    // 借新还旧提示
    if (state.debt > 0 && state.cash < state.debt * 0.02 && state.cash >= nextInterest) {
      toast('负债已达 ' + yi(state.debt) + '，利息吞噬现金中', 'info', '💳');
    }
  }

  /* ---------------------------------------------------------
     结局
     --------------------------------------------------------- */
  function gameOver(result) {
    state.over = true;
    disableActions(true);

    // 冻结结算快照：结局画面必须与该判定瞬间的数值一致（避免之后再取价算出「不到 100 亿的胜利」）
    const final = {
      result: result,
      net: netWorth(),
      cash: state.cash,
      debt: state.debt,
      land: state.land,
      buildings: state.buildings,
      reputation: Math.round(state.reputation),
      prestige: Math.round(state.prestige),
      interestRate: state.interestRate,
      creditRating: state.creditRating,
      day: state.day,
      events: state.stats.events,
      fraudExposed: state.fraudExposed,
      escaped: 0,
      bailoutRatio: 0,
      bailoutText: ''
    };

    if (result === 'win') {
      log('🎉🎉🎉 <b>净资产 ' + yi(final.net) + '，突破 100 亿！你成为地产大亨！</b>', 'big');
      toast('恭喜！净资产破百亿！', 'good', '🎉');
      return showEnding({
        win: true,
        emoji: '🎉',
        title: '净资产突破 100 亿！',
        desc: '交易对手们排队来送钱，评级机构连夜上调展望。'
            + '你站在总部顶楼，看着满城的楼，都是你的。<br>——至少报表上是。'
      }, final);
    }

    // 暴雷
    log('💥💥💥 <b>资金链断裂！债务暴雷！</b>', 'bad');
    log('债权人纷纷上门，项目停工，股价暴跌……', 'bad');
    if (state.fraudExposed) {
      log('⚠️ 财务造假已被查出，<b>罪加一等</b>！', 'bad');
    }
    toast('现金付不起日利息，暴雷了！', 'bad', '💥');

    // 资产转移结算
    let bailoutRatio = 0;
    let bailoutText = '';
    if (state.wifeTransferred) {
      bailoutRatio = BAILOUT_RATIO_READY;
      bailoutText = '✅ 你早已技术性离婚，配偶名下资产安然无恙。';
    } else if (Math.random() < BAILOUT_LUCK) {
      bailoutRatio = BAILOUT_RATIO_FRESH;
      bailoutText = '✅ 临时离婚转移成功！你带着部分资产远走他乡。';
    } else {
      bailoutRatio = 0;
      bailoutText = '❌ 转移失败！资产被冻结，你在机场被带走调查。';
    }
    const escaped = Math.max(0, final.net * bailoutRatio);
    final.escaped = escaped;
    final.bailoutRatio = bailoutRatio;
    final.bailoutText = bailoutText;
    log(bailoutText + ' 落袋 <b>' + yi(escaped) + '</b>。', bailoutRatio > 0 ? 'warn' : 'bad');

    showEnding({
      win: false,
      emoji: '💥',
      title: '债务暴雷，游戏结束',
      desc: bailoutText
    }, final);
  }

  function verdictFor(f) {
    const net = f.net, escaped = f.escaped;
    if (f.result === 'win') {
      if (f.fraudExposed) return '你是踩着假账登上神坛的。评级机构给你 AAA，检察院给你传票——<b>先赢后输的那种赢</b>。';
      if (f.debt > 500) return '百亿身家，千亿负债。<b>你不是在做地产，你在做杠杆行为艺术。</b>';
      return '真正的产业巨头，报表是真的一本账。<b>恭喜，你是这局里少数的体面人。</b>';
    }
    if (escaped > 0 && escaped >= 50) return '暴雷声中，你带着 <b>' + fmt(escaped) + ' 亿</b> 出了关。债权人彻夜难眠，你在南半球晒着太阳。<b>法律意义上，这局你没输。</b>';
    if (escaped > 0) return '你跑了，但只带走了 <b>' + fmt(escaped) + ' 亿</b>。够买个小岛，不够买回名声。';
    if (f.fraudExposed) return '假账、商票、高息理财，最后一起爆在你手上。<b>你不是输给了市场，是输给了自己那张报表。</b>';
    if (net < -100) return '近 <b>' + fmt(Math.abs(net)) + ' 亿</b> 的窟窿，一个时代的注脚。<b>规模确实做到了行业第一。</b>';
    return '债务到期那天，账上只剩 <b>' + fmt(f.cash) + ' 亿</b>，连利息都不够。<b>资金链从来不给你第二次机会。</b>';
  }

  function showEnding(o, f) {
    const net = f.net;
    const best = getBest();
    const isRecord = net > best;
    const bestNow = Math.max(best, net);
    setBest(bestNow);

    const escaped = f.escaped;
    const score = Math.max(net, 0) + escaped;

    openModal(o.win ? '🏆 结局 · 地产大亨' : '💥 结局 · 暴雷时刻', (ui) => {
      const hero = document.createElement('div');
      hero.className = 'final-hero';
      hero.innerHTML =
        '<span class="final-emoji' + (o.win ? '' : ' boom') + '">' + o.emoji + '</span>' +
        '<h3 class="final-title' + (o.win ? '' : ' lose') + '">' + o.title + '</h3>' +
        '<p class="final-desc">' + o.desc + '</p>';
      ui.raw(hero);

      const grid = document.createElement('div');
      grid.className = 'final-grid';
      const items = [
        ['最终净资产', fmt(net) + ' 亿', net >= 0 ? 'gold' : 'red'],
        ['现金余额', fmt(f.cash) + ' 亿', 'green'],
        ['剩余负债', fmt(f.debt) + ' 亿', f.debt > 0 ? 'red' : 'green'],
        ['土地 / 房源', f.land + ' 块 / ' + f.buildings + ' 栋', ''],
        ['经营天数', f.day + ' 天', ''],
        ['信誉 / 声望', f.reputation + ' / ' + f.prestige, ''],
        ['利率 / 评级', pct(f.interestRate) + ' / ' + f.creditRating, ''],
        ['市场事件', f.events + ' 次', '']
      ];
      if (escaped > 0) {
        items.splice(1, 0, ['成功转移资产', fmt(escaped) + ' 亿', 'gold']);
        items.push(['合计带出', fmt(score) + ' 亿', 'gold']);
      }
      items.forEach((it) => {
        const d = document.createElement('div');
        d.className = 'final-stat ' + it[2];
        d.innerHTML = '<span>' + it[0] + '</span><b>' + it[1] + '</b>';
        grid.appendChild(d);
      });
      ui.raw(grid);

      const v = document.createElement('div');
      v.className = 'verdict';
      v.innerHTML = verdictFor(f)
        + '<br><br>历史最佳净资产：<b>' + fmt(bestNow) + ' 亿</b>'
        + (isRecord ? ' 🎊 <b>新纪录！</b>' : '');
      ui.raw(v);

      const note = document.createElement('p');
      note.className = 'final-note';
      note.textContent = '以上为结局判定瞬间的结算数据；左侧看板停留在前一天收盘时的数值。';
      ui.raw(note);

      // 按钮
      const wrap = document.createElement('div');
      wrap.className = 'modal-actions';
      wrap.style.gridTemplateColumns = '1fr 1.4fr';

      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'btn ghost';
      replay.textContent = '查看日志';
      replay.addEventListener('click', () => ui.close());

      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn primary';
      again.textContent = '↻ 再开一局';
      again.addEventListener('click', () => {
        ui.close();
        startGame(state.companyName);
        startMusicFromGesture();   // 结局弹窗里的点击同样是用户手势，音乐可无缝续播
      });

      wrap.appendChild(replay);
      wrap.appendChild(again);
      ui.raw(wrap);
    });
  }

  /* ---------------------------------------------------------
     最高纪录
     --------------------------------------------------------- */
  function getBest() {
    try {
      const v = Number(localStorage.getItem(STORE_BEST));
      return isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function setBest(v) {
    try { localStorage.setItem(STORE_BEST, String(v)); } catch (e) { /* 忽略隐私模式 */ }
  }

  /* ---------------------------------------------------------
     开新局
     --------------------------------------------------------- */
  function startGame(name) {
    state.cash = 1.0;
    state.land = 0;
    state.buildings = 0;
    state.debt = 0;
    state.reputation = INIT_REPUTATION;
    state.prestige = INIT_PRESTIGE;
    state.day = 1;
    state.interestRate = INIT_RATE;
    state.landPrice = INIT_LAND_PRICE;
    state.housePrice = INIT_HOUSE_PRICE;
    state.creditRating = 'AAA';
    state.fraudExposed = false;
    state.wifeTransferred = false;
    state.dailyInterest = 0;
    state.over = false;
    state.companyName = name || '许总';
    state.stats = { events: 0, actions: 0, peakNet: 1, frauds: 0, transfers: 0, totalBorrowed: 0 };

    logScroll.innerHTML = '';
    toastsEl.innerHTML = '';
    closeModal();
    $('ceoLine').textContent = '董事长：' + state.companyName;
    $('introOverlay').hidden = true;
    $('game').hidden = false;
    disableActions(false);

    render();
    log('🏢 <b>' + state.companyName + ' 的地产帝国开张了。</b>', 'big');
    log('初始资金 ' + yi(state.cash) + '。目标：在暴雷前把净资产做到 <b>100 亿</b>，或者带着钱跑路。', 'info');
    toast('开局！先买地，再借钱，然后盖楼', 'info', '🏢');
  }

  /* ---------------------------------------------------------
     键盘快捷键
     --------------------------------------------------------- */
  function onGlobalKey(e) {
    if ($('game').hidden) return;
    if (!modalOverlay.hidden) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (state.over) return;

    if (e.code === 'Space') {
      e.preventDefault();
      actSkip();
      return;
    }
    const found = ACTIONS.find((a) => a.key === e.key);
    if (found) {
      e.preventDefault();
      found.run();
    }
  }

  /* ---------------------------------------------------------
     说明弹窗
     --------------------------------------------------------- */
  function showHelp() {
    openModal('❓ 玩法说明', (ui) => {
      ui.raw(mkHelp());
      ui.cancel('知道了');
    });
  }

  function mkHelp() {
    const d = document.createElement('div');
    d.innerHTML =
      '<p class="modal-text">目标是<b>净资产 100 亿</b>。净资产 = 现金 + 土地估值 + 房源估值 − 负债。</p>' +
      '<p class="modal-text">' +
        '<b>🏞️ 买地</b>：1 亿/块起，地价每天波动 ±3%。<br>' +
        '<b>🏗️ 盖楼</b>：每块地 0.5 亿建成 1 栋，房源估值按 (成本+售价)/2 计。<br>' +
        '<b>🏘️ 卖房</b>：按当前售价回款，是最稳定的现金流来源。<br>' +
        '<b>💳 借钱</b>：评级决定负债上限（AAA 50 亿 → B 3 亿），年化利率 8% 起。<br>' +
        '<b>📢 吸收资金</b>：高息理财（1 亿到手，还 1.3 亿）/ 商票（到手 80%，负债全额）/ 预售（负债仅计 50%）。<br>' +
        '<b>🎭 欺骗系统</b>：财务造假、转移资产、技术性离婚，高收益但会掉信誉，暴雷时罪加一等。<br>' +
        '<b>💎 买信誉</b>：捐款/公关换信誉，信誉决定你还能借多少钱。' +
      '</p>' +
      '<p class="modal-text">' +
        '<b>⚠️ 死亡条件</b>：每天先扣利息（负债 × 年化 / 365）。如果<b>现金 &lt; 当日利息</b> 且仍有负债，立刻暴雷出局。<br>' +
        '<b>📉 信誉每天自然 −1</b>，所以要靠还债、预售、公关维持。' +
      '</p>' +
      '<p class="modal-text">' +
        '<b>🏁 结局</b>：暴雷时若已技术性离婚，可保住 50% 净值；否则有 30% 概率临时转移成功（保 30%）。' +
        '转移出去的资产才是真正属于你的钱。' +
      '</p>';
    return d;
  }

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */
  function init() {
    ['cash', 'debt', 'net', 'land', 'building', 'landPrice', 'housePrice', 'rate'].forEach(registerWatch);
    renderActions();
    render();
    initMusic();

    const best = getBest();
    $('bestIntro').textContent = best > 0 ? fmt(best) + ' 亿' : '—';

    $('startBtn').addEventListener('click', () => {
      const name = ($('playerName').value || '').trim() || '许总';
      startGame(name);
      // 用户手势内启动：满足浏览器的自动播放策略，进入游戏即响起背景音乐
      startMusicFromGesture();
    });
    $('playerName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('startBtn').click();
    });

    $('helpBtn').addEventListener('click', showHelp);

    $('restartBtn').addEventListener('click', () => {
      openModal('↻ 重新开局', (ui) => {
        ui.text('当前进度会全部丢失，确定要从头再来吗？');
        ui.option({
          icon: '↻', name: '重新开始', desc: '现金回到 1 亿，天数回到第 1 天', danger: true,
          onPick: () => { ui.close(); startGame(state.companyName); startMusicFromGesture(); }
        });
        ui.cancel('继续经营');
      });
    });

    $('clearLogBtn').addEventListener('click', () => {
      logScroll.innerHTML = '';
      log('日志已清屏。', 'muted');
    });

    $('modalClose').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', onGlobalKey);

    // 开场页聚焦姓名
    setTimeout(() => { const n = $('playerName'); if (n) { n.focus(); n.select(); } }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
