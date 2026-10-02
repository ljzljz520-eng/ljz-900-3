/* 员工扫码整改页 */
const app = $('#app');
const code = new URLSearchParams(location.search).get('code') || '';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderEntry(msg) {
  app.innerHTML = `
    ${msg ? `<div class="banner danger">${msg}</div>` : ''}
    <div class="card">
      <h2>进入整改单</h2>
      <p class="muted">请扫描整改码；如扫码失败，可手动输入整改单编号（如 ZG-20261002-001）</p>
      <label class="fld" style="margin-top:12px">
        <span>整改单编号</span>
        <input type="text" id="codeInput" placeholder="ZG-YYYYMMDD-XXX" value="${escapeHtml(code)}">
      </label>
      <button class="btn block" id="goBtn">查看问题并整改</button>
    </div>`;
  $('#goBtn').onclick = () => {
    const v = $('#codeInput').value.trim();
    if (!v) return toast('请输入整改单编号', 'err');
    location.href = '/fix.html?code=' + encodeURIComponent(v);
  };
  $('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#goBtn').click());
}

async function loadIssue() {
  app.innerHTML = '<div class="empty">正在加载整改单…</div>';
  try {
    const issue = await api('/api/issues/' + encodeURIComponent(code));
    renderIssue(issue);
  } catch (err) {
    if (err.status === 404) {
      renderEntry('⚠️ 链接已失效：该整改单不存在、已被删除，或编号输入有误。请重新扫码或联系管理员确认。');
    } else {
      renderEntry('⚠️ ' + err.message);
    }
  }
}

let issueCache = null;

async function refresh() {
  issueCache = await api('/api/issues/' + encodeURIComponent(code));
  renderIssue(issueCache);
}

function renderIssue(issue) {
  issueCache = issue;
  const s = issue.status;
  let banner = '';
  if (s === 'expired') {
    banner = `<div class="banner danger">⏰ 该整改单已超过期限（截止 ${fmtTime(issue.deadline)}），链接已失效，无法上传或提交。<br>请联系负责人延期后，重新扫码进入。</div>`;
  } else if (s === 'fixed') {
    banner = `<div class="banner info">✅ 你已提交整改照片，正在等待负责人验收，请勿离开或重复提交。</div>`;
  } else if (s === 'approved') {
    banner = `<div class="banner ok">🎉 验收已通过，本单完成，感谢配合！</div>`;
  } else if (s === 'rejected') {
    banner = `<div class="banner danger">↩️ 整改被驳回${issue.reviewComment ? '：' + escapeHtml(issue.reviewComment) : ''}<br>请重新处理后再次上传照片，期限已顺延。</div>`;
  }

  const canEdit = (s === 'pending' || s === 'rejected') && !issue.expired;
  const urgent = issue.remainMs != null && issue.remainMs < 3600e3;

  app.innerHTML = `
    <div class="card">
      <div class="head" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-size:18px;font-weight:800;letter-spacing:.5px">${issue.code}</span>
        <span class="badge ${s}">${STATUS_TEXT[s]}</span>
      </div>
      <div style="margin:6px 0">
        <span class="tag">${escapeHtml(issue.area)}</span>
        <span class="tag">${escapeHtml(issue.category)}</span>
        <span class="points">扣分 −${issue.points}</span>
      </div>
      ${issue.description ? `<div style="margin:8px 0">${escapeHtml(issue.description)}</div>` : ''}
      ${canEdit || s === 'pending' || s === 'rejected'
        ? `<div class="countdown ${urgent ? 'urgent' : 'normal'}">${countdown(issue.remainMs)}（截止 ${fmtTime(issue.deadline)}）</div>` : ''}
      ${banner}
    </div>

    <div class="card">
      <h2>问题照片（管理员拍摄）</h2>
      <div class="compare">
        <div class="photos-min problem-min">
          <h4>问题现状</h4>
          ${issue.problemPhotos.map((p) => `<img src="${p.url}" data-src="${p.url}" alt="问题照片">`).join('')}
        </div>
        <div class="photos-min fix-min">
          <h4>整改照片</h4>
          <div id="fixThumbs"></div>
        </div>
      </div>
    </div>

    <div class="card" id="actionCard"></div>
    <p class="muted" style="text-align:center">如照片打不开或链接失效，请联系管理员重新获取整改码</p>
  `;

  $$('.problem-min img, .fix-min img').forEach((im) =>
    im.addEventListener('click', () => lightbox.show(im.dataset.src || im.src)));

  renderFixThumbs();
  renderActions();
}

