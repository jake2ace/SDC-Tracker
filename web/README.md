# web：Milestone2Cash Proof-to-Cash 前端

对应 Issue #19（STEP-3）与第七步联调。React 19 + TypeScript + Vite，界面默认英文，可切换中文和马来文。类型直接引用仓库根目录的 `contracts/`，不另写一套 DTO。

## 运行

建议使用 Node.js 24 LTS。前后端分别运行：

```bash
# 终端 1，仓库根目录
npm ci
# 仅在没有 .env 时复制模板，保留已有的服务端密钥配置。
test -f .env || cp .env.example .env
npm run db:init
npm start

# 终端 2
cd web
npm ci
npm run dev          # 默认连接本地 API
```

打开 http://localhost:5173 ，先看到产品简介页，点 Sign in 进入（演示登录，只是入口，没有密码）。

`npm run dev:api` 也连接本地 API。Vite 把 `/api` 和 `/health` 代理到 `http://127.0.0.1:3000`，所以本地开发不需要设置 `FRONTEND_ORIGIN`。后端地址不同可以设 `API_TARGET`。只有显式设置 `VITE_DATA_SOURCE=mock`、使用 `--mode mock`，或在网址加入 `?source=mock` 并重新加载，才会使用 fixtures；`?source=api` 可切回 API。

DeepSeek key 只配置在仓库根目录的服务端 `.env`，不要放入 `web/` 或任何 `VITE_` 环境变量。没有可用模型时，提醒使用标明来源的模板，回复和截图通过人工录入与审核继续流程。

`npm run build` 生成 `web/dist/`。发布时需由同一站点代理 `/api` 到后端；`vite preview` 只预览静态构建，不替代后端服务或生产代理。

## 检查

```bash
npm run check   # tsc 严格类型检查（含 contracts/api.ts、domain.ts）
npm test        # vitest：金额与日期格式、mock 主流程、三语词条完整性
npm run build
```

## 页面结构

| 导航 | 内容 |
| --- | --- |
| Home | 当前角色的待办、待收款、已逾期、今日现金；项目阶段（PM 完成阶段、生成发票草稿） |
| Invoices | 左边发票列表，右边详情。详情分三个标签页：Details（金额、到期日、老板审批、已收付款）、Messages（催款提醒和客户回复按时间排成对话，付款承诺在这里确认）、Payment check（截图 → 银行核对 → 财务入账三步，只展开当前一步） |
| Bank | 已导入的银行入账、是否已被使用；导入 CSV |
| Cash | 30 天预测，按时付款与晚付两条线，安全线；进出账来源和逐日明细 |
| Activity | 操作日志，包括被拦下的尝试 |

右上角：演示身份切换、EN / 中文 / BM、更多菜单（深浅色切换、Demo tools、Sign out）。键盘按 1 到 5 可以直接切换五个页面，输入框里打字时不会触发。Demo tools 只给评审和录视频用，可以切换 fixture 状态、模拟 AI 不可用和断网、原样重放 fixtures 里的错误场景（角色不对、版本过期、入账被重复使用等）。

## 数据层

- `src/lib/client/types.ts`：`DataClient` 接口，按 `ApiOperations` 的 operationId 调用，返回契约里的 `{data, meta}`。
- `src/lib/client/http.ts`：真实后端。只调用 `ENDPOINTS` 里标为 implemented 的接口；planned 的直接提示“后端尚未提供”，按钮同时禁用。
- `src/lib/client/mock.ts`：按 fixtures 的 `stateId → nextStateId` 走状态，返回录好的响应。请求和 fixture 对不上时报 `mock_gap`，不会自己编结果。自由文本（回复内容、原因）允许不同，会提示没有保存。
- `src/lib/session.tsx`：当前身份、工作区、写操作。每次写入带 `Idempotency-Key`，同一请求失败后重试沿用同一个 key；进行中的按钮禁用，防止重复提交。成功后重新拉工作区并更新依赖数据。身份切换先清空数据和表单，旧请求的响应不会覆盖新身份；跨公司切换同时回到 Home。
- 原图由带身份的 `getReceiptImage` 请求取得，再创建临时 Blob URL；离开视图或切换身份时撤销 URL。不会把密钥或身份放进图片网址。
- 现金流请求使用工作区返回的演示日期。付款或承诺变更后重新读取预测，历史上已履行或被替代的承诺不再显示为未来收入。
- 付款审批只提交匹配结果版本；发票、凭证、银行账本或候选入账变更后要求重新核对。Promise confirmation 使用已审核的日期和完整余款，需要更改时先更正回复。
- 金额全部用整数 sen，输入用字符串解析，不做浮点运算；业务日期按 MYT 日历显示，时间统一显示 MYT。
- 匹配结论、拟入账金额、余款、是否结清都只显示后端返回的值。页面不自己判断 Confirmed 或 Paid。

## 视觉

- 默认深色，菜单里可以切浅色，选择会记在浏览器里。颜色全部是 `src/styles.css` 顶部的变量，深浅两套各一份。
- 侧边栏、发票标签页、语言切换和现金流明细的选中态共用一个玻璃选中块（`src/components/Glass.tsx`），切换时会滑过去；系统开启“减少动态效果”时不做动画。
- 金额、发票号、参考号、日期时间用等宽字体，方便对齐和核对。

## 三语

`src/i18n/`：英文原文就是 key，`zh.ts`、`ms.ts` 是对照表。新增界面文字时用 `t("...")`，常量表里用 `msg("...")` 标记；`npm test` 会检查两种语言是否都有翻译、占位符是否一致。客户数据、后端报错原文、日志摘要不翻译。

## 数据来源与验证

| operationId | api 模式 | mock 模式 |
| --- | --- | --- |
| listDemoUsers、getWorkspace | 已接 | fixtures |
| completeMilestone、createInvoiceDraft、decideInvoice | 已接 | fixtures |
| generateReminder、sendReminder | 已接 | fixtures |
| createReply、correctReply、confirmPromise | 已接 | fixtures |
| uploadReceipt、correctReceipt、runMatch、approvePayment | 已接 | fixtures |
| importBankStatement、getForecast | 已接 | fixtures |
| getReceiptImage | 已接，带身份获取原图 | 明示无原图 |

类型检查和 16 项前端单元测试覆盖金额、日期、fixtures 与三语词条。第七步浏览器联调与实际模型调用的结果记录在[集成验证报告](../docs/evaluation/STEP7-INTEGRATION.md)；模型响应来自真实服务，银行和客户数据仍为合成演示数据。测试文件与业务界面分开维护。十次人工流程计时与组员复核按用户要求跳过，不宣称已完成这两项实验。

## 已知问题

- mock 模式的现金流预测只有 `afterPromise` 状态、晚付 7 天这一组 fixture，其他状态会提示没有覆盖。
- mock 截图仅用于回放固定响应，不包含可查看的真实图片；实际上传与原图审核请使用 API 模式。
- 演示登录和身份切换不属于生产账号权限系统；发送提醒仅模拟发送，付款审批只写演示账本。
