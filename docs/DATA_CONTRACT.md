# Issue #1：共同开发约定

这份约定把已确认的界面草图接到同一套数据上。**本 Issue 交付数据、类型、接口和验收样例；页面、数据库及 HTTP 路由在后续 Issue 实现。**

| 给谁用 | 入口 |
|---|---|
| 前端、后端共用字段 | [domain.ts](../contracts/domain.ts)、[api.ts](../contracts/api.ts) |
| 初始化、重置演示 | [demo.json](../data/demo.json) |
| 核对金额、状态、日期 | [expected-results.json](../data/expected-results.json) |

## 1. 先讲一个故事

Studio Lumen 帮 Kopi Tiga 做店面设计，合同 **RM60,000**，分三次收款：

| 阶段 | 金额 | 初始状态 |
|---|---:|---|
| 签约 | RM18,000 | 演示开始前已收款，已计入期初余额 |
| 设计确认 | RM18,000 | 待完成，计划 2026-10-22 完成 |
| 最终交付 | RM24,000 | 计划 2026-12-10，超出本次预测窗口 |

演示时依次操作：

1. **10 月 22 日，项目经理完成设计确认** → 自动生成 RM18,000 草稿。
2. **老板批准，财务模拟开票** → 账期 14 天，实际到期日 **11 月 5 日**。
3. **切换至 11 月 8 日** → 未付款，显示 **逾期 3 天**；生成提醒，财务可编辑后模拟发送。
4. **登记 11 月 8 日全额到账** → 发票变为已付款，未发送提醒取消，停止催收；预测中实际收款替换预计收款。

固定预测窗口为 **10 月 22 日—11 月 20 日，共 30 天**。期初 RM20,000，安全线 RM10,000；11 月 10 日支出 RM25,000。

| 场景 | 期末余额 | 低于安全线的情况 |
|---|---:|---|
| 按时收 RM18,000 | RM13,000 | 无 |
| 延迟至窗口之后 | −RM5,000 | 11 月 10 日起，安全线缺口 RM15,000；负余额缺口 RM5,000 |
| 11 月 8 日已实际到账 | RM13,000 | 无；切换延迟场景也不能移动实际到账 |

第二家公司 Rantau Events 用于验证复用和公司隔离：期初 RM12,000、安全线 RM8,000，有一张 RM13,500 的已逾期发票；窗口内支出合计 RM15,000。按假定基准日收款时，期末 RM10,500；延迟到窗口之外时，期末 −RM3,000。

## 2. 数据必须遵守

- 金额使用**整数 sen**：RM18,000 = `1800000`。币种 `MYR`，禁止浮点货币运算。
- 业务日期使用真实日历日期 `YYYY-MM-DD`，按马来西亚日期计算；时间戳带时区。到期日 = 实际开票日 + `netDays`，当天不算逾期。
- `demo.json` 是初始状态，主案例尚未完成或开票。不要把 11 月 8 日的截图状态当初始化数据。
- 初赛只支持**单次全额收款**；收款金额从发票读取，请求不得改金额。分期、退款、税费、汇率不在此接口版本。
- 实体 ID 稳定且唯一。一阶段最多一张发票；一发票最多一笔付款、一条未发送提醒。重复点击不能追加副本。
- 公司归属以 `companyId` 为准；`Milestone` 沿 `projectId → Project.companyId` 推导。模拟回执沿请求 ID 关联发票或提醒。所有关联必须属于同一公司。
- 每次变更保存审批、执行人、时间及成功／失败／拒绝日志。对外回执始终 `simulation: true`，前端明确显示“模拟”。
- `mock_template` 仅是种子演示模板；`manual_template` 是用户明确选择的非 AI 备用模板，使用相同的事实校验和本地白名单句式。真正调用模型成功后才可标记 `source: "ai"`；模型不计算金额或逾期天数，也不能自行批准或发送。

### 状态和权限

| 对象 | 状态流转 |
|---|---|
| 阶段 | `pending → completed`，同一次事务生成 `pending_approval` 发票 |
| 发票 | `pending_approval → approved → issued → paid`，或 `pending_approval → rejected` |
| 提醒 | `draft → sent`；付款时未发草稿 `draft → cancelled` |

`rejected` 在本版本是终态，不重新生成该阶段发票。开票失败仍为 `approved`；发送失败仍为 `draft`，保留错误并允许重试。审批之后金额、客户和付款依据不可变。