function renderFixThumbs() {
  const issue = issueCache;
  const box = $('#fixThumbs');
  if (!box) return;
  box.innerHTML = '';
  const canEdit = (issue.status === 'pending' || issue.status === 'rejected') && !issue.expired;
  issue.fixPhotos.forEach((p) => {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    const im = document.createElement('img');
    im.src = p.url;
    im.alt = '整改照片';
    im.onclick = () => lightbox.show(p.url);
    wrap.appendChild(im);
    if (canEdit) {
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.onclick = async () => {
        const ok = await confirmDialog({
          title: '删除这张整改照片？',
          text: '删除后可立即重新拍照上传。',
          okText: '删除', danger: true
        });
        if (!ok) return;
        try {
          await api(`/api/issues/${issue.code}/photos/fix/${p.id}`, { method: 'DELETE' });
          toast('照片已删除，请重新拍照上传', 'ok');
          await refresh();
        } catch (err) {
          toast('删除失败：' + err.message, 'err', 3000);
        }
      };
      wrap.appendChild(del);
    }
    box.appendChild(wrap);
  });

  if (canEdit && issue.fixPhotos.length < 9) {
    const label = document.createElement('label');
    label.className = 'addbox';
    label.style.cssText = 'width:100%;aspect-ratio:1';
    label.innerHTML = `<span class="plus">📷</span><span>拍照 / 上传整改图</span><input type="file" accept="image/*" capture="environment" multiple>`;
    const inp = label.querySelector('input');
    inp.onchange = () => doUpload([...inp.files], label);
    box.appendChild(label);
  }
}

async function doUpload(files, labelEl) {
  const imgs = files.filter((f) => /^image\//.test(f.type));
  if (!imgs.length) return toast('请选择图片文件（JPG/PNG）', 'err');
  const over = imgs.filter((f) => f.size > 10 * 1024 * 1024);
  if (over.length) return toast(`${over.length} 张图片超过 10MB，请压缩后重新上传`, 'err', 3000);
  if (issueCache.fixPhotos.length + imgs.length > 9)
    return toast('整改照片最多 9 张，请先删除部分照片再上传', 'err');

  const oldHtml = labelEl ? labelEl.innerHTML : '';
  if (labelEl) labelEl.innerHTML = '<span>上传中…</span>';
  try {
    const fd = new FormData();
    imgs.forEach((f) => fd.append('photos', f));
    await api(`/api/issues/${issueCache.code}/fix-photos`, { method: 'POST', body: fd });
    toast('整改照片上传成功', 'ok');
    await refresh();
  } catch (err) {
    toast('上传失败：' + err.message + '，请检查网络后重新选择上传', 'err', 3400);
    // 重建上传格，保证文件选择器可再次使用
    renderFixThumbs();
  }
}

function renderActions() {
  const issue = issueCache;
  const box = $('#actionCard');
  const canEdit = (issue.status === 'pending' || issue.status === 'rejected') && !issue.expired;

  if (!canEdit) {
    if (issue.status === 'expired') {
      box.innerHTML = `<button class="btn ghost block" onclick="location.reload()">刷新链接状态</button>`;
    } else if (issue.status === 'fixed') {
      box.innerHTML = `<div class="muted" style="text-align:center">提交时间：${fmtTime(issue.submittedAt)}</div>`;
    } else if (issue.status === 'approved') {
      box.innerHTML = `<div class="muted" style="text-align:center">验收时间：${fmtTime(issue.reviewedAt)}</div>`;
    }
    return;
  }

  box.innerHTML = `
    <h2>提交整改</h2>
    <label class="fld">
      <span>整改人姓名（选填）</span>
      <input type="text" id="fixerName" maxlength="20" placeholder="如：王师傅" value="${escapeHtml(issue.fixerName)}">
    </label>
    <p class="muted" style="font-size:12.5px">上传整改完成照片后点「提交验收」，负责人审核通过即闭环；被驳回可重新上传。</p>
    <button class="btn block ok" id="submitFix">提交整改，申请验收</button>
  `;
  $('#submitFix').onclick = async () => {
    if (!issue.fixPhotos.length) return toast('请先拍照上传整改完成图', 'err');
    const ok = await confirmDialog({
      title: '确认提交整改？',
      text: `共 ${issue.fixPhotos.length} 张整改照片，提交后需负责人驳回才能修改。`,
      okText: '提交验收'
    });
    if (!ok) return;
    const btn = $('#submitFix');
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      await api(`/api/issues/${issue.code}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixerName: $('#fixerName').value.trim() })
      });
      toast('已提交，等待负责人验收', 'ok');
      await refresh();
    } catch (err) {
      toast('提交失败：' + err.message + '，请稍后重试', 'err', 3200);
      btn.disabled = false;
      btn.textContent = '提交整改，申请验收';
    }
  };
}

// 倒计时自动刷新（不打断上传）
setInterval(async () => {
  if (!issueCache) return;
  const s = issueCache.status;
  if (s !== 'pending' && s !== 'rejected') return;
  const fresh = await api('/api/issues/' + encodeURIComponent(code)).catch(() => null);
  if (fresh && fresh.status !== issueCache.status) renderIssue(fresh);
  else if (fresh) { issueCache = fresh; }
}, 30000);

if (!code) renderEntry();
else loadIssue();
