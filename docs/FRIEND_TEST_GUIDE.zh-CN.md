# Proof-to-Cash 朋友测试指南

测试地址：**https://milestone-2-cash-proof-to-cash.replit.app/**
预计 15–20 分钟。请按 F01 → F06 顺序操作；结果可以直接填在文末。

## 开始前

- 打开网址，点击 **Sign in**。这是演示身份入口，不需要真实账号。右上角 **Demo identity** 可以切换角色；本指南按英文界面写。
- 使用测试包里的 `lumen-partial.png`、`lumen-final.png` 和 `bank-lumen-final.csv`。源码位置分别为 `data/demo/receipts/` 和 `data/demo/`。只用这些合成数据，不上传真实银行流水、付款截图或客户信息。
- 开始时选 **Lumen finance (demo)**，进入 **Invoices → LUMEN-DEMO-001**，应看到总额 **RM18,000**、已收 **RM0**、未收 **RM18,000**。第一笔 RM9,000 银行记录已预置，不用先导入。
- **所有人共用这份演示账本，请一次只安排一人测试。** 若起始金额不符，先联系负责人恢复测试环境，不要继续套用以下预期。刷新、换浏览器、重新 Sign in 都不会清空服务器数据；Demo tools 中的 mock 状态也不是这次测试环境。
- 这是可重置的公开演示环境，数据保存在服务器 SQLite 中。已实测重新发布会恢复初始账本，新增收款和截图不保留；暂停后恢复也未通过持久化验收。请保存反馈和截图，不要把这里当作正式财务存档。
- 演示时钟固定在 **2026年10月23日 12:00 MYT**，日期不随今天移动。截图、银行数据和消息均为虚构；发送提醒是模拟操作。

## F01｜发票审批和角色限制（约 2 分钟）

1. 以 **Lumen finance (demo)** 进入 **Home → Projects**，找到 **Final handover**：`Mark complete` 应不可点击。
2. 切换 **Lumen pm (demo)**，点击该项目的 **Mark complete → Create invoice draft**。
3. 打开刚生成的 **RM6,000** 发票，记下号码。PM 的 **Approve and issue** 应不可点击。
4. 切换 **Lumen owner (demo)**，回到这张草稿，点击 **Approve and issue**。

**预期：** 同一里程碑只出现一张发票；Owner 批准后才从草稿变为已开票。它不是后续收款用的 `LUMEN-DEMO-001`，后续请切回 RM18,000 的那张。

## F02｜提醒先编辑，再模拟发送（约 2 分钟）

1. 切回 **Lumen finance (demo)**，打开 **LUMEN-DEMO-001 → Messages**。
2. 点击 **Draft a reminder**，选择 **English → Write draft**。
3. 检查草稿金额，修改一句话，再点击 **Send (simulated)**。

**预期：** 草稿可编辑，生成草稿时没有自动发送；发送后显示 **Sent (simulated)**。实际不会发到 WhatsApp 或邮箱，已收款仍为 **RM0**。如果显示 **Template**，请记录为模板降级，不要写成 AI 生成成功。

## F03｜第一笔 RM9,000：核对、审批、防重复（约 4 分钟）

1. 打开该发票的 **Payment check**，上传 `lumen-partial.png`；若显示 **Link to reply (optional)**，选择 **Do not link**，然后点 **Upload and read**。
2. 对照原图检查下表字段。识别失败或字段错误时，记录问题，再用 **Correct these fields**／已展开的表单更正，填写更正原因并 **Save correction**。
3. 点击 **Run bank check**，应显示部分收款的银行匹配结果。此时已收仍为 **RM0**，还不能当成到账。
4. 在 **Finance records the payment** 中，先确认收款按钮在未勾选时不可用；勾选 **I checked the bank credit, the screenshot and the amounts above.**，再点 **Record partial payment of RM 9,000.00**。
5. 点击 **Check another payment**，再次上传同一张 `lumen-partial.png`。若上传被拒绝，记下提示；若允许上传，继续 **Run bank check**。

**预期：** 第一次审批后已收 **RM9,000**、未收 **RM9,000**，仍可催收。重复证据应被拦截或标记为已用，不能再产生收款；已收仍为 **RM9,000**。

