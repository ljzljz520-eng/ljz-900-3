/**
 * 演示数据：生成 3 条不同状态的整改单（含 1x1 占位图，真实使用时替换成照片）
 * 运行: npm run seed
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 1x1 PNG（灰/红/绿）
const png = {
  gray: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  red: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8Dwn4EKAwAyGAFrE2NxXQAAAABJRU5ErkJggg==', 'base64'),
  green: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QzwAEjQGAZ8kBzAAAAABJRU5ErkJggg==', 'base64')
};
function mkImg(color) {
  const key = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.png';
  fs.writeFileSync(path.join(UPLOAD_DIR, key), png[color]);
  return { key, uploadedAt: Date.now() };
}

const now = Date.now();
db.load();
db.getIssues().length = 0; // 清空演示单
db.load().seq = {};

const samples = [
  { area: '灶台', title: '灶台积油严重，火嘴周边油污结块', score: 5, ttl: 48,
    desc: '1号灶台正面及火嘴周围有明显积油，存在火灾隐患，要求全面拆洗。', state: 'overdue',
    inspector: '王管理员' },
  { area: '冰箱', title: '冰箱内生熟混放，半成品未覆膜', score: 3, ttl: 24,
    desc: '立式冷藏柜中生肉与即食蔬菜同层摆放，多个保鲜盒无覆膜无日期标签。', state: 'submitted',
    inspector: '王管理员', rectifier: '李厨师', note: '已分层摆放，生肉下移并加贴标签，全部覆膜。' },
  { area: '地面', title: '排水沟周边地面积水湿滑', score: 2, ttl: 48,
    desc: '洗菜区地面长期积水，已放置警示牌但未疏通，请清理排水口并拖干。', state: 'approved',
    inspector: '王管理员', rectifier: '张帮厨', note: '已疏通排水口、拖干地面并撒防滑粉。' }
];

samples.forEach((s, idx) => {
  const no = db.nextIssueNo();
  const problem = [mkImg('red')];
  const issue = {
    id: crypto.randomBytes(9).toString('hex'),
    no, area: s.area, title: s.title, description: s.desc, score: s.score,
    inspector: s.inspector,
    problemImages: problem,
    rectifyImages: [],
    rectifier: null, rectifyNote: '', approved: false, approvedAt: null, rejectReason: '',
    token: crypto.randomBytes(12).toString('hex'),
    createdAt: now - (idx + 2) * 3600 * 1000,
    updatedAt: now - idx * 3600 * 1000,
    deadline: s.state === 'overdue' ? now - 5 * 3600 * 1000 : now + (s.ttl - idx) * 3600 * 1000,
    expiresAt: now + 72 * 3600 * 1000
  };
  if (s.state === 'submitted' || s.state === 'approved') {
    issue.rectifyImages = [mkImg('green')];
    issue.rectifier = s.rectifier; issue.rectifyNote = s.note;
  }
  if (s.state === 'approved') { issue.approved = true; issue.approvedAt = now - 3600 * 1000; }
  db.getIssues().push(issue);
});

db.saveSync();
console.log('✅ 演示数据已写入: 3 条整改单（已超期 / 待核验 / 已完成）');
console.log('   启动服务后登录 http://localhost:3000/admin  账号 admin / admin123');
