# STEP-5：本地 OCR、DeepSeek 结构化与 fallback

GitHub：[#21](https://github.com/jake2ace/SDC-Tracker/issues/21)

**状态：DONE · 职责：后端开发与 AI 集成 · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17))、STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))**

## 目标

本地 OCR 提取合成收据文本，DeepSeek 按固定 schema 结构化收据和客户回复；无法可靠提取时转人工。

## 范围与允许目录

`src/`、`data/seed/`、`data/eval/`、`tests/`、`eval/`、`scripts/`、`docs/`；密钥和原始私有运行记录只在环境变量/`.local/`。

## 完成标准

- [x] 本地 OCR 保留原图与原文关联；结构化字段可追溯到证据，金额/日期/参考信息不得无依据补全。
- [x] 客户回复按冻结分类/schema 提取付款主张、付款承诺、争议等信息；承诺日期只作为预测输入，不作为到账证据。
- [x] DeepSeek 仅通过服务端调用，输出经过 schema 与业务字段验证；上传文本视为数据，不执行其中指令。
- [x] 低置信度、缺字段、冲突、超时、模型不可用或不合法输出均显示可恢复的审核状态；人工/规则 fallback 显式标注来源。
- [x] 对 40 张合成收据和 40 条合成回复保留逐项结果；真实调用成功与替身测试分开记录，不把 fallback 当成 AI 成功。

## 证据

- [接口、脱敏配置与人工处理](../EXTRACTION.md)；测试集中在 `tests/integration/`。
- [评测说明](../evaluation/STEP5.md)与[80 项实际运行报告](../evaluation/extraction-deepseek-results.json)，记录输入/源码 hash、OCR 版本、真实模型响应和独立注入测试。
- 实际 40 张合成凭证：OCR 40/40；金额 40/40、参考号 35/40、时间 40/40。40 条合成回复：意图 39/40；必须复核的情况均进入复核。6 个独立置信度 guard probe 全部通过，不计入模型准确率。
- 36 项后端／集成测试和 13 组契约检查通过；人工修正、失败降级、重复请求、原图及 OCR 持久化均有覆盖。
- 参考号仍可能出现 O/0 误读；这些结果只证明本组合成样本，不代表真实银行截图准确率。付款与承诺确认仍属于第六步。
