# Issue #4：AI 催收

财务查看逾期发票 → DeepSeek 生成草稿 → 人工核对／编辑 → **模拟发送**。登记全额到账后，未发送草稿取消，停止催收。金额、日期、权限和发送决定由业务代码控制；AI 只写文案。模型接收语气与占位符，实际客户名、金额等事实在本地填入；生成结果仍需人工检查。

首次使用将 `.env.example` 复制为 `.env`，只需填写 `DEEPSEEK_API_KEY=` 右侧。密钥仅供服务端读取，不能放进前端、截图或 Git；无需修改模型或地址。使用 Node.js 22.13 或以上：

```sh
node --env-file=.env examples/collections-demo.mjs
node --test tests/*.test.mjs
```

第一条命令会实际调用 DeepSeek **一次**，显示 Rantau 合成案例的草稿。输入 `SEND` 才模拟发送；直接回车或非交互运行均不发送。演示只用内存，不保存数据、不自动重试、不自动登记付款。测试使用替身，不访问真实模型。

模型固定配置为 `deepseek-flash`，地址为 `https://api.deepseek.com/chat/completions`。[官方 2026-10-17 更新](https://api-docs.deepseek.com/zh-cn/updates/)说明当前别名对应 **V4.1-Flash-1017**；该别名不能保证永久锁定此版本。[请求格式见官方文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。

## 接入 #2

`createCollectionsService({ store, generator, now })` 使用 #1 的 `DemoState`；`generator` 接受业务事实，返回 `{ subject, body }`。生产实例使用 `createDeepSeekGenerator()`。模型失败返回 `503 AI_UNAVAILABLE`，不保存半成品，重新生成失败时保留旧稿。没有静默模板替代。

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
