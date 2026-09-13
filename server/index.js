/**
 * 食堂后厨整改台 — 服务端
 * 角色: 管理员检查建单(灶台/冰箱/地面问题照片) -> 生成编号+整改二维码
 *       后厨员工扫码补整改图 -> 负责人看板汇总扣分/状态/完成率
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 整改链接默认有效期 48 小时
const LINK_TTL_MS = Number(process.env.LINK_TTL_MS || 48 * 3600 * 1000);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
// 图片静态服务（见下，带权限/过期控制由 /api/photo 统一出口，这里仅兜底）
app.use('/uploads', express.static(UPLOAD_DIR));

/* ---------------- 文件上传 ---------------- */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '.img';
    cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/WEBP/GIF 图片格式'));
  }
});

/* ---------------- 鉴权 ---------------- */
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key && key === process.env.ADMIN_KEY) return next();
  // 简单会话: 登录后发 token，存内存
  const token = req.headers['x-admin-token'];
  if (token && SESSIONS.has(token)) return next();
  return res.status(401).json({ code: 401, msg: '请先登录管理员账号' });
}
const SESSIONS = new Map(); // token -> adminName

/* ---------------- 工具 ---------------- */
function rid() { return crypto.randomBytes(9).toString('hex'); }

function nowPlusTTL() { return Date.now() + LINK_TTL_MS; }

/** 计算单条问题实时状态（不写库） */
function computeState(issue) {
  const submitted = issue.rectifyImages && issue.rectifyImages.length > 0;
  if (issue.approved) return 'approved';
  if (submitted) return 'submitted';
  const overdue = issue.deadline && Date.now() > issue.deadline;
  return overdue ? 'overdue' : 'pending';
}

function issueView(issue, { withPhotoUrls = true } = {}) {
  const state = computeState(issue);
  const out = {
    id: issue.id,
    no: issue.no,
    area: issue.area,
    title: issue.title,
    description: issue.description,
    score: issue.score,
    inspector: issue.inspector,
    status: state,
    problemImages: issue.problemImages || [],
    rectifyImages: issue.rectifyImages || [],
    rectifier: issue.rectifier || null,
    rectifyNote: issue.rectifyNote || '',
    createdAt: issue.createdAt,
    deadline: issue.deadline,
    expiresAt: issue.expiresAt,
    approvedAt: issue.approvedAt || null,
    rejectReason: issue.rejectReason || '',
    updatedAt: issue.updatedAt
  };
  if (withPhotoUrls) {
    out.problemImages = (issue.problemImages || []).map(p => ({ key: p.key, url: `/api/photo/${p.key}`, uploadedAt: p.uploadedAt }));
    out.rectifyImages = (issue.rectifyImages || []).map(p => ({ key: p.key, url: `/api/photo/${p.key}`, uploadedAt: p.uploadedAt }));
  }
  return out;
}

/** 员工链接校验：token 是否存在、是否过期 */
function resolveStaffToken(req, res) {
  const token = req.params.token || req.query.token || req.body.token;
  if (!token) { res.status(400).json({ code: 400, msg: '链接缺少整改凭证 token' }); return null; }
  const issue = db.getIssueByToken(token);
  if (!issue) {
    res.status(404).json({ code: 404, msg: '链接无效：找不到对应的整改单，可能已被删除。', type: 'invalid' });
    return null;
  }
  if (issue.expiresAt && Date.now() > issue.expiresAt) {
    res.status(410).json({
      code: 410, type: 'expired',
      msg: '该整改链接已于 ' + new Date(issue.expiresAt).toLocaleString('zh-CN') + ' 过期，请联系检查管理员重新生成。',
      expiresAt: issue.expiresAt,
      issueNo: issue.no
    });
    return null;
  }
  return issue;
}

/* ================= 管理端：登录 ================= */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.findAdmin(username, password);
  if (!admin) return res.status(401).json({ code: 401, msg: '账号或密码错误（默认 admin / admin123）' });
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, admin.name);
  res.json({ code: 0, data: { token, name: admin.name } });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) SESSIONS.delete(token);
  res.json({ code: 0 });
});

