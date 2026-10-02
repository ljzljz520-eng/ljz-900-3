/* 管理员检查台 */
let pendingFiles = []; // 建单前本地待传图片 {id,file,url}
let currentFilter = '';
let issuesCache = [];

// ---------- 本地上传格 ----------
function renderCreateUploader() {
  const box = $('#createUploader');
  box.innerHTML = '';
  pendingFiles.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${p.url}" alt="待上传"><button class="del" type="button">×</button>`;
    d.querySelector('img').onclick = () => lightbox.show(p.url);
    d.querySelector('.del').onclick = async () => {
      const ok = await confirmDialog({
        title: '移除这张照片？',
        text: '该照片还未提交，移除后需重新选择上传。',
        okText: '移除', danger: true
      });
      if (!ok) return;
      URL.revokeObjectURL(p.url);
      pendingFiles = pendingFiles.filter((x) => x.id !== p.id);
      renderCreateUploader();
      toast('照片已移除，可重新选择上传', 'ok');
    };
    box.appendChild(d);
  });
  if (pendingFiles.length < 9) {
    const add = document.createElement('label');
    add.className = 'addbox';
    add.innerHTML = `<span class="plus">＋</span><span>上传问题照片</span><input type="file" accept="image/*" capture="environment" multiple>`;
    const inp = add.querySelector('input');
    inp.onchange = () => {
      const files = [...inp.files];
      addFiles(files);
      inp.value = '';
    };
    box.appendChild(add);
  }
}

function addFiles(files) {
  const imgs = files.filter((f) => /^image\//.test(f.type));
  if (imgs.length !== files.length) toast('仅支持图片文件，已自动跳过非图片', 'err');
  const oversize = imgs.filter((f) => f.size > 10 * 1024 * 1024);
  if (oversize.length) {
    toast(`有 ${oversize.length} 张图片超过 10MB，请压缩后重新选择`, 'err', 3000);
  }
  const valid = imgs.filter((f) => f.size <= 10 * 1024 * 1024);
  const room = 9 - pendingFiles.length;
  if (valid.length > room) {
    toast(`最多 9 张，已为你保留前 ${room} 张`, 'err');
  }
  valid.slice(0, room).forEach((file) => {
    pendingFiles.push({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) });
  });
  renderCreateUploader();
}

// ---------- 建单 ----------
$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingFiles.length) return toast('请至少上传 1 张问题照片', 'err');
  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = '正在上传图片并建单…';
  const fd = new FormData(e.target);
  pendingFiles.forEach((p) => fd.append('photos', p.file));
  try {
    const issue = await api('/api/issues', { method: 'POST', body: fd });
    pendingFiles.forEach((p) => URL.revokeObjectURL(p.url));
    pendingFiles = [];
    renderCreateUploader();
    e.target.reset();
    e.target.querySelector('[name=points]').value = 5;
    e.target.querySelector('[name=hours]').value = 24;
    toast(`建单成功：${issue.code}`, 'ok');
    showResult(issue);
    loadList();
  } catch (err) {
    toast(err.message, 'err', 3200);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交检查问题，生成编号';
  }
});

