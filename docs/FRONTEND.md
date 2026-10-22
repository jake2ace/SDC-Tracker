# 前端说明

前端在 `web/`，纯 HTML、CSS 和原生 ES modules，没有构建步骤，也不用安装依赖，和后端一样只要 Node.js 22.13+。视觉按 `Claude前端开发资料/SDC-Tracker_界面草图.html` 还原，界面文字全部是英文；中文只在开发时用 `npm run web:zh` 打开切换按钮查看。

## 启动

先启动后端（沿用已有 `.env`，密钥只在后端进程里）：

```sh
DEMO_MODE=true CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173 node --env-file=.env src/server.mjs
```

再开一个终端启动前端：

```sh
npm run web
```

浏览器打开 `http://127.0.0.1:5173`。可选环境变量：`API_BASE`（默认 `http://127.0.0.1:3000`）、`WEB_HOST`、`WEB_PORT`（默认 5173）、`DEV_CHINESE=1`。

## 页面怎么走

打开后先是介绍页，不直接进数据面板。点 Walk through the demo 进入第 1 步。

| 页面 | 读取 | 写入 |
| --- | --- | --- |
| Projects & invoicing | `GET /api/projects`、`GET /api/invoices/{id}` | 完成阶段、批准、驳回、模拟开票 |
| AI collections | `GET /api/collections?filter=overdue/unpaid/paid`（只有 Owner 和 Finance 会请求） | 生成提醒、修改、确认发送、登记收款 |
| Cash flow | `GET /api/forecast`，按时和所选延迟情景各取一次 | 无 |
| Overview | `GET /api/overview`、`GET /api/activity`、窗口外到账的预测 | 无 |

每页顶部有一行 Next step，根据后端返回的状态写出下一步该谁做什么，并提供切换身份、跳转页面或把演示日期调到到期日之后的按钮。它只是导航提示，不会替用户执行任何写操作。

## 身份、公司和数据刷新

- 每个 `/api/*` 请求都带 `X-Demo-User`。当前身份存在浏览器的 localStorage，只是为了刷新后还是同一个人，不当作登录。
- 换公司时先用旧身份发 `PUT /api/demo/settings`（同时带 `companyId` 和 `userId`），成功后取消所有进行中的请求，清空旧公司的数据和选中项，再用新身份重新加载。
- 每次加载都记住开始时的 epoch，换公司或重置会让 epoch 加一，所以慢返回的旧数据会被丢掉。同一份数据重叠刷新时，只保留最后一次请求的结果。
- 每个写操作成功或失败后都重新拉 session、项目、发票、催收、总览、预测和日志。按钮在刷新完成前一直禁用，避免对旧状态重复点击。页面只显示后端返回的状态，不在本地猜测成功。
- 操作期间切换身份会释放旧操作的按钮状态；旧请求即使晚返回，也不能覆盖新身份的数据或清除新操作的状态。
- 预测场景按同一轮刷新一起更新。刷新期间隐藏对比图；部分失败时只保留上一轮完整数据并标明刷新失败，不把不同日期或不同轮次的结果拼在一起。
- 刷新失败但屏幕上还有旧数据时，页面顶部会提示 Couldn't refresh，并给出重试按钮。

## 安全护栏

- 生成、修改、查看提醒都不会发送。发送前必须保存修改，再在确认框里看到收件人、主题和全文后点 Send (simulated)。草稿事实过期（演示日期变了）时禁止发送，要求重新生成。
- 确认框捕获该版本的 `reviewToken`，后端在写入模拟发件箱的同一事务里校验。另一标签页修改文案或收件人后，旧确认返回 `409 DRAFT_CHANGED`，必须重新检查后确认。
- AI 失败后可主动选择可编辑的人工模板。页面明确显示没有使用 AI；替换已有草稿会再确认，不会自动发送，原有权限和内容校验仍适用。
- 所有业务文字都用文本节点渲染，代码里没有 `innerHTML` 一类的 HTML 拼接，测试会检查这一点。
- 静态服务只返回 `web/` 里白名单内的文件，`.env`、`data/`、`server.mjs` 和 `e2e/` 都是 404。响应带 CSP，脚本只能来自本站，`connect-src` 只允许配置的后端地址。
- 前端代码里没有任何密钥，`/config.js` 只输出后端地址和是否显示中文。
- 后端的中文报错信息收在 Technical details 里，同时保留 Request ID 方便排查。

## 模拟和真实

| 部分 | 性质 |
| --- | --- |
| 开票回执、提醒发件 | 后端模拟接口，页面都标了 simulated |
| 演示身份 | 合成身份切换，不是生产登录 |
| 提醒措辞 | 正常运行时由后端调用 DeepSeek，从审核过的话术里选；金额和日期由后端本地拼装 |
| `web/e2e/fake-ai-backend.mjs` | 真实后端代码，只把 DeepSeek 的网络传输换成本地替身，用于没有密钥的机器做走查和截图 |
| 现金流 | 后端按规则计算的情景，不是模型预测，也不代表银行余额 |

## 测试

```sh
npm test
```

`tests/web-frontend.test.mjs` 覆盖金额和日期格式、API 客户端请求头和错误处理、换公司后丢弃旧响应、重叠刷新、操作期间防重复点击、静态服务的 CSP 和文件白名单、与真实后端的 CORS 预检，以及禁止 HTML 拼接。

回归测试还覆盖切换身份时的操作清理、旧请求晚返回、预测整批刷新及部分失败。`tests/collections-ui.test.mjs` 直接测试确认框捕获的草稿版本、人工模板的明确选择与替换取消，以及客户端发送的版本参数。

2026-10-23 修复验收：467 项自动测试通过；在临时 SQLite 与 AI 网络替身环境中，浏览器跑通 Lumen、Rantau 两家公司的阶段完成→审批→开票→逾期提醒→确认发送→收款→现金流流程，并验证 AI 失败转人工模板、双标签页旧确认拦截、失败重试、重复操作、付款取消未发提醒、刷新后记录保留及不同预测情景。未调用真实模型或发送真实邮件。

本次修复实测截图：[人工备用模板](frontend-screenshots/21-manual-template-fallback.png)、[双标签页旧确认被拦截](frontend-screenshots/22-stale-confirm-blocked.png)。`00`–`20` 为此前前端走查保留的截图。本地功能验收完成后，Issue #6 仍需另一位组员复核再关闭；部署和真实模型调用另行验证。

浏览器走查需要另外装 Playwright（不是项目依赖）：

```sh
rm -f /tmp/sdc-walk.sqlite*
DB_PATH=/tmp/sdc-walk.sqlite FAKE_AI_FAIL_FIRST=1 CORS_ORIGINS=http://127.0.0.1:5173 node web/e2e/fake-ai-backend.mjs
npm run web
node web/e2e/walkthrough.mjs walkthrough-shots
```

走查从重置数据开始，跑完 Lumen 全流程、无权限、开票失败重试、AI 不可用、发送失败重试、重复操作、付款后停止催收、按时和延迟 7/14 天及窗口外的预测、滚动窗口、切换到 Rantau、驳回草稿和手机布局，共 24 步，并保存截图。

## 已知限制

- 演示时钟和失败开关是全局的，多人同时操作会互相影响，这是后端的设计。
- Figtree 字体从 Google Fonts 加载，离线时退回系统字体。
- 介绍页的故事文字是固定文案；进入应用后的所有数字都来自后端。
