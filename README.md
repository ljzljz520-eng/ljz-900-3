# 🍳 食堂后厨整改台

食堂后厨卫生检查整改闭环系统：管理员拍照建单 → 自动编号+整改二维码 → 后厨员工扫码补整改图 → 负责人核验、看板汇总。

## 启动

```bash
npm start                 # 启动 http://localhost:3000
npm run seed              # （可选）写入 3 条演示数据
```

- 管理端：http://localhost:3000/admin ，默认账号 `admin` / `admin123`
- 员工端：管理端建单后点「整改二维码」，微信扫码进入（也可在浏览器打开链接）
- 数据存储：`data/store.json`；图片：`uploads/`（无数据库依赖）

## 功能与需求对照

| 需求 | 实现 |
|---|---|
| 上传灶台/冰箱/地面问题照片 | 建单弹窗多选上传，区域下拉（灶台/冰箱/地面/备餐台…），单张≤8MB |
| 生成编号 | 自动生成 `ZG-年月日-序号`（每日从 001 起），另生成员工整改二维码 |
| 扫码补整改图 | 一单一 token，员工免登录上传整改照片+整改人+说明，支持进度显示 |
| 负责人汇总页 | 累计扣分、问题总数、待整改/待核验/已完成/已超期、完成率、提交率、区域扣分分布、CSV 导出 |
| 删除图片提示 | 管理端/员工端删图均有二次确认弹窗，删除后 Toast 提示；物理文件同步删除 |
| 重新上传提示 | 选图超限/格式错误/上传失败/网络中断均有明确 Toast；驳回后重传自动替换旧图 |
| 过期链接提示 | 链接默认 48h 有效；过期/无效/图片丢失分别展示专门提示页，可由管理员一键「重新生成链接」 |

## 状态流转

待整改（pending）→ 员工提交 → 待核验（submitted）→ 负责人通过 → 已完成（approved）
　　　　　　　　　　　　　　　　↘ 驳回 → 员工重新上传
超过整改期限未提交自动标记「已超期」（看板与列表实时计算）。

## 主要接口

- `POST /api/admin/login` · `POST /api/admin/issues`（建单）· `GET /api/admin/issues`
- `POST /api/admin/issues/:id/photos` 补传 · `/photos/delete` 删图 · `/review` 核验 · `/relink` 续期 · `/qrcode`
- `GET /api/admin/dashboard` 汇总
- `GET /api/staff/issue/:token` · `POST /api/staff/upload/:token` · `POST /api/staff/photo/delete/:token`
