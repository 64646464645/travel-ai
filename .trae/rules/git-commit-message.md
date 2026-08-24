---
alwaysApply: false
scene: git_message
---

# Git 提交信息规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范，格式如下：

```
<type>(<scope>): <subject>

<body>

<footer>
```

## 格式要求

1. **type**：必填，表示提交类型
2. **scope**：可选，表示影响范围（如模块、页面、组件名）
3. **subject**：必填，简明扼要描述本次改动，不超过 50 个字符
4. **body**：可选，详细说明改动原因、上下文或与之前行为的差异
5. **footer**：可选，关联 issue、breaking change 等

## type 类型

| 类型     | 说明                                               |
| -------- | -------------------------------------------------- |
| feat     | 新增功能                                           |
| fix      | 修复 Bug                                           |
| docs     | 文档变更                                           |
| style    | 代码格式（不影响逻辑，如空格、缩进、分号等）       |
| refactor | 重构（既非新功能也非修复 Bug）                     |
| perf     | 性能优化                                           |
| test     | 增加或修改测试                                     |
| build    | 构建系统或外部依赖变更（如 npm、webpack、vite 等） |
| ci       | 持续集成配置变更                                   |
| chore    | 其他不修改 src 或 test 的杂项改动                  |

## subject 规则

- 使用祈使句，动词开头（如「新增」「修复」「优化」「移除」）
- 首字母小写
- 结尾不加句号
- 用中文描述

## 示例

```
feat(auth): 新增微信登录功能

支持微信扫码登录，登录后自动绑定现有账号。
```

```
fix(order): 修复订单金额计算精度丢失问题

使用整数分存储金额，避免浮点数精度误差。
Closes #123
```

```
refactor: 抽取通用请求拦截器

将重复的鉴权逻辑收敛到统一拦截器，减少代码重复。
```

## 其他要求

- 一次提交只做一件事，避免混合无关改动
- 提交信息应说明「为什么」而不仅是「做了什么」
- breaking change 需在 footer 中用 `BREAKING CHANGE:` 标注
