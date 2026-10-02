'use strict';
/* ================= 基础设施 ================= */
const $app = document.getElementById('app');

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const flat = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false);
  for (const c of flat) el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/* ---------- 身份（本地保存，方便演示三种角色） ---------- */
const ROLE_LABEL = { admin: '管理员', manager: '负责人', staff: '后厨员工' };
let identity = JSON.parse(localStorage.getItem('zg_identity') || 'null');
if (!identity || !identity.role) identity = { role: 'staff', name: '后厨员工·李厨' };
function saveIdentity() { localStorage.setItem('zg_identity', JSON.stringify(identity)); }

/* ---------- API ---------- */
async function api(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  headers['X-Role'] = identity.role;
  headers['X-User-Name'] = encodeURIComponent(identity.name);
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  let data = null;
  try { data = await res.json(); } catch (_) { /* 非 JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------- Toast ---------- */
const toastRoot = document.getElementById('toast-root');
function toast(msg, type = 'info', ms = 2400) {
  const t = h('div', { class: `toast ${type}` }, msg);
  toastRoot.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- Modal ---------- */
const modalRoot = document.getElementById('modal-root');
function openModal({ title, body, okText, cancelText = '取消', onOk, danger }) {
  let closed = false;
  const close = () => { if (!closed) { closed = true; mask.remove(); } };
  const btns = [h('button', { class: 'btn', onClick: close }, cancelText)];
  if (okText) {
    btns.push(h('button', {
      class: `btn ${danger ? 'danger' : 'primary'}`,
      onClick: async () => { try { const r = onOk && await onOk(close); if (r !== false) close(); } catch (e) { toast(e.message, 'err'); } }
    }, okText));
  }
  const mask = h('div', { class: 'modal-mask', onClick: e => { if (e.target === mask) close(); } },
    h('div', { class: 'modal' },
      title ? h('h4', null, title) : null,
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'btns' }, btns)
    )
  );
  modalRoot.appendChild(mask);
  return close;
}
/* 确认弹窗：点“确定”resolve(true)，取消/点遮罩 resolve(false) */
function confirmDialog(text, opts = {}) {
  return new Promise(resolve => {
    let decided = false;
    openModal({
      title: opts.title || '操作确认',
      danger: opts.danger,
      okText: opts.okText || '确定',
      body: opts.body || h('p', { style: 'margin:4px 0 0;font-size:14px;line-height:1.6' }, text),
      onOk: () => { decided = true; resolve(true); },
      cancelText: '取消'
    });
    // 取消（按钮或遮罩关闭）轮询兜底；确定时也要停掉轮询
    const timer = setInterval(() => {
      if (decided) { clearInterval(timer); return; }
      if (!document.querySelector('.modal-mask')) { resolve(false); clearInterval(timer); }
    }, 60);
  });
}

/* ---------- 大图查看 ---------- */
function lightbox(src) {
  const mask = h('div', { class: 'lightbox', onClick: e => { if (e.target === mask) mask.remove(); } },
    h('button', { class: 'close', onClick: () => mask.remove() }, '✕'),
    h('img', { src, alt: '' })
  );
  document.body.appendChild(mask);
}

/* ---------- 时间格式化 ---------- */
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtCountdown(deadline) {
  const diff = deadline - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor(abs % 86400000 / 3600000);
  const mins = Math.floor(abs % 3600000 / 60000);
  const parts = [];
  if (days) parts.push(`${days}天`);
  if (hours || days) parts.push(`${hours}小时`);
  parts.push(`${mins}分钟`);
  return { overdue: diff <= 0, text: parts.join('') };
}

const STATUS = {
  pending: { label: '待整改', cls: 'pending' },
  rectified: { label: '待复核', cls: 'rectified' },
  approved: { label: '已通过', cls: 'approved' },
  rejected: { label: '已退回', cls: 'rejected' }
};

/* ---------- 照片上传/预览组件 ---------- */
function photoUploader(max = 6) {
  const files = [];
  const grid = h('div', { class: 'photo-grid' });
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true,
    style: 'display:none',
    onChange: e => {
      const picked = [...e.target.files];
      const remain = max - files.length;
      if (picked.length > remain) toast(`最多上传 ${max} 张，已自动截选前 ${remain} 张`, 'err');
      for (const f of picked.slice(0, remain)) {
        if (!f.type.startsWith('image/')) { toast('仅支持图片文件，已自动跳过非图片', 'err'); continue; }
        if (f.size > 8 * 1024 * 1024) { toast(`「${f.name}」超过 8MB，已跳过`, 'err'); continue; }
        files.push(f);
      }
      fileInput.value = '';
      render();
    }
  });
  function render() {
    grid.innerHTML = '';
    files.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      grid.appendChild(h('div', { class: 'photo' },
        h('img', { src: url, alt: '预览', onClick: () => lightbox(url) }),
        h('button', {
          class: 'preview-remove', title: '移除',
          onClick: () => { files.splice(i, 1); URL.revokeObjectURL(url); render(); }
        }, '✕'),
        h('div', { class: 'tag' }, f.name.slice(0, 12))
      ));
    });
    if (files.length < max) {
      grid.appendChild(h('label', { class: 'uploader' },
        h('div', null, h('div', { class: 'plus' }, '＋'), h('div', null, '拍照/相册')),
        fileInput
      ));
    }
  }
  render();
  return { el: grid, files: () => files };
}

