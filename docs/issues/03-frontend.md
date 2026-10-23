# STEP-3：前端设计、开发与 API 对接

GitHub：[#19](https://github.com/jake2ace/SDC-Tracker/issues/19)

**状态：DONE · 职责：前端设计与开发；前后端共同协调接口和联调验收 · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17))；最终对接依赖 STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))、STEP-4 ([#20](https://github.com/jake2ace/SDC-Tracker/issues/20))、STEP-5 ([#21](https://github.com/jake2ace/SDC-Tracker/issues/21))、STEP-6 ([#22](https://github.com/jake2ace/SDC-Tracker/issues/22))**

## 目标

用英文界面清楚展示发票/催收、客户回复与付款证明、银行 CSV、匹配审批及现金流；先接同契约 mock，再接真实后端。

## 范围与允许目录

`web/`、`web/` 内前端测试及说明；共享依赖配置、`contracts/` 和后端变更由后端任务负责人及项目协调人员共同确认。不得将密钥或核心财务判断放入前端。

## 完成标准

- [x] 使用 STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17)) 的统一数据和 API client；mock 可替换，所有写入以服务端返回状态为准，不在各页面维护不同账本。
- [x] 完整展示加载、空数据、失败、待审核、驳回、部分付款及结清状态；低置信度字段可检查/修正，保留原始来源。
- [x] 人工审批前展示发票、证据、银行记录、拟入账金额与余款；不把 `Matched`、收据或付款承诺展示成银行已确认到账。
- [x] 成功操作后刷新相关余额、催收、日志和预测；失败不显示成功，重复点击不重复提交；旧页面数据不能覆盖新结果。
- [x] 桌面和手机可用，键盘能操作，金额/日期清晰；演示与模拟状态明确，UI copy 使用英文。

## 证据

运行与 API/mock 切换方式见 [web/README.md](../../web/README.md)。全部 17 个接口已对接；16 项前端测试、3 个浏览器集成场景和前端构建通过，关键截图与操作过程见[第七步联调报告](../evaluation/STEP7-INTEGRATION.md)。完整演示视频属于 STEP-8 提交材料，尚未录制。

前端和技术联调完成不等于人工效率实验或团队验收完成；STEP-7 的两项人工证据仍待补。
