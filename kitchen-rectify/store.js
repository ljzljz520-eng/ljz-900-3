// 轻量 JSON 文件存储（零原生依赖，替代 SQLite）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDB() {
  return { issues: [], seq: {}, counters: { issue: 0 } };
}

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) {
  db = emptyDB();
  save();
}

let saveTimer = null;
function save() {
  // 同步写，保证简单可靠（数据量小）
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('保存数据失败:', e.message);
  }
}
function saveDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 50);
}

module.exports = { db, save, saveDebounced };

function reload() {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // 原地替换内容，保持外部持有的 db 引用有效
    Object.keys(db).forEach((k) => delete db[k]);
    Object.assign(db, emptyDB(), loaded);
  } catch (e) {
    console.error('重新加载数据失败:', e.message);
  }
}
module.exports.reload = reload;
