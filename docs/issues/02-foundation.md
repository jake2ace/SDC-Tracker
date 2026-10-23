# STEP-2：核心底座、开票、催收、权限与日志

GitHub：[#18](https://github.com/jake2ace/SDC-Tracker/issues/18)

**状态：DONE · 职责：后端开发 · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17)，已完成)**

## 目标

建立能启动、持久保存、执行权限检查的后端新基线，支持发票草稿和人工确认的演示催收。

## 范围与允许目录

`src/`、`data/seed/`、`tests/`、`scripts/`、`docs/` 及服务端工程配置；接口变更同步 `contracts/`。涉及 `web/` 页面的改动交给前端任务负责人。

## 完成标准

- [x] 可初始化/重置合成数据；客户、发票及日志刷新和重启后保留；不同演示企业的数据隔离。
- [x] 发票金额、到期日及余额由后端计算/验证；生成草稿、批准与模拟开票有明确状态；重复操作不产生副本。
- [x] 仅未结清且符合规则的发票进入催收；消息可人工检查、修改、确认后模拟发送，保存来源及发送状态。
- [x] 权限校验在后端执行；未批准、被驳回、越权或接口失败均不推进业务状态，并保留审计记录。
- [x] 提供可运行启动命令、环境变量示例与健康检查；交给 STEP-8 ([#24](https://github.com/jake2ace/SDC-Tracker/issues/24)) 先验证部署骨架。

## 证据

[运行与验证说明](../BACKEND.md)。`npm run check`、`npm test`（8 组实际 HTTP/SQLite 测试）和 `npm --prefix contracts run check`（13 组静态数据校验）通过。测试包含重启后的状态与幂等响应、跨公司/角色拒绝、回滚、过期草稿和人工确认模拟发送。模型成功路径使用注入响应，未声称真实 DeepSeek 调用或部署完成。
