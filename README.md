# SDC Tracker

**项目交付 → 自动开票 → AI 催收 → 30 天现金流预测。**

SDC Hackathon 2026 · Domain 2 · 队伍 Lets go

> 当前分支：Issue #1 共享数据、Issue #3 自动开票、Issue #4 AI 催收模块及测试已落地；等待接入 Issue #2 的页面、会话、审批和数据库。以下是完整初赛目标。

## 初赛必须完成

| 功能 | 最终效果 |
|---|---|
| 自动开票 | 项目阶段完成后生成正确的发票草稿；人工批准后模拟开票，保存结果。 |
| AI 催收 | 识别逾期欠款，AI 生成可修改的提醒；人工确认后模拟发送，付款后停止催收。 |
| 现金流预测 | 展示未来 30 天预计余额，对比按时与延迟到账，标出低于安全线的日期和金额。 |

三个功能共用数据，必须能演示一次完整流程。使用团队自建合成数据和模拟外部接口，业务逻辑真正运行。

- [完成标准](docs/ACCEPTANCE.md)
- [Issue #1：故事、数据与接口约定](docs/DATA_CONTRACT.md)
- [Issue #3：自动开票运行与接入](docs/INVOICING.md)
- [Issue #4：DeepSeek AI 催收运行与接入](docs/COLLECTIONS.md)
- [故事与完成标准 PDF（前期方案名：Milestone2Cash）](docs/Milestone2Cash_初赛故事与完成标准.pdf)
- [GitHub 项目管理流程](docs/WORKFLOW.md)

## 做事顺序

1. 统一演示案例、数据字段和接口约定。
2. 搭建数据库、页面、权限、审批和日志。
3. 开发开票、AI 催收与现金流三个功能，持续联调。
4. 按完成标准验收，部署后再验证一次。
5. 完成提交材料，检查链接和可复现性。

用 Issues 记录任务，用看板跟踪状态，用 Pull Request 合并修改。人员由团队自行认领与安排。

## 如何运行

当前先检查 Issue #1 的共享契约（Node.js 20 或以上，无需安装依赖）：

```sh
node --test tests/contract.test.mjs
```

前端与后端从同一份 [demo.json](data/demo.json) 初始化；字段使用 [domain.ts](contracts/domain.ts)，接口使用 [api.ts](contracts/api.ts)。测试预期在 [expected-results.json](data/expected-results.json)。JSON 数据可直接复制进 mock adapter；不得硬编码另一套金额或日期。

运行自动开票演示及全部测试（Node.js 22.13 或以上；SQLite 只用于测试，无需安装依赖）：

```sh
node examples/invoicing-demo.mjs
node --test tests/*.test.mjs
```

演示会依次显示生成草稿、未批准阻断、模拟失败、重试成功与重复开票保护。审批使用明确标注的测试占位，数据仅保存在内存；应用启动命令将在基础工程接入后补充。

AI 催收：首次使用将 `.env.example` 复制为 `.env`，只填写 `DEEPSEEK_API_KEY=` 右侧，再运行：

```sh
node --env-file=.env examples/collections-demo.mjs
```

这会请求一次 DeepSeek 话术选择并在本地组装草稿，输入 `SEND` 才模拟发送。AI 只能选择审核过的催收话术，无权读文件或执行命令；事实和客户资料不进入模型请求。地址与模型已配置；`.env` 不上传 Git。自动测试使用模型替身，完整应用仍待联调。详见 [AI 安全边界](docs/COLLECTIONS.md#ai-安全边界)。

## 交付与声明

初赛交付包括原型、公开 GitHub / README、官方 PRD、PPTX、技术工具声明及 5–7 分钟演示视频。开发期仓库保持 private，提交前按规则公开并核对访问权限。

实际使用的 AI、第三方代码、模型和服务均须记录；Replit 使用证据及适用的 RunPod 证据随声明整理。提交前确认官方格式、截止时间和 API sponsor 声明的具体要求。

参考：[Domain 2 正式赛题](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view) · [Participant Handbook](https://drive.google.com/file/d/1fGBS-jevDj_FrF8wsbYNPzyU5TTrfk1V/view)

代码采用 Apache-2.0；第三方内容保留各自许可与署名。
