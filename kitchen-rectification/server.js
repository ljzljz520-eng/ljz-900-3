'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const db = require('./lib/db');
const { upload } = require('./lib/upload');
const { seedIfEmpty } = require('./lib/seed');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 小工具 ----------
const ADMIN_ROLES = ['admin', 'manager'];

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.get('X-Role') || 'staff';
    if (!roles.includes(role)) {
      return res.status(403).json({ error: '当前身份无权执行此操作', code: 'FORBIDDEN' });
    }
    req.role = role;
    next();
  };
}

function handler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function findImage(t, imageId) {
  for (const group of [t.issueImages, t.fixImages]) {
    const img = group.find(i => i.imageId === imageId);
    if (img) return img;
  }
  return null;
}

function isOverdue(t, now = Date.now()) {
  // 已通过的不再算过期；其余超过截止时间即过期
  return t.status !== 'approved' && now > t.deadline;
}

function decorate(t, now = Date.now()) {
  return { ...t, overdue: isOverdue(t, now) };
}

function addHistory(t, by, action, text) {
  t.history = t.history || [];
  t.history.push({ at: Date.now(), by: by || '未知', action, text });
}

function actorName(req, fallback) {
  const raw = req.get('X-User-Name') || '';
  try {
    return (decodeURIComponent(raw) || fallback).slice(0, 20);
  } catch (_) {
    return (raw || fallback).slice(0, 20);
  }
}

// ---------- API：汇总看板 ----------
app.get('/api/stats', handler(async (req, res) => {
  const tickets = db.getTickets();
  const now = Date.now();
  const total = tickets.length;

  const count = s => tickets.filter(t => t.status === s).length;
  const pending = count('pending');
  const rectified = count('rectified');
  const approved = count('approved');
  const rejected = count('rejected');
  const overdue = tickets.filter(t => isOverdue(t, now)).length;
  const totalPoints = tickets.reduce((a, t) => a + (Number(t.points) || 0), 0);
  const completionRate = total ? Math.round((approved / total) * 1000) / 10 : 0;
  const responseRate = total ? Math.round(((rectified + approved) / total) * 1000) / 10 : 0;

  const byAreaMap = {};
  for (const t of tickets) {
    const a = byAreaMap[t.area] || (byAreaMap[t.area] = { area: t.area, count: 0, points: 0, approved: 0 });
    a.count += 1;
    a.points += Number(t.points) || 0;
    if (t.status === 'approved') a.approved += 1;
  }
  const byArea = Object.values(byAreaMap).sort((a, b) => b.points - a.points);

  res.json({
    total, pending, rectified, approved, rejected, overdue,
    totalPoints, completionRate, responseRate, byArea
  });
}));

// ---------- API：整改单列表 ----------
app.get('/api/tickets', handler(async (req, res) => {
  let list = [...db.getTickets()];
  const { status, area, overdue } = req.query;
  if (status) list = list.filter(t => t.status === status);
  if (area) list = list.filter(t => t.area === area);
  if (overdue === '1') list = list.filter(t => isOverdue(t));
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map(t => decorate(t)));
}));

// ---------- API：单条详情（员工扫码进入） ----------
app.get('/api/tickets/:id', handler(async (req, res) => {
  const t = db.getTicket(req.params.id);
  if (!t) {
    return res.status(404).json({
      error: '整改链接无效：该编号不存在或已被移除',
      code: 'NOT_FOUND'
    });
  }
  res.json(decorate(t));
}));

// ---------- API：生成二维码（链接到员工整改页） ----------
app.get('/api/tickets/:id/qrcode', handler(async (req, res) => {
  const t = db.getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: '整改单不存在', code: 'NOT_FOUND' });

  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/#/ticket/${t.id}`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
    color: { dark: '#1f2937', light: '#ffffff' }
  });
  res.send(svg);
}));

