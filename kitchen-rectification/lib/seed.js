'use strict';
// 首次启动时生成演示数据（含各状态整改单 + 示意照片）
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const db = require('./db');

function makePng(filePath, base, pattern) {
  const W = 480, H = 360;
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) * 4;
      const noise = ((x * 13 + y * 7) % 37) - 18;
      let [r, g, b] = base.map(v => Math.max(0, Math.min(255, v + noise)));
      if (pattern === 'floor') {
        if (x % 80 < 4 || y % 80 < 4) [r, g, b] = [210, 210, 210];
        const dx = x - 300, dy = y - 230;
        if (Math.hypot(dx, dy * 1.6) < 70) [r, g, b] = [70, 86, 60];
      } else if (pattern === 'stove') {
        if ((x - 140) ** 2 + (y - 200) ** 2 < 60 ** 2) [r, g, b] = [45, 45, 48];
        if ((x - 330) ** 2 + (y - 200) ** 2 < 60 ** 2) [r, g, b] = [45, 45, 48];
        if (Math.hypot(x - 230, y - 280) < 45) [r, g, b] = [120, 90, 40];
      } else if (pattern === 'fridge') {
        if (Math.abs(y - 130) < 6 || Math.abs(y - 230) < 6) [r, g, b] = [170, 185, 195];
        if ((x - 150) ** 2 + (y - 185) ** 2 < 30 ** 2) [r, g, b] = [190, 70, 60];
        if ((x - 190) ** 2 + (y - 180) ** 2 < 24 ** 2) [r, g, b] = [80, 150, 70];
      } else if (pattern === 'hood') {
        if (Math.abs(y - 120) < 50 && x > 90 && x < 390) [r, g, b] = [150, 150, 155];
        if (x === 240 && y > 165 && y < 200) [r, g, b] = [90, 70, 30];
      } else if (pattern === 'clean') {
        if (Math.abs(x - y) < 12) [r, g, b] = [255, 255, 255];
      }
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function seedIfEmpty() {
  if (db.getTickets().length > 0) return;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const demos = [
    {
      area: '灶台', desc: '灶台表面有明显油污，火眼周边残渣未清理，存在消防隐患。',
      points: 8, base: [176, 150, 120], pattern: 'stove',
      status: 'pending', deadlineHours: 24, offset: -2 * 60 * 60 * 1000
    },
    {
      area: '冰箱', desc: '生肉与即食蔬菜同层混放，未覆膜，有交叉污染风险。',
      points: 12, base: [200, 220, 230], pattern: 'fridge',
      status: 'rectified', deadlineHours: 48, offset: -26 * 60 * 60 * 1000
    },
    {
      area: '地面', desc: '备餐区地面积水未拖干，员工易滑倒。',
      points: 5, base: [225, 225, 220], pattern: 'floor',
      status: 'approved', deadlineHours: 24, offset: -3 * day
    },
    {
      area: '排烟罩', desc: '排烟罩滤网油垢厚积，滴油到锅台上方。',
      points: 15, base: [180, 180, 175], pattern: 'hood',
      status: 'rejected', deadlineHours: 12, offset: -20 * 60 * 60 * 1000
    }
  ];

  let seq = 0;
  for (const d of demos) {
    seq += 1;
    const id = `ZG${dayKey}-${String(seq).padStart(3, '0')}`;
    const createdAt = now + d.offset;
    const deadline = createdAt + d.deadlineHours * 60 * 60 * 1000;

    const issueImg = `${id}-issue.png`;
    makePng(path.join(db.UPLOAD_DIR, issueImg), d.base, d.pattern);

    const issueImages = [{
      imageId: 'ig-1',
      url: '/uploads/' + issueImg,
      label: '问题照片',
      uploadedBy: '管理员·王检查',
      uploadedAt: createdAt,
      deleted: false
    }];

    let fixImages = [];
    let submittedBy = null, submittedAt = null, reviewedBy = null, reviewedAt = null, reviewNote = '';

    if (['rectified', 'approved', 'rejected'].includes(d.status)) {
      const fixImg = `${id}-fix.png`;
      makePng(path.join(db.UPLOAD_DIR, fixImg), d.pattern === 'clean' ? [200, 220, 200] : [205, 215, 200], 'clean');
      fixImages = [{
        imageId: 'ig-2',
        url: '/uploads/' + fixImg,
        label: '整改照片',
        uploadedBy: '后厨员工·李厨',
        uploadedAt: createdAt + 3 * 60 * 60 * 1000,
        deleted: false
      }];
      submittedBy = '后厨员工·李厨';
      submittedAt = createdAt + 3 * 60 * 60 * 1000;
    }
    if (d.status === 'approved') {
      reviewedBy = '负责人·张主管';
      reviewedAt = submittedAt + 2 * 60 * 60 * 1000;
      reviewNote = '整改到位，已复核。';
    }
    if (d.status === 'rejected') {
      reviewedBy = '负责人·张主管';
      reviewedAt = submittedAt + 1 * 60 * 60 * 1000;
      reviewNote = '只擦了表面，油垢仍在，请拆洗滤网后重新提交。';
    }

    db.addTicket({
      id, area: d.area, desc: d.desc, points: d.points, deadline, status: d.status,
      issueImages, fixImages,
      createdBy: '管理员·王检查', createdAt,
      submittedBy, submittedAt,
      reviewedBy, reviewedAt, reviewNote,
      history: buildHistory(d.status, createdAt, submittedAt, reviewedAt)
    });
  }
  // 将演示数据占用的序号回填，避免后续开单重号
  db.setSeq(dayKey, seq);
  db.save();

  function buildHistory(status, created, submitted, reviewed) {
    const h = [{ at: created, by: '管理员·王检查', action: 'create', text: '创建整改单并上传问题照片' }];
    if (submitted) h.push({ at: submitted, by: '后厨员工·李厨', action: 'submit', text: '提交整改照片' });
    if (reviewed) h.push({
      at: reviewed, by: '负责人·张主管',
      action: status === 'approved' ? 'approve' : 'reject',
      text: status === 'approved' ? '复核通过' : '复核不通过，退回重新整改'
    });
    return h;
  }
}

module.exports = { seedIfEmpty };