| 操作 | 允许角色 |
|---|---|
| 查看总览、项目、发票、预测、日志 | 同公司全部角色 |
| 完成阶段 | `pm` |
| 批准／驳回发票 | `owner` |
| 查看催收工作台 | `owner`、`finance` |
| 模拟开票、生成／编辑／发送提醒、登记付款 | `finance` |

权限检查必须在服务端先于幂等判断执行。查另一公司的实体返回 `404`；同公司无操作权限返回 `403`。不得只隐藏前端按钮。

## 3. HTTP 接口

方法和请求／响应字段的完整类型在 [api.ts](../contracts/api.ts)。成功响应直接是表中对象，无额外 `data` 包装；除首次创建资源可用 `201` 外均为 `200`，幂等重试为 `200`。

演示模式用 `X-Demo-User: u_lumen_fin` 选择已存在用户；真实认证留给基础工程。缺失／未知身份返回 `401`。业务公司从用户推导，不接受正文覆盖。演示控制接口仅在显式启用演示模式时开放。

| 方法与路径 | 输入 | 成功输出 / 关键行为 |
|---|---|---|
| `GET /api/demo/session` | 无 | `settings, user, company, companies, users`；仅演示角色选择器可列出各公司的虚构角色 |
| `PUT /api/demo/settings` | 部分 `DemoSettings` | `{settings}`；切换公司时须同时选该公司的 `userId`；整体验证通过后原子更新 |
| `POST /api/demo/reset` | `{}` | `{settings}`；恢复完整种子状态，清空后续演示操作 |
| `GET /api/overview` | 无 | `Overview`，统计口径见下文 |
| `GET /api/projects` | 无 | `{projects: [...项目、client、milestones、invoices]}` |
| `POST /api/milestones/{id}/complete` | `{}` | `{milestone, invoice, created}`；重复返回原发票及 `created:false`；历史已收款阶段不生成新发票 |
| `GET /api/invoices` | 可选 `status` | `{invoices}` |
| `GET /api/invoices/{id}` | 无 | `{invoice, logs}` |
| `POST /api/invoices/{id}/approve` | `{}` | `{invoice}`；仅待审批，已批准重试返回同一记录 |
| `POST /api/invoices/{id}/reject` | `{reason}` | `{invoice}`；原因去空白后 1—500 字，已驳回且相同原因重试返回原记录 |
| `POST /api/invoices/{id}/issue` | `{}` | `{invoice, receipt}`；仅已批准，已开票／已付款重试返回原回执 |
| `POST /api/invoices/{id}/payments` | `{receivedAt}` | `{invoice, payment, cancelledReminders}`；仅已开票；同日期重复返回原付款，不同日期冲突 `409` |
| `GET /api/collections` | `filter=overdue\|unpaid\|paid`，默认 `overdue` | `{items: [{invoice, client, overdueDays, reminders}]}` |
| `POST /api/invoices/{id}/reminders` | `{regenerate?:boolean,useTemplate?:boolean}` | `{reminder}` 含 `reviewToken`；仅逾期且未付款；默认返回已有草稿；`regenerate:true` 更新**同一草稿**；`useTemplate:true` 明确选择人工备用模板，不调用 AI、不发送 |
| `PATCH /api/reminders/{id}` | `{subject, body}` | `{reminder}`；仅草稿；去空白后主题 1—200 字，正文 1—4000 字 |
| `POST /api/reminders/{id}/send` | `{reviewToken}` | `{reminder, outbox}`；服务端在同一事务内核对确认版本（正文、收件人和发票信息）；变化则 `409 DRAFT_CHANGED`，须重新加载检查。相同令牌重复发送返回原回执（即使后来已付款），首次发送仍校验未付款和逾期状态，无第二条 outbox |
| `GET /api/forecast` | `mode=fixed\|rolling`、`scenario=on_time\|late`、`delayDays=7\|14\|beyond_window` | `ForecastResult`；默认 `fixed` + `on_time`；`late` 必须带延迟参数 |
| `GET /api/activity` | `limit`，默认 50，范围 1—200 | `{logs}`，本公司日志按时间倒序，同时间按 ID 排序 |

收到未知字段、非法枚举／日期／数值，返回 `400`，不得静默修正。收款日期应在 `[issuedAt, demoDate]` 之间；不得移动演示日期至已记录业务事件之前（除重置）。`failNext` 如提供，须包含两个布尔字段。`on_time` 不接受 `delayDays`；查询参数数值须先严格解析。