/* ================= 路由 ================= */
let countdownTimer = null;
function clearTimers() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }

function navigate(hash) { location.hash = hash; }

async function route() {
  clearTimers();
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [path0, query = ''] = raw.split('?');
  const path = path0;
  const params = Object.fromEntries(new URLSearchParams(query));
  $app.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    let m;
    if (path === '/' || path === '') return renderHome();
    if (path === '/new') return renderNew();
    if (path === '/tickets') return renderList(params);
    if (path === '/dashboard') return renderDashboard();
    if ((m = path.match(/^\/ticket\/([\w-]+)$/))) return renderDetail(m[1]);
    if (path === '/invalid') return renderInvalid();
    return renderInvalid(true);
  } catch (e) {
    $app.appendChild(h('div', { class: 'page' },
      h('div', { class: 'alert error big' }, `页面加载失败：${e.message}`),
      h('button', { class: 'btn block', onClick: () => navigate('#/') }, '返回首页')));
  }
}
window.addEventListener('hashchange', route);

/* ---------- 顶栏 ---------- */
function topbar(title, sub, { back = true } = {}) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'back-btn', title: '返回', onClick: () => history.back() }, '‹') : null,
    h('div', { class: 'title' }, title, sub ? h('small', null, sub) : null),
    h('button', {
      class: 'identity-chip',
      onClick: openIdentityModal,
      title: '切换身份'
    }, `${ROLE_LABEL[identity.role]} · ${identity.name.split('·').pop()}`)
  );
}

function openIdentityModal() {
  const roles = [
    { role: 'admin', icon: '🔍', desc: '巡检开单、上传问题照片、生成编号与二维码' },
    { role: 'manager', icon: '📊', desc: '查看汇总看板、复核整改、延期与退回' },
    { role: 'staff', icon: '👨‍🍳', desc: '扫码查看问题、上传整改照片' }
  ];
  let chosen = identity.role;
  const nameInput = h('input', { type: 'text', value: identity.name, maxlength: 20 });
  const cardsWrap = h('div', { class: 'role-cards' });
  function paint() {
    cardsWrap.innerHTML = '';
    roles.forEach(r => {
      cardsWrap.appendChild(h('button', {
        class: `role-card ${chosen === r.role ? 'on' : ''}`,
        onClick: () => { chosen = r.role; paint(); }
      },
        h('div', { class: 'ic' }, r.icon),
        h('div', null, h('b', null, ROLE_LABEL[r.role]), h('span', null, r.desc))));
    });
  }
  paint();
  openModal({
    title: '切换当前身份',
    body: h('div', null,
      cardsWrap,
      h('label', { class: 'fld', style: 'margin-top:12px' },
        h('span', null, '姓名 / 工号'), nameInput),
      h('p', { class: 'muted', style: 'margin:0' }, '提示：身份仅用于本机演示操作留痕。')),
    okText: '保存',
    onOk: () => {
      const name = nameInput.value.trim() || ROLE_LABEL[chosen];
      identity = { role: chosen, name };
      saveIdentity();
      toast('身份已切换', 'ok');
      route();
    }
  });
}

/* ================= 首页 ================= */
async function renderHome() {
  $app.appendChild(topbar('食堂后厨整改台', '检查 · 整改 · 复核闭环', { back: false }));
  const page = h('div', { class: 'page' });
  $app.appendChild(page);

  page.appendChild(h('div', { class: 'page-head' },
    h('h2', null, `你好，${identity.name.split('·').pop()}`),
    h('p', null, '今天也要把后厨的安全隐患整改到位 🍳')));

  // 角色快捷入口
  const quick = h('div', { class: 'card' }, h('h3', null, '快捷操作'), h('div', { class: 'row wrap' }));
  if (identity.role === 'admin') {
    quick.lastChild.appendChild(h('button', { class: 'btn primary', onClick: () => navigate('#/new') }, '📷 开整改单'));
    quick.lastChild.appendChild(h('button', { class: 'btn', onClick: () => navigate('#/tickets') }, '整改列表'));
  } else if (identity.role === 'manager') {
    quick.lastChild.appendChild(h('button', { class: 'btn primary', onClick: () => navigate('#/dashboard') }, '📊 汇总看板'));
    quick.lastChild.appendChild(h('button', { class: 'btn', onClick: () => navigate('#/tickets') }, '整改列表'));
  } else {
    quick.lastChild.appendChild(h('button', { class: 'btn primary', onClick: () => navigate('#/tickets?f=pending') }, '🧹 待我整改'));
    quick.lastChild.appendChild(h('button', { class: 'btn', onClick: () => navigate('#/tickets') }, '全部整改单'));
  }
  page.appendChild(quick);

  // 最近整改单
  page.appendChild(h('div', { class: 'page-head' }, h('h2', { style: 'font-size:16px' }, '最近整改单')));
  const box = h('div', null, h('div', { class: 'skeleton' }, '加载中…'));
  page.appendChild(box);
  try {
    const tickets = await api('/api/tickets');
    box.innerHTML = '';
    if (!tickets.length) {
      box.appendChild(h('div', { class: 'empty' }, h('span', { class: 'big-ic' }, '📋'), '暂无整改单，管理员快去开单吧'));
    } else {
      tickets.slice(0, 3).forEach(t => box.appendChild(ticketCard(t)));
    }
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'alert error big' }, `加载失败：${e.message}`));
  }
}

