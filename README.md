# SDC Tracker

**让小企业知道：哪些项目款该收、谁需要催、晚到账会不会影响未来 30 天的现金。**

SDC Hackathon 2026 · Domain 2 · 队伍 Lets go

## 我们要做成什么

用同一份业务数据跑通：**阶段完成 → 发票草稿 → 人工批准 → 模拟开票 → 逾期提醒 → 人工确认发送 → 登记收款 → 现金流更新**。

| 功能 | 完成标准 |
|---|---|
| 自动开票 | 按付款约定生成草稿；未经批准不能开票，重复点击不重复开票。 |
| AI 催收 | 只处理本公司的逾期欠款；提醒可检查、修改，确认后模拟发送；付款后停止催收。 |
| 现金流预测 | 展示未来 30 天余额、按时与延迟到账的差异、低于安全线的日期及缺口，并能追溯每笔来源。 |
| 多案例验证 | 两家公司、正常和延迟到账、已收款、失败重试、无权限操作都能正确演示。 |

**当前后端已接通 #2 的数据库、权限、审批和日志，以及 #3–#5 的业务接口。前端在 `web/`，按草图实现并接入这些接口，说明见 [docs/FRONTEND.md](docs/FRONTEND.md)。** `examples/forecast-ui` 是可选的预测验证页，不是最终前端。

## 本地启动

需要 Node.js **22.13 或以上**，无需安装运行依赖。已有 `.env` 就直接使用；首次配置才从 `.env.example` 创建 `.env`，填写 `DEEPSEEK_API_KEY`。不要覆盖已有密钥，也不要把密钥交给前端。

```sh
DEMO_MODE=true node --env-file=.env src/server.mjs
```

API 默认在 `http://127.0.0.1:3000`；根路径不提供网页。前端若运行在另一个端口，启动时允许它的精确来源，例如：

```sh
DEMO_MODE=true CORS_ORIGINS=http://localhost:5173 node --env-file=.env src/server.mjs
```

### 打开前端

后端按上面的方式启动，`CORS_ORIGINS` 写前端地址：

```sh
DEMO_MODE=true CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173 node --env-file=.env src/server.mjs
```

另开一个终端：

```sh
npm run web
```

浏览器打开 `http://127.0.0.1:5173`。前端不需要安装依赖，也不读取 `.env`。

每次 `/api/*` 请求都要带演示角色头，如 `X-Demo-User: u_lumen_pm`。这是合成身份切换，**不是生产登录系统**。SQLite 保存到 `.local/sdc-tracker.sqlite`，重启保留数据。

```sh
npm test
```

测试使用 AI 替身，不消耗密钥额度。运行中的后端在生成新催收草稿时才调用 DeepSeek；缺少密钥会明确报错。开票、发送和付款登记均为演示流程，不接真实财务账户。

## 给开发者

- [后端与 Claude 前端交接：启动、接口、角色、多案例验收](docs/BACKEND_HANDOFF.md)
- [统一数据与 API 约定](docs/DATA_CONTRACT.md) · [API 类型](contracts/api.ts)
- [开票](docs/INVOICING.md) · [AI 催收与安全边界](docs/COLLECTIONS.md) · [现金流与 8 个案例](docs/FORECAST.md)
- [前端结构、启动与验收](docs/FRONTEND.md)
- [初赛完成标准](docs/ACCEPTANCE.md) · [项目管理流程](docs/WORKFLOW.md)

AI 只选择审核过的话术，业务事实在本地组装；客户资料不进入模型请求。预测由确定的账本规则计算，不调用 AI，也不代表银行已到账。前端必须使用接口返回的数据，不能另造一套固定数值。

**接下来：用真实密钥在本机走一遍前端 → 录制多案例完整流程 → 部署验证 → 整理初赛材料。**

## 交付与声明

初赛材料包括原型、公开 GitHub / README、官方 PRD、PPTX、技术工具声明及 5–7 分钟演示视频；开发期间仓库保持 private。提交前核对官方格式、截止时间、访问权限及 Replit / RunPod 等工具证据要求，记录实际使用的 AI、模型与第三方代码。

参考：[Domain 2 正式赛题](https://drive.google.com/file/d/11wqbeO-HYep-DJPQ-LPZnrZfQvCgr5BU/view) · [Participant Handbook](https://drive.google.com/file/d/1fGBS-jevDj_FrF8wsbYNPzyU5TTrfk1V/view)。代码采用 Apache-2.0；第三方内容保留各自许可与署名。