// ---------- API：管理员开单 ----------
app.post('/api/tickets',
  requireRole('admin'),
  upload.array('photos', 6),
  handler(async (req, res) => {
    const { area, desc, points, deadlineHours } = req.body;
    if (!area || !desc || !desc.trim()) {
      return res.status(400).json({ error: '请填写检查区域和问题描述', code: 'BAD_INPUT' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请至少上传 1 张问题照片', code: 'NO_PHOTO' });
    }
    const pts = Number(points);
    if (!Number.isFinite(pts) || pts <= 0 || pts > 100) {
      return res.status(400).json({ error: '扣分值需在 1~100 之间', code: 'BAD_INPUT' });
    }
    const hours = Number(deadlineHours);
    if (![6, 12, 24, 48, 72].includes(hours)) {
      return res.status(400).json({ error: '请选择整改时限', code: 'BAD_INPUT' });
    }

    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = db.nextSeq(dayKey);
    const id = `ZG${dayKey}-${String(seq).padStart(3, '0')}`;
    const by = actorName(req, '管理员');

    const issueImages = req.files.map((f, idx) => ({
      imageId: `ig-${Date.now()}-${idx}`,
      url: `/uploads/${f.filename}`,
      label: '问题照片',
      uploadedBy: by,
      uploadedAt: Date.now() + idx,
      deleted: false
    }));

    const ticket = {
      id, area: String(area).slice(0, 10),
      desc: String(desc).trim().slice(0, 500),
      points: pts,
      deadline: Date.now() + hours * 3600 * 1000,
      status: 'pending',
      issueImages,
      fixImages: [],
      createdBy: by,
      createdAt: Date.now(),
      submittedBy: null, submittedAt: null,
      reviewedBy: null, reviewedAt: null, reviewNote: '',
      history: [{ at: Date.now(), by, action: 'create', text: `创建整改单，上传 ${issueImages.length} 张问题照片` }]
    };
    db.addTicket(ticket);
    res.status(201).json(decorate(ticket));
  })
);

// ---------- API：员工提交整改 ----------
app.post('/api/tickets/:id/submit',
  upload.array('photos', 6),
  handler(async (req, res) => {
    const t = db.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '整改链接无效：该编号不存在', code: 'NOT_FOUND' });

    const force = req.body.force === 'true' || req.body.force === '1';
    const overdue = isOverdue(t);
    if (overdue && !force) {
      // 过期链接提示：需管理员/负责人延期，或显式确认仍提交（留痕）
      return res.status(410).json({
        error: `该整改单已于 ${new Date(t.deadline).toLocaleString('zh-CN')} 到期，请联系负责人延期后再提交`,
        code: 'EXPIRED',
        deadline: t.deadline
      });
    }
    if (t.status === 'approved') {
      return res.status(409).json({ error: '该整改单已复核通过，无需再次提交', code: 'ALREADY_DONE' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请拍摄并上传整改后的照片', code: 'NO_PHOTO' });
    }

    const by = actorName(req, '后厨员工');
    const news = req.files.map((f, idx) => ({
      imageId: `ig-${Date.now()}-${idx}`,
      url: `/uploads/${f.filename}`,
      label: '整改照片',
      uploadedBy: by,
      uploadedAt: Date.now() + idx,
      deleted: false
    }));
    t.fixImages = (t.fixImages || []).concat(news);
    t.status = 'rectified';
    t.submittedBy = by;
    t.submittedAt = Date.now();
    t.reviewNote = '';
    addHistory(t, by, 'submit',
      `提交 ${news.length} 张整改照片${overdue ? '（已超期，超期提交留痕）' : ''}`);
    db.updateTicket(t.id, {});
    res.json(decorate(t));
  })
);

// ---------- API：负责人复核通过 / 退回 ----------
app.post('/api/tickets/:id/review',
  requireRole('manager', 'admin'),
  handler(async (req, res) => {
    const t = db.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '整改单不存在', code: 'NOT_FOUND' });

    const pass = req.body.pass === true || req.body.pass === 'true';
    const note = String(req.body.note || '').trim().slice(0, 200);
    const by = actorName(req, '负责人');

    if (pass) {
      const aliveFix = (t.fixImages || []).filter(i => !i.deleted);
      if (aliveFix.length === 0) {
        return res.status(400).json({ error: '没有有效的整改照片，无法通过', code: 'NO_PHOTO' });
      }
      t.status = 'approved';
      t.reviewedBy = by; t.reviewedAt = Date.now(); t.reviewNote = note;
      addHistory(t, by, 'approve', '复核通过' + (note ? `：${note}` : ''));
    } else {
      if (!note) return res.status(400).json({ error: '退回时必须填写整改意见', code: 'BAD_INPUT' });
      t.status = 'rejected';
      t.reviewedBy = by; t.reviewedAt = Date.now(); t.reviewNote = note;
      addHistory(t, by, 'reject', `复核不通过：${note}`);
    }
    db.updateTicket(t.id, {});
    res.json(decorate(t));
  })
);

// ---------- API：重新上传（替换某张图片） ----------
app.post('/api/tickets/:id/images/:imageId/replace',
  (req, res, next) => { req.role = req.get('X-Role') || 'staff'; next(); },
  upload.single('photo'),
  handler(async (req, res) => {
    const t = db.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '整改单不存在', code: 'NOT_FOUND' });
    const img = findImage(t, req.params.imageId);
    if (!img) return res.status(404).json({ error: '图片不存在', code: 'NOT_FOUND' });

    const staffCanFix = img.label === '整改照片' && req.role === 'staff' && ['pending', 'rejected'].includes(t.status);
    if (req.role !== 'admin' && !staffCanFix) {
      return res.status(403).json({ error: '当前状态/身份不允许重新上传该图片', code: 'FORBIDDEN' });
    }
    if (!req.file) return res.status(400).json({ error: '请选择新的图片文件', code: 'NO_PHOTO' });

    const oldUrl = img.url;
    img.url = `/uploads/${req.file.filename}`;
    img.deleted = false;
    img.uploadedAt = Date.now();
    img.uploadedBy = actorName(req, img.label === '问题照片' ? '管理员' : '后厨员工');
    addHistory(t, img.uploadedBy, 'replace', `重新上传${img.label}（旧文件已标记失效）`);
    deleteFileQuiet(oldUrl);
    db.updateTicket(t.id, {});
    res.json(decorate(t));
  })
);