/* ---------- 整改单卡片 ---------- */
function ticketCard(t) {
  const st = STATUS[t.status];
  const imgs = t.issueImages.filter(i => !i.deleted);
  return h('button', { class: 'ticket-item', onClick: () => navigate(`#/ticket/${t.id}`) },
    h('div', { class: 'row' },
      h('span', { class: 'tid' }, t.id),
      h('span', { class: 'spacer' }),
      h('span', { class: `badge ${st.cls}` }, h('i', { class: 'dot' }), st.label),
      t.overdue ? h('span', { class: 'badge overdue' }, '已过期') : null),
    h('div', { class: 'desc2' }, `【${t.area}】${t.desc}`),
    h('div', { class: 'meta-line' },
      h('span', { class: 'points-tag' }, `扣 ${t.points} 分`),
      h('span', null, `🕓 截止 ${fmtTime(t.deadline).slice(5)}`),
      imgs.length ? h('span', null, `📷 ${imgs.length} 图`) : h('span', { style: 'color:#dc2626' }, '⚠ 图片缺失'))
  );
}

/* ================= 管理员开单 ================= */
function renderNew() {
  if (identity.role !== 'admin') {
    $app.appendChild(topbar('开整改单'));
    $app.appendChild(h('div', { class: 'page' },
      h('div', { class: 'alert warn big' }, '仅「管理员」身份可以开整改单，请先切换身份。'),
      h('button', { class: 'btn block', onClick: openIdentityModal }, '切换为管理员')));
    return;
  }
  $app.appendChild(topbar('开整改单', '巡检发现问题，拍照编号派单'));
  const page = h('div', { class: 'page' });
  $app.appendChild(page);

  const areas = ['灶台', '冰箱', '地面', '排烟罩', '操作台', '储物架', '其他'];
  const deadlines = [6, 12, 24, 48, 72];
  let area = '灶台';
  let deadlineHours = 24;

  const areaChips = h('div', { class: 'chip-group' });
  function paintAreas() {
    areaChips.innerHTML = '';
    areas.forEach(a => areaChips.appendChild(h('button', {
      type: 'button', class: `chip ${area === a ? 'on' : ''}`,
      onClick: () => { area = a; paintAreas(); }
    }, a)));
  }
  paintAreas();

  const dlChips = h('div', { class: 'chip-group' });
  function paintDl() {
    dlChips.innerHTML = '';
    deadlines.forEach(d => dlChips.appendChild(h('button', {
      type: 'button', class: `chip ${deadlineHours === d ? 'on' : ''}`,
      onClick: () => { deadlineHours = d; paintDl(); }
    }, `${d} 小时`)));
  }
  paintDl();

  const descInput = h('textarea', { placeholder: '例如：灶台表面有明显油污，火眼周边残渣未清理……', maxlength: 500 });
  const pointsInput = h('input', { type: 'number', min: '1', max: '100', value: '10' });
  const uploader = photoUploader(6);

  const errBox = h('div');
  const submitBtn = h('button', { class: 'btn primary block' }, '提交并生成整改编号');

  page.append(
    h('div', { class: 'card' },
      errBox,
      h('label', { class: 'fld' }, h('span', null, '检查区域 ', h('em', null, '*')), areaChips),
      h('label', { class: 'fld' }, h('span', null, '问题描述 ', h('em', null, '*')), descInput),
      h('div', { class: 'row', style: 'gap:14px;align-items:flex-start' },
        h('label', { class: 'fld', style: 'flex:1' }, h('span', null, '扣分（1-100）', h('em', null, '*')), pointsInput),
        h('div', { class: 'fld', style: 'flex:1.4' }, h('span', { class: 'fld' }, h('span', null, '整改时限')), dlChips))
    ),
    h('div', { class: 'card' },
      h('h3', null, '问题照片 ', h('span', { class: 'muted' }, '（1-6 张，单张 ≤ 8MB）')),
      uploader.el),
    submitBtn
  );

  submitBtn.addEventListener('click', async () => {
    errBox.innerHTML = '';
    const desc = descInput.value.trim();
    const points = Number(pointsInput.value);
    const files = uploader.files();
    if (!desc) return showFormErr(errBox, '请填写问题描述');
    if (!Number.isFinite(points) || points < 1 || points > 100) return showFormErr(errBox, '扣分值需在 1~100 之间');
    if (!files.length) return showFormErr(errBox, '请至少拍摄/上传 1 张问题照片');

    const fd = new FormData();
    fd.append('area', area); fd.append('desc', desc);
    fd.append('points', String(points)); fd.append('deadlineHours', String(deadlineHours));
    files.forEach(f => fd.append('photos', f));

    submitBtn.disabled = true;
    submitBtn.textContent = '提交中…';
    try {
      const t = await api('/api/tickets', { method: 'POST', body: fd });
      toast(`开单成功，编号 ${t.id}`, 'ok', 3000);
      navigate(`#/ticket/${t.id}`);
    } catch (e) {
      showFormErr(errBox, e.message);
      toast(e.message, 'err');
      submitBtn.disabled = false;
      submitBtn.textContent = '提交并生成整改编号';
    }
  });
}
function showFormErr(box, msg) {
  box.innerHTML = '';
  box.appendChild(h('div', { class: 'alert error' }, '⚠ ', msg));
}

