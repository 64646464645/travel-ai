# 仓库指南

## 项目结构与模块组织

此仓库是基于 npm workspaces 的 monorepo，在根目录统一安装依赖与运行命令：

- `apps/travel-h5/` 是基于 Vue 3 + Vite 的移动端 Web 客户端。页面位于 `src/views/`，可复用 UI 位于 `src/components/`，路由位于 `src/router/`，共享类型、常量和工具函数位于 `src/types/`、`src/constants/` 和 `src/utils/`，静态文件位于 `public/`。
- `apps/travel-server/` 是 Node.js 服务。HTTP 入口文件为 `src/index.ts`；路由位于 `src/routes/`，业务逻辑位于 `src/services/`，共享辅助函数位于 `src/utils/`。编译输出生成在 `dist/` 中，不应直接编辑或提交。
- `packages/shared/` 是前后端共享的数据契约包（`@travel/shared`），以 zod schema 与派生类型定义旅行计划、聊天消息等类型。

依赖由根目录 `package.json` 的 `workspaces` 统一管理，生成单一 `package-lock.json`。

## 构建、测试与开发命令

在仓库根目录运行以下命令：

- `npm install` 安装所有 workspace 依赖并生成单一锁文件。
- `npm run dev` 同时启动服务端（nodemon + tsx）与客户端（Vite）。
- `npm run build` 依次构建 `@travel/shared`、`travel-server` 与 `travel-h5`。
- `npm run type-check` 运行客户端 Vue/TypeScript 类型检查。
- `npm run dev -w travel-h5`、`npm run build -w travel-server` 等可对单个包运行命令。

请根据 `.env.example` 创建 `apps/travel-server/.env`，并在调用聊天或推荐接口前配置所选 LLM 提供商的 API 密钥。服务端默认端口为 `3300`；客户端开发时通过 Vite 代理将 `/api` 转发到该端口。

## 代码风格与命名约定

使用严格模式的 TypeScript，并保持现有的两空格缩进和单引号风格。Vue 组件和页面使用 PascalCase（如 `SpotItem.vue`、`Profile.vue`）；函数、变量、服务和工具函数使用 camelCase；路由路径使用小写。客户端导入优先使用 Vue `<script setup>` 和现有的 `@` 别名。服务端职责应按路由、服务和辅助模块分离。

## 工作区规则

规则加载和治理要求见 `.trae/rules/core.md`。项目指南仅维护仓库结构、开发命令和代码约定；数据库、环境安全、验证、服务清理、Spec 和提交规范由核心规则按场景路由到专项 Rule。
