# Milestone2Cash Proof-to-Cash

[English](README.md) | [简体中文](README.zh-CN.md)

> 帮助马来西亚微小型服务企业为已完成工作开票、跟进逾期欠款，并在登记收款前用银行记录核对客户的付款声明。

**前端已接通全部十七个后端契约接口，包含人工批准入账、部分收款、付款承诺及 30 天现金流情景计算。** 评委请使用下方已签署 PDF、PPT、公开原型及 [6 分 19 秒演示视频](https://www.youtube.com/watch?v=pholjV_8vBM)。应用验证基线为 `c438678`；材料整理和链接更新不改变该业务代码基线。

本 README 按 [SDC 提交模板](https://github.com/michaelzhngg/SDC_Hackathon_Submission_Template/blob/main/README.md) 的章节顺序整理。25 October 2026 已复核公开仓库和未登录视频播放。历史模型评测、自动化测试、线上操作核验及门户提交记录分别保留证据，不相互替代。

## 团队信息

| 字段 | 内容 |
| --- | --- |
| 团队名称 | Lets go |
| 参赛赛道 | Domain 2 — Orbyte Smart SME Challenge |
| SDG 方向（1–17） | SDG 8 — 体面工作和经济增长；目标 8.2 / 8.3，业务效果仍属待验证目标 |
| 队长 | Jiazhong Yang |
| 大学 | Monash University Malaysia；Universiti Malaya |
| 成员人数 | 4 人；正式注册名单已确认 |

## 链接

| 资源 | 链接／状态 |
| --- | --- |
| GitHub 仓库 | [jake2ace/SDC-Tracker](https://github.com/jake2ace/SDC-Tracker)；已公开 |
| 正式方案／PRD | [已签署 Preliminary PDF](submission/SDC2026_Lets%20go_Preliminary.pdf) |
| 技术与工具声明 | [已签署 Technical Declaration PDF](submission/SDC2026_Lets%20go_TechDeclaration.pdf) |
| Replit 使用证明 | [Replit POU PDF](submission/SDC2026_Lets%20go_Replit_POU.pdf) |
| RunPod 使用说明 | [真实非使用说明 PDF](submission/SDC2026_Lets%20go_Runpod_POU.pdf) |
| 共享契约 | [契约说明](docs/CONTRACT.md) · [类型、规则与样例](contracts/) |
| 后端 API | [启动、配置与已实现接口](docs/BACKEND.md) |
| 本地联调 | [浏览器、API 与模型验证](docs/evaluation/STEP7-INTEGRATION.md) |
| 部署说明 | [单端口构建、托管与持久化](docs/DEPLOYMENT.md) |
| 提交材料索引 | [正式文件与验证证据](submission/README.md) |
| 合成数据 | [演示 seed](data/seed/README.md) · [评测输入与独立 gold](data/eval/README.md) |
| Replit 项目 | [团队工作区](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash)；匿名工作区访问曾返回 404，评委请使用下方公开演示 |
| 在线演示 | [公开演示](https://milestone-2-cash-proof-to-cash.replit.app/) · [朋友测试指南](docs/FRIEND_TEST_GUIDE.zh-CN.md) |
| RunPod 端点 | 本实现未使用 RunPod，无端点 |
| 演示幻灯片 | [Milestone2Cash.pptx](submission/Milestone2Cash.pptx) |
| 演示视频 | [YouTube：Milestone2Cash](https://www.youtube.com/watch?v=pholjV_8vBM)，6:19，已验证未登录播放 |
| 线上流程证据 | [F01–F06 结果](submission/validation/results.json) · [中文记录](submission/validation/%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C.txt) · [16 张截图](submission/validation/screenshots/) |

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
├── submission/README.md        # 正式材料与验证证据索引
└── LICENSE
```

`src/` 中的 API 和 `web/` 中的界面均可在本地运行，测试代码与业务模块分开。正式文件见[提交材料清单](submission/README.md)。

### 架构

**浏览器界面 → Node.js API → SQLite**。服务端运行 OCR，调用 DeepSeek 执行允许的提取任务，并匹配导入的合成银行入账记录。账本和预测更新需要经过人工批准。详见[产品规格](docs/PRODUCT_SPEC.md)。

## 如何运行

### 方式一 — 在 Replit 运行

评委可直接打开[公开演示](https://milestone-2-cash-proof-to-cash.replit.app/)，选择 **Open demo workspace**。25 October 的 F01–F06 已在真实线上界面跑通，证据见[本轮结果](submission/validation/results.json)。本轮结束后 `LUMEN-DEMO-001` 为已收 RM18,000、未收 RM0，两笔付款保留；另有一张 RM6,000 未付款发票。评委可以查看已完成结果和审计记录。若要按[测试指南](docs/FRIEND_TEST_GUIDE.zh-CN.md)从 RM0 已收重放，需要项目负责人先准备干净种子环境；共享账本目前不是未操作的初始状态。

这是共用、可重置的演示账本：SQLite 保存在发布实例文件系统中。页面刷新保留已验证，但此前重新发布曾重置账本，不宣称 Replit 重新部署后仍具备持久财务存储。配置和限制见[部署说明](docs/DEPLOYMENT.md)及[历史托管验证](docs/evaluation/HOSTED-VERIFICATION.md)。团队工作区可能需要项目所有者访问，评委试用不依赖该入口。

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

在第二个终端进入仓库根目录，运行 `npm run dev:web`，然后打开 `http://localhost:5173`。网站主页的 **Open demo workspace** 进入工作台后，可切换 PM、Owner 或 Finance 身份；`/#/home` 直接打开工作台。界面默认连接真实的本地 API；仅在需要固定样例时，添加 `?source=mock` 并重新加载。

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

24 October 对 `c438678` 的检查通过 60 项后端、23 项前端、13 组契约／数据验证、类型检查及构建。25 October 另完成独立生产构建的 13 项检查，包括无模型密钥降级与进程重启保留；这不是 Replit 重新部署持久化测试。

25 October 约 01:30–01:50 MYT，助手操作线上界面完成六项 F01–F06，全部通过。两张收据与一条付款承诺无需人工更正，界面显示 95% 模型置信度。六项工作流不计入历史三条自动化浏览器场景，也不是新一轮 40 张回执／40 条回复准确率评测。独立队友研究和人工耗时对比仍未进行，不能从这些检查推导真实企业节省时间的比例。

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

现有仓库已导入[团队 Replit 项目](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash)。已记录的工作区使用 Node.js 24.22.1，构建前端并在同一地址运行前端和 API。线上验证覆盖真实 AI 标记的提醒、截图提取、银行匹配、人工批准入账和预测更新，密钥保存在平台 secrets。正式证据见 [Replit 使用证明 PDF](submission/SDC2026_Lets%20go_Replit_POU.pdf)，公开状态及存储限制见[部署记录](docs/DEPLOYMENT.md)。

## 我们如何使用 RunPod

团队确认本实现没有使用 RunPod，也没有 RunPod 端点。Tesseract 在应用服务器本地运行，模型推理直接调用 DeepSeek hosted API。详见[真实非使用说明](submission/SDC2026_Lets%20go_Runpod_POU.pdf)；该文件不声称运行过 GPU 工作负载或获得官方豁免。

## 挑战与收获

付款凭证只是待核对的声明，部分付款必须保留余款，响应中断也不代表写入失败。联调中完善了安全重试、刷新失败后的明确恢复、身份切换后的状态隔离，以及区分实际和预计收入的现金流。人工流程计时和组员复核按用户要求跳过；尚未测量人工节省时间。

## 后续改进

- [ ] 根据实测错误案例改进字段提取。
- [ ] 在审核访问权限、隐私和运行要求后，考虑真实系统接入。

## 团队分工

| 姓名 | 大学 | 职责 |
| --- | --- | --- |
| Jiazhong Yang | Monash University Malaysia | 队长；代码实现 |
| LOW LI XIN | Universiti Malaya | 方案构思、核心功能规划、产品定位、PPT 与视频制作 |
| Jieheng Li | Monash University Malaysia | 代码实现 |
| Lingchen Wu | Monash University Malaysia | UI 设计、视觉外观与用户体验 |

以上为团队确认的实际分工。团队还确认全员完成规定的 GenAI、Database 和 Cloud Deployment workshops，未使用比赛开始前已有的自有代码，没有雇佣／实习知识产权限制。同一比赛期间的早期迭代仍属于本次开发历史。

OpenAI Codex 和 Anthropic Claude 为开发提供了主要辅助。Codex 支持后端、前端界面与路由、测试、研究和文档制作；Claude 支持前端实现。真实使用范围及人工责任见[正式技术声明](submission/SDC2026_Lets%20go_TechDeclaration.pdf)。技术测试和助手操作的线上核验不等于独立队友研究。

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
| 8 | [#24](https://github.com/jake2ace/SDC-Tracker/issues/24) | 已完成 — 按队长确认的现有演示范围；数据持久化后续跟踪 |

详细资料：[依赖与验收计划](docs/ISSUE_PLAN.md) · [前端交接](docs/FRONTEND_HANDOFF.md) · [决策记录](docs/decisions.md)。

## 提交检查清单

- [x] 确认正式注册队长、成员和大学。
- [x] 记录 SDG 8.2／8.3、实际分工、workshop 与原创性回答。
- [x] 补充 PPT 和 6:19 YouTube 视频链接，并验证未登录播放。
- [x] 记录 Replit 使用和真实使用证明、RunPod 实际非使用说明。
- [x] 完成正式方案和技术声明 PDF，并按队长授权填写文字签名及日期。
- [x] 按确认后的队名与官方模板命名提交文件。
- [x] 公开仓库；核验公开原型、六项线上流程和独立生产构建检查。
- [x] 在材料 PR 合并后复核默认分支的最终 PDF、PPT 与全部链接。
- [x] 将门户显示的提交记录、代码／材料版本及核对范围保存在 [STEP-8 记录](docs/issues/08-submission.md)。

队长于 2026 年 10 月 25 日明确选择“这次先用现有演示，后续再完善数据保存”。因此本次保留队友已上线、已测试的合成演示并完成 STEP-8；云端重新发布后的数据保存转为 [后续改进 #40](https://github.com/jake2ace/SDC-Tracker/issues/40)，不记作已通过的测试。

官网 [FAQ](https://sdchack.my/faq) 和当前门户显示的截止时间为 **2026 年 10 月 25 日 07:59 AM MYT**。门户中的提交记录与本仓库材料发布是不同证据，见 STEP-8 的对应记录。

## 许可证

采用 [Apache License 2.0](LICENSE) 许可证。