/* ================= 整改列表 ================= */
async function renderList(param) {
  $app.appendChild(topbar('整改单列表'));
  const page = h('div', { class: 'page' });
  $app.appendChild(page);

  const filters = [
    { k: 'all', label: '全部' }, { k: 'pending', label: '待整改' },
    { k: 'rectified', label: '待复核' }, { k: 'approved', label: '已通过' },
    { k: 'rejected', label: '已退回' }, { k: 'overdue', label: '已过期' }
  ];
  let current = (param && param.f) || 'all';
  let keyword = '';
  const search = h('input', { type: 'text', placeholder: '搜索编号 / 区域 / 描述', style: 'margin-bottom:10px' });
  const chipsBar = h('div', { class: 'filters' });
  const listBox = h('div');

  function paintChips() {
    chipsBar.innerHTML = '';
    filters.forEach(f => chipsBar.appendChild(h('button', {
      class: `chip ${current === f.k ? 'on' : ''}`,
      onClick: () => { current = f.k; paintChips(); paintList(); }
    }, f.label)));
  }
  let all = [];
  function paintList() {
    listBox.innerHTML = '';
    let list = all.slice();
    if (current === 'overdue') list = list.filter(t => t.overdue);
    else if (current !== 'all') list = list.filter(t => t.status === current);
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(t =>
        t.id.toLowerCase().includes(k) || t.area.includes(keyword) || t.desc.toLowerCase().includes(k));
    }
    if (!list.length) {
      listBox.appendChild(h('div', { class: 'empty' }, h('span', { class: 'big-ic' }, '🗂️'), '没有符合条件的整改单'));
      return;
    }
    list.forEach(t => listBox.appendChild(ticketCard(t)));
  }
  search.addEventListener('input', () => { keyword = search.value.trim(); paintList(); });

  page.append(search, chipsBar, listBox);
  paintChips();
  listBox.appendChild(h('div', { class: 'skeleton' }, '加载中…'));
  try {
    all = await api('/api/tickets');
    paintList();
  } catch (e) {
    listBox.innerHTML = '';
    listBox.appendChild(h('div', { class: 'alert error big' }, `加载失败：${e.message}`));
  }
}