| 核对字段 | 第一张 `lumen-partial.png` | 第二张 `lumen-final.png` |
| --- | --- | --- |
| Amount (RM) | 9000 | 9000 |
| Reference | LMN-231026-001 | LMN-231026-002 |
| Payer name | KOPI TIGA TEST | KOPI TIGA TEST |
| Transferred at (MYT) | 2026-10-23 10:30 | 2026-10-23 11:00 |
| Sending bank | DEMO SENDER BANK A | DEMO SENDER BANK A |

## F04｜承诺付款只改变预测（约 3 分钟）

1. 回到 **Messages → Add customer reply**，粘贴：

   > I will pay the remaining RM9,000 on 28 October 2026.

2. **Message language** 选 **English**，保留预填的 **Received at (MYT)**，点击 **Save reply**。
3. 检查这条新回复：意图应为 **Promises a date**、金额 **RM9,000**、日期 **2026-10-28**。必要时点 **Correct**／**Enter manually**，修正并写明原因，再 **Save correction**。
4. 点击该回复的 **Confirm … for RM 9,000.00**。进入侧栏 **Cash**，将 **Late payment scenario** 设为 **7 days late**，在 **Money in and out** 用 **Scenario** 切换两种情景。

**预期：** 该发票已收仍为 **RM9,000**、未收仍为 **RM9,000**；原到期日不变。剩余 RM9,000 在 **Paid on time** 为 **10月28日**，在 **Paid 7 days late** 为 **11月4日**，都标为 **Expected, not received**。第一笔已批准的 RM9,000 仍为 **Received**，日期不会跟着推迟。

## F05｜第二笔结清、停止催收、刷新保留（约 3 分钟）

1. 进入侧栏 **Bank → Import bank statement**，选择 `bank-lumen-final.csv`，预览后点 **Import**。
2. 应导入 **1** 条新银行记录；导入本身不算收款，该发票仍欠 **RM9,000**。
3. 回到 **LUMEN-DEMO-001 → Payment check → Check another payment**，上传 `lumen-final.png`，核对上表最后一列数据，**Run bank check**，勾选人工核对项后 **Record payment of RM 9,000.00**。
4. 查看 **Messages**、侧栏 **Cash**，然后刷新网页。再去 **Bank** 重复导入同一份 CSV。

**预期：** 发票显示 **Fully paid**，累计已收 **RM18,000**、未收 **RM0**；不再提供新的 **Draft a reminder**。预测中该发票只剩两笔已收 RM9,000，不再有未收预测。刷新后这些数据保留；重复 CSV 显示 **0** 条新增、**1** 条已导入，不能多收一笔。

## F06｜公司隔离与手机页面（约 2 分钟）

1. 在 Lumen 发票页复制当前完整网址，然后从 **Demo identity** 切换 **Rantau finance (demo)**。
2. 查看 **Invoices** 和 **Cash**：应看到 Rantau 的数据，而不是 Lumen 的发票与收款。以 Rantau 身份打开刚复制的 Lumen 发票网址。
3. 切回 **Lumen finance (demo)**，确认前面结清结果仍在；用手机或缩窄窗口查看发票与现金流，尝试打开导航和查看明细。

**预期：** Rantau 不能读取 Lumen 发票，应提示 **Invoice not found in this company** 或拒绝访问；切回 Lumen 后数据正常。手机上关键按钮可点击，金额不被遮挡。这里验证的是演示角色/公司隔离，不代表正式账号登录已经实现。

## 直接复制这个格式反馈

```text
测试人：
时间 / 浏览器 / 电脑或手机：
F01 发票审批：通过 / 失败 / 未测
F02 提醒：通过 / 失败 / 未测；AI 草稿 / Template
F03 部分收款与重复证据：通过 / 失败 / 未测；是否手动更正：
F04 承诺与预测：通过 / 失败 / 未测；是否手动更正：
F05 结清与刷新：通过 / 失败 / 未测
F06 公司隔离与手机：通过 / 失败 / 未测
问题编号 + 最后一步操作 + 实际看到什么：
截图：
```

遇到错误请保留原提示和截图。若刷新后金额不确定，先查看发票和 Activity，再联系负责人，不要连续重复审批。无法完成前置步骤时，将后续相关用例记为“未测”，不要猜测通过。
