# 规则加载矩阵

本矩阵定义规则的加载边界。仅 `core.md` 使用 `alwaysApply: true`；其他 Rule 使用 `alwaysApply: false`，由任务场景和核心规则路由决定是否读取。

| Rule | 常驻 | 场景 | 触发条件 | 职责 |
| ---- | ---- | ---- | -------- | ---- |
| `core.md` | 是 | `workspace_core` | 每个任务 | 跨任务安全、协作、验证责任和专项规则路由 |
| `database-migration.md` | 否 | `database_migration` | schema、索引、初始化、数据迁移、用户数据清理 | 迁移版本、升级、备份、回滚和数据生命周期 |
| `environment-security.md` | 否 | `environment_configuration` | 环境变量、生产配置、CORS、密钥、请求限制、环境审计 | 配置契约、生产安全和敏感信息保护 |
| `verification-gate.md` | 否 | `change_verification` | 代码、配置、依赖或构建行为变更交付前 | 默认验证、专项验证选择和验收摘要 |
| `service-cleanup.md` | 否 | `service_verification` | 启动或重启服务、后端/API 验收、端口清理 | 关闭服务并释放端口 |
| `git-commit-message.md` | 否 | `git_message` | 用户明确要求创建或修改 Git commit | Conventional Commits 格式和提交范围 |
| `spec-first-workflow.md` | 否 | `feature_implementation` | 中大型功能、跨模块需求、公共 API、数据库变更或边界不清 | 完整 Spec 的确认与实施顺序；轻量任务边界 |
| `spec-lifecycle.md` | 否 | `feature_implementation` | 创建、确认、实现、阻塞、完成或废弃 Spec | Spec 状态机、三文档一致性和验收证据 |

## 场景核对

| 样本任务 | 必须加载 | 不要求加载 | 结论 |
| -------- | -------- | ---------- | ---- |
| 单文件 Vue 样式调整 | `core.md`；交付时按需读取 `verification-gate.md` | 数据库、环境、服务、提交和完整 Spec Rule | 可按轻量任务直接实施 |
| 新增数据库索引 | `core.md`、`database-migration.md`、`spec-first-workflow.md`、`spec-lifecycle.md`、`verification-gate.md` | Git 提交规则；未启动服务时不要求服务关闭规则 | 必须进入完整 Spec 与迁移验证流程 |