/* ================= 管理端：问题单 CRUD ================= */
// 上传问题照片（建单前或建单时；需登录）
app.post('/api/admin/upload', adminAuth, (req, res, next) => {
  upload.array('photos', 6)(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, msg: err.message || '上传失败' });
    if (!req.files || !req.files.length) return res.status(400).json({ code: 400, msg: '未收到图片文件' });
    const photos = req.files.map(f => ({ key: f.filename, uploadedAt: Date.now() }));
    res.json({ code: 0, data: photos });
  });
});

// 建单
app.post('/api/admin/issues', adminAuth, (req, res) => {
  const { area, title, description, score, problemImages, deadlineHours, inspector } = req.body || {};
  if (!area || !title) return res.status(400).json({ code: 400, msg: '检查区域与问题描述为必填项' });
  if (!Array.isArray(problemImages) || problemImages.length === 0)
    return res.status(400).json({ code: 400, msg: '请至少上传 1 张问题照片（灶台/冰箱/地面等）' });
  const now = Date.now();
  const ttlHours = Math.max(1, Number(deadlineHours) || 48);
  const issue = {
    id: rid(),
    no: db.nextIssueNo(),
    area, title,
    description: description || '',
    score: Math.max(0, Math.min(100, Number(score) || 0)),
    inspector: inspector || SESSIONS.get(req.headers['x-admin-token']) || '管理员',
    problemImages: problemImages.map(p => ({ key: String(p.key || p).replace(/[^a-z0-9.\-]/gi, ''), uploadedAt: p.uploadedAt || now })),
    rectifyImages: [],
    rectifier: null,
    rectifyNote: '',
    approved: false,
    approvedAt: null,
    rejectReason: '',
    token: crypto.randomBytes(12).toString('hex'),
    createdAt: now,
    updatedAt: now,
    deadline: now + ttlHours * 3600 * 1000,
    expiresAt: now + Math.max(ttlHours, 48) * 3600 * 1000
  };
  db.insertIssue(issue);
  res.json({ code: 0, data: issueView(issue) });
});

// 列表
app.get('/api/admin/issues', adminAuth, (req, res) => {
  const { status, area, keyword } = req.query;
  let list = db.getIssues().slice();
  if (status) list = list.filter(i => computeState(i) === status);
  if (area) list = list.filter(i => i.area === area);
  if (keyword) {
    const k = String(keyword).toLowerCase();
    list = list.filter(i =>
      i.no.toLowerCase().includes(k) ||
      i.title.toLowerCase().includes(k) ||
      i.description.toLowerCase().includes(k)
    );
  }
  res.json({ code: 0, data: list.map(i => issueView(i)) });
});

// 详情（管理端）
app.get('/api/admin/issues/:id', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在，可能已被删除' });
  res.json({ code: 0, data: issueView(issue) });
});

// 删除问题照片（建单时/建单后均可，需登录）
app.post('/api/admin/issues/:id/photos/delete', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  const { key, type } = req.body || {};
  const bucket = type === 'rectify' ? 'rectifyImages' : 'problemImages';
  const idx = (issue[bucket] || []).findIndex(p => p.key === key);
  if (idx === -1) return res.status(404).json({ code: 404, msg: '图片不存在，可能已被删除' });
  issue[bucket].splice(idx, 1);
  // 物理删除文件（失败不阻断记录删除）
  fs.promises.unlink(path.join(UPLOAD_DIR, key)).catch(() => {});
  if (bucket === 'problemImages' && issue.problemImages.length === 0) {
    // 允许删空，提示前端补图
  }
  db.updateIssue(issue.id, { [bucket]: issue[bucket] });
  res.json({ code: 0, msg: '图片已删除', data: issueView(db.getIssue(issue.id)) });
});

