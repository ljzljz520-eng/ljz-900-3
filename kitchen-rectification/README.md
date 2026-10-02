# 🍳 食堂后厨整改台

食堂后厨安全检查 → 拍照编号派单 → 员工扫码整改 → 负责人复核闭环的全流程小应用。

## 快速开始

```bash
cd kitchen-rectification
npm install      # 依赖已在 node_modules 中，可跳过
npm start        # 默认 http://localhost:3000  （PORT=8080 npm start 可换端口）
```

首次启动自动生成 4 条演示整改单（灶台/冰箱/地面/排烟罩，覆盖待整改、待复核、已通过、已退回+过期四种状态）和示意照片，开箱即用。

## 三种角色（右上角切换，仅本机演示用，操作会留痕）

| 角色 | 能做什么 |
|---|---|
| 🔍 **管理员** | 巡检开单：选区域、填问题描述与扣分、上传 1–6 张问题照片、设定 6–72h 整改时限；生成 `ZG20261002-001` 式编号和整改二维码；可删/换问题照片 |
| 👨‍🍳 **后厨员工** | 扫码（或打开整改链接）查看问题、上传整改照片提交；被退回后可重新整改 |
| 📊 **负责人** | 汇总看板（扣分、状态分布、完成率、区域扣分）；复核通过或退回（退回必须填意见）；过期单可一键延期 |

## 核心流程

```
管理员开单 ──► 生成编号+二维码 ──► 员工扫码补整改图 ──► 负责人复核
   待整改                                                ├─ 通过 ─► 已闭环
                                                        └─ 退回 ─► 员工重新整改
```

- 编号规则：`ZG + 日期 + 当日序号`，按日自增，不重号。
- 整改时限：开单时选择；到期未闭环即标记「已过期」。

## 提示与异常处理（均有中文提示）

- **删除图片**：二次确认弹窗 → 软删除 + 物理文件清理 + 操作记录留痕；原图片链接立即返回 410「图片已删除」占位图，不会出现裂图；至少保留 1 张照片。
- **重新上传**：替换图片前二次确认；旧文件删除、旧链接失效，操作写入时间线。
- **过期链接**：员工扫码进入显示醒目的过期横幅并锁定提交区；负责人/管理员可在该页直接延期（+6/12/24/48h）恢复有效；员工若强行提交会被 410 拦截，确认后可「超期提交留痕」。
- **上传校验**：仅图片、单张 ≤ 8MB、最多 6 张，超限/类型错误均有中文 toast。
- **无效链接**：编号不存在或已移除时进入「整改链接无效」提示页。
- **权限**：员工不能开单/延期/删问题照片；整改照片提交后即锁定，需负责人退回才能更换。

## 技术栈

- 后端：Node.js + Express，Multer 处理上传，qrcode 生成 SVG 二维码，JSON 文件持久化（`data/store.json`，原子写入）
- 前端：原生 HTML/CSS/JS 单页（hash 路由），移动端优先，无构建步骤
- 图片：存于 `uploads/`，首次启动用 pngjs 生成演示图

## 目录

```
kitchen-rectification/
├── server.js          # Express 服务与全部 API
├── lib/
│   ├── db.js          # JSON 存储与编号序列
│   ├── upload.js      # multer 类型/大小校验
│   └── seed.js        # 首启演示数据
├── public/            # 前端单页（index.html / app.js / styles.css）
├── data/              # 持久化数据（.gitignore）
└── uploads/           # 上传图片（.gitignore）
```

## 主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats` | 看板汇总（扣分/状态/完成率/区域） |
| GET | `/api/tickets` | 列表（支持 `status` `area` `overdue` 过滤） |
| GET | `/api/tickets/:id` | 详情（不存在返回 404 中文提示） |
| GET | `/api/tickets/:id/qrcode` | 整改二维码（SVG） |
| POST | `/api/tickets` | 管理员开单（multipart，角色 admin） |
| POST | `/api/tickets/:id/submit` | 员工提交整改（过期返回 410，`force=true` 超期留痕） |
| POST | `/api/tickets/:id/review` | 复核 `{pass,note}`（退回必填 note） |
| POST | `/api/tickets/:id/extend` | 延期（manager/admin） |
| POST | `/api/tickets/:id/images/:imageId/replace` | 重新上传替换 |
| DELETE | `/api/tickets/:id/images/:imageId` | 删除图片（软删+清文件） |
