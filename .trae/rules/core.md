---
alwaysApply: true
scene: workspace_core
---

# 核心工作区规则

- 使用中文沟通；修改前读取相关文件并遵循仓库既有约定。
- 不覆盖、删除或回滚用户已有改动，除非用户明确要求。
- 不提交或输出 `.env`、密钥、令牌、密码、完整认证头、完整用户对话或完整模型响应。
- 代码、配置、依赖或构建行为变更交付前，执行与风险匹配的验证，并说明未执行项及原因。
- 未经用户明确要求，不创建 Git commit。

## Token 效率

- 终端命令仅保留退出码与尾部错误，不整段返回构建或服务日志。
- 搜索先定位目标文件，再精准读取，避免全量匹配内容。
- 已读取的文件优先复用行号引用，避免重复读取。
- 大范围或开放式代码探索使用 `search` 子代理并仅回传摘要；已知文件或符号使用定向工具。

## 专项规则路由

- 数据库 schema、索引、初始化、数据迁移或用户数据清理：读取 `database-migration.md`。
- 环境变量、生产配置、CORS、密钥、请求限制或环境审计：读取 `environment-security.md`。
- 启动服务、后端/API 验收或端口清理：读取 `verification-gate.md` 和 `service-cleanup.md`。
- 用户要求创建或修改 Git commit：读取 `git-commit-message.md`。
- 中大型功能、跨模块需求、公共 API、数据库变更或需求边界不清：读取 `spec-first-workflow.md` 和 `spec-lifecycle.md`。