// 补传问题照片（已建单）
app.post('/api/admin/issues/:id/photos', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  upload.array('photos', 6)(req, res, async (err) => {
    if (err) return res.status(400).json({ code: 400, msg: err.message || '上传失败，请重新选择图片' });
    if (!req.files || !req.files.length) return res.status(400).json({ code: 400, msg: '未收到图片，请重新上传' });
    if (issue.problemImages.length + req.files.length > 8)
      return res.status(400).json({ code: 400, msg: '问题照片最多 8 张，请先删除部分图片' });
    const add = req.files.map(f => ({ key: f.filename, uploadedAt: Date.now() }));
    issue.problemImages.push(...add);
    db.updateIssue(issue.id, { problemImages: issue.problemImages });
    res.json({ code: 0, msg: `已重新上传 ${add.length} 张图片`, data: issueView(db.getIssue(issue.id)) });
  });
});

// 删除整改单
app.delete('/api/admin/issues/:id', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  [...(issue.problemImages || []), ...(issue.rectifyImages || [])].forEach(p =>
    fs.promises.unlink(path.join(UPLOAD_DIR, p.key)).catch(() => {}));
  db.deleteIssue(req.params.id);
  res.json({ code: 0, msg: `整改单 ${issue.no} 已删除` });
});

// 审核通过/驳回
app.post('/api/admin/issues/:id/review', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  const { action, reason } = req.body || {};
  if (action === 'approve') {
    if (!issue.rectifyImages.length) return res.status(400).json({ code: 400, msg: '员工尚未上传整改图，无法通过' });
    db.updateIssue(issue.id, { approved: true, approvedAt: Date.now(), rejectReason: '' });
    return res.json({ code: 0, msg: '已核验通过', data: issueView(db.getIssue(issue.id)) });
  }
  if (action === 'reject') {
    db.updateIssue(issue.id, { approved: false, approvedAt: null, rejectReason: reason || '整改不到位，请重新处理并上传' });
    return res.json({ code: 0, msg: '已驳回，员工可重新上传整改图', data: issueView(db.getIssue(issue.id)) });
  }
  res.status(400).json({ code: 400, msg: '未知审核动作' });
});

// 重新生成整改链接（旧链接失效）
app.post('/api/admin/issues/:id/relink', adminAuth, (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  const ttlHours = Math.max(1, Number(req.body && req.body.ttlHours) || 48);
  const token = crypto.randomBytes(12).toString('hex');
  db.updateIssue(issue.id, {
    token,
    expiresAt: Date.now() + ttlHours * 3600 * 1000
  });
  res.json({ code: 0, msg: '已生成新链接，旧链接立即失效', data: issueView(db.getIssue(issue.id)) });
});

// 获取整改二维码（dataURL，直接前端展示/打印）
app.get('/api/admin/issues/:id/qrcode', adminAuth, async (req, res) => {
  const issue = db.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ code: 404, msg: '整改单不存在或已删除' });
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/rectify.html?token=${issue.token}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: '#1f2937', light: '#ffffff' } });
    res.json({ code: 0, data: { qr: dataUrl, url, expiresAt: issue.expiresAt, no: issue.no } });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '二维码生成失败: ' + e.message });
  }
});

/* ================= 看板汇总 ================= */
app.get('/api/admin/dashboard', adminAuth, (req, res) => {
  const list = db.getIssues();
  const total = list.length;
  let totalScore = 0, approved = 0, submitted = 0, pending = 0, overdue = 0;
  const areaMap = {};
  list.forEach(i => {
    const s = computeState(i);
    totalScore += Number(i.score) || 0;
    if (s === 'approved') approved++;
    if (s === 'submitted') submitted++;
    if (s === 'pending') pending++;
    if (s === 'overdue') overdue++;
    if (!areaMap[i.area]) areaMap[i.area] = { area: i.area, count: 0, score: 0, approved: 0 };
    areaMap[i.area].count++;
    areaMap[i.area].score += Number(i.score) || 0;
    if (s === 'approved') areaMap[i.area].approved++;
  });
  const completionRate = total ? Math.round((approved / total) * 1000) / 10 : 0;
  const submitRate = total ? Math.round(((approved + submitted) / total) * 1000) / 10 : 0;
  res.json({
    code: 0,
    data: {
      total, totalScore, approved, submitted, pending, overdue,
      completionRate, submitRate,
      areas: Object.values(areaMap).sort((a, b) => b.score - a.score)
    }
  });
});

