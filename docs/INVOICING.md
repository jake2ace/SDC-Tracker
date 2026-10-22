# Issue #3：阶段完成 → 模拟开票

已实现独立的开票业务模块与路由分发器，等待接入 #2 的服务器、会话和数据库。审批页面与审批接口仍由 #2 负责。

在仓库根目录运行（Node.js 22.13 或以上，无需安装依赖）：

```sh
node examples/invoicing-demo.mjs
node --test tests/*.test.mjs
```

演示：10 月 22 日 PM 完成设计确认 → **RM18,000 草稿** → 未批准开票返回 **409** → **#2 审批占位 fixture** → 10 月 24 日模拟开票先 **502**、重试 **200** → 实际到期 **11 月 7 日** → 重复点击返回同一回执，实际尝试 **2 次**。

金额、账期取自 [demo.json](../data/demo.json)。CLI 仅用内存、不写盘；fixture 只是演示中写入批准记录，不代表审批接口已经完成。

## 给 #2 的接入要求

1. **共用状态与事务。** `createInvoicingService({ store, now })` 读取 #1 的 `DemoState`。`store.read()` 返回隔离的快照；`store.transaction(fn)` 在所有写入共用的排他锁／数据库事务内执行一次**同步**回调，返回后提交，抛异常则回滚，提交完成才 resolve。返回 403、409、502 也要提交拒绝日志、失败记录和尝试次数。审批、演示设置及其他模块必须参与同一套并发控制。
2. **服务端决定身份。** `userId` 必须由可信会话映射到同公司的 #1 用户；不能直接信任正文、查询参数或生产请求里的演示身份头。公司从用户推导，业务模块检查角色和对象归属。
3. **#2 提供批准／驳回。** 批准时设置 `status: "approved"`，保存 `approval: { by: owner.name, role: "owner", at: ISO时间戳 }`；Owner 必须属于同一公司，并记录操作日志。存储层只接受服务端允许的字段更新，批准后禁止变更发票金额、客户、账期和付款依据；开票使用已批准快照，不从后来修改的项目条款重新取值。数据库须保证阶段对应发票、开票请求 ID 与回执请求 ID 各自唯一。
4. **挂载已有 HTTP 服务。** 用 [routes.mjs](../src/invoicing/routes.mjs) 的 `routeInvoicingRequest(service, { method, pathname, query, body, userId })`，其中 `query` 是 `URLSearchParams`，`body` 是已解析的 JSON。返回 `{ status, body }` 时按原样响应；返回 `null` 时交给宿主的其他路由；异常交给宿主错误处理。

| 本模块负责的路由 | 用途 |
|---|---|
| `GET /api/projects` | 同公司项目、阶段与发票 |
| `POST /api/milestones/{id}/complete` | PM 完成阶段，同时生成唯一草稿 |
| `GET /api/invoices?status=…` | 发票列表，可选状态筛选 |
| `GET /api/invoices/{id}` | 发票详情及相关日志 |
| `POST /api/invoices/{id}/issue` | Finance 批准后模拟开票；失败重试、重复回执 |

两个 POST 均接受空对象 `{}`。成功响应直接返回业务对象，**不再套 `data`**；错误结构见 [api.ts](../contracts/api.ts)。会计适配器仅模拟，无真实外部调用。

**接入前需要对齐：** 当前 #2 旧分支的 Node HTTP／SQLite 实现使用 `operator/reviewer/viewer` 及 `data` 响应封套，与 #1 的 `pm/owner/finance`、直接响应对象不同。需要明确适配角色、状态结构和事务存储后再接入；目前尚未完成与该分支的集成验证。
