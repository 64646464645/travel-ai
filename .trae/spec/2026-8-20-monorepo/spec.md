# Monorepo 改造

> 状态：草案（待评审）
> 日期：2026-08-20
> 目标仓库：`travel-ai/`

## 1. 背景与目标

当前仓库包含两个逻辑独立、物理相邻的 TypeScript 应用（`travel-h5` 前端与 `travel-server` 后端），各自维护独立的 `package.json` 与锁文件，且共享的数据契约（旅行计划、聊天消息等类型）被前后端重复定义，存在漂移风险。

目标：统一依赖与锁文件管理、抽取共享数据契约、提供一键启动开发体验，同时最小化对业务代码的侵入。

## 2. 非目标

- 不引入微前端、不拆分更多业务包。
- 不引入 Turborepo/Nx 等重型编排工具。
- 不改变现有技术栈（Vue/Vite/Express/LangChain 均不变）。

## 3. 需求描述

### 用户故事 / 使用场景

- 作为开发者，我希望在仓库根目录执行一次 `npm install` 即可装齐前后端依赖。
- 作为开发者，我希望在根目录执行 `npm run dev` 一键同时启动前后端。
- 作为开发者，我希望前后端共享同一份数据契约，避免类型重复与漂移。

### 功能需求

- 使用 npm workspaces 管理多包，应用迁移到 `apps/`，共享包置于 `packages/shared`。
- 抽取 `@travel/shared` 包，以 zod schema + 派生类型承载共享数据契约。
- 后端复用 `@travel/shared` 的 zod schema 做运行时校验。
- 前端仅以 `import type` 消费 `@travel/shared` 的类型。
- 前端 API 地址不再硬编码绝对地址，改为环境变量 + dev proxy。

## 4. 验收标准

- [ ] 目录结构为 `apps/travel-h5`、`apps/travel-server`、`packages/shared`。
- [ ] 根目录 `npm install` 生成单一 `package-lock.json`。
- [ ] `npm run dev` 一键启动前后端。
- [ ] 前端 `npm run type-check`、后端 `npm run build` 均通过。
- [ ] 前端 `src/types/index.ts` 中与后端重复的类型已移除，统一引用 `@travel/shared`。
- [ ] 后端 `recommendService.ts` 不再本地定义 zod schema。
- [ ] 前端 API 地址不再硬编码绝对地址。
- [ ] 无 `.env`、`dist/` 被提交。