### 总览与预测口径

- `unpaidAmount`：仅 `issued` 发票之和；`paid`、草稿和已驳回不计。
- `overdueAmount`、`overdueCount`：`issued` 且 `dueDate < demoDate`。
- `pendingApprovalCount`：`pending_approval` 数量。
- `pendingIssueAmount`：`pending_approval + approved` 金额之和，避免与已开票欠款混算。
- `overview.forecast`：固定窗口、按时场景的 `ForecastSummary`，前端展示其基准日期标签。
- 固定窗口从公司 `forecastBaseDate` 起算；滚动窗口从 `demoDate` 起算，两者均包含首日在内的 30 天。每日余额 = 前日余额 + 当日收入 − 当日支出。图表按日期绘制阶梯线。
- 尚无发票的阶段按 `plannedDate + netDays` 估计；已完成未开票阶段按草稿 `expectedDueDate`；已开票使用 `dueDate`。同一阶段只用当前最确定的一条，已驳回排除。
- `settledBeforeDemo` 已含在期初中，永远不追加收款。`paid` 发票只计真实 `Payment`，不能再计预计款。
- 已逾期且未收款，按时场景假定基准日到账，明确 `assumedToday:true`，不伪称已收款。延迟场景从 `max(到期日, 基准日)` 再加延迟；`beyond_window` 将原本窗口内预计款移至窗口结束后，原本已在窗口外的预计日期不提前。
- 滚动期初 = 原期初 + 原基准日至新基准日前已实际收款 − 同区间计划支出；本演示将计划支出视为按计划支付。这是预测假设，不是银行对账。
- `minBalance/minDate`、低于安全线天数均按**每日收支后的余额**统计，最低值相同取最早日；低于安全线是严格 `<`。安全线缺口 `max(0, safetyLine-balance)` 与负余额缺口 `max(0,-balance)` 分开。

### 失败与重试

统一错误示例（`details` 必须是对象）：

```json
{"error":{"code":"UPSTREAM_FAILED","message":"模拟开票失败，请重试。","details":{"retryable":true,"invoiceId":"inv_kt_2"}}}
```

| HTTP | code | 行为 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | 字段不合法，无业务写入 |
| 401 | `UNAUTHENTICATED` | 演示身份缺失或无效 |
| 403 | `FORBIDDEN` | 角色不能执行，记拒绝日志 |
| 404 | `NOT_FOUND` | 不存在或其他公司对象，不泄露详情 |
| 409 | `INVALID_STATE` | 状态不允许，例如未审批开票／已付款催收／历史已收款阶段完成 |
| 409 | `DRAFT_CHANGED` | 文案、收件人或发票信息已变化；重新加载、人工检查并确认，不自动更换令牌重试 |
| 502 | `UPSTREAM_FAILED` | 演示开票／发送失败，两者保存错误与失败日志；开票另更新 `issueAttempts`，本地状态不前进 |
| 503 | `AI_UNAVAILABLE` | 保留原草稿，显示模型失败；如提供模板降级，须由用户选择并标明来源 |

`failNext.accounting/outbox` 各只消费一次，模拟在外部回执写入前失败。开票重试沿用 `issueRequestId`，发送重试沿用 `sendRequestId`；服务端按请求 ID 取回唯一回执。正式外部适配器发生超时、结果未知时，必须先按相同幂等键查询／重试，不能换键再执行。

生成提醒失败不创建半成品；重新生成失败保留旧文案。`sequence = 已发送次数 + 1`，生成多次不增加次数；第 1 次 gentle、第 2 次 firm、第 3 次及以后 final。发送前重新核对金额、到期日、逾期天数；事实已变化返回 `409`，要求重新生成并人工检查。

## 4. 交付检查

在仓库根目录执行：

```sh
node --test tests/contract.test.mjs
```

检查种子关系、金额、状态与角色、手算预期结果及非法样本。该检查通过不等于 HTTP 服务通过验收；后续 Issue 要用相同种子和预期值验收实际页面、接口、并发重试及持久化。

Issue #1 的验收：能从 JSON 重置到同一故事；开发者能按类型调用同一组输入输出；正常与失败路径有明确处理；检查命令通过。提交 PR 供另一名组员审核后再关闭 Issue。