/* ================= 汇总看板（负责人） ================= */
async function renderDashboard() {
  $app.appendChild(topbar('汇总看板', '扣分 / 整改状态 / 完成率'));
  const page = h('div', { class: 'page' });
  $app.appendChild(page);
  const box = h('div', null, h('div', { class: 'skeleton' }, '加载中…'));
  page.appendChild(box);
  try {
    const s = await api('/api/stats');
    box.innerHTML = '';

    box.appendChild(h('div', { class: 'stat-grid' },
      statCard('teal', s.total, '整改单总数'),
      statCard('red', `-${s.totalPoints}`, '累计扣分'),
      statCard('green', `${s.completionRate}%`, '整改完成率（已通过）'),
      statCard('amber', s.overdue, '已过期未闭环')));

    const prog = h('div', { class: 'card' },
      h('h3', null, '整改进度'),
      progressRow('已通过', s.approved, s.total, '#16a34a'),
      progressRow('待复核', s.rectified, s.total, '#2563eb'),
      progressRow('待整改', s.pending, s.total, '#d97706'),
      progressRow('已退回', s.rejected, s.total, '#dc2626'),
      h('p', { class: 'muted', style: 'margin:8px 0 0' },
        `响应率（已提交整改）：${s.responseRate}% · 过期超期未闭环：${s.overdue} 单`));
    box.appendChild(prog);

    const areaCard = h('div', { class: 'card' }, h('h3', null, '区域扣分分布'));
    if (!s.byArea.length) {
      areaCard.appendChild(h('p', { class: 'muted' }, '暂无数据'));
    } else {
      const maxPts = Math.max(...s.byArea.map(a => a.points));
      s.byArea.forEach(a => {
        areaCard.appendChild(h('div', { class: 'area-row' },
          h('div', { class: 'lbl' },
            h('span', null, `${a.area}（${a.count} 单）`),
            h('span', { class: 'points-tag' }, `扣 ${a.points} 分`)),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(4, a.points / maxPts * 100)}%` }))));
      });
    }
    box.appendChild(areaCard);

    box.appendChild(h('div', { class: 'page-head' }, h('h2', { style: 'font-size:16px;margin:4px 0' }, '全部整改单')));
    const tickets = await api('/api/tickets');
    const listBox = h('div');
    tickets.forEach(t => listBox.appendChild(ticketCard(t)));
    box.appendChild(listBox);
  } catch (e) {
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'alert error big' }, `看板加载失败：${e.message}`));
  }
}
function statCard(cls, num, lbl) {
  return h('div', { class: `stat ${cls}` }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));
}
function progressRow(label, n, total, color) {
  const pct = total ? Math.round(n / total * 100) : 0;
  return h('div', { style: 'margin-bottom:8px' },
    h('div', { class: 'lbl', style: 'display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px' },
      h('span', null, label), h('span', { class: 'muted' }, `${n} 单 · ${pct}%`)),
    h('div', { class: 'progress' }, h('i', { style: `width:${pct}%;background:${color}` })));
}

/* ================= 整改单详情（员工扫码落地页） ================= */
async function renderDetail(id) {
  let t;
  try {
    t = await api(`/api/tickets/${id}`);
  } catch (e) {
    if (e.status === 404) return renderInvalid(false, e.message);
    throw e;
  }
  $app.appendChild(topbar('整改单详情', t.id));
  const page = h('div', { class: 'page' });
  $app.appendChild(page);

  const headCard = h('div', { class: 'card' });
  const cd = h('span', { class: 'countdown' });
  function refreshHead() {
    const st = STATUS[t.status];
    headCard.innerHTML = '';
    headCard.appendChild(h('div', { class: 'row' },
      h('h2', { style: 'margin:0;font-size:18px' }, `【${t.area}】问题整改`),
      h('span', { class: 'spacer' }),
      h('span', { class: `badge ${st.cls}` }, h('i', { class: 'dot' }), st.label)));
    const c = fmtCountdown(t.deadline);
    cd.className = 'countdown' + (c.overdue && t.status !== 'approved' ? ' urgent' : '');
    cd.textContent = (t.status === 'approved') ? '已闭环' : (c.overdue ? `已超期 ${c.text}` : `剩余 ${c.text}`);
    headCard.appendChild(h('div', { class: 'meta-line', style: 'margin-top:6px' },
      h('span', { class: 'points-tag' }, `扣 ${t.points} 分`),
      h('span', null, '🕓 截止 ', fmtTime(t.deadline)),
      cd));
  }
  refreshHead();
  page.appendChild(headCard);
  countdownTimer = setInterval(async () => {
    // 跨越截止时刻时自动重拉，保证过期提示/提交锁定即时生效
    const wasOverdue = t.overdue;
    try {
      const fresh = await api(`/api/tickets/${t.id}`);
      if (fresh.overdue !== wasOverdue) {
        t = fresh;
        renderDetailRaw(t);
      } else {
        refreshHead();
      }
    } catch (_) { refreshHead(); }
  }, 30000);

  // 过期链接提示条
  const overdueBox = h('div');
  function paintOverdue() {
    overdueBox.innerHTML = '';
    if (!t.overdue) return;
    const alert = h('div', { class: 'alert warn big' },
      h('div', null, '⏰ ', h('b', null, '该整改链接已过期！'),
        h('div', { style: 'margin-top:4px;font-weight:400' },
          `截止时间为 ${fmtTime(t.deadline)}，当前已超期。员工提交入口已锁定。`)));
    overdueBox.appendChild(alert);
    if (identity.role === 'manager' || identity.role === 'admin') {
      const chipRow = h('div', { class: 'row wrap', style: 'margin-top:8px' },
        h('span', { class: 'muted' }, '负责人可延期：'));
      [6, 12, 24, 48].forEach(hh => chipRow.appendChild(h('button', {
        class: 'btn sm warn-btn',
        onClick: async () => {
          try {
            t = await api(`/api/tickets/${t.id}/extend`, { method: 'POST', body: JSON.stringify({ hours: hh }) });
            toast(`已延期 ${hh} 小时，链接恢复有效`, 'ok');
            renderDetailRaw(t);
          } catch (e2) { toast(e2.message, 'err'); }
        }
      }, `+${hh}h`)));
      alert.firstChild.appendChild(chipRow);
    }
  }
  paintOverdue();
  page.appendChild(overdueBox);

  // 退回意见
  if (t.status === 'rejected' && t.reviewNote) {
    page.appendChild(h('div', { class: 'alert error big' },
      h('div', null, '🚫 ', h('b', null, '复核被退回：'), h('div', { style: 'margin-top:4px;font-weight:400' }, t.reviewNote))));
  }

  // 问题描述
  page.appendChild(h('div', { class: 'card' },
    h('h3', null, '🔎 问题描述'),
    h('p', { style: 'margin:0 0 10px;font-size:14px' }, t.desc),
    h('dl', { class: 'kv' },
      h('dt', null, '检查人'), h('dd', null, t.createdBy || '—'),
      h('dt', null, '开单时间'), h('dd', null, fmtTime(t.createdAt)))));

  // 问题照片
  const issueCard = h('div', { class: 'card' },
    h('h3', null, '📷 问题照片 ', h('span', { class: 'muted' }, `（${t.issueImages.filter(i => !i.deleted).length}/${t.issueImages.length}）`)));
  issueCard.appendChild(photoGrid(t, 'issue'));
  page.appendChild(issueCard);

  // 整改照片 & 提交入口
  const fixCard = h('div', { class: 'card' },
    h('h3', null, '🧹 整改照片', t.fixImages.length ? h('span', { class: 'muted' },
      `（${t.fixImages.filter(i => !i.deleted).length}/${t.fixImages.length}）`) : h('span', { class: 'muted' }, '（尚未提交）')));
  fixCard.appendChild(photoGrid(t, 'fix'));

  const canSubmit = identity.role === 'staff' && (t.status === 'pending' || t.status === 'rejected');
  if (canSubmit && !t.overdue) {
    const uploader = photoUploader(6);
    const submitBtn = h('button', { class: 'btn primary block', style: 'margin-top:12px' },
      t.status === 'rejected' ? '重新提交整改照片' : '提交整改照片');
    submitBtn.addEventListener('click', async () => {
      const files = uploader.files();
      if (!files.length) return toast('请先拍摄或选择整改后的照片', 'err');
      const doSubmit = async (force) => {
        const fd = new FormData();
        files.forEach(f => fd.append('photos', f));
        if (force) fd.append('force', 'true');
        submitBtn.disabled = true; submitBtn.textContent = '上传中…';
        try {
          t = await api(`/api/tickets/${t.id}/submit`, { method: 'POST', body: fd });
          toast('整改照片提交成功，等待负责人复核', 'ok', 3000);
          renderDetailRaw(t);
        } catch (e) {
          submitBtn.disabled = false;
          submitBtn.textContent = t.status === 'rejected' ? '重新提交整改照片' : '提交整改照片';
          if (e.code === 'EXPIRED') {
            openExpiredSubmitModal(e, () => doSubmit(true));
          } else {
            toast(e.message, 'err');
          }
        }
      };
      doSubmit(false);
    });
    fixCard.appendChild(h('div', { style: 'margin-top:12px' },
      h('p', { class: 'muted', style: 'margin:0 0 8px' }, '拍一下清理后的现场，提交后负责人会收到复核提醒。'),
      uploader.el, submitBtn));
  } else if (canSubmit && t.overdue) {
    fixCard.appendChild(h('div', { class: 'alert warn', style: 'margin-top:10px' },
      '链接已过期，无法提交整改照片，请联系负责人在本页延期后再试。'));
  } else if (t.status === 'pending' || t.status === 'rejected') {
    fixCard.appendChild(h('p', { class: 'muted', style: 'margin:10px 0 0' }, '后厨员工扫码后可在此上传整改照片。'));
  } else if (t.status === 'rectified') {
    fixCard.appendChild(h('div', { class: 'alert info', style: 'margin-top:10px' },
      `整改照片已于 ${fmtTime(t.submittedAt)} 由 ${t.submittedBy} 提交，等待负责人复核。`));
  }
  page.appendChild(fixCard);

  // 复核结论
  if (t.status === 'approved') {
    page.appendChild(h('div', { class: 'card' },
      h('h3', null, '✅ 复核结论'),
      h('dl', { class: 'kv' },
        h('dt', null, '复核人'), h('dd', null, t.reviewedBy || '—'),
        h('dt', null, '复核时间'), h('dd', null, fmtTime(t.reviewedAt)),
        h('dt', null, '意见'), h('dd', null, t.reviewNote || '整改到位，复核通过。'))));
  }

  // 二维码 + 复核操作（管理员/负责人）
  if (identity.role === 'admin' || identity.role === 'manager') {
    page.appendChild(qrCard(t));
  }
  const actionBar = h('div', { class: 'action-bar' });
  if ((identity.role === 'manager' || identity.role === 'admin') && t.status === 'rectified') {
    actionBar.appendChild(h('button', {
      class: 'btn danger', style: 'flex:1',
      onClick: () => rejectFlow(t, nt => { t = nt; renderDetailRaw(t); })
    }, '退回重改'));
    actionBar.appendChild(h('button', {
      class: 'btn primary', style: 'flex:2',
      onClick: async () => {
        try {
          t = await api(`/api/tickets/${t.id}/review`, { method: 'POST', body: JSON.stringify({ pass: true, note: '' }) });
          toast('已复核通过，整改闭环', 'ok');
          renderDetailRaw(t);
        } catch (e) { toast(e.message, 'err'); }
      }
    }, '✅ 复核通过'));
  }
  if (actionBar.children.length) page.appendChild(actionBar);

  // 操作留痕
  const histCard = h('div', { class: 'card' }, h('h3', null, '🕘 操作记录'));
  const ul = h('ul', { class: 'timeline' });
  (t.history || []).slice().reverse().forEach(item => {
    ul.appendChild(h('li', null,
      h('div', null, item.text),
      h('div', { class: 't-time' }, `${fmtTime(item.at)} · ${item.by}`)));
  });
  histCard.appendChild(ul);
  page.appendChild(histCard);
}

// 详情页整体重绘（保留滚动位置）
function renderDetailRaw(t) {
  $app.innerHTML = '';
  clearTimers();
  renderDetail(t.id);
}

/* 过期提交确认弹窗 */
function openExpiredSubmitModal(err, onForce) {
  openModal({
    title: '⏰ 整改链接已过期',
    danger: true,
    okText: '仍要提交（超期留痕）',
    cancelText: '联系负责人延期',
    body: h('div', null,
      h('p', { style: 'font-size:14px;line-height:1.6' }, err.message),
      h('p', { class: 'muted', style: 'font-size:12.5px' },
        '建议先联系负责人延期；如确需现在提交，系统将记录为“超期提交”。')),
    onOk: () => onForce()
  });
}

/* 退回流程（必须填意见） */
function rejectFlow(t, done) {
  const ta = h('textarea', { placeholder: '请说明退回原因，例如：只擦了表面，油垢仍在……', maxlength: 200 });
  openModal({
    title: '退回重新整改',
    danger: true,
    okText: '确认退回',
    body: h('div', null,
      h('p', { class: 'muted', style: 'margin-top:0' }, '退回后员工将收到提醒并可重新上传整改照片。'),
      ta),
    onOk: async () => {
      const note = ta.value.trim();
      if (!note) { toast('请填写退回原因', 'err'); return false; }
      try {
        const nt = await api(`/api/tickets/${t.id}/review`, { method: 'POST', body: JSON.stringify({ pass: false, note }) });
        toast('已退回并通知员工重新整改', 'ok');
        done(nt);
      } catch (e) { toast(e.message, 'err'); return false; }
    }
  });
}

/* 二维码卡片 */
function qrCard(t) {
  const card = h('div', { class: 'card qr-box' },
    h('h3', { style: 'justify-content:center' }, '🏷️ 员工扫码整改'),
    h('img', {
      alt: '整改二维码',
      src: `/api/tickets/${t.id}/qrcode?t=${t.createdAt}`,
      style: 'border:1px solid var(--border);border-radius:10px;background:#fff;padding:6px',
      onError: () => toast('二维码加载失败，请检查网络后刷新', 'err')
    }),
    h('div', { class: 'link', id: 'qr-link' }),
    h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' },
      h('button', {
        class: 'btn sm',
        onClick: () => {
          const link = `${location.origin}/#/ticket/${t.id}`;
          navigator.clipboard?.writeText(link).then(
            () => toast('整改链接已复制', 'ok'),
            () => toast('复制失败，请手动长按链接复制', 'err'));
        }
      }, '复制整改链接'),
      h('button', {
        class: 'btn sm',
        onClick: async function () {
          try {
            const r = await fetch(`/api/tickets/${t.id}/qrcode?t=${Date.now()}`);
            if (!r.ok) throw new Error('生成失败');
            const url = URL.createObjectURL(await r.blob());
            const a = h('a', { href: url, download: `${t.id}-qrcode.svg` });
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast('二维码已重新生成并下载', 'ok');
          } catch (e) { toast('二维码重新生成失败，请重试', 'err'); }
        }
      }, '🔄 重新生成')));
  card.querySelector('#qr-link').textContent = `${location.origin}/#/ticket/${t.id}`;
  return card;
}

