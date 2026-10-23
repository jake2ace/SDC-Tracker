# Milestone2Cash Proof-to-Cash 开发计划

依据：团队定稿 `LetsGo_Final_Idea.pdf` 与 [产品规格](PRODUCT_SPEC.md)。状态：**STEP-1 进行中，其余步骤 TODO**。旧 Milestone2Cash 的代码、测试结果和已完成事项不作为重建版的验收结果。

| 步骤 | 交付 | 职责 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| STEP-1 | [范围、数据、API 与 fixtures 冻结](issues/01-contract.md) | 项目协调与后端开发；团队确认业务 | 无 | IN PROGRESS |
| STEP-2 | [核心底座、开票、催收、权限与日志](issues/02-foundation.md) | 后端开发 | STEP-1 | TODO |
| STEP-3 | [前端设计、开发与 API 对接](issues/03-frontend.md) | 前端开发；前后端共同联调验收 | STEP-1；联调依赖 STEP-2/4/5/6 | TODO |
| STEP-4 | [银行 CSV 与确定性匹配](issues/04-matching.md) | 后端开发 | STEP-1、STEP-2 | TODO |
| STEP-5 | [本地 OCR、DeepSeek 结构化与 fallback](issues/05-ai-extraction.md) | 后端开发与 AI 集成 | STEP-1、STEP-2 | TODO |
| STEP-6 | [审批入账、部分付款与现金流联动](issues/06-reconciliation.md) | 后端开发 | STEP-2、STEP-4、STEP-5 | TODO |
| STEP-7 | [端到端与量化评测](issues/07-evaluation.md) | 测试与评测；团队交叉复核 | STEP-3、STEP-4、STEP-5、STEP-6 | TODO |
| STEP-8 | [部署、材料与提交核对](issues/08-submission.md) | 部署与文档；团队完成展示与提交 | 骨架依赖 STEP-2；最终依赖 STEP-7 | TODO |

顺序：**STEP-1 → STEP-2 → STEP-4/STEP-5 并行 → STEP-6 → STEP-7 → STEP-8 最终检查**。前端开发在 STEP-1 冻结后并行开展 STEP-3；先用同契约 mock，再接真实后端。STEP-8 的部署骨架在 STEP-2 可运行时立即验证，材料可同步准备。

## GitHub 任务入口

| 步骤 | Issue |
| --- | --- |
| STEP-1 | [#17 范围、数据、API 与 fixtures](https://github.com/jake2ace/SDC-Tracker/issues/17) |
| STEP-2 | [#18 核心底座、开票、催收、权限与日志](https://github.com/jake2ace/SDC-Tracker/issues/18) |
| STEP-3 | [#19 前端设计、开发与 API 对接](https://github.com/jake2ace/SDC-Tracker/issues/19) |
| STEP-4 | [#20 银行 CSV 与确定性匹配](https://github.com/jake2ace/SDC-Tracker/issues/20) |
| STEP-5 | [#21 OCR、AI 理解及人工降级](https://github.com/jake2ace/SDC-Tracker/issues/21) |
| STEP-6 | [#22 审批入账、部分付款与现金流](https://github.com/jake2ace/SDC-Tracker/issues/22) |
| STEP-7 | [#23 联调与量化评测](https://github.com/jake2ace/SDC-Tracker/issues/23) |
| STEP-8 | [#24 部署与提交材料](https://github.com/jake2ace/SDC-Tracker/issues/24) |

## 协作与检查点

- **Checkpoint A：可开工。** STEP-1 的实体、状态、API、错误格式、样例与验收数据一致；团队确认业务范围。此时将共享契约和样例交给前端任务负责人。
- **Checkpoint B：完整最小流程。** 一张合成发票从生成、人工确认催收、回复/凭证、银行记录匹配、人工审批到余额和预测更新可走通；失败不会显示成功。部署骨架能打开。
- **Checkpoint C：冻结演示版本。** STEP-7 的实测与团队复核完成，保留失败记录；材料中的功能和数字均有证据。之后只修阻塞问题。
- **Checkpoint D：可提交。** 部署链接、仓库、声明、PRD、演示材料及视频逐项核对；实际提交后保存回执，不能把本地完成写成已提交。

前端开发维护 `web/`；后端开发维护 `src/`、`contracts/` 和 `scripts/`；测试与数据任务覆盖 `data/`、`eval/` 和相应测试。共享接口、依赖配置由后端任务负责人和项目协调人员共同确认。前端若发现缺接口，先记录到对应 Issue，不自行改变后端规则。UI 文案使用英文。具体成员通过 Issue 认领，不预先假定人员分配。

每步沿用 **Issue → Todo → In progress → In review → Done**：写清目标和依赖，单独分支，PR 关联 Issue，附验证证据，经团队或另一位成员复核后关闭。不要虚构成员认领、会议或验收记录。

## 所有步骤共同遵守

- 数据、银行 CSV、收据和客户回复全部合成；银行导入、开票、发消息、收款登记均为演示，不代表真实银行接入或资金到账。
- OCR/AI 只提取或建议；匹配状态不是已到账事实。最终入账必须由有权限的人检查并批准。
- 部分付款只减少欠款，余款继续保留催收；只有全额结清才停止该发票催收。付款承诺仅影响情景预测，不计为已收现金。
- 失败、低置信度、冲突与重复操作必须有明确结果；人工修正可追溯，重试不重复入账。真实模型失败时不得把 fallback 标为 AI 成功。
- 私有原始证据放 `.local/`；可公开的合成评测结果经检查后放 `docs/evaluation/`。密钥不进前端、Git 或公开证据。

## 变更记录

| 日期 | 决定 | 状态与追踪 |
| --- | --- | --- |
| 2026-10-23 | 按团队定稿从头建立新基线；旧方案先本地备份，再清理活动工作区；保留仓库身份和 Git 历史 | 本计划全部 TODO；备份及清理结果由主协调记录 |

后续范围、接口、指标或分工变化追加记录，并关联 Issue/PR；保留旧决定及取代原因，不覆盖历史。
