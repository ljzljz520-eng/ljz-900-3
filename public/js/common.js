/* 公共工具: API 封装 / Toast / 弹窗 / 灯箱 / 时间 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const Api = {
  adminToken: localStorage.getItem('adminToken') || '',
  adminName: localStorage.getItem('adminName') || '',
  async req(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.adminToken) headers['X-Admin-Token'] = this.adminToken;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let res, data;
    try {
      res = await fetch(url, { ...opts, headers });
      data = await res.json();
    } catch (e) {
      Toast.show('网络异常，请检查连接后重试', 'error');
      throw e;
    }
    if (res.status === 401) {
      if (location.pathname.endsWith('admin.html') || location.pathname === '/admin') {
        this.clearAuth();
        Toast.show('登录已失效，请重新登录', 'warn');
        setTimeout(() => location.href = '/admin', 900);
      }
      throw Object.assign(new Error(data.msg || '未登录'), { data });
    }
    if (!res.ok || data.code !== 0) {
      const err = new Error(data.msg || `请求失败(${res.status})`);
      err.code = data.code; err.type = data.type; err.data = data;
      throw err;
    }
    return data.data;
  },
  get(u) { return this.req(u); },
  post(u, body) { return this.req(u, { method: 'POST', body }); },
  upload(url, formData) { return this.req(url, { method: 'POST', body: formData }); },
  del(url) { return this.req(url, { method: 'DELETE' }); },
  clearAuth() {
    this.adminToken = ''; this.adminName = '';
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminName');
  }
};

const Toast = {
  box: null,
  init() {
    if (this.box) return;
    this.box = document.createElement('div');
    this.box.id = 'toastBox';
    document.body.appendChild(this.box);
  },
  show(msg, type = 'info', duration = 2600) {
    this.init();
    const icons = { success: '✅', error: '⚠️', warn: '🔔', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(msg)}</span>`;
    this.box.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtFull(ts) {
  if (!ts) return '—';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function timeLeft(deadline) {
  const diff = deadline - Date.now();
  if (diff <= 0) {
    const h = Math.floor(-diff / 3600000);
    return { over: true, text: h >= 24 ? `已超期 ${Math.floor(h / 24)} 天 ${h % 24} 小时` : `已超期 ${h} 小时` };
  }
  const h = diff / 3600000;
  if (h >= 24) return { over: false, text: `剩余 ${Math.floor(h / 24)} 天 ${Math.floor(h % 24)} 小时` };
  if (h >= 1) return { over: false, text: `剩余 ${Math.floor(h)} 小时 ${Math.floor((h % 1) * 60)} 分` };
  return { over: false, text: `剩余 ${Math.max(1, Math.floor(diff / 60000))} 分钟` };
}

const STATUS = {
  pending:   { text: '待整改', cls: 'tag-pending' },
  submitted: { text: '待核验', cls: 'tag-submitted' },
  approved:  { text: '已完成', cls: 'tag-approved' },
  overdue:   { text: '已超期', cls: 'tag-overdue' }
};
const AREAS = ['灶台', '冰箱', '地面', '备餐台', '洗菜池', '储物架', '排烟系统', '其他'];

/* 灯箱 */
function initLightbox() {
  let lb = $('#lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = '<span class="close">&times;</span><img alt="预览">';
    document.body.appendChild(lb);
    lb.addEventListener('click', () => lb.classList.remove('show'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('show'); });
  }
  document.addEventListener('click', e => {
    if (e.target.matches('.photo img')) {
      lb.querySelector('img').src = e.target.src;
      lb.classList.add('show');
    }
  });
}

/* 确认弹窗: await confirmDialog('删除后不可恢复，确认删除？') */
function confirmDialog(msg, { title = '请确认', okText = '确认', danger = true } = {}) {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'mask show';
    mask.innerHTML = `<div class="modal">
      <h3>${danger ? '⚠️' : '❓'} ${escapeHtml(title)}</h3>
      <p class="tip" style="color:#374151">${escapeHtml(msg)}</p>
      <div class="row">
        <button class="btn btn-ghost" data-act="cancel">取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(okText)}</button>
      </div></div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.dataset.act === 'cancel') { mask.remove(); resolve(false); }
      if (e.target.dataset.act === 'ok') { mask.remove(); resolve(true); }
    });
  });
}

document.addEventListener('DOMContentLoaded', initLightbox);
