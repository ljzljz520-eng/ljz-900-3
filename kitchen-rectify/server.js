const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, save } = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 工具 ----------
function uid() {
  return crypto.randomBytes(9).toString('hex');
}
function publicUrl(req, p) {
  return `${req.protocol}://${req.get('host')}${p}`;
}
function findIssue(idOrCode) {
  return (
    db.issues.find((i) => i.id === idOrCode) ||
    db.issues.find((i) => i.code === idOrCode)
  );
}
// 计算有效状态：待整改/驳回 超过截止时间 => 已过期
function effective(issue, now = Date.now()) {
  if ((issue.status === 'pending' || issue.status === 'rejected') &&
      issue.deadline && now > issue.deadline) {
    return 'expired';
  }
  return issue.status;
}
function issueView(issue, req, now = Date.now()) {
  return {
    ...issue,
    status: effective(issue, now),
    rawStatus: issue.status,
    expired:
      (issue.status === 'pending' || issue.status === 'rejected') &&
      issue.deadline && now > issue.deadline,
    remainMs: issue.deadline ? issue.deadline - now : null,
    problemPhotos: issue.problemPhotos.map((p) => ({ ...p, url: publicUrl(req, '/uploads/' + p.filename) })),
    fixPhotos: issue.fixPhotos.map((p) => ({ ...p, url: publicUrl(req, '/uploads/' + p.filename) }))
  };
}
function todayCode() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// ---------- 上传配置 ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持上传图片文件（JPG/PNG 等）'));
  }
});
function removeFile(filename) {
  // 防目录穿越
  const safe = path.basename(filename);
  fs.promises.unlink(path.join(UPLOAD_DIR, safe)).catch(() => {});
}
function uploadHandler(req, res, next) {
  upload.array('photos', 9)(req, res, (err) => {
    if (err) {
      // multer 出错时已落盘的文件要清理
      if (req.files) req.files.forEach((f) => removeFile(f.filename));
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: '图片大小不能超过 10MB，请压缩后重新上传' });
      if (err.code === 'LIMIT_FILE_COUNT')
        return res.status(400).json({ error: '单次最多上传 9 张图片' });
      return res.status(400).json({ error: err.message || '图片上传失败' });
    }
    next();
  });
}

// ---------- 接口 ----------

// 列表（管理员 / 负责人）
app.get('/api/issues', (req, res) => {
  let list = [...db.issues];
  const { status, area, q } = req.query;
  if (status) list = list.filter((i) => effective(i) === status);
  if (area) list = list.filter((i) => i.area === area);
  if (q) {
    const k = q.trim();
    list = list.filter((i) => i.code.includes(k) || (i.description || '').includes(k));
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map((i) => issueView(i, req)));
});

// 单条（员工扫码）
app.get('/api/issues/:id', (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '链接已失效：未找到该整改单，可能已被删除或编号有误' });
  res.json(issueView(issue, req));
});

// 二维码
app.get('/api/issues/:id/qr', async (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '整改单不存在或已被删除' });
  const url = publicUrl(req, '/fix.html?code=' + encodeURIComponent(issue.code));
  try {
    const qr = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ qr, url, code: issue.code });
  } catch (e) {
    res.status(500).json({ error: '二维码生成失败' });
  }
});

