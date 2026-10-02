# 食堂后厨整改台

面向食堂后厨卫生检查的「发现问题 → 扫码整改 → 验收闭环」管理工具。

## 角色与页面

| 角色 | 入口 | 能做什么 |
|---|---|---|
| 管理员 | `/admin.html` | 检查时选择区域（灶台/冰箱/地面…），上传问题照片，设置扣分与整改期限，生成编号和整改二维码；可补传/删除照片、审核（通过/驳回）、延期、删除整单 |
| 后厨员工 | `/fix.html?code=编号`（扫码进入） | 查看问题照片与倒计时，拍照上传整改图（可删除重传），提交验收；被驳回后可重新整改 |
| 负责人 | `/dashboard.html` | 汇总页：扣分总额/当前扣分、各状态数量、**完成率**、区域分布、整改明细，30 秒自动刷新 |

## 状态流转

```
待整改 pending ──员工提交──▶ 待验收 fixed ──管理员通过──▶ 已通过 approved
     ▲                          │
     └────────管理员驳回(自动顺延24h)──┘
待整改/驳回 且超过截止时间 ⇒ 已过期 expired（动态计算，管理员延期后恢复）
```

编号规则：`ZG-YYYYMMDD-NNN`（按日递增），二维码内容直接指向员工整改页。

## 关键提示设计（需求点）

- **删除图片**：前端二次确认弹窗；后端保证问题照片至少保留 1 张、整改照片提交后不可删（需管理员驳回）。
- **重新上传**：建单前可移除本地待传图；建单后员工在提交前可删除/补传整改图，被驳回后也可重新上传；上传失败明确提示并可重试。
- **过期链接**：超过期限扫码进入显示「链接已失效/已过期」横幅，禁止上传与提交，提示联系负责人延期；负责人一键延期 24h 后链接恢复。
- 其他校验：仅图片、单张 ≤10MB、最多 9 张、必须有照片才能建单/提交、二维码/编号错误给出 404 提示。

## 技术栈

- Node.js 20 + Express
- multer（图片上传，落盘到 `uploads/`）
- qrcode（二维码 dataURL）
- JSON 文件存储 `data/db.json`（零原生依赖，沙箱无法编译 better-sqlite3 时的等价方案；支持 SIGHUP 热加载）
- 原生 HTML/CSS/JS 前端，移动端优先，支持手机调起相机（`capture="environment"`）

## 运行

```bash
cd kitchen-rectify
npm install
npm start            # http://localhost:3000
PORT=8080 npm start  # 自定义端口
```

> 手机扫码需要能从手机访问到本机地址（同一局域网，用本机 IP:端口），
> 二维码会自动使用当前访问的 host 生成绝对链接。

## 主要接口

- `GET  /api/issues`（可按 `status/area/q` 过滤）
- `POST /api/issues`（multipart：area、category、points、hours、description、photos）
- `GET  /api/issues/:codeOrId`、`GET  /api/issues/:codeOrId/qr`
- `POST /api/issues/:code/photos`（补传问题照片）
- `POST /api/issues/:code/fix-photos`（员工传整改图）
- `DELETE /api/issues/:code/photos/:kind/:photoId`
- `POST /api/issues/:code/submit`
- `PUT  /api/issues/:code/review`（`{action: approve|reject, comment}`）
- `POST /api/issues/:code/extend`（`{hours}`）
- `DELETE /api/issues/:code`
- `GET  /api/stats`