/* ================= 员工端（扫码，免登录但 token 受控） ================= */
app.get('/api/staff/issue/:token', (req, res) => {
  const issue = resolveStaffToken(req, res);
  if (!issue) return;
  res.json({ code: 0, data: issueView(issue) });
});

// 员工上传整改图
app.post('/api/staff/upload/:token', (req, res) => {
  const issue = resolveStaffToken(req, res);
  if (!issue) return;
  if (issue.approved) return res.status(400).json({ code: 400, msg: '该问题已核验通过，无需再次上传' });
  upload.array('photos', 6)(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, msg: err.message || '上传失败，请重新拍摄/选择图片' });
    if (!req.files || !req.files.length) return res.status(400).json({ code: 400, msg: '未收到图片，请重新上传整改照片' });
    const { rectifier, note, replace } = req.body || {};
    // 重新上传：先清空旧整改图（驳回后整改场景）
    let oldKeys = [];
    if (replace === '1' && issue.rectifyImages.length) {
      oldKeys = issue.rectifyImages.map(p => p.key);
      issue.rectifyImages = [];
    }
    if (issue.rectifyImages.length + req.files.length > 6)
      return res.status(400).json({ code: 400, msg: '整改照片最多 6 张，请删除后再传' });
    const add = req.files.map(f => ({ key: f.filename, uploadedAt: Date.now() }));
    issue.rectifyImages.push(...add);
    db.updateIssue(issue.id, {
      rectifyImages: issue.rectifyImages,
      rectifier: rectifier || issue.rectifier || '后厨员工',
      rectifyNote: note !== undefined ? note : issue.rectifyNote,
      rejectReason: '' // 重新提交后清空驳回理由
    });
    oldKeys.forEach(k => fs.promises.unlink(path.join(UPLOAD_DIR, k)).catch(() => {}));
    res.json({ code: 0, msg: `整改照片上传成功（${add.length} 张），等待负责人核验`, data: issueView(db.getIssue(issue.id)) });
  });
});

// 员工删除自己的整改图（链接有效期内）
app.post('/api/staff/photo/delete/:token', (req, res) => {
  const issue = resolveStaffToken(req, res);
  if (!issue) return;
  if (issue.approved) return res.status(400).json({ code: 400, msg: '已核验通过的整改图不能删除，如需重拍请联系负责人驳回' });
  const { key } = req.body || {};
  const idx = issue.rectifyImages.findIndex(p => p.key === key);
  if (idx === -1) return res.status(404).json({ code: 404, msg: '图片不存在，可能已被删除' });
  issue.rectifyImages.splice(idx, 1);
  fs.promises.unlink(path.join(UPLOAD_DIR, key)).catch(() => {});
  db.updateIssue(issue.id, { rectifyImages: issue.rectifyImages });
  res.json({ code: 0, msg: '整改图片已删除，可重新上传', data: issueView(db.getIssue(issue.id)) });
});

/* ================= 图片出口（失效/删除友好提示） ================= */
app.get('/api/photo/:key', (req, res) => {
  const key = path.basename(req.params.key);
  const file = path.join(UPLOAD_DIR, key);
  if (!/^[a-z0-9.\-]+$/i.test(key) || !fs.existsSync(file)) {
    return res.status(404).send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px;color:#6b7280">
      <div style="font-size:42px">🖼️</div><h3>图片无法查看</h3>
      <p>该图片可能已被删除，或链接已过期失效。</p><p>请联系检查管理员重新获取。</p></body>`);
  }
  res.sendFile(file);
});

/* ================= 页面路由 ================= */
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/rectify.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rectify.html')));

/* 错误兜底 */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ code: 500, msg: '服务器开小差了，请稍后重试' });
});

app.listen(PORT, () => {
  db.load();
  console.log(`🍳 食堂后厨整改台已启动: http://localhost:${PORT}`);
  console.log(`   管理端: http://localhost:${PORT}/admin  (默认 admin / admin123)`);
});