// 管理员：建单（检查发现问题）
app.post('/api/issues', uploadHandler, (req, res) => {
  const area = (req.body.area || '').trim();
  const category = (req.body.category || '').trim();
  if (!area) return res.status(400).json({ error: '请选择检查区域（灶台/冰箱/地面等）' });
  if (!category) return res.status(400).json({ error: '请选择问题类别' });
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: '请至少上传 1 张问题照片' });

  const points = Math.max(0, Math.min(100, Number(req.body.points) || 0));
  const hours = Math.max(0.5, Math.min(720, Number(req.body.hours) || 24));
  const now = Date.now();

  const dateKey = todayCode();
  db.seq[dateKey] = (db.seq[dateKey] || 0) + 1;
  const code = `ZG-${dateKey}-${String(db.seq[dateKey]).padStart(3, '0')}`;

  const issue = {
    id: uid(),
    code,
    area,
    category,
    description: (req.body.description || '').trim(),
    points,
    status: 'pending',
    createdAt: now,
    deadline: now + hours * 3600 * 1000,
    submittedAt: null,
    reviewedAt: null,
    reviewComment: '',
    fixerName: '',
    problemPhotos: req.files.map((f) => ({ id: uid(), filename: f.filename, uploadedAt: Date.now() })),
    fixPhotos: []
  };
  db.issues.push(issue);
  save();
  res.status(201).json(issueView(issue, req));
});

// 补传问题照片（管理员，建单后追加）
app.post('/api/issues/:id/photos', uploadHandler, (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '整改单不存在或已被删除' });
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: '请选择要上传的图片' });
  if (issue.problemPhotos.length + req.files.length > 9)
    return res.status(400).json({ error: '问题照片最多 9 张，请先删除部分照片' });
  req.files.forEach((f) =>
    issue.problemPhotos.push({ id: uid(), filename: f.filename, uploadedAt: Date.now() })
  );
  save();
  res.json(issueView(issue, req));
});

// 删除照片（kind=problem|fix）
app.delete('/api/issues/:id/photos/:kind/:photoId', (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '整改单不存在或已被删除' });
  const kind = req.params.kind === 'fix' ? 'fixPhotos' : 'problemPhotos';

  if (kind === 'fixPhotos' && !['pending', 'rejected'].includes(issue.status))
    return res.status(403).json({ error: '整改单已提交审核，不能删除整改照片；如需修改请联系管理员驳回' });
  if (kind === 'problemPhotos' && issue.problemPhotos.length <= 1)
    return res.status(400).json({ error: '至少保留 1 张问题照片，不能全部删除' });

  const idx = issue[kind].findIndex((p) => p.id === req.params.photoId);
  if (idx === -1) return res.status(404).json({ error: '照片不存在或已被删除' });
  const [photo] = issue[kind].splice(idx, 1);
  removeFile(photo.filename);
  save();
  res.json({ ok: true, message: '照片已删除' });
});

// 员工：上传整改照片
app.post('/api/issues/:id/fix-photos', uploadHandler, (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '链接已失效：整改单不存在或已被删除' });
  if (!['pending', 'rejected'].includes(issue.status))
    return res.status(403).json({ error: '整改单已提交或已审核，不能再上传照片' });
  if (issue.deadline && Date.now() > issue.deadline)
    return res.status(403).json({ error: '整改期限已过，请联系负责人延期后再上传' });
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: '请选择要上传的整改照片' });
  if (issue.fixPhotos.length + req.files.length > 9)
    return res.status(400).json({ error: '整改照片最多 9 张，请先删除部分照片' });
  req.files.forEach((f) =>
    issue.fixPhotos.push({ id: uid(), filename: f.filename, uploadedAt: Date.now() })
  );
  save();
  res.json(issueView(issue, req));
});

// 员工：提交整改（等待验收）
app.post('/api/issues/:id/submit', (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '链接已失效：整改单不存在或已被删除' });
  if (!['pending', 'rejected'].includes(issue.status))
    return res.status(403).json({ error: '当前状态不能提交整改' });
  if (issue.deadline && Date.now() > issue.deadline)
    return res.status(403).json({ error: '已超过整改期限，无法提交，请联系负责人延期' });
  if (issue.fixPhotos.length === 0)
    return res.status(400).json({ error: '请先上传整改完成照片，再提交验收' });
  issue.status = 'fixed';
  issue.submittedAt = Date.now();
  issue.fixerName = (req.body && req.body.fixerName ? String(req.body.fixerName) : issue.fixerName).trim();
  save();
  res.json(issueView(issue, req));
});

