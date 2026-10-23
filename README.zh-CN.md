# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> 帮助马来西亚微小型服务企业为已完成工作开票、跟进逾期欠款，并在登记收款前用银行记录核对客户的付款声明。

**第一、二、四、五步已实现：共享契约、开票／催收、银行 CSV 匹配、本地 OCR、结构化提取与人工修正。** 前端独立开发；付款审批与现金流仍待实施。旧实现已在本地备份；旧版测试结果不能证明重建版可用。

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
| 后端 API | [启动、配置与已实现接口](docs/BACKEND.md) |
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

开票、催收、CSV 导入、匹配建议、凭证上传与客户回复提取 API 已实现；付款分配与预测待完成，前端独立开发。

### 技术栈

| 层级 | 技术／状态 |
| --- | --- |
| 前端 | React + TypeScript + Vite；实现在 `web/` 中 |
| 后端 | Node.js 22.13+；HTTP API 可运行 |
| 数据库 | SQLite；演示数据持久化与事务 |
| AI／计算 | 离线 Tesseract OCR；服务端 DeepSeek 结构化；无密钥时明确转人工处理 |
| 托管／开发 | Replit 使用与部署待验证 |

## 项目结构

现有实现、数据和文档入口：

```text
.
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md
├── src/                        # HTTP API、业务操作与 SQLite 存储
├── scripts/                    # 数据库初始化与重置
├── tests/                      # HTTP 与持久化测试；第五步集中在 tests/integration/
├── contracts/                  # v1.0.0 类型、规则、样例与校验
├── data/seed/                  # 合成演示状态与银行 CSV
├── data/eval/                  # 评测输入及独立 gold 标签
├── docs/
│   ├── PRODUCT_SPEC.md / ISSUE_PLAN.md
│   ├── CONTRACT.md / BACKEND.md
│   ├── FRONTEND_HANDOFF.md / TEAM_GUIDE.md
│   ├── decisions.md
│   └── issues/                 # 八个实施任务
├── submission/README.md        # 待准备材料与证据清单
└── LICENSE
```

`src/` 中的 API 可在本地运行；`web/` 前端是下一步开发任务。计划提交文件见[提交材料清单](submission/README.md)。

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
npm ci
cp .env.example .env
npm run db:init
npm start
```

访问 `http://localhost:3000/health` 检查服务。以下十四个操作已实现；调用示例见[后端说明](docs/BACKEND.md)、[银行匹配说明](docs/BANK_MATCHING.md)和[凭证与回复说明](docs/EXTRACTION.md)：

- `GET /api/demo-users`、`GET /api/workspace`
- `POST /api/milestones/:id/complete`、`POST /api/milestones/:id/invoice-draft`
- `POST /api/invoices/:id/decision`
- `POST /api/invoices/:id/reminders`、`POST /api/reminders/:id/send`
- `POST /api/bank-statements`、`POST /api/receipts/:id/match`
- `POST /api/invoices/:id/replies`、`POST /api/invoices/:id/receipts`
- `PATCH /api/replies/:id/extraction`、`PATCH /api/receipts/:id/evidence`
- `GET /api/receipts/:id/image`

消息发送为模拟。其余契约端点仍待实现，前端和部署尚未完成；没有 API 密钥也可使用催款模板。

### 运行测试

在仓库根目录执行：

```bash
npm run check
npm test
npm run evaluate:matcher
npm ci --prefix contracts
npm --prefix contracts run check
```

后端及独立集成测试覆盖持久化、权限、凭证上传、提取降级和人工修正；30 个冻结匹配案例与契约检查独立执行。[提取验证说明](docs/EXTRACTION.md)区分本地 OCR、真实模型响应及注入测试，合成样本成绩不代表生产准确率。

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

组员通过下方 Issue 认领具体任务，工作分为项目协调、前端设计与开发、后端开发、测试和文档。共享契约与后端基础已就绪：前端可以对接十四个已实现操作，剩余流程使用同一契约的 fixtures。

组员现在可以认领合成案例、独立核算、测试复核、文档、幻灯片和演示任务。这些是可参与的工作，不代表已经分配给任何人。按[组员参与指南](docs/TEAM_GUIDE.md)操作：收到邀请后接受、更新 `main`、在对应 Issue 认领具体任务，再创建独立分支并提交 PR。

### 八步开发计划

| 步骤 | Issue | 交付内容 |
| --- | --- | --- |
| 1 | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | 已完成 — 范围、数据、API 契约与测试样例 |
| 2 | [#18](https://github.com/jake2ace/SDC-Tracker/issues/18) | 已完成 — 后端、开票、催收与权限 |
| 3 | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | 前端设计、开发与 API 对接 |
| 4 | [#20](https://github.com/jake2ace/SDC-Tracker/issues/20) | 已完成 — 银行 CSV 与确定性匹配 |
| 5 | [#21](https://github.com/jake2ace/SDC-Tracker/issues/21) | 已完成 — OCR、AI 提取及人工降级 |
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
