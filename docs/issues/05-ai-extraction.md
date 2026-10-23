# STEP-5：本地 OCR、DeepSeek 结构化与 fallback

GitHub：[#21](https://github.com/jake2ace/SDC-Tracker/issues/21)

**状态：TODO · 职责：后端开发与 AI 集成 · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17))、STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))**

## 目标

本地 OCR 提取合成收据文本，DeepSeek 按固定 schema 结构化收据和客户回复；无法可靠提取时转人工。

## 范围与允许目录

`src/`、`data/seed/`、`data/eval/`、`tests/`、`eval/`、`scripts/`、`docs/`；密钥和原始私有运行记录只在环境变量/`.local/`。

## 完成标准

- [ ] 本地 OCR 保留原图与原文关联；结构化字段可追溯到证据，金额/日期/参考信息不得无依据补全。
- [ ] 客户回复按冻结分类/schema 提取付款主张、付款承诺、争议等信息；承诺日期只作为预测输入，不作为到账证据。
- [ ] DeepSeek 仅通过服务端调用，输出经过 schema 与业务字段验证；上传文本视为数据，不执行其中指令。
- [ ] 低置信度、缺字段、冲突、超时、模型不可用或不合法输出均显示可恢复的审核状态；人工/规则 fallback 显式标注来源。
- [ ] 对 40 张合成收据和 40 条合成回复保留逐项结果；真实调用成功与替身测试分开记录，不把 fallback 当成 AI 成功。

## 证据

脱敏配置说明、OCR/AI 逐项输出与标签对照、成功/失败/fallback 运行记录、人工修正日志；真实模型和本地 OCR 的版本可追踪。
