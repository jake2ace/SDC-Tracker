# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> 帮助马来西亚微小型服务企业为已完成工作开票、跟进逾期欠款，并在登记收款前用银行记录核对客户的付款声明。

**契约 v1.0.0 已形成，等待团队在 [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) 复核；应用尚未实现，目前不可运行。** 旧实现已在本地备份并从 `main` 移除；旧版测试结果不能证明重建版可用。

本 README 按 [SDC 提交模板](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template/blob/main/README.md) 的章节顺序整理。结构对齐不代表已经完成参赛提交要求。

## 团队信息

| 字段 | 内容 |
| --- | --- |
| 团队名称 | Lets go |
| 参赛赛道 | Domain 2 — Orbyte Smart SME Challenge |
| SDG 方向（1–17） | SDG 8 — 体面工作和经济增长；拟对应目标 8.2 / 8.3 |
| 队长 | 待团队确认 |
| 大学 | 待团队确认 |
| 成员人数 | 计划 4 人；正式注册名单待确认 |

## 链接

| 资源 | 链接／状态 |
| --- | --- |
| GitHub 仓库 | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker) |
| 共享契约 | [契约说明](docs/CONTRACT.md) · [类型、规则与样例](contracts/) |
| 合成数据 | [演示 seed](data/seed/README.md) · [评测输入与独立 gold](data/eval/README.md) |
| Replit 项目 | 待补充 |
| 在线演示 | 待补充 |
| RunPod 端点 | 重建版尚未使用 |
| 演示幻灯片 | 待补充 |
| 演示视频 | 待补充 |

## 项目概览

### 问题

小型服务企业需要跟踪按项目阶段开出的发票和逾期欠款。客户发来“我已付款”或截图后，企业仍需要用银行记录核对，尤其要处理部分付款、重复凭证和信息不一致等情况。

### 解决方案

计划中的流程：**项目阶段完成 → 发票草稿 → Owner 批准 → 逾期催款草稿 → Finance 确认模拟发送 → 客户回复或截图 → OCR 与字段提取 → 银行记录匹配 → Finance 批准付款分配 → 更新余额、催收、未来 30 天预测及活动日志。**

新增重点是付款凭证核对：AI 辅助读取声明，规则解释匹配结果，人工批准入账。部分付款后，剩余金额仍然待收。原型使用团队自行创建的合成数据，发消息和银行数据均为模拟，不进行真实支付或银行接入。

### 主要功能

- **开票与催收：** 按项目阶段开票，催款消息可编辑并经人工批准。
- **凭证审核：** 展示提取字段、银行入账候选、重复与不一致情况，并提供人工降级入口。
- **收款跟踪：** 经批准的部分／全额付款分配、剩余欠款及可追溯的现金流预测。

以上功能均处于规划阶段，尚未完成实现验证。

### 技术栈

| 层级 | 计划采用的技术 |
| --- | --- |
| 前端 | React + TypeScript + Vite；实现在 `web/` 中 |
| 后端 | Node.js 22.13+ |
| 数据库 | SQLite |
| AI／计算 | 本地 OCR 与服务端 DeepSeek；具体版本和能力待验证 |
| 托管／开发 | Replit 使用与部署待验证 |

## 项目结构

现有契约、数据和文档入口：

```text
.
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md
├── contracts/                  # v1.0.0 类型、规则、样例与校验
├── data/seed/                  # 合成演示状态与银行 CSV
├── data/eval/                  # 评测输入及独立 gold 标签
├── docs/
│   ├── PRODUCT_SPEC.md / ISSUE_PLAN.md
│   ├── CONTRACT.md
│   ├── FRONTEND_HANDOFF.md / TEAM_GUIDE.md
│   ├── decisions.md
│   └── issues/                 # 八个实施任务
├── submission/README.md        # 待准备材料与证据清单
└── LICENSE
```

应用实现目录 `src/`、`web/` 及后续实现测试／评测工具目前尚不可运行。计划文件名见[提交材料清单](submission/README.md)；PDF 只会在完成并核查后加入。

### 架构

计划架构：**浏览器界面 → Node.js API → SQLite**。服务端运行 OCR，调用 DeepSeek 执行允许的提取任务，并匹配导入的合成银行入账记录。账本和预测更新需要经过人工批准。详见[产品规格](docs/PRODUCT_SPEC.md)。

