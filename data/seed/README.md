# 合成演示 seed

状态：**STEP-1 数据契约样例，尚未由应用加载或执行验证**。所有人名、公司、银行、回复、金额和事件均为合成内容；事件记录不代表真实人员已经执行操作。

| 文件 | 用途 |
| --- | --- |
| `demo-state.json` | 两家公司、角色、客户、项目、里程碑、发票、银行记录、回复、支出与合成历史事件 |
| `bank-lumen.csv` | Lumen 的一笔 900000 sen 合成银行 credit |
| `bank-rantau.csv` | Rantau 的一笔 1200000 sen 合成银行 credit |

固定时钟为 `2026-10-23T04:00:00Z`（MYT 12:00），业务日期为 MYT，货币为 MYR，金额均为整数 sen。实体字段对应 `contracts/domain.ts`；文件外层 `metadata` 仅说明数据来源与场景，不是 API 返回模型。运行时银行 ledger 版本以 `Company.version` 为准。

Lumen 主发票 `inv_lumen_001` 的总额和未收余额都是 **1800000 sen**，已收 **0**。900000 sen 银行记录已导入，但尚未由 Finance 批准；它不能成为实际收款，也不能提前把余款改成 900000 sen。批准后才会剩下 900000 sen，并继续追踪余款。付款承诺回复也尚未确认为有效承诺。

两份 CSV 的记录已存在于 seed；再次导入同一 CSV 应去重。CSV 只包含 `externalId,postedDate,amountSen,reference,payer,bank`，公司归属由已选择的服务端公司决定，不能由任意 CSV 列切换。

`receipts`、`matchResults`、`payments`、`promises` 初始为空；当前没有生成收据图片或执行 OCR。后续步骤通过上传/人工录入构造证据，再核对和审批。`activityLogs` 仅记录合成快照的已发生事项，没有伪造尚未批准的付款/承诺事件。

审批后的独立测试快照放在 `../eval/forecast.inputs.json`，不得自动覆盖这份待审批 seed。评测 gold 不得被应用、模型输入或匹配器加载。