// 管理员：验收（通过 / 驳回）
app.put('/api/issues/:id/review', (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '整改单不存在或已被删除' });
  if (issue.status !== 'fixed')
    return res.status(403).json({ error: '仅待验收的整改单可以审核' });
  const action = req.body && req.body.action;
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ error: '审核动作无效' });
  issue.status = action === 'approve' ? 'approved' : 'rejected';
  issue.reviewedAt = Date.now();
  issue.reviewComment = (req.body.comment || '').trim();
  if (action === 'reject') {
    // 驳回后默认再给 24 小时整改期（可用 extend 调整）
    issue.deadline = Math.max(issue.deadline || 0, Date.now()) + 24 * 3600 * 1000;
  }
  save();
  res.json(issueView(issue, req));
});

// 管理员：延期
app.post('/api/issues/:id/extend', (req, res) => {
  const issue = findIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: '整改单不存在或已被删除' });
  if (['approved', 'fixed'].includes(issue.status))
    return res.status(403).json({ error: issue.status === 'approved' ? '该单已验收通过，无需延期' : '该单待验收，无需延期' });
  const hours = Math.max(0.5, Math.min(720, Number(req.body && req.body.hours) || 24));
  const base = Math.max(issue.deadline || 0, Date.now());
  issue.deadline = base + hours * 3600 * 1000;
  save();
  res.json(issueView(issue, req));
});

// 管理员：删除整改单
app.delete('/api/issues/:id', (req, res) => {
  const idx = db.issues.findIndex((i) => i.id === req.params.id || i.code === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '整改单不存在或已被删除' });
  const [issue] = db.issues.splice(idx, 1);
  issue.problemPhotos.forEach((p) => removeFile(p.filename));
  issue.fixPhotos.forEach((p) => removeFile(p.filename));
  save();
  res.json({ ok: true, message: `整改单 ${issue.code} 已删除` });
});

// 负责人：汇总统计
app.get('/api/stats', (req, res) => {
  const now = Date.now();
  const byStatus = { pending: 0, fixed: 0, approved: 0, rejected: 0, expired: 0 };
  const byAreaMap = {};
  let totalPoints = 0;
  let deductedPoints = 0; // 未通过验收的问题仍计扣分
  db.issues.forEach((i) => {
    const s = effective(i, now);
    byStatus[s]++;
    byAreaMap[i.area] = byAreaMap[i.area] || { area: i.area, total: 0, approved: 0, points: 0 };
    byAreaMap[i.area].total++;
    byAreaMap[i.area].points += i.points;
    if (s === 'approved') byAreaMap[i.area].approved++;
    totalPoints += i.points;
    if (s !== 'approved') deductedPoints += i.points;
  });
  const total = db.issues.length;
  res.json({
    total,
    byStatus,
    totalPoints,
    deductedPoints,
    completionRate: total ? Math.round((byStatus.approved / total) * 1000) / 10 : 0,
    byArea: Object.values(byAreaMap).sort((a, b) => b.total - a.total)
  });
});

// 图片访问（防穿越，手动 sendFile）
app.get('/uploads/:name', (req, res, next) => {
  const safe = path.basename(req.params.name);
  const fp = path.join(UPLOAD_DIR, safe);
  if (!fp.startsWith(UPLOAD_DIR)) return res.status(400).end();
  res.sendFile(fp, (err) => { if (err) next(); });
});

// 兜底
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((req, res) => res.status(404).send('页面不存在'));
// 全局错误
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器异常，请稍后重试' });
});

app.listen(PORT, () => {
  console.log(`食堂后厨整改台已启动: http://localhost:${PORT}`);
});

// 支持 SIGHUP 热加载数据文件（多实例/外部修改时使用）
process.on('SIGHUP', () => {
  require('./store').reload();
  console.log('数据文件已热加载');
});