// ---------- API：删除图片（软删除 + 物理文件清理） ----------
app.delete('/api/tickets/:id/images/:imageId',
  handler(async (req, res) => {
    const role = req.get('X-Role') || 'staff';
    const t = db.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '整改单不存在', code: 'NOT_FOUND' });
    const img = findImage(t, req.params.imageId);
    if (!img) return res.status(404).json({ error: '图片不存在或已删除', code: 'NOT_FOUND' });
    if (img.deleted) return res.status(410).json({ error: '该图片已被删除', code: 'IMAGE_GONE' });

    const group = t.issueImages.includes(img) ? t.issueImages : t.fixImages;
    if (group === t.issueImages && role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可删除问题照片', code: 'FORBIDDEN' });
    }
    if (group === t.fixImages && t.status === 'approved' && !ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: '整改单已通过，图片不可删除', code: 'FORBIDDEN' });
    }
    if (group === t.fixImages && role === 'staff' && !['pending', 'rejected'].includes(t.status)) {
      return res.status(403).json({ error: '整改照片已提交，如需更换请联系负责人退回', code: 'FORBIDDEN' });
    }
    if (group.filter(i => !i.deleted).length <= 1) {
      return res.status(400).json({
        error: group === t.issueImages ? '至少保留 1 张问题照片' : '至少保留 1 张整改照片',
        code: 'LAST_IMAGE'
      });
    }

    img.deleted = true;
    img.deletedAt = Date.now();
    img.deletedBy = actorName(req, role === 'admin' ? '管理员' : role === 'manager' ? '负责人' : '后厨员工');
    addHistory(t, img.deletedBy, 'delete-image', `删除${img.label}（${path.basename(img.url)}）`);
    deleteFileQuiet(img.url);
    db.updateTicket(t.id, {});
    res.json({ ok: true, ticket: decorate(t) });
  })
);

// ---------- API：负责人延期（过期链接处置） ----------
app.post('/api/tickets/:id/extend',
  requireRole('manager', 'admin'),
  handler(async (req, res) => {
    const t = db.getTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '整改单不存在', code: 'NOT_FOUND' });
    if (t.status === 'approved') return res.status(409).json({ error: '已通过的整改单无需延期', code: 'ALREADY_DONE' });

    const hours = Number(req.body.hours);
    if (![6, 12, 24, 48, 72].includes(hours)) {
      return res.status(400).json({ error: '请选择延期时长', code: 'BAD_INPUT' });
    }
    const old = t.deadline;
    t.deadline = Math.max(Date.now(), old) + hours * 3600 * 1000;
    addHistory(t, actorName(req, '负责人'), 'extend',
      `延期 ${hours} 小时（${new Date(old).toLocaleString('zh-CN')} → ${new Date(t.deadline).toLocaleString('zh-CN')}）`);
    db.updateTicket(t.id, {});
    res.json(decorate(t));
  })
);

// ---------- 上传文件：已删除图片返回 410 占位，不留坏链 ----------
app.use('/uploads', (req, res, next) => {
  const filePath = path.join(db.UPLOAD_DIR, path.basename(req.path));
  if (!fs.existsSync(filePath)) {
    res.status(410).setHeader('Content-Type', 'image/svg+xml');
    return res.send('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
      '<rect width="100%" height="100%" fill="#f3f4f6" stroke="#d1d5db"/>' +
      '<text x="100" y="78" text-anchor="middle" font-size="14" fill="#9ca3af">图片已删除</text></svg>');
  }
  next();
}, express.static(db.UPLOAD_DIR, { maxAge: '7d' }));

function deleteFileQuiet(url) {
  try {
    fs.unlinkSync(path.join(db.UPLOAD_DIR, path.basename(url)));
  } catch (_) { /* 文件可能已不存在，忽略 */ }
}

// ---------- 错误处理（含 multer 超限/类型错误转中文提示） ----------
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const map = {
      LIMIT_FILE_SIZE: '图片不能超过 8MB，请压缩后重新上传',
      LIMIT_FILE_COUNT: '最多上传 6 张图片',
      LIMIT_UNEXPECTED_FILE: '上传字段不正确'
    };
    return res.status(400).json({ error: map[err.code] || '上传失败，请重试', code: err.code });
  }
  if (err) return res.status(400).json({ error: err.message || '请求处理失败', code: 'BAD_REQUEST' });
  next();
});

// 兜底：未知路由回到首页（hash 路由页面不受影响）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.load();
seedIfEmpty();
app.listen(PORT, () => {
  console.log(`食堂后厨整改台已启动: http://localhost:${PORT}`);
});
