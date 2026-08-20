# Monorepo 改造 - 任务拆分

## 任务列表

| 编号 | 任务                                           | 依赖 | 验收标准                                |
| ---- | ---------------------------------------------- | ---- | --------------------------------------- |
| T1   | 目录迁移到 `apps/` 并建立根 workspace + 根脚本 | -    | 根 `npm install` 成功，子包脚本仍可运行 |
| T2   | 新增 `packages/shared`，后端迁入 zod schema    | T1   | 后端 `npm run build` 通过               |
| T3   | 前端改为消费 `@travel/shared` 类型             | T2   | 前端 `npm run type-check` 通过          |
| T4   | 清理前端硬编码 API 地址（proxy/env）           | T3   | 前后端联调正常                          |

## 分阶段计划

### P0（T1）

- 使用 `git mv` 将 `travel-h5/` → `apps/travel-h5/`、`travel-server/` → `apps/travel-server/`。
- 新增根 `package.json`（workspaces、`concurrently` 脚本）与 `tsconfig.base.json`。
- 根目录 `npm install` 生成单一锁文件。

### P1（T2）

- 新增 `packages/shared`，导出 `travel.ts`（zod schema + 类型）与 `chat.ts`。
- 后端 `recommendService.ts` 改为从 `@travel/shared` 导入 schema。

### P2（T3）

- 前端删除与后端重复的类型，改为 `import type` 消费 `@travel/shared`。
- 配置 Vite alias 与 `server.fs.allow`。

### P3（T4）

- 前端 API 地址改为 `VITE_API_BASE_URL` 环境变量 + dev proxy。
