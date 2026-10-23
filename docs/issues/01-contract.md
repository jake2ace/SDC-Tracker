# STEP-1：冻结范围、数据、API 与 fixtures

GitHub：[#17](https://github.com/jake2ace/SDC-Tracker/issues/17)

**状态：IN REVIEW · 职责：项目协调与后端开发；团队确认业务范围 · 依赖：无**

## 目标

把定稿转成前后端共用、能验收的最小业务流程，让前端开发按固定接口与后端并行推进。

## 范围与允许目录

`contracts/`、`data/seed/`、`data/eval/`、`docs/`；只约定接口和 fixtures，不实施 UI 或业务服务。

## 完成标准

- [x] 明确客户、发票、欠款、催收、回复、收据、银行记录、匹配建议、审批、付款及预测的字段、状态和角色权限。
- [x] 准备 v1.0.0 API 请求/响应、错误格式、金额与日期规则、重复操作标识；提供正常、部分付款、含糊/冲突、失败的 fixtures。
- [x] 写清匹配规则及阈值、人工审核条件、AI 输出 schema/fallback、预测算法；承诺日期与已收款分开。
- [x] 建立全合成评测清单：40 张/4 种布局收据的生成计划（图片尚未生成）、40 条中英马来语回复、30 个匹配案例，以及 4 组各 10 天手算预测；标签与预期结果独立保存。
- [ ] 明确 MVP 与暂缓项、目录边界及技术栈；团队确认范围，前端使用的 fixtures 与后端契约一致。

## 证据

[契约说明](../CONTRACT.md)、`contracts/`、`data/seed/`、`data/eval/` 和[校验记录](../CONTRACT_VALIDATION.md)。`npm --prefix contracts run check` 通过类型检查与 13 组结构／数据校验；尚未实施的接口均为 planned。这不是应用、OCR、模型或 matcher 的运行结果。

待组员复核业务规则和示例后记录结论，再关闭本 Issue 并进入前后端实现。
