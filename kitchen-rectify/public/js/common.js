// 通用方法：toast / 确认框 / 大图 / 请求 / 时间
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function toast(msg, type = '', ms = 2200) {
  let box = $('#toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.className = type;
  box.textContent = msg;
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(box._t);
  box._t = setTimeout(() => box.classList.remove('show'), ms);
}

function confirmDialog({ title = '确认操作', text = '', okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        <p>${text}</p>
        <div class="m-acts">
          <button class="btn ghost" data-no>取消</button>
          <button class="btn ${danger ? 'danger' : ''}" data-yes>${okText}</button>
        </div>
      </div>`;
    const close = (v) => { mask.remove(); resolve(v); };
    mask.addEventListener('click', (e) => { if (e.target === mask) close(false); });
    mask.querySelector('[data-no]').onclick = () => close(false);
    mask.querySelector('[data-yes]').onclick = () => close(true);
    document.body.appendChild(mask);
  });
}

const lightbox = (() => {
  let el;
  function show(src) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'lightbox';
      el.innerHTML = '<button class="close-lb">×</button><img alt="preview">';
      el.addEventListener('click', () => el.classList.remove('show'));
      document.body.appendChild(el);
    }
    el.querySelector('img').src = src;
    el.classList.add('show');
  }
  return { show };
})();

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) || `请求失败（${res.status}），请稍后重试`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function countdown(ms) {
  if (ms == null) return '';
  if (ms <= 0) return '已过期';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `剩余 ${d} 天 ${h % 24} 小时`;
  if (h > 0) return `剩余 ${h} 小时 ${m % 60} 分`;
  return `剩余 ${m} 分钟`;
}
const STATUS_TEXT = {
  pending: '待整改', fixed: '待验收', approved: '已通过',
  rejected: '已驳回', expired: '已过期'
};

// 带「重新上传」处理的图片提交（失败时按业务返回提示）
async function uploadPhotos(url, files) {
  const fd = new FormData();
  for (const f of files) fd.append('photos', f);
  return api(url, { method: 'POST', body: fd });
}
