# Proof-to-Cash contract v1.0.0

对应 [STEP-1 / #17](https://github.com/jake2ace/SDC-Tracker/issues/17)。**STEP-2 已实现身份列表、工作区和五个开票／催收写接口；其余十个接口仍为 planned，前端尚未实现。** 按 `contracts/api.ts` 的逐端点 status 区分能力；后端运行方式见[运行说明](BACKEND.md)。本文中的阈值、接口和技术栈是工程约定，不是 PDF 原文规定。

## 文件与版本

- `contracts/domain.ts`：实体、AI 输入输出、matcher 与 forecast 输入输出类型。
- `contracts/api.ts`：请求、响应、错误、端点及角色矩阵，逐项标注 implemented 或 planned。
- `contracts/rules.json`：金额、时间、幂等、匹配、CSV、上传、AI 和预测规则。
- `contracts/ai.schema.json`：JSON Schema 2020-12；根校验 `aiInput`，`$defs` 分别校验三类模型输出。
- `contracts/fixtures.json`：独立场景和完整 `Workspace` 快照。`stateId` 是场景前置，`nextStateId` 是成功后状态；失败不得改变业务状态。成功写操作的后置快照继承前置日志并追加审计事件；错误样例保留业务快照，实际服务可另外追加拒绝尝试日志。
- `data/seed/`、`data/eval/`：运行演示种子与独立评测输入／gold，由数据负责人维护。评测 gold 不发给模型或 matcher。

接口采用 camelCase；未定义字段拒绝，避免无意扩大写权限。响应只使用本契约字段；没有 `$ref` 替身或缩略实体。新增可选字段需同步 mock、类型及后端；删除、改名、语义或状态变化需升级契约版本并通知双方。合约版本 `1.0.0` 不代表产品发布版本。

技术约定：Node.js 22.13+、ES modules、SQLite 后端；共享 TypeScript DTO；React + TypeScript + Vite 前端位于 `web/` 独立包。前端依赖精确版本在安装阶段验证并锁定。本地 tesseract.js OCR、服务器 DeepSeek；模型和 API 地址通过服务器环境配置，真实调用需要另行验证。不得把 key 放入前端。以上不是 PDF 强制技术栈。

## 标量、身份与公司

- 金额是 JavaScript safe integer 的 MYR **sen**。发票、credit、payment、expense 必须正数；paid/outstanding 可为零；余额与有符号现金 delta 可负。运算中间结果也必须保持 safe integer。
- UTC timestamp 必须是实际有效的 ISO 时间且以 `Z` 结尾，例如 `2026-10-23T04:00:00Z`。业务日期是有效 `YYYY-MM-DD`，语义固定为 MYT 日历日期，不按浏览器时区解释。
- 固定演示时钟为 `2026-10-23T04:00:00Z`，即 MYT 2026-10-23 12:00。实时模式未来另定，不能让演示随宿主时钟漂移。
- 公司固定示例 `co_lumen`、`co_rantau`。服务器根据 `X-Demo-User` 查自己的用户表，得到唯一 companyId 和 role；请求不能传 companyId 来覆盖身份。
- 所有实体查找、关系关联、图片访问及写操作先校验公司。另一公司的资源返回通用 `404 NOT_FOUND`，不返回 ID、付款人或余额细节。角色不符返回 `403 FORBIDDEN`。
- `X-Demo-User` 是可切换的演示身份，不是生产认证。`GET /api/demo-users` 只列合成用户选择项，不需要身份，不返回客户资料。
- 各公司独立验证 Owner / Finance / PM；**没有隐式角色继承**。Owner 不自动拥有 Finance 或 PM 的写权限。全部角色可以读取自己公司的工作区、预测和图片。
- 所有金额状态、版本、权限、重复和过期检查由服务器执行。前端禁用按钮只是辅助，不是授权。

## 状态与关键不变量

`TenantEntity` 统一包含 id、companyId、正整数 version、createdAt、updatedAt；新实体 version=1。Company.version 是银行集合／分配的聚合版本；有新入账导入或分配时递增，纯重复导入不递增。

| 实体 | 合法状态／转换 |
| --- | --- |
| Milestone | planned → completed；本版不撤销完成。 |
| Invoice | draft → issued 或 rejected；issued → partially_paid → paid，也可直接 issued → paid；rejected 不重新启用。 |
| Collection | draft/rejected 为 not_started；issued/partially_paid 为 active；paid 为 stopped。active 不等于已经逾期。 |
| Reminder | draft → sent_simulated；发送时仍需检查发票是否逾期且有余款。 |
| Reply / Receipt | ready / needs_review / manual_required；人工修正后由服务器盖章并重新核对。ready 只表示提取可用，不证明付款。 |
| Match | pending → applied；仅 confirmed 或 partial 可申请 Finance 入账。 |
| Promise | active → superseded 或 fulfilled；新承诺替代旧承诺；全额结清时 fulfilled。 |

发票号由服务器生成。一个 milestone 最多一张 invoice，创建不能复制；本版不提供编辑已批准发票、退款、冲销、拆分 credit、删除或修改已入账 payment 的入口。

Match 本版没有独立的“保存拒绝”操作；不批准／关闭核对面板会保留 pending，不改账本，也不产生持久化 rejected 状态。前端可提供返回、修正及重新核对，不能画出声称已保存拒绝决定的按钮。Owner 对 invoice 的 reject 则是表中明确的持久化操作。

`totalAmountSen = paidAmountSen + outstandingAmountSen`。paidAmount 只累加已批准 payment。**部分付款只减少余款，不能结清整张发票，也不能停止余款催收。** 一笔 bank credit 只能完整分配给一张 invoice；其金额超过当前余款时进入人工复核，不自动拆分或入账。

## HTTP 与角色矩阵

默认 JSON 请求／响应使用 `application/json`，写请求必须有 `X-Demo-User` 和 `Idempotency-Key`。multipart 的数值和 ID 是字符串表单项，由服务器严格解析。所有列表对当前合成演示提供完整公司快照，不另造分页 API。

| Operation ID | Contract endpoint | 写角色／读取 | 成功数据与 HTTP |
| --- | --- | --- | --- |
| listDemoUsers | GET `/api/demo-users` | 公开合成身份项 | `{users}`，200 |
| getWorkspace | GET `/api/workspace` | 全角色／当前公司 | Workspace，200 |
| completeMilestone | POST `/api/milestones/:id/complete` | PM | Milestone，200 |
| createInvoiceDraft | POST `/api/milestones/:id/invoice-draft` | PM | `{invoice,milestone,existing}`，200 |
| decideInvoice | POST `/api/invoices/:id/decision` | Owner | Invoice，200 |
| generateReminder | POST `/api/invoices/:id/reminders` | Finance | Reminder，201 |
| sendReminder | POST `/api/reminders/:id/send` | Finance | Reminder，200 |
| createReply | POST `/api/invoices/:id/replies` | Finance | `{reply,fallbackReason}`，201 |
| correctReply | PATCH `/api/replies/:id/extraction` | Finance | Reply，200 |
| uploadReceipt | POST `/api/invoices/:id/receipts` | Finance | `{receipt,existing,fallbackReason}`，200 |
| getReceiptImage | GET `/api/receipts/:id/image` | 全角色／当前公司 | 原图字节与正确 Content-Type，200 |
| correctReceipt | PATCH `/api/receipts/:id/evidence` | Finance | Receipt，200 |
| importBankStatement | POST `/api/bank-statements` | Finance | BankImportResult，200 |
| runMatch | POST `/api/receipts/:id/match` | Finance | MatchResult，200 |
| approvePayment | POST `/api/matches/:id/approve-payment` | Finance | `{payment,invoice,bankCredit,match,companyVersion}`，200 |
| confirmPromise | POST `/api/replies/:id/confirm-promise` | Finance | `{promise,invoice,reply}`，200 |
| getForecast | GET `/api/forecast?asOfDate=2026-10-23&delayDays=7` | 全角色／当前公司 | Forecast，200 |

除了图片成功响应，其余成功为 `{data,meta}`，失败为 `{error,meta}`。meta 包含 requestId、contractVersion、mode=`demo`、asOf 和 idempotencyReplayed。图片失败仍用 JSON 错误信封，不能把错误文字标成 image/png。前端必须先检查 HTTP 状态和 Content-Type。

### 写请求语义

- `expectedVersion` 总是目标路径实体的版本；发票草稿路径指 milestone，导入路径无实体 ID 时指 Company.version。
- completeMilestone 只接受 expectedVersion。createInvoiceDraft 也只接受 expectedVersion，金额、客户、项目、到期日来自 milestone，不能从客户端覆盖。
- decideInvoice 带 decision=`approve|reject` 和 reason；reject 的 reason 必须非空。审批前只能是 draft。
- generateReminder 带 language；原始 dueDate 必须早于当前 MYT 日期且 invoice 尚有余款。使用已允许的文案模板，AI 只能起草。sendReminder 带 text、expectedVersion（reminder）和 expectedInvoiceVersion，再次检查余款及逾期后模拟发送。
- createReply 带 text、receivedAt、language；text 长度 1–4000 字符。receivedAt 不晚于当前演示时钟。创建时同步尝试提取，故障返回成功创建的 manual_required 记录及 fallbackReason，不丢掉用户输入。
- correctReply 带 intent、promisedDate、amountSen、reason。correctReceipt 带完整 bank、amountSen、reference、transferredAt、payer、reason。人工修正不能写 source/confidence/reviewedBy/reviewedAt；服务器设置 source=manual、confidence=null 并记录审核人／时间。
- uploadReceipt 是 multipart：`file`、`expectedVersion`，可选 `replyId`；有 replyId 时必须同时给 expectedReplyVersion，并验证回复属于同一发票。成功关联时增加 reply.version。同一发票重传相同图片返回已有 receipt、existing=true，不再次 OCR 或产生另一笔证据，也不重新挂接另一个 reply；跨发票同图返回 409 DUPLICATE_EVIDENCE。
- runMatch 带 receipt.expectedVersion 和 expectedInvoiceVersion；服务器创建当前 ledger 版本的规则结果。
- approvePayment 只带 match.expectedVersion；金额、credit、invoice 等全来自已存 match，客户端不能覆盖。服务器原子校验 match 及其捕获的 invoiceVersion、receiptVersion、bankLedgerVersion、eligibleCreditVersion，并重新确认合法判定与未分配状态，然后写 payment、credit 分配、invoice 余额、match 状态、company 版本及 audit。任何一步失败全部回滚。
- confirmPromise 带 reply.expectedVersion、expectedInvoiceVersion、promisedDate、amountSen。回复必须已清楚提取或人工修正，且 intent=promise；确认日期必须有效，金额必须等于整笔当前余款。不同金额或歧义返回 REVIEW_REQUIRED。替代旧 active promise，更新 invoice.confirmedPromiseId 和版本，不能变更原始 dueDate 或创造 payment。
- `reason` 非空时长度上限 500；催款 text 长度 1–2000。服务端执行所有长度、金额、日期、角色及版本校验。

### 幂等、并发及错误

每个写请求用 8–128 字符的 `Idempotency-Key`（允许 ASCII 字母、数字、`.`、`_`、`:`、`-`）。记录唯一作用域 `(companyId, actorId, key)`，绑定 method、规范化路径及 body SHA-256。JSON 使用 RFC 8785 canonicalization；multipart 哈希覆盖文本项、文件 MIME 与文件字节 SHA-256，忽略 boundary／文件名。

顺序：认证及公司／角色检查 → 规范化并比较已存幂等记录 → 完整请求的成功重放 → 新请求的版本及业务校验 → 原子变更及持久化幂等结果。同 key 同内容重放原状态码和业务结果（meta 的 requestId 可更新、idempotencyReplayed=true），即使原 expectedVersion 已旧也不能再次执行。同 key 改内容或路径为 409；同 key 正在执行为 409 IDEMPOTENCY_IN_PROGRESS，可稍后用原 key 重试。幂等记录持久化跨重启；失败事务不得留下“已成功”的记录。

新 key 不豁免版本检查。目标实体或匹配捕获版本改变时返回 409 VERSION_CONFLICT，前端刷新并重新匹配，不盲改 expectedVersion 后再批准。已分配 credit 返回 409 CREDIT_ALREADY_ALLOCATED；same-image duplicate 返回 409 DUPLICATE_EVIDENCE。同 key 成功重放优先于这些业务重复检查。

| HTTP | error.code | 处理 |
| --- | --- | --- |
| 401 | UNAUTHENTICATED | 缺少／未知演示身份。 |
| 403 | FORBIDDEN | 同公司但无操作角色。 |
| 404 | NOT_FOUND | 不存在或属于另一公司，响应不泄露区别。 |
| 409 | VERSION_CONFLICT / IDEMPOTENCY_CONFLICT / IDEMPOTENCY_IN_PROGRESS / INVALID_STATE / DUPLICATE_EVIDENCE / CREDIT_ALREADY_ALLOCATED / BANK_IMPORT_CONFLICT | 不改变付款状态；按原因刷新、复核或重试原请求。 |
| 413 | PAYLOAD_TOO_LARGE | 拒绝超上传上限。 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 拒绝不支持的真实文件类型。 |
| 422 | VALIDATION_ERROR / IDEMPOTENCY_KEY_REQUIRED / REVIEW_REQUIRED | 修正字段或复核；不得自动批准。 |
| 500 | INTERNAL_ERROR | 回滚；不返回内部堆栈或密钥。 |

错误 details 只允许 fieldErrors、currentVersion、entityType、entityId、rowNumbers、reasonCodes；跨公司 404 不附实体细节。可恢复的“模型不可用”不是全请求 500，而是数据的 manual_required/fallback 状态。用户修正导致请求内容变化时使用新幂等 key。

## 上传及银行 CSV

图片只接受 PNG/JPEG/WebP，最多 5 MiB、解码后 20,000,000 像素，拒绝动画。服务器根据字节和解码结果检查，不信文件扩展名或客户端 MIME。路径由服务器生成；`imageId` 不暴露本地文件系统路径。原图访问仍要租户检查。

CSV 为 UTF-8，可含 BOM，最多 1 MiB、1000 个数据行；RFC 4180 引号转义。表头名称与顺序必须精确为：

```csv
externalId,postedDate,amountSen,reference,payer,bank
LUMEN-CREDIT-001,2026-10-23,900000,LMN-231026-001,KOPI TIGA TEST,DEMO RECEIVING BANK
```

externalId 非空最多 128 字符；postedDate 是 MYT 日期；amountSen 是正整数字符串，拒绝小数、指数、千位逗号、负数；reference 非空最多 128，payer 非空最多 200，bank 非空最多 100。本接口只导入 credit，不把 debit 当成负 credit。任何坏行整批拒绝，不产生半次导入；rowNumber 计数包括表头，所以第一个数据行是 2。

postedDate 不得晚于当前 asOf 的 MYT 日期；未来日期不是当前到账证据，导入整批返回 422 VALIDATION_ERROR。即使内部输入绕过导入，matcher 仍独立检查并阻止未来流水入账。

同公司 externalId 唯一：同规范化内容跳过，不同内容整批 409 BANK_IMPORT_CONFLICT。另按规范化 bank + postedDate + amountSen + reference + payer 指纹去重；换 externalId 不得把同一条银行记录导入两次。批内也执行相同校验。fingerprint 相同返回已有 credit ID；不会覆盖已分配信息。原始规范化字段保留用于审计。

reference 规范化：Unicode NFKC、trim、uppercase、移除 Unicode 空白，**保留标点**。payer/bank：NFKC、trim、uppercase、连续空白折叠为单个空格，保留标点。externalId 只 trim，大小写有意义。不做模糊编辑距离或拼写猜测。

BankCredit.bank 是**收款账户银行**；ReceiptEvidence.bank 可能是**发起付款银行**，二者不要求相等，不能因此拒绝跨行转账。

## Matcher 的确定性规则

1. 首先检查公司／关联、invoice 可收款状态、正金额、必需字段、有效时间。无效、缺字段或未来 transfer 时间为 needs_review；HTTP 上非法人工输入先 422，不进入 matcher。bank、amountSen、reference、transferredAt、payer 均为核对所需字段。
2. AI evidence 的 confidence 必须 ≥0.85；这是人工分流阈值，不是经过校准的准确概率。manual evidence 必须有服务器 reviewedBy/reviewedAt；缺审核章或低置信度为 needs_review。
3. 已知跨发票重复图、已批准 payment 使用过的规范化 reference、已分配 credit 为 duplicate。只在同公司范围判断，不把另一公司的记录泄露为候选。
4. 在同公司 bank credits 中以 **exact normalized reference** 找候选；无 reference 候选为 not_in_bank_yet，含义仅为当前导入数据尚无证据，不是断言银行未到账。
5. 候选付款人和截图付款人都必须精确命中该 Customer 独立维护的 payerAliases。别名不能从当前截图“学习”；不匹配为 needs_review/wrong_payer。
6. bank postedDate 必须不晚于 asOf 的 MYT 日期，且在 receipt.transferredAt 对应 MYT 日期的 `[当天, 当天+2日]`，包含两端。未来流水为 needs_review/future_bank_posting；有同参考号但日期窗口外证据时为 needs_review/date_outside_window，不误称未到账。
7. 同参考号范围内出现多个有歧义的候选为 needs_review/multiple_candidates；不因为其中一笔金额“看起来刚好”就忽略矛盾记录。
8. 唯一合格候选的 bank 金额必须与截图金额完全相同，容差 0 sen；不相同为 amount_mismatch。信用金额超过 invoice 余款为 needs_review/overpayment。
9. bank 金额等于全部余款为 confirmed；小于余款且大于零为 partial。仅两者生成 eligibleCreditId 和拟入账／余款金额，其余结果为 null，必须由 Finance 批准后才写 payment。

整个 matcher 不调用模型，也不识别图像是否被编辑。审核人不能直接把任意判定改成 confirmed；需要修正字段、补充独立银行数据并重新运行规则。匹配结果记录所用版本；审批时不能信任前端或旧 verdict。

## AI 白名单与人工降级

PDF p5 的 OCR 结构化需求与 p6 “只发回复和金额”的描述存在范围冲突；本版选择最小必要脱敏文本方案，并明确记录为工程约定。

只允许 AiInput 字段：task、redactedText、language、可选 outstandingAmountSen、replyReceivedAt、referenceDate，以及固定 timezone。不允许原图、银行流水、客户完整资料、账号、电话、邮箱、地址。图片先服务器本地 OCR；付款人和 reference 在本地改为 `PAYER_*`、`REF_*` token，模型只能回传当前请求已存在的 token，本地映射还原。未知 token、试图直接输出原始标识、字段越界或 schema 失败均转 manual_required，不能信模型“推测”。

AI 输出 JSON Schema 拒绝额外字段，金额需正整数 sen，日期需实际日历合法；业务上还校验时区、相对日期及金额。输出 confidence<0.85 为 needs_review；网络／配额／key／非法输出为 manual_required；明确 fallbackReason，保留原始输入给人工修正。提示词和 OCR 文本都只是数据，不能修改系统权限。

回复承诺日期以 receivedAt 的 MYT 日期作参照。类似“Friday”而无法确定是哪一个 Friday 时必须人工确认。模型不能签发、发送、入账或修改预测；没有 AI key 仍可手填字段，使用同一 matcher。

## 30 天预测与承诺

`asOfDate` 必须等于 `asOf` 的 MYT 日期。返回连续 30 个 MYT 日期 `[asOfDate, asOfDate+29]`；两条场景依次为 on_time(delayDays=0) 和 delayed（请求的 0–30 天）。

- openingBalanceSen 是该日 MYT 00:00 的**演示账本余额**，已包含此前确认的历史 payment。
- Payment.effectiveDate 使用 Finance.confirmedAt 的 MYT 日期，bankPostedDate 独立保留为银行证据。不追溯改账；今日批准昨日流水会成为今日演示 actual，而不是改动过去 opening balance。这不等于银行真实到账时间。
- 仅 effectiveDate=asOfDate 且 confirmedAt<=asOf 的已批准 payment 作为当日 actualReceipts。旧 payment 已含在 opening 中，不重复加；未来未确认记录不得算实际到账。
- 对 issued / partially_paid invoice，仅 outstandingAmountSen 作为 expected。若有有效 active promise，使用 promisedDate，否则 dueDate；先将过去的预计日期落到 asOfDate，再按场景加 delayDays。
- Promise 只支持确认整笔余款的预计日期，不支持拆分金额承诺。之后有部分付款时，以当前 outstanding 作为预测金额，不能继续计原 promise.amountSen 全额。
- Expenses 按原 dueDate 扣减；delayDays 只移动 expected receipts，不改变 actual、opening 或 expense。早于 asOfDate 的 expense 已在 opening 中，不再扣。
- 超出 30 天的 expected 不计入窗口余额，列入 deferredInvoiceIds。不会把移出窗口的账款说成已收回。
- `closing = opening + actualReceipts + expectedReceipts - expenses`；下一天 opening 等于前日 closing。安全线用严格 `< safetyThresholdSen`。每一笔 delta 保留 sourceId、invoiceId（非发票项可为 null）及 entryIds。

Lumen 主例：发票 1,800,000 sen；确认 900,000 sen 后余款 900,000 sen、状态 partially_paid、collectionStatus=active。余款确认在 2026-10-30 支付时，预计只加 900,000 sen。所有余额、银行数据和公司均合成，不是账户资金证明。

## 前端 mock 与验收边界

前端数据访问层用同一 `ApiOperations` DTO 对接 mock/api。fixtures 场景必须独立重置或按指定 nextStateId 过渡；不能把相互独立的全额与部分付款场景连起来。同公司换角色可在验证身份后替换 actor；**跨公司切换必须载入对应公司的整份 Workspace**，清理旧详情、上传、选中项和缓存，不能只替换 actor。actor.companyId 必须与 workspace.company.id 一致；fixtures 提供 Lumen 与 Rantau 两份完整工作区，不能把 Lumen 账本挂到 Rantau 身份下，也不能把 fixture 内的 Finance actor 当作实际权限。

multipart fixture 使用文件描述符代替 JSON 假 Blob。截图二进制尚未生成，标为 planned_not_generated；图像生成与 OCR 实测属于后续步骤。不能用占位 hash 或文件名声称已经跑通 OCR。

契约样例可验收类型、格式、场景一致性和独立 gold 算术。STEP-2 的运行结果单独记录在[后端说明](BACKEND.md)。实际匹配率、OCR 准确率、真实 AI 调用、人工耗时、部署及完整端到端行为必须由后续实现另行验证，不能把 contract fixtures 当作通过结果。
