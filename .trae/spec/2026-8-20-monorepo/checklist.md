# Monorepo 改造 - 检查清单

## 开发前

- [x] 需求边界已确认
- [x] 涉及文件/模块已定位（travel-h5、travel-server、types、request.ts 等）

## 开发中

- [x] 目录迁移到 apps/（git mv，保持历史）
- [x] 根 workspace 配置（workspaces、concurrently 脚本）
- [x] 新增 packages/shared（zod schema + 类型）
- [x] 后端迁移 zod schema 到共享包
- [x] 前端切换为消费 @travel/shared 类型
- [x] Vite alias 与 server.fs.allow 配置
- [x] 前端 API 地址治理（环境变量 + proxy）

## 完成后验收

- [x] 目录结构为 apps/travel-h5、apps/travel-server、packages/shared
- [x] 根目录 npm install 生成单一 package-lock.json
- [x] npm run dev 一键启动前后端
- [x] 前端 type-check、后端 build 均通过
- [x] 前端 types/index.ts 中重复类型已移除，统一引用 @travel/shared
- [x] 后端 recommendService.ts 不再本地定义 zod schema
- [x] 前端 API 地址不再硬编码绝对地址
- [x] 无 .env、dist 被提交
