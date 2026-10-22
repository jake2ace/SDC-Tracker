# 基础接口与 Issue #1 交接说明

本接口约定服务于 Issue #2 的通用工程。它只提供工作空间、演示身份、通用审批与日志，不预先决定公司的项目、发票、金额、付款节点、收款记录或财务状态。Issue #1 的业务数据设计由对应队友负责，完成后一起确认映射。

## 1. 请求与响应

接口路径以 `/api` 开头。JSON 写请求使用 `Content-Type: application/json`。

成功响应：

```json
{ "data": {} }
```

失败响应：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "面向调用方的错误说明",
    "requestId": "用于查找日志的请求标识"
  }
}
```

示例中的 `ERROR_CODE` 是格式占位符，不应写成固定判断条件。调用方需要检查 HTTP 状态码并显示服务端的错误说明，不能把失败响应当成成功对象。前端不能通过请求中的 `workspaceId`、角色或 `actorId` 自行决定权限；这些值由服务端根据会话确认。

## 2. 演示会话

| 方法与路径 | 请求 | 说明 |
| --- | --- | --- |
| `GET /api/demo/users` | — | 获取可选择的合成演示账户；仅演示模式开放 |
| `POST /api/demo/session` | `{ "userId": "从账户列表取得的 ID" }` | 建立演示会话，响应为 `{ "data": { "user": {}, "csrfToken": "…" } }` |
| `GET /api/session` | — | 获取当前会话用户和 `csrfToken`，结构同上 |
| `DELETE /api/session` | 无业务字段 | 退出当前会话；需要 CSRF token |

服务端使用不透明随机值作为会话 cookie，设置 `HttpOnly` 和 `SameSite=Strict`；客户端无需也不能从 JavaScript 读取该 cookie。HTTPS 部署时设置 `COOKIE_SECURE=1`。演示账号选择不提供生产身份认证；关闭演示模式后，需要另行接入身份系统才能登录。

除演示登录外，所有写请求都需要 `X-CSRF-Token`。服务端还检查请求的 `Origin`，阻止其他来源页面发起写操作。浏览器页面和 API 应由同一个服务地址提供；不要为了方便联调直接关闭来源或权限校验。

同源前端调用示例：

```js
// userId 从 GET /api/demo/users 的响应选择，不能硬编码为真实账号。
const loginResponse = await fetch('/api/demo/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId })
});
const loginBody = await loginResponse.json();
if (!loginResponse.ok) throw new Error(loginBody.error.message);
const csrfToken = loginBody.data.csrfToken;

const createResponse = await fetch('/api/operations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({
    title: '合成流程连通性检查',
    payload: { note: '仅用于演示，无真实财务数据' }
  })
});
const createBody = await createResponse.json();
if (!createResponse.ok) throw new Error(createBody.error.message);
const operation = createBody.data;
```

浏览器会为同源请求自动携带会话 cookie。切换账户后要使用新会话的 token，不要继续复用上一个账户的 token。

## 3. 通用操作接口

| 方法与路径 | 请求体 | 允许角色与状态 |
| --- | --- | --- |
| `GET /api/operations` | — | 所有登录角色；只返回本工作空间操作 |
| `POST /api/operations` | `{ "title": "标题", "payload": { "note": "备注" } }` | `operator` 创建 `draft` |
| `POST /api/operations/:id/submit` | `{}` | `operator`，仅 `draft` |
| `POST /api/operations/:id/approve` | `{}` | `reviewer`，仅 `pending_approval` |
| `POST /api/operations/:id/reject` | `{ "reason": "可选的驳回原因" }` | `reviewer`，仅 `pending_approval` |
| `POST /api/operations/:id/execute` | `{ "simulateFailure": false }` | `reviewer`，仅 `approved` |

每个操作包含以下字段：

```text
id, title, kind, status, workspaceId, createdBy,
createdAt, updatedAt, result, attempts, payload
```

当前创建的 `kind` 固定为 `foundation_check`，`payload` 只有通用备注 `note`。`attempts` 用于观察执行尝试，`result` 由服务端记录。调用方不能直接提交 `approved`、`executed`、执行结果或其他工作空间 ID 来绕过流程。

模拟失败使用 `simulateFailure: true`，返回 HTTP `503` 并记录失败，操作保留 `approved`。再次成功执行后变成 `executed`。已经执行的操作再次执行返回 HTTP `409`，不重复执行。`viewer` 只有读取权限。

这不是“AI 催收接口”或“开票接口”。后续接入实际功能时，业务模块仍需验证自己的输入和业务约束，并明确何时需要批准、批准的是哪个版本，以及执行后怎样保存结果。

## 4. 查询日志

```text
GET /api/logs
GET /api/logs?outcome=failure
GET /api/logs?operationId=<operation-id>
GET /api/logs?before=<log-id>
```

可用筛选参数为 `outcome=success|failure|denied`、`operationId` 和 `before`。每次固定最多返回 100 条。`before` 使用上一批日志中取得的 ID 作为游标；不要把它当作任意业务时间戳。响应为 `{ "data": [] }`，只包含当前工作空间允许查看的日志。

每项日志包含：

```text
id, actorId, actorName, action, outcome, operationId,
requestId, statusCode, message, createdAt
```

对接页面可以先显示时间、操作者、动作、结果、说明，排查时再用 `requestId` 查找对应请求。未认证请求也会记录日志，但没有可确认的工作空间；此类记录不会通过工作空间日志 API 返回，需要由维护者在本地数据库中排查。不要在错误文本或日志消息里记录密钥及完整敏感输入。

## 5. 与 Issue #1 交接时只先确定三件事

### 工作空间与业务主体怎么关联

基础工程内部已经有 `foundation_workspaces`。队友的公司或业务主体模型不需要改名迁就这个表；双方先确认每一笔业务记录怎样归属一个工作空间，以及读取和执行时在哪一层校验归属。不要仅凭前端传来的公司 ID 读取数据。

### 审批单与业务数据怎么关联

双方确认业务对象如何关联通用操作、审批时需要保留哪些输入、修改之后是否需要重新审批。这一步需要基于 Issue #1 最终 schema 讨论，不在这里提前发明财务字段或覆盖队友文件。

当前 `payload.note` 只是最小通用演示。未来扩展 payload 前，应一起确认字段、类型、校验、版本和迁移方式；不要把整个业务数据库复制进一段未经验证的 JSON。

### 执行入口怎样接上业务模块

先把目前的 `foundation_check` 执行位置作为对接点，之后由开票或催收模块提供连接逻辑。连接逻辑需要明确：输入、成功结果、可重试失败、避免重复执行的方法，以及是否发生真实外部操作。现金流预测是否需要人工审批，由团队按实际功能确定，不应为了复用示例强加同一流程。

接入 Orbyte 时同样通过明确的连接边界适配。当前没有真实 Orbyte API 连接，不能把本地示例结果写成已完成平台集成。对外展示的模拟步骤应明确标注。

## 6. 团队集成顺序

1. 各自在分支提交，先同步 Issue #1 的数据约定与 Issue #2 的会话／审批接口。
2. 以一个合成业务案例连通界面、业务数据、审批、执行和日志。
3. 测正常流程，再测未批准、驳回、无权、跨工作空间、重复执行和接口失败。
4. 检查刷新与重启后数据保留，以及合成数据与日志不泄漏到其他工作空间。
5. 记录实际命令、结果和演示证据，由另一位成员复核后再关闭 Issue。

这里描述的是集成约定和验收路线，不代表 Issue #1 已完成，也不代表 Orbyte、Replit 发布或真实消息发送已经接通。
