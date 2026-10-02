/* 负责人汇总页 */
let currentFilter = '';
let issues = [];

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#stats').innerHTML = `
      <div class="stat acc"><div class="num">${s.completionRate}%</div><div class="lbl">整改完成率（${s.byStatus.approved}/${s.total}）</div>
        <div class="progress"><div style="width:${s.completionRate}%"></div></div></div>
      <div class="stat wait"><div class="num">${s.byStatus.pending + s.byStatus.rejected}</div><div class="lbl">待整改 / 已驳回</div></div>
      <div class="stat"><div class="num" style="color:#2b7de9">${s.byStatus.fixed}</div><div class="lbl">待验收</div></div>
      <div class="stat exp"><div class="num">${s.byStatus.expired}</div><div class="lbl">已过期</div></div>
      <div class="stat pen"><div class="num">−${s.deductedPoints}</div><div class="lbl">当前累计扣分（未闭环）</div></div>
      <div class="stat"><div class="num">−${s.totalPoints}</div><div class="lbl">问题扣分总计</div></div>
      <div class="stat"><div class="num">${s.total}</div><div class="lbl">整改单总数</div></div>
      <div class="stat acc"><div class="num">${s.byStatus.approved}</div><div class="lbl">验收通过数</div></div>
    `;
    $('#areaBox').innerHTML = s.byArea.length
      ? s.byArea.map((a) => {
          const rate = Math.round((a.approved / a.total) * 1000) / 10;
          return `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between">
              <strong>${escapeHtml(a.area)}</strong>
              <span class="points">−${a.points}分</span>
            </div>
            <div class="muted" style="font-size:12.5px">${a.approved}/${a.total} 已完成 · 完成率 ${rate}%</div>
            <div class="progress"><div style="width:${rate}%"></div></div>
          </div>`;
        }).join('')
      : '<div class="empty">暂无数据</div>';
  } catch (err) {
    toast('统计加载失败：' + err.message, 'err');
  }
}

async function loadList() {
  try {
    const qs = currentFilter ? `?status=${currentFilter}` : '';
    issues = await api('/api/issues' + qs);
    renderList();
  } catch (err) {
    toast('明细加载失败：' + err.message, 'err');
  }
}

function renderList() {
  const box = $('#issueList');
  if (!issues.length) {
    box.innerHTML = '<div class="empty">暂无整改单</div>';
    return;
  }
  box.innerHTML = issues.map((issue) => {
    const s = issue.status;
    let extra = '';
    if (s === 'pending' || s === 'rejected')
      extra = `<span class="countdown ${issue.remainMs < 3600e3 ? 'urgent' : 'normal'}">${countdown(issue.remainMs)}</span>`;
    if (s === 'rejected' && issue.reviewComment)
      extra += `<div class="banner danger" style="margin-top:6px">驳回：${escapeHtml(issue.reviewComment)}</div>`;
    return `<div class="issue">
      <div class="head">
        <span class="code">${issue.code}</span>
        <span class="badge ${s}">${STATUS_TEXT[s]}</span>
        <span class="tag">${escapeHtml(issue.area)}</span>
        <span class="tag">${escapeHtml(issue.category)}</span>
        <span class="points">−${issue.points}分</span>
        ${extra}
      </div>
      ${issue.description ? `<div class="desc">${escapeHtml(issue.description)}</div>` : ''}
      <div class="muted" style="font-size:12.5px;margin-top:4px">
        建单 ${fmtDate(issue.createdAt)} · 截止 ${fmtDate(issue.deadline)}
        ${issue.submittedAt ? ' · 提交 ' + fmtDate(issue.submittedAt) : ''}
        ${issue.reviewedAt ? ' · 验收 ' + fmtDate(issue.reviewedAt) : ''}
        ${issue.fixerName ? ' · 整改人 ' + escapeHtml(issue.fixerName) : ''}
      </div>
      <div class="photos">
        ${issue.problemPhotos.map((p) => `<img src="${p.url}" data-src="${p.url}">`).join('')}
        ${issue.fixPhotos.length
          ? `<span style="align-self:center" class="muted">整改→</span>` +
            issue.fixPhotos.map((p) => `<img src="${p.url}" data-src="${p.url}" style="border:2px solid #1a9e5c">`).join('')
          : ''}
      </div>
    </div>`;
  }).join('');
  $$('#issueList img').forEach((im) =>
    im.addEventListener('click', () => lightbox.show(im.dataset.src)));
}

$$('#filters button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#filters button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    currentFilter = b.dataset.s;
    loadList();
  })
);

function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  $('#clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
}

loadStats();
loadList();
tick();
setInterval(tick, 10000);
setInterval(() => { loadStats(); loadList(); }, 30000); // 自动刷新
