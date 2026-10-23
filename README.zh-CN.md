# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> 帮助马来西亚微小型服务企业为已完成工作开票、跟进逾期欠款，并在登记收款前用银行记录核对客户的付款声明。

**前端现已接通全部十七个后端契约接口，包含人工批准入账、部分收款、付款承诺及 30 天现金流预测。** 本地联调结果见[第七步报告](docs/evaluation/STEP7-INTEGRATION.md)。按用户要求跳过人工耗时对比与组员复核，不宣称已完成这两项实验；现进入部署与提交准备。

本 README 按 [SDC 提交模板](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template/blob/main/README.md) 的章节顺序整理。结构对齐不代表已经完成参赛提交要求。

## 团队信息

| 字段 | 内容 |
| --- | --- |
| 团队名称 | Lets go |
| 参赛赛道 | Domain 2 — Orbyte Smart SME Challenge |
| SDG 方向（1–17） | SDG 8 — 体面工作和经济增长；拟对应目标 8.2 / 8.3 |
| 队长 | Jiazhong Yang |
| 大学 | Monash University Malaysia；Universiti Malaya |
| 成员人数 | 4 人；正式注册名单已确认 |

## 链接

| 资源 | 链接／状态 |
| --- | --- |
| GitHub 仓库 | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker) |
| 共享契约 | [契约说明](docs/CONTRACT.md) · [类型、规则与样例](contracts/) |
| 后端 API | [启动、配置与已实现接口](docs/BACKEND.md) |
| 本地联调 | [浏览器、API 与模型验证](docs/evaluation/STEP7-INTEGRATION.md) |
| 部署说明 | [单端口构建、托管与持久化](docs/DEPLOYMENT.md) |
| 提交准备 | [材料与剩余要求](submission/README.md) |
| 合成数据 | [演示 seed](data/seed/README.md) · [评测输入与独立 gold](data/eval/README.md) |
| Replit 项目 | [团队工作区](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash) |
| 在线演示 | [公开演示](https://milestone-2-cash-proof-to-cash.replit.app/) · [朋友测试指南](docs/FRIEND_TEST_GUIDE.zh-CN.md) |
| RunPod 端点 | 重建版尚未使用 |
| 演示幻灯片 | 独立准备；[本地幻灯片需求](submission/SLIDE_REQUIREMENTS.md) |
| 演示视频 | 待补充 |

## 项目概览

### 问题

小型服务企业需要跟踪按项目阶段开出的发票和逾期欠款。客户发来“我已付款”或截图后，企业仍需要用银行记录核对，尤其要处理部分付款、重复凭证和信息不一致等情况。

### 解决方案

应用流程：**项目阶段完成 → 发票草稿 → Owner 批准 → 逾期催款草稿 → Finance 确认模拟发送 → 客户回复或截图 → OCR 与字段提取 → 银行记录匹配 → Finance 批准付款分配 → 更新余额、催收、未来 30 天预测及活动日志。**

新增重点是付款凭证核对：AI 辅助读取声明，规则解释匹配结果，人工批准入账。部分付款后，剩余金额仍然待收。原型使用团队自行创建的合成数据，发消息和银行数据均为模拟，不进行真实支付或银行接入。

### 主要功能

- **开票与催收：** 按项目阶段开票，催款消息可编辑并经人工批准。
- **凭证审核：** 展示提取字段、银行入账候选、重复与不一致情况，并提供人工降级入口。
- **收款跟踪：** 经批准的部分／全额付款分配、剩余欠款及可追溯的现金流预测。

浏览器界面通过共享 API 契约连接开票、催收、凭证提取、银行核对、财务批准入账、剩余应收与现金流预测。

### 技术栈

| 层级 | 技术／状态 |
| --- | --- |
| 前端 | React + TypeScript + Vite；实现在 `web/` 中 |
| 后端 | Node.js HTTP API；建议使用 Node.js 24 LTS |
| 数据库 | SQLite；本地持久化和事务已验证，云端持久存储待确认 |
| AI／计算 | 离线 Tesseract OCR；服务端 DeepSeek 结构化；无密钥时明确转人工处理 |
| 托管／开发 | Replit Node.js 24；可重置的 SQLite 演示环境，不是持久财务存档 |

## 项目结构

现有实现、数据和文档入口：

```text
.
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md
├── src/                        # HTTP API、业务操作与 SQLite 存储
├── scripts/                    # 数据库工具与独立评测脚本
├── tests/integration/          # API、持久化与浏览器集成测试
├── web/                        # React 界面；单元测试独立放在 web/tests/
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

`src/` 中的 API 和 `web/` 中的界面均可在本地运行，测试代码与业务模块分开。计划提交文件见[提交材料清单](submission/README.md)。

### 架构

**浏览器界面 → Node.js API → SQLite**。服务端运行 OCR，调用 DeepSeek 执行允许的提取任务，并匹配导入的合成银行入账记录。账本和预测更新需要经过人工批准。详见[产品规格](docs/PRODUCT_SPEC.md)。

## 如何运行

### 方式一 — 在 Replit 运行

可直接打开[公开演示](https://milestone-2-cash-proof-to-cash.replit.app/)，或在[团队项目](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash)使用仓库内的 `.replit` 配置。公网核心流程已通过[托管验证](docs/evaluation/HOSTED-VERIFICATION.md)，朋友可按[测试指南](docs/FRIEND_TEST_GUIDE.zh-CN.md)操作。这是共用、可重置的演示账本：SQLite 保存在发布实例文件系统中，不是持久财务存档。配置和限制见[部署说明](docs/DEPLOYMENT.md)。

### 方式二 — 在本地运行

建议使用 Node.js 24 LTS 和 npm。克隆仓库并启动 API：

```bash
git clone https://github.com/jake2ace/SDC-Tracker.git
cd SDC-Tracker
npm ci
npm ci --prefix web
# 保留已有 .env 及其中的服务端密钥。
test -f .env || cp .env.example .env
npm run db:init
npm start
```

在第二个终端进入仓库根目录，运行 `npm run dev:web`，然后打开 `http://localhost:5173`。演示登录页进入工作区后，可切换 PM、Owner 或 Finance 身份。界面默认连接真实的本地 API；仅在需要固定样例时，添加 `?source=mock` 并重新加载。

如需通过单一地址运行构建版本，先停止开发服务器，然后执行：

```bash
npm run build
npm run start:production
```

访问 `http://localhost:3000`，前端与 API 共用此地址。[部署检查](docs/DEPLOYMENT.md)已验证本地进程重启和无密钥降级。演示身份切换不等于生产登录认证。

在根目录 `.env` 中设置 `DEEPSEEK_API_KEY`，保留 `DEEPSEEK_MODEL=deepseek-flash`。密钥只能留在服务端，不放入 `web/` 或任何 `VITE_` 变量。模型不可用时，提醒明确使用模板，付款证据可转人工录入和审核。

访问 `http://localhost:3000/health` 检查服务。以下十七个操作已实现；调用示例见[后端说明](docs/BACKEND.md)、[银行匹配说明](docs/BANK_MATCHING.md)、[凭证与回复说明](docs/EXTRACTION.md)和[付款与预测说明](docs/RECONCILIATION.md)：

- `GET /api/demo-users`、`GET /api/workspace`
- `POST /api/milestones/:id/complete`、`POST /api/milestones/:id/invoice-draft`
- `POST /api/invoices/:id/decision`
- `POST /api/invoices/:id/reminders`、`POST /api/reminders/:id/send`
- `POST /api/bank-statements`、`POST /api/receipts/:id/match`
- `POST /api/invoices/:id/replies`、`POST /api/invoices/:id/receipts`
- `PATCH /api/replies/:id/extraction`、`PATCH /api/receipts/:id/evidence`
- `GET /api/receipts/:id/image`
- `POST /api/matches/:id/approve-payment`、`POST /api/replies/:id/confirm-promise`
- `GET /api/forecast?asOfDate=2026-10-23&delayDays=7`

消息发送与记账均为演示模拟。[托管验证记录](docs/evaluation/HOSTED-VERIFICATION.md)区分本地、Replit 工作区与公网测试。演示时钟固定为 2026 年 10 月 23 日，界面从 API 读取，而非使用电脑当天日期。

### 运行测试

在仓库根目录执行：

```bash
npm run check
npm test
npm run test:web
npm run test:e2e
npm run build
npm run test:deployment
npm run test:deployment:smoke
npm run evaluate:matcher
npm run evaluate:forecast
npm ci --prefix contracts
npm --prefix contracts run check
```

浏览器测试放在 `tests/integration/browser/`，前端单元测试放在 `web/tests/`。如尚未安装 Playwright 的 Chromium，先运行一次 `npx playwright install chromium`，再执行 `test:e2e`。后端测试覆盖持久化、权限、凭证上传、提取降级和人工修正；30 个冻结匹配案例与契约检查独立执行。[联调报告](docs/evaluation/STEP7-INTEGRATION.md)与[提取验证说明](docs/EXTRACTION.md)区分本地 OCR、真实模型响应及注入测试，合成样本成绩不代表生产准确率。

## 我们如何使用 Replit

现有仓库已导入[团队 Replit 项目](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash)。工作区使用 Node.js 24.22.1，构建前端并在同一地址运行前端和 API。工作区已验证真实 DeepSeek 提醒、截图提取、银行匹配、人工批准入账和预测更新，密钥保存在平台 secrets。公开发布状态及数据保存限制见[部署记录](docs/DEPLOYMENT.md)；正式使用证明 PDF 仍需纳入提交材料。

## 我们如何使用 RunPod

重建版尚未使用 RunPod；计划中的 MVP 没有 GPU 工作负载。提交前应根据官方要求确认本赛道是否需要 RunPod 使用证明。模板中的“Required”标签不代表本项目已经使用它。

## 挑战与收获

付款凭证只是待核对的声明，部分付款必须保留余款，响应中断也不代表写入失败。联调中完善了安全重试、刷新失败后的明确恢复、身份切换后的状态隔离，以及区分实际和预计收入的现金流。人工流程计时和组员复核按用户要求跳过；尚未测量人工节省时间。

## 后续改进

- [ ] 根据实测错误案例改进字段提取。
- [ ] 在审核访问权限、隐私和运行要求后，考虑真实系统接入。

## 团队分工

| 姓名 | 大学 | 职责 |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | 注册队长 |
| LOW LI XIN | Universiti Malaya | 组员；具体贡献待确认 |
| Jieheng Li | Monash University Malaysia | 组员；具体贡献待确认 |
| Lingchen Wu | Monash University Malaysia | 组员；具体贡献待确认 |

组员通过下方 Issue 认领具体任务，工作分为项目协调、前端设计与开发、后端开发、测试和文档。全部十七个操作现已接通，共享演示已发布；接下来完成朋友测试、演示录制和提交材料。

组员现在可以认领合成案例、独立核算、测试复核、文档、幻灯片和演示任务。这些是可参与的工作，不代表已经分配给任何人。按[组员参与指南](docs/TEAM_GUIDE.md)操作：收到邀请后接受、更新 `main`、在对应 Issue 认领具体任务，再创建独立分支并提交 PR。

### 八步开发计划

| 步骤 | Issue | 交付内容 |
| --- | --- | --- |
| 1 | [#17](https://github.com/jake2ace/SDC-Tracker/issues/17) | 已完成 — 范围、数据、API 契约与测试样例 |
| 2 | [#18](https://github.com/jake2ace/SDC-Tracker/issues/18) | 已完成 — 后端、开票、催收与权限 |
| 3 | [#19](https://github.com/jake2ace/SDC-Tracker/issues/19) | 前端已实现并接通全部十七个操作 |
| 4 | [#20](https://github.com/jake2ace/SDC-Tracker/issues/20) | 已完成 — 银行 CSV 与确定性匹配 |
| 5 | [#21](https://github.com/jake2ace/SDC-Tracker/issues/21) | 已完成 — OCR、AI 提取及人工降级 |
| 6 | [#22](https://github.com/jake2ace/SDC-Tracker/issues/22) | 已完成 — 付款审批、部分收款与预测 |
| 7 | [#23](https://github.com/jake2ace/SDC-Tracker/issues/23) | 已完成 — 技术联调；人工计时和组员复核按要求跳过 |
| 8 | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | 部署、演示与提交核对 |

详细资料：[依赖与验收计划](docs/ISSUE_PLAN.md) · [前端交接](docs/FRONTEND_HANDOFF.md) · [决策记录](docs/decisions.md)。

## 提交检查清单

- [x] 确认正式注册队长、成员和大学。
- [ ] 确认拟采用的 SDG 目标和实际分工。
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
