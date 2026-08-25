# Travel AI

Travel AI 是一个面向中文用户的 AI 旅行规划与问答应用。用户可以注册账号，生成旅行计划，并通过支持流式输出的 AI 对话继续完善行程。

## 功能

- 根据目的地、预算和出行天数生成旅行计划
- 展示每日行程、景点、交通、预算拆分及旅行提示
- 支持 AI 旅行问答和 SSE 流式响应
- 支持会话创建、查询、消息查看、重命名和删除
- 支持注册、登录、退出、刷新令牌和当前用户查询
- 使用 MySQL 保存用户、会话、消息和刷新令牌
- 使用短期上下文和基于向量检索的长期记忆提升对话连续性
- 非生产环境提供 Swagger API 文档

## 技术栈

- 前端：Vue 3、Vite、TypeScript、Vant、Pinia、Vue Router
- 服务端：Node.js、Express、TypeScript、LangChain
- 数据库：MySQL
- 长期记忆：Qwen Embedding、Vectra
- 共享契约：Zod schema 和 TypeScript 类型
- 仓库管理：npm workspaces

## 项目结构

```text
travel-ai/
├── apps/
│   ├── travel-h5/       Vue 3 移动端 Web 客户端
│   └── travel-server/   Express API、AI 服务和数据存储
├── packages/
│   └── shared/          前后端共享的 Zod schema 与类型
├── package.json         根目录 workspace 脚本
└── package-lock.json    根目录统一依赖锁文件
```

## 环境要求

- Node.js LTS
- npm
- MySQL 8.x 或兼容版本
- 至少一个聊天模型服务的 API Key
- 使用长期记忆时需要配置 Qwen Embedding API Key

## 快速开始

### 1. 安装依赖

在仓库根目录执行：

```bash
npm install
```

### 2. 配置服务端环境变量

复制服务端配置示例：

```bash
copy apps\travel-server\.env.example apps\travel-server\.env
```

Linux 或 macOS 可执行：

```bash
cp apps/travel-server/.env.example apps/travel-server/.env
```

至少填写数据库连接信息、`JWT_SECRET` 和当前使用模型提供商对应的 API Key。默认使用 DeepSeek：

```env
PROVIDER=DEEPSEEK
DEEPSEEK_API_KEY=your-api-key
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=travel_ai
JWT_SECRET=replace-with-a-long-random-secret
```

如果使用 Qwen 作为聊天模型：

```env
PROVIDER=QWEN
QWEN_API_KEY=your-api-key
```

长期记忆使用 Qwen Embedding，与聊天模型的 `PROVIDER` 独立，因此启用长期记忆时需要保留 `QWEN_API_KEY`。

### 3. 配置前端环境变量

本地开发时通常不需要配置。前端会将 `/api` 请求代理到 `http://127.0.0.1:3300`。

如果前端与服务端分开部署，可复制并填写：

```bash
copy apps\travel-h5\.env.example apps\travel-h5\.env
```

```env
VITE_API_BASE_URL=https://your-api.example.com
```

### 4. 启动开发环境

在仓库根目录执行：

```bash
npm run dev
```

默认地址：

- 前端：`http://localhost:5173`
- 服务端：`http://localhost:3300`

服务端首次启动时会初始化所需的 MySQL 数据表。

## 常用命令

```bash
# 启动前端、服务端和共享包 watch
npm run dev

# 构建整个项目
npm run build

# 执行全仓类型检查
npm run type-check

# 单独构建前端
npm run build -w travel-h5

# 单独构建服务端
npm run build -w travel-server

# 运行长期记忆相关测试
npm run test:eval -w travel-server

# 运行长期记忆检索评测
npm run eval:memory -w travel-server
npm run eval:memory:matrix -w travel-server
npm run eval:memory:e2e -w travel-server
```

## 服务端配置

服务端配置文件为 `apps/travel-server/.env`，完整字段请参考 `apps/travel-server/.env.example`。

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境；生产环境应设置为 `production` | `development` |
| `PORT` | 服务端口 | `3300` |
| `PROVIDER` | 聊天模型提供商，可选 `DEEPSEEK` 或 `QWEN` | `DEEPSEEK` |
| `LLM_TIMEOUT_MS` | 模型请求超时时间，单位为毫秒 | `120000` |
| `MEMORY_WINDOW_SIZE` | 短期记忆窗口大小 | `10` |
| `MEMORY_TOP_K` | 长期记忆检索返回数量 | `4` |
| `MEMORY_SCORE_THRESHOLD` | 长期记忆检索分数阈值 | `0.3` |
| `VECTOR_INDEX_DIR` | Vectra 向量索引目录 | `data/vectra` |
| `MEMORY_EXTRACTION_ENABLED` | 是否启用结构化长期记忆抽取 | `true` |
| `ACCESS_TOKEN_TTL` | 访问令牌有效期 | `15m` |
| `REFRESH_TOKEN_TTL` | 刷新令牌有效期 | `30d` |

## API 文档

开发环境启动服务端后，可访问：

- Swagger UI：`http://localhost:3300/api-docs`
- OpenAPI JSON：`http://localhost:3300/api-docs.json`
- 健康检查：`GET http://localhost:3300/api/heartbeat`
- 指标接口：`GET http://localhost:3300/api/stats`

主要 API 分组如下：

| 分组 | 路径 | 说明 |
| --- | --- | --- |
| 认证 | `/api/auth` | 注册、登录、刷新令牌、退出和当前用户 |
| 旅行 | `/api/travel` | 生成旅行计划和 AI 聊天 |
| 会话 | `/api/travel/sessions` | 管理旅行问答会话及消息 |
| 指标 | `/api/stats` | 查看服务运行和记忆检索指标 |

除认证公开接口和健康检查外，旅行、会话及当前用户接口需要在请求头中携带 JWT：

```http
Authorization: Bearer <access-token>
```

## 安全注意事项

- 不要提交 `.env` 文件、API Key、数据库密码或真实 JWT 密钥
- 生产环境必须将 `NODE_ENV` 设置为 `production`
- 生产环境必须使用高熵随机值替换 `JWT_SECRET`
- 生产环境应限制 CORS 来源，并通过 HTTPS 传输令牌和用户数据
- 不要在日志、Issue 或文档中粘贴完整认证头、令牌或用户对话

## 生产构建

构建整个项目：

```bash
npm run build
```

构建完成后，服务端输出位于 `apps/travel-server/dist`。启动服务端：

```bash
npm run start -w travel-server
```

前端静态资源位于 `apps/travel-h5/dist`，可部署到任意支持静态文件托管的 Web 服务器，并通过 `VITE_API_BASE_URL` 指向服务端 API。

## 许可

当前项目未声明开源许可证，使用和分发前请遵循项目维护者的授权约定。
