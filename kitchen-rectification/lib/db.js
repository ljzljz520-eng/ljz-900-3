'use strict';
// JSON 文件存储：整改单（tickets）+ 编号自增序列（seq）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const DEFAULT_DB = { seq: {}, tickets: [] };

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

let data = null;

function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      // 数据文件损坏时备份并重建，避免整个服务不可用
      fs.copyFileSync(DB_FILE, DB_FILE + '.broken-' + Date.now());
      data = structuredClone(DEFAULT_DB);
    }
  } else {
    data = structuredClone(DEFAULT_DB);
  }
  data.seq = data.seq || {};
  data.tickets = Array.isArray(data.tickets) ? data.tickets : [];
}

let saveTimer = null;
function save() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE); // 原子替换，防止写入一半被读取
}

function getState() {
  if (!data) load();
  return data;
}

function nextSeq(dateKey) {
  const s = getState();
  s.seq[dateKey] = (s.seq[dateKey] || 0) + 1;
  save();
  return s.seq[dateKey];
}

function setSeq(dateKey, n) {
  const s = getState();
  s.seq[dateKey] = Math.max(s.seq[dateKey] || 0, n);
  save();
}

function getTickets() {
  return getState().tickets;
}

function getTicket(id) {
  return getState().tickets.find(t => t.id === id) || null;
}

function addTicket(ticket) {
  getState().tickets.push(ticket);
  save();
  return ticket;
}

function updateTicket(id, patch) {
  const t = getTicket(id);
  if (!t) return null;
  Object.assign(t, patch);
  save();
  return t;
}

module.exports = {
  UPLOAD_DIR,
  load,
  save,
  nextSeq,
  setSeq,
  getTickets,
  getTicket,
  updateTicket,
  addTicket
};