/* 照片网格（含删除/替换操作） */
function photoGrid(t, group) {
  const images = group === 'issue' ? t.issueImages : t.fixImages;
  const grid = h('div', { class: 'photo-grid' });
  if (!images.length) {
    grid.appendChild(h('div', { class: 'empty', style: 'grid-column:1/-1;padding:20px' }, '暂无照片'));
    return grid;
  }
  const canManageIssue = identity.role === 'admin';
  const canManageFix = identity.role === 'admin' || identity.role === 'manager' ||
    (identity.role === 'staff' && ['pending', 'rejected'].includes(t.status));
  const canReplace = group === 'issue' ? identity.role === 'admin'
    : (identity.role === 'admin' || (identity.role === 'staff' && ['pending', 'rejected'].includes(t.status)));

  images.forEach(img => {
    const box = h('div', { class: `photo ${img.deleted ? 'deleted' : ''}` });
    box.appendChild(h('img', {
      src: img.url, alt: img.label,
      onClick: () => { if (!img.deleted) lightbox(img.url); }
    }));
    if (img.deleted) {
      box.appendChild(h('div', { class: 'deleted-mask' }, '🗑️ 已删除',
        h('span', { style: 'font-weight:400;font-size:10px' }, img.deletedBy ? `by ${img.deletedBy.split('·').pop()}` : '')));
    } else {
      const actions = h('div', { class: 'actions' });
      if ((group === 'issue' ? canManageIssue : canManageFix)) {
        actions.appendChild(h('button', {
          class: 'icon-btn', title: '删除图片',
          onClick: () => deleteImageFlow(t, img)
        }, '🗑'));
      }
      if (canReplace) {
        actions.appendChild(h('button', { class: 'icon-btn', title: '重新上传', onClick: () => replaceImageFlow(t, img) }, '↻'));
      }
      if (actions.children.length) box.appendChild(actions);
      box.appendChild(h('div', { class: 'tag' }, img.label));
    }
    grid.appendChild(box);
  });
  return grid;
}