async function showResult(issue) {
  const card = $('#resultCard');
  card.style.display = '';
  $('#qrCode').textContent = issue.code;
  const link = $('#openFixLink');
  link.href = `/fix.html?code=${encodeURIComponent(issue.code)}`;
  try {
    const q = await api(`/api/issues/${issue.code}/qr`);
    $('#qrImg').src = q.qr;
    link.href = q.url;
  } catch (e) {
    toast('整改码生成失败，请稍后重试', 'err');
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#printBtn').onclick = () => {
  const src = $('#qrImg').src;
  const code = $('#qrCode').textContent;
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>整改码 ${code}</title>
    <style>body{text-align:center;padding:40px;font-family:sans-serif}
    img{width:260px;height:260px}h2{margin:12px 0 4px;letter-spacing:2px}p{color:#666}</style></head>
    <body><img src="${src}"><h2>${code}</h2><p>微信/支付宝扫码 · 提交整改照片</p></body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
};

// ---------- 列表 ----------
const FILTERS = $$('#filters button');
FILTERS.forEach((b) =>
  b.addEventListener('click', () => {
    FILTERS.forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    currentFilter = b.dataset.s;
    loadList();
  })
);

async function loadList() {
  try {
    const qs = currentFilter ? `?status=${currentFilter}` : '';
    issuesCache = await api('/api/issues' + qs);
    renderList();
  } catch (err) {
    toast('列表加载失败：' + err.message, 'err');
  }
}

function renderList() {
  const box = $('#issueList');
  if (!issuesCache.length) {
    box.innerHTML = '<div class="empty">暂无整改单，先在上方登记一个问题吧</div>';
    return;
  }
  box.innerHTML = '';
  issuesCache.forEach((issue) => box.appendChild(renderIssue(issue)));
}

function renderIssue(issue) {
  const el = document.createElement('div');
  el.className = 'issue';
  const status = issue.status;
  const cd =
    status === 'pending' || status === 'rejected'
      ? `<span class="countdown ${issue.expired ? 'urgent' : issue.remainMs < 3600e3 ? 'urgent' : 'normal'}">${countdown(issue.remainMs)}</span>`
      : '';
  el.innerHTML = `
    <div class="head">
      <span class="code">${issue.code}</span>
      <span class="badge ${status}">${STATUS_TEXT[status]}</span>
      <span class="tag">${issue.area}</span><span class="tag">${issue.category}</span>
      <span class="points">−${issue.points}分</span>
      ${cd}
    </div>
    ${issue.description ? `<div class="desc">${escapeHtml(issue.description)}</div>` : ''}
    <div class="muted" style="margin-top:4px">建单 ${fmtTime(issue.createdAt)} · 截止 ${fmtTime(issue.deadline)}</div>
    <div class="photos problem-photos"></div>
    <div class="photos fix-photos"></div>
    <div class="review-info"></div>
    <div class="acts"></div>`;

  const pp = el.querySelector('.problem-photos');
  issue.problemPhotos.forEach((p) => {
    pp.appendChild(thumbNode(p, issue, 'problem'));
  });
  const addProblem = document.createElement('label');
  addProblem.className = 'addbox';
  addProblem.style.cssText = 'width:72px;height:72px;aspect-ratio:auto';
  addProblem.innerHTML = `<span class="plus">＋</span><input type="file" accept="image/*" multiple>`;
  addProblem.querySelector('input').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('正在上传图片…');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('photos', f));
      await api(`/api/issues/${issue.code}/photos`, { method: 'POST', body: fd });
      toast('问题照片已补充上传', 'ok');
      loadList();
    } catch (err) {
      toast('上传失败：' + err.message + '，请重新选择上传', 'err', 3000);
    }
  };
  pp.appendChild(addProblem);

  if (issue.fixPhotos.length) {
    const fp = el.querySelector('.fix-photos');
    const label = document.createElement('div');
    label.style.width = '100%';
    label.innerHTML = `<span class="muted" style="font-size:12px">整改照片（提交于 ${fmtTime(issue.submittedAt)}）：</span>`;
    fp.appendChild(label);
    issue.fixPhotos.forEach((p) => fp.appendChild(thumbNode(p, issue, 'fix')));
  }

  if (status === 'rejected' && issue.reviewComment) {
    el.querySelector('.review-info').innerHTML =
      `<div class="banner danger" style="margin-top:8px">驳回原因：${escapeHtml(issue.reviewComment)}</div>`;
  }

  const acts = el.querySelector('.acts');
  const btn = (text, cls, fn) => {
    const b = document.createElement('button');
    b.className = `btn sm ${cls}`;
    b.textContent = text;
    b.onclick = fn;
    acts.appendChild(b);
    return b;
  };

  btn('整改码', 'ghost', () => openQr(issue));

  if (status === 'fixed') {
    btn('验收通过', 'ok', () => review(issue, 'approve'));
    btn('驳回整改', 'danger', () => review(issue, 'reject'));
  }
  if (status === 'pending' || status === 'rejected' || status === 'expired') {
    btn('延期 24h', 'warn', () => extend(issue, 24));
  }
  if (issue.fixPhotos.length === 0 || ['rejected', 'expired', 'pending'].includes(status)) {
    btn('删除整单', 'ghost', async () => {
      const ok = await confirmDialog({
        title: `删除整改单 ${issue.code}？`,
        text: '将同时删除该单的全部问题照片与整改照片，此操作不可恢复。',
        okText: '确认删除', danger: true
      });
      if (!ok) return;
      try {
        await api(`/api/issues/${issue.code}`, { method: 'DELETE' });
        toast('整改单已删除', 'ok');
        loadList();
      } catch (err) {
        toast('删除失败：' + err.message, 'err');
      }
    });
  }
  return el;
}

