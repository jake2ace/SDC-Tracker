# Issue #4：AI 催收

财务查看逾期发票 → DeepSeek 选择催收话术 → 本地组装草稿 → 人工核对／编辑 → **模拟发送**。登记全额到账后，未发送草稿取消，停止催收。金额、日期、权限和发送决定由业务代码控制；生成结果仍需人工检查。

## AI 安全边界

- **只选话术**：模型仅可返回开场、付款状态询问、结尾的三个允许 ID。正文由代码内预先审核的话术拼接，拒绝任意自由文本、额外字段和工具调用。修改话术库须经代码审核。
- **不提供私人数据**：请求只有语气及固定话术库；姓名、发票信息、历史文案、其他客户资料和密钥不进入模型消息。密钥仅用于官方 API 的认证请求头。
- **不给执行能力**：没有文件、数据库、浏览器、shell 或发信工具。固定官方地址并禁止重定向；模型输出不参与地址、查询、命令或收件人选择。
- **失败即阻断**：输入严格校验；模型返回异常、超时或超过大小限制不产生新草稿。安全检查拒绝时返回 `503` 和 `details.guardrail="blocked"`，日志仅存固定说明，不保存恶意原文或密钥。
- **人工编辑单独处理**：仍可修改文案，但编辑内容不会再输入模型。生成、编辑、发送前共用纯文本限制，拒绝 HTML 标记、双向文字等隐藏控制字符；发送始终由财务显式确认。人工编辑不等于 AI 审核通过。

这样限制的是模型实际能够接触的数据和返回的内容，不依靠它自觉服从系统提示词。数据字段仍是数据，不能转成 HTML、指令或下游模型提示词。参考 [OWASP 提示词注入防护](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)。

## 本地运行

首次使用将 `.env.example` 复制为 `.env`，只需填写 `DEEPSEEK_API_KEY=` 右侧。密钥仅供服务端读取，不能放进前端、截图或 Git；无需修改模型或地址。使用 Node.js 22.13 或以上：

```sh
node --env-file=.env examples/collections-demo.mjs
node --test tests/*.test.mjs
```

第一条命令会实际调用 DeepSeek **一次**，显示 Rantau 合成案例的草稿。输入 `SEND` 才模拟发送；直接回车或非交互运行均不发送。演示只用内存，不保存数据、不自动重试、不自动登记付款。测试使用替身，不访问真实模型。

模型固定配置为 `deepseek-flash`，地址为 `https://api.deepseek.com/chat/completions`。[官方 2026-10-17 更新](https://api-docs.deepseek.com/zh-cn/updates/)说明当前别名对应 **V4.1-Flash-1017**；该别名不能保证永久锁定此版本。[请求格式见官方文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。

## 接入 #2

`createCollectionsService({ store, generator, now })` 使用 #1 的 `DemoState`；可信服务端 `generator` 接受业务事实，返回 `{ subject, body }`。生产实例使用 `createDeepSeekGenerator()`，它将事实留在本地，只发送固定选项。模型失败返回 `503 AI_UNAVAILABLE`，不保存半成品，重新生成失败时保留旧稿；必须取得合法的模型选择才组装草稿，没有失败后静默降级。

`store.read()` 返回隔离快照；`store.transaction(fn)` 与审批、开票、收款、设置等**所有写入共用**排他锁／数据库事务，执行一次同步回调。正常返回即提交（包括错误响应中的日志），抛异常回滚，提交后 resolve。AI 请求在事务外执行，返回后再次校验身份、状态与事实，防止生成期间付款后仍保存或发送催收。实际数据库、会话和页面仍需 #2 接入，未完成整站联调。

在可信会话和 JSON 解析之后挂载 `routeCollectionsRequest(service, { method, pathname, query, body, userId })`：`userId` 来自服务端会话，`query` 是 `URLSearchParams`；原样输出返回的 `{ status, body }`，不要再套 `data`。`null` 交给其他路由，异常交给宿主错误处理。

| 接口 | 请求／行为 |
|---|---|
| `GET /api/collections` | 可选 `filter=overdue\|unpaid\|paid`，默认逾期；Owner／Finance 可查看 |
| `POST /api/invoices/{id}/reminders` | `{}` 返回已有草稿；`{regenerate:true}` 更新同一草稿 |
| `PATCH /api/reminders/{id}` | `{subject, body}`；仅可编辑草稿 |
| `POST /api/reminders/{id}/send` | `{}`；人工确认后模拟发送，重复请求返回同一回执 |
| `POST /api/invoices/{id}/payments` | `{receivedAt:"YYYY-MM-DD"}`；全额到账并取消未发送草稿 |

后四项仅 Finance 可操作。发送失败返回 `502`，保留草稿与错误供手动重试；发送前事实改变返回 `409`，须重新生成并核对。前端应显示 AI 来源、引用事实、错误和“模拟发送”标识，不能把模型调用成功当成已发送。

接入页面时必须使用纯文本渲染（例如 React 的 `{text}` / DOM `textContent`），禁止 `innerHTML`、Markdown 自动链接或自动加载图片。#2 仍需完成真实会话鉴权、跨站请求防护、请求体大小限制和按用户／公司限频；本模块测试不代表整站已经通过安全验收。不要将演示身份选择器作为公开部署的认证方式。
