# STEP-8：部署与提交材料

GitHub：[#24](https://github.com/jake2ace/SDC-Tracker/issues/24)

**状态：IN PROGRESS · 职责：后端开发负责部署与技术核对；文档和演示任务负责人准备材料，团队确认并完成实际提交 · 依赖：部署骨架 STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))；技术验收 STEP-7 ([#23](https://github.com/jake2ace/SDC-Tracker/issues/23)，两项人工证据按用户要求跳过)**

## 目标

及早确认可部署，最终让评委访问的产品、材料和演示数字一致，并按最新官方要求完成提交核对。

## 范围与允许目录

部署配置、`scripts/`、`README.md`、`docs/` 及团队提交资料；前后端代码修改回对应步骤。密钥仅通过部署平台环境变量配置。

## 完成标准

- [ ] **早期检查：** STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18)) 骨架可运行后立即部署并验证页面/API、健康检查、环境变量与持久化方式；记录链接与问题。
- [ ] **最终检查：** 在部署环境/无痕窗口走通 STEP-7 ([#23](https://github.com/jake2ace/SDC-Tracker/issues/23)) 核心流程、重启与失败场景；移除 AI key 后可见降级，人工录入和规则核对仍可工作。按 README 可在干净环境安装、配置、初始化和运行。
- [ ] PRD、pitch deck、工具/模型/第三方声明、公开仓库与演示视频按当前官方清单核对；UI 和演示以英文表达，功能与数字有实测依据。
- [ ] 清楚说明全部合成数据、模拟开票/发送/收款、CSV 导入和人工审批边界；不宣称 live Orbyte、银行实时接入或真实回款效果。
- [ ] 团队确认讲解内容和实际分工；核对链接权限、视频可访问性、材料版本、截止日期及提交入口，确保评委可访问。
- [ ] 实际提交后另存回执/状态证据；部署完成、材料完成和已提交分别记录，不能互相代替。

## 证据

部署链接及验证记录、干净环境复现记录、官方要求来源和检查日期、最终材料清单/版本、工具声明、团队确认与提交回执。

## 当前进度（2026-10-24）

- 已准备前后端同一地址运行、`.replit` 配置和[部署说明](../DEPLOYMENT.md)。50 项后端、16 项前端、3 条浏览器流程、13 组契约检查通过；另有独立生产进程浏览器检查，覆盖重启持久化和无 key 降级。
- [英文方案](../../submission/PRODUCT_NARRATIVE.md)、[技术声明草稿](../../submission/TECH_DECLARATION.md)和[演示脚本](../../submission/PITCH_SCRIPT.md)已准备；四人注册名单已确认。最终官方 PDF、平台用证、签名与录制仍待完成。
- 已复核[当前官方要求](../SUBMISSION_REQUIREMENTS.md)：截止为 2026-10-25 07:59:59 MYT，提交仓库需公开，Replit 需真实用证；RunPod 适用性与表单 API Premium sponsor 声明仍需确认。
- [Replit 项目](https://replit.com/@lijieheng18/Milestone2Cash-Proof-to-Cash)已发布到[公开演示](https://milestone-2-cash-proof-to-cash.replit.app/)，公网收款全流程及真实 AI 调用通过，详见[托管验证](../evaluation/HOSTED-VERIFICATION.md)。这是可重置的共享 SQLite 演示环境，不能宣称具备持久财务存储。
- [朋友测试指南](../FRIEND_TEST_GUIDE.zh-CN.md)已准备。正式使用证明 PDF、视频、团队签署和提交回执仍未完成，本 Issue 保持 IN PROGRESS。