## 如何运行

### 方式一 — 在 Replit 运行

目前不可运行。Replit 项目、配置和验证过的操作步骤会在实现及部署核查时补充。

### 方式二 — 在本地运行

准备 Node.js 22.13+ 和 npm 后克隆仓库：

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
```

目前没有应用启动命令。可以先阅读共享契约和合成数据，并执行下方校验；应用安装和配置说明会随可运行的实现补充。

### 运行测试

在仓库根目录执行：

```bash
npm ci --prefix contracts
npm --prefix contracts run check
```

该命令检查 TypeScript 契约，并执行 13 组结构／数据一致性校验。它**不是应用实现测试**，不会运行 OCR、DeepSeek，也不能证明 matcher 或现金流预测已实现、达到准确率目标。实现测试与量化评测将在对应 Issue 中补充。

## 我们如何使用 Replit

重建版计划使用 Replit，但目前没有对应使用证据。在 #24 中记录实际项目、开发／部署用途和使用证明；凭据存放在平台的 secrets 中。此处不宣称已经使用 Replit 或完成部署。

## 我们如何使用 RunPod

重建版尚未使用 RunPod；计划中的 MVP 没有 GPU 工作负载。提交前应根据官方要求确认本赛道是否需要 RunPod 使用证明。模板中的“Required”标签不代表本项目已经使用它。

## 挑战与收获

当前规划结论：付款凭证只是待核对的声明，部分付款必须保留余款，前后端协作需要共享契约。实现中的困难和实测结果会在实际发生后记录。

## 后续改进

- [ ] 根据实测错误案例改进字段提取。
- [ ] 在审核访问权限、隐私和运行要求后，考虑真实系统接入。

## 团队分工

| 姓名 | 职责 | GitHub |
| --- | --- | --- |
| 正式注册名单待确认 | 任务认领待确认 | 待确认 |

组员通过下方 Issue 认领具体任务，工作分为项目协调、前端设计与开发、后端开发、测试和文档。先在 #17 复核 v1.0.0 契约与数据；团队确认共同基线后，前端 mock 与后端实现可以并行。线框设计和复核现在就可以开始。

组员现在可以认领合成案例、独立核算、测试复核、文档、幻灯片和演示任务。这些是可参与的工作，不代表已经分配给任何人。按[组员参与指南](docs/TEAM_GUIDE.md)操作：收到邀请后接受、更新 `main`、在对应 Issue 认领具体任务，再创建独立分支并提交 PR。

### 八步开发计划

| 步骤 | Issue | 交付内容 |
| --- | --- | --- |
| 1 | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | 范围、数据、API 契约与测试样例 |
| 2 | [#18](https://github.com/jake2ace/SDC-Tracker/issues/18) | 后端、开票、催收与权限 |
| 3 | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | 前端设计、开发与 API 对接 |
| 4 | [#20](https://github.com/jake2ace/SDC-Tracker/issues/20) | 银行 CSV 与确定性匹配 |
| 5 | [#21](https://github.com/jake2ace/SDC-Tracker/issues/21) | OCR、AI 提取及人工降级 |
| 6 | [#22](https://github.com/jake2ace/SDC-Tracker/issues/22) | 付款审批、部分收款与预测 |
| 7 | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | 联调与量化评测 |
| 8 | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | 部署、演示与提交核对 |

详细资料：[依赖与验收计划](docs/ISSUE_PLAN.md) · [前端交接](docs/FRONTEND_HANDOFF.md) · [决策记录](docs/decisions.md)。

## 提交检查清单

- [ ] 确认团队信息、正式注册名单和 SDG 目标。
- [ ] 补充幻灯片和演示视频链接。
- [ ] 记录 Replit 使用及使用证明。
- [ ] 确认 RunPod 要求的适用性，提供所需的真实证据。
- [ ] 完成 Preliminary Submission 和 Technology Declaration PDF。
- [ ] 按确认后的团队名称及官方模板命名提交文件。
- [ ] 验证部署、链接及全部运行步骤。
- [ ] 检查最终仓库中的凭据与私有数据。
- [ ] 确认实测声明及 AI／工具声明，并保留真实提交回执。

## 许可证

采用 [Apache License 2.0](LICENSE) 许可证。