/* 删除图片：二次确认 + 结果提示 */
async function deleteImageFlow(t, img) {
  const ok = await confirmDialog(null, {
    title: '删除图片',
    danger: true,
    okText: '确认删除',
    body: h('div', null,
      h('p', { style: 'font-size:14px;line-height:1.6;margin:4px 0' },
        `确定删除这张${img.label}吗？删除后该图片链接立即失效，且操作会记入操作记录。`),
      h('p', { class: 'muted', style: 'font-size:12.5px;margin:0' }, '如只是照片拍错了，建议使用「↻ 重新上传」直接替换。'))
  });
  if (!ok) return;
  try {
    const r = await api(`/api/tickets/${t.id}/images/${img.imageId}`, { method: 'DELETE' });
    toast('图片已删除，链接同步失效', 'ok');
    renderDetailRaw(r.ticket);
  } catch (e) {
    if (e.code === 'IMAGE_GONE') toast('该图片已被删除，列表可能不是最新的', 'err');
    else if (e.code === 'LAST_IMAGE') toast(e.message, 'err');
    else toast(`删除失败：${e.message}`, 'err');
  }
}

/* 重新上传图片：确认后选择新图替换 */
function replaceImageFlow(t, img) {
  const inp = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('仅支持上传图片文件', 'err');
    if (f.size > 8 * 1024 * 1024) return toast('图片不能超过 8MB，请压缩后重新上传', 'err');
    const ok = await confirmDialog(null, {
      title: '重新上传图片',
      okText: '确认替换',
      body: h('p', { style: 'font-size:14px;line-height:1.6;margin:4px 0' },
        `将用新图片「${f.name}」替换当前${img.label}，旧图片将被删除且原链接失效。`)
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append('photo', f);
    toast('正在上传替换…', 'info', 1200);
    try {
      const nt = await api(`/api/tickets/${t.id}/images/${img.imageId}/replace`, { method: 'POST', body: fd });
      toast('图片已重新上传，旧链接已失效', 'ok');
      renderDetailRaw(nt);
    } catch (e) {
      toast(`重新上传失败：${e.message}`, 'err');
    }
  });
  document.body.appendChild(inp);
  inp.click();
  setTimeout(() => inp.remove(), 60000);
}

/* ================= 无效/过期链接页 ================= */
function renderInvalid(unknown, message) {
  $app.appendChild(topbar('链接不可用', undefined, { back: false }));
  $app.appendChild(h('div', { class: 'page' },
    h('div', { class: 'card', style: 'text-align:center;padding:32px 20px' },
      h('div', { style: 'font-size:52px' }, unknown ? '🔗' : '⚠️'),
      h('h2', { style: 'margin:8px 0;font-size:19px' }, unknown ? '页面不存在' : '整改链接无效'),
      h('p', { class: 'muted', style: 'font-size:13.5px;line-height:1.7' },
        message || '您扫码打开的整改链接不存在或已被移除。请核对二维码，或联系管理员重新获取整改链接。'),
      h('div', { style: 'margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
        h('button', { class: 'btn primary', onClick: () => navigate('#/') }, '返回首页'),
        h('button', { class: 'btn', onClick: () => navigate('#/tickets') }, '查看整改列表')))));
}

/* ================= 启动 ================= */
document.title = '食堂后厨整改台';
route();
