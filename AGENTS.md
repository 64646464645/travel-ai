# 仓库指南

## 项目结构与模块组织

此仓库包含两个分别安装依赖的 TypeScript 应用：

- `travel-h5/` 是基于 Vue 3 + Vite 的移动端 Web 客户端。页面位于 `src/views/`，可复用 UI 位于 `src/components/`，路由位于 `src/router/`，共享类型、常量和工具函数位于 `src/types/`、`src/constants/` 和 `src/utils/`，静态文件位于 `public/`。
- `travel-server/` 是 Node.js 服务。HTTP 入口文件为 `src/index.ts`；路由位于 `src/routes/`，业务逻辑位于 `src/services/`，共享辅助函数位于 `src/utils/`。编译输出生成在 `dist/` 中，不应直接编辑或提交。

请分别进入两个应用目录安装依赖，因为它们各自拥有独立的 `package.json` 和锁文件。

## 构建、测试与开发命令

请在对应的应用目录中运行命令：

- `npm install` 安装依赖。
- `npm run dev` 启动 Vite 客户端，或使用 `nodemon` 和 `tsx` 启动服务端。
- `npm run build` 对客户端执行类型检查并构建，或将服务端编译到 `travel-server/dist/`。
- `npm run type-check` 运行客户端 Vue/TypeScript 类型检查。
- `npm run preview` 预览构建后的客户端。
- `npm start` 运行编译后的服务端；请先执行构建。

请根据 `.env.example` 创建 `travel-server/.env`，并在调用聊天或推荐接口前配置所选 LLM 提供商的 API 密钥。服务端默认端口为 `3300`。

## 代码风格与命名约定

使用严格模式的 TypeScript，并保持现有的两空格缩进和单引号风格。Vue 组件和页面使用 PascalCase（如 `SpotItem.vue`、`Profile.vue`）；函数、变量、服务和工具函数使用 camelCase；路由路径使用小写。客户端导入优先使用 Vue `<script setup>` 和现有的 `@` 别名。服务端职责应按路由、服务和辅助模块分离。

## 测试指南

当前尚未配置测试框架或测试套件。提交变更前，至少运行相关客户端的 `npm run type-check`，以及两个应用的构建命令。引入测试框架后，为新增行为添加针对性测试；测试名称应清晰描述所验证的行为。在占位脚本被替换之前，不要依赖服务端的 `npm test` 命令。

## 提交与拉取请求指南

近期提交使用简短摘要，通常带有 `refactor:` 前缀（例如 `refactor: migrate travel-server to TypeScript`）。请遵循简洁的 `<type>: <summary>` 格式，并将无关变更分开。拉取请求应说明面向用户的影响或 API 影响，列出验证命令，注明环境或配置变更，关联相关 issue，并在涉及客户端 UI 变更时附上截图。

## 安全与配置提示

不要提交 `.env`、API 密钥或生成的 `dist/` 输出。配置名称发生变化时，请同步更新 `.env.example`，并避免记录提供商凭据，或包含敏感数据的完整用户提示词/响应。
