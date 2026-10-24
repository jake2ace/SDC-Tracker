# STEP-8：部署与提交材料

GitHub：[#24](https://github.com/jake2ace/SDC-Tracker/issues/24)

**状态：DONE — 按队长于 2026-10-25 明确确认的现有合成演示范围完成；云端数据持久化转为后续改进 [#40](https://github.com/jake2ace/SDC-Tracker/issues/40) · 职责：后端开发负责部署与技术核对；文档和演示任务负责人准备材料，团队确认并完成实际提交 · 依赖：部署骨架 STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))；技术验收 STEP-7 ([#23](https://github.com/jake2ace/SDC-Tracker/issues/23)，两项人工证据按用户要求跳过)**

## 目标

及早确认可部署，最终让评委访问的产品、材料和演示数字一致，并按最新官方要求完成提交核对。

## 范围与允许目录

部署配置、`scripts/`、`README.md`、`docs/` 及团队提交资料；前后端代码修改回对应步骤。密钥仅通过部署平台环境变量配置。

## 完成标准

- [x] **早期检查：** STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18)) 骨架可运行后立即部署并验证页面/API、健康检查、环境变量与持久化方式；记录链接与问题。
- [x] **最终检查（按本次确认的演示范围）：** 线上 STEP-7 ([#23](https://github.com/jake2ace/SDC-Tracker/issues/23)) 核心流程已走通；隔离生产环境的重启、失败场景、无 AI key 可见降级、人工录入和规则核对通过。按 README 完成干净安装、配置、初始化和运行。云端跨重新发布的数据保留按队长决定移至 [#40](https://github.com/jake2ace/SDC-Tracker/issues/40)，本次不宣称该能力已通过。
- [x] PRD、pitch deck、工具/模型/第三方声明、公开仓库与演示视频按当前官方清单核对；UI 和演示以英文表达，功能与数字有实测依据。
- [x] 清楚说明全部合成数据、模拟开票/发送/收款、CSV 导入和人工审批边界；不宣称 live Orbyte、银行实时接入或真实回款效果。
- [x] 团队确认讲解内容和实际分工；核对链接权限、视频可访问性、材料版本、截止日期及提交入口，确保评委可访问。
- [x] 实际提交后另存回执/状态证据；部署完成、材料完成和已提交分别记录，不能互相代替。

第二项的证据与范围：六项线上 F01–F06 流程通过；干净环境安装、初始化、构建及本地生产进程重启通过；无 key 的 Template / manual_required、人工修正与规则核对均已验证。Replit 曾暂停恢复失败、重新发布后重置账本和原图。队长于 2026-10-25 明确选择“这次先用现有演示，后续再完善数据保存”，本次据此接受已说明的合成演示限制并完成 STEP-8；这不是云端持久化验证通过。详见[完整核验记录](../evaluation/STEP8-FINAL-CHECK.md)。

## 证据

部署链接及验证记录、干净环境复现记录、官方要求来源和检查日期、最终材料清单/版本、工具声明、团队确认与提交回执。

## 当前进度（2026-10-25）

- [最终材料索引](../../submission/README.md)已包含正式 PRD、技术声明、Replit 用证、RunPod 实际未使用说明、14 页 PPT 及 [6:19 YouTube 视频](https://www.youtube.com/watch?v=pholjV_8vBM)。签名为队长明确授权的文字签名 Jiazhong Yang，日期 25 October 2026。
- 当前公开应用基线是 `c438678`。同一版本在[独立干净生产环境](../evaluation/STEP8-INDEPENDENT-PRODUCTION.md)通过 60 后端、23 前端、13 契约组、两端类型检查与构建；4 项部署测试包含在 60 后端测试内，另有 9 项真实生产进程检查。旧的 3 条自动化浏览器场景本次未重跑；PPT 第 11 页已标为历史统计。
- [F01–F06 线上浏览器实测](../../submission/validation/results.json)通过。主发票现为已收 RM18,000、未收 RM0、两笔 RM9,000；另一张 RM6,000 发票未支付。本轮保留现有结清状态，未重置或重新部署线上演示。
- [公开演示](https://milestone-2-cash-proof-to-cash.replit.app/)及健康检查当前可访问；GitHub 仓库已公开；YouTube 浏览器可播放、显示 6:19，未携带 Cookie 的官方 oEmbed 接口返回 HTTP 200。
- 官网 FAQ 与提交页面均显示截止 **2026-10-25 07:59 AM MYT**。刷新提交网站后，已显示保存的 GitHub 链接及 API integration confirmed；[状态截图](../../submission/SUBMISSION_STATUS.md)已保留。页面未显示最初保存时间，本轮没有重新接受或修改该声明。
- Markdown 旧方案/技术声明/脚本已标明是历史准备稿，以正式 PDF、PPT 和视频为准。素材清单、文件哈希与核验范围见[完整记录](../evaluation/STEP8-FINAL-CHECK.md)。
- [PR #39](https://github.com/jake2ace/SDC-Tracker/pull/39) 已合并至 `main`，合并提交 `ab43055bf8d909c7295d4fecd9a31cbfbcc3cd55`。正式材料已从默认分支读回并核对 blob SHA。
- 队长已明确接受本次现有演示范围，保留队友已上线的网站，不重新发布、不改变当前账本。云端重新发布后的数据保存由 [#40](https://github.com/jake2ace/SDC-Tracker/issues/40) 后续跟踪；STEP-8 按已确认范围完成。