function thumbNode(photo, issue, kind) {
  const d = document.createElement('img');
  d.src = photo.url;
  d.width = d.height = 72;
  d.onclick = () => lightbox.show(photo.url);
  // 长按/点击右上角删除：用包装实现
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.width = '72px';
  wrap.style.height = '72px';
  d.style.margin = '0';
  wrap.appendChild(d);
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.onclick = async (ev) => {
    ev.stopPropagation();
    const ok = await confirmDialog({
      title: '删除这张照片？',
      text: kind === 'problem'
        ? '删除后问题单仍需保留至少 1 张照片，可随后重新上传。'
        : '删除后可重新选择照片上传，提交前均可修改。',
      okText: '删除照片', danger: true
    });
    if (!ok) return;
    try {
      await api(`/api/issues/${issue.code}/photos/${kind}/${photo.id}`, { method: 'DELETE' });
      toast('照片已删除，可重新上传', 'ok');
      loadList();
    } catch (err) {
      toast('删除失败：' + err.message, 'err', 3000);
    }
  };
  wrap.appendChild(del);
  return wrap;
}

async function openQr(issue) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask show';
  mask.innerHTML = `
    <div class="modal qr-box">
      <h3 style="text-align:center">整改码</h3>
      <div style="font-weight:800;letter-spacing:1px">${issue.code}</div>
      <div id="qrLoading" class="muted" style="padding:30px 0">二维码生成中…</div>
      <img id="qrPop" style="display:none;margin:10px auto">
      <div class="muted" style="font-size:12px">员工扫码进入整改页上传照片</div>
      <div class="m-acts" style="margin-top:14px">
        <a class="btn ghost" href="/fix.html?code=${encodeURIComponent(issue.code)}">打开整改页</a>
        <button class="btn" data-close>知道了</button>
      </div>
    </div>`;
  mask.querySelector('[data-close]').onclick = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  document.body.appendChild(mask);
  try {
    const q = await api(`/api/issues/${issue.code}/qr`);
    mask.querySelector('#qrLoading').remove();
    const img = mask.querySelector('#qrPop');
    img.src = q.qr;
    img.style.display = 'block';
  } catch (e) {
    mask.querySelector('#qrLoading').textContent = '二维码生成失败，请稍后重试';
  }
}

async function review(issue, action) {
  let comment = '';
  if (action === 'reject') {
    comment = window.prompt('请填写驳回原因（员工端可见）：', '整改不到位，请重新处理');
    if (comment === null) return; // 取消
    if (!comment.trim()) return toast('驳回必须填写原因', 'err');
  }
  const ok = await confirmDialog({
    title: action === 'approve' ? '确认验收通过？' : '确认驳回该整改？',
    text: action === 'approve'
      ? `${issue.code} 将标记为「已通过」，计入完成率。`
      : `${issue.code} 将退回员工重新整改，系统自动顺延 24 小时期限。`,
    okText: action === 'approve' ? '通过' : '驳回',
    danger: action === 'reject'
  });
  if (!ok) return;
  try {
    await api(`/api/issues/${issue.code}/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, comment })
    });
    toast(action === 'approve' ? '已验收通过' : '已驳回，员工可重新整改', 'ok');
    loadList();
  } catch (err) {
    toast('操作失败：' + err.message, 'err');
  }
}

async function extend(issue, hours) {
  const ok = await confirmDialog({
    title: '延长整改期限？',
    text: `将在当前截止时间基础上顺延 ${hours} 小时（过期链接将恢复有效）。`,
    okText: '确认延期'
  });
  if (!ok) return;
  try {
    const updated = await api(`/api/issues/${issue.code}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours })
    });
    toast(`已延期，新截止时间：${fmtTime(updated.deadline)}`, 'ok');
    loadList();
  } catch (err) {
    toast('延期失败：' + err.message, 'err');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 粘贴/拖拽上传（桌面端加分项，失败不影响主流程）
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData || {}).items || []]
    .filter((it) => it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (files.length) { addFiles(files); toast('已从剪贴板读入图片'); }
});

loadList();
setInterval(() => {
  // 每分钟刷新倒计时与过期状态
  renderList();
}, 60000);
