/**
 * 极简 JSON 文件数据库（同步 + 写锁防抖，适合食堂检查小流量场景）
 * 数据文件: data/store.json
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STORE = {
  seq: { '': 0 }, // 日期序号，key 为 YYYYMMDD
  issues: [],
  admins: [{ username: 'admin', password: 'admin123', name: '王管理员' }]
};

let cache = null;
let writeTimer = null;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULT_STORE, null, 2));
  }
}

function load() {
  if (cache) return cache;
  ensure();
  try {
    cache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    console.error('存储文件损坏，使用备份/默认数据', e.message);
    cache = { ...DEFAULT_STORE, seq: { '': 0 }, issues: [] };
  }
  if (!cache.seq) cache.seq = { '': 0 };
  if (!cache.issues) cache.issues = [];
  if (!cache.admins) cache.admins = DEFAULT_STORE.admins;
  return cache;
}

/** 防抖落盘（400ms 合并多次写） */
function save() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    ensure();
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, STORE_FILE);
  }, 400);
}

function saveSync() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  ensure();
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

/** 生成编号: ZG-YYYYMMDD-001（每天从 001 开始） */
function nextIssueNo() {
  const db = load();
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  db.seq[day] = (db.seq[day] || 0) + 1;
  return `ZG-${day}-${String(db.seq[day]).padStart(3, '0')}`;
}

function getIssues() { return load().issues; }
function getIssue(id) { return load().issues.find(i => i.id === id); }
function getIssueByToken(token) { return load().issues.find(i => i.token === token); }

function insertIssue(issue) {
  load().issues.unshift(issue);
  save();
}

function updateIssue(id, patch) {
  const db = load();
  const it = db.issues.find(i => i.id === id);
  if (!it) return null;
  Object.assign(it, patch, { updatedAt: Date.now() });
  save();
  return it;
}

function deleteIssue(id) {
  const db = load();
  const idx = db.issues.findIndex(i => i.id === id);
  if (idx === -1) return false;
  db.issues.splice(idx, 1);
  save();
  return true;
}

function findAdmin(username, password) {
  return load().admins.find(a => a.username === username && a.password === password);
}

module.exports = {
  load, save, saveSync, nextIssueNo,
  getIssues, getIssue, getIssueByToken,
  insertIssue, updateIssue, deleteIssue, findAdmin
};
