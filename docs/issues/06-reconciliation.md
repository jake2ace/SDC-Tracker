# STEP-6：审批入账、部分付款与现金流联动

GitHub：[#22](https://github.com/jake2ace/SDC-Tracker/issues/22)

**状态：TODO · Owner role：Codex · 依赖：STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))、STEP-4 ([#20](https://github.com/jake2ace/SDC-Tracker/issues/20))、STEP-5 ([#21](https://github.com/jake2ace/SDC-Tracker/issues/21))**

## 目标

把提取、匹配和人工决定接回账本，使余额、余款催收、付款承诺与现金流保持一致。

## 范围与允许目录

`src/`、`tests/`、`data/seed/`、`data/eval/`、`eval/`、`docs/`；契约变更同步 `contracts/`，界面交互交给 STEP-3 ([#19](https://github.com/jake2ace/SDC-Tracker/issues/19))。

## 完成标准

- [ ] 有权限的人明确检查/批准后才进行演示入账；批准对象绑定当时的证据和金额，资料变化后要求重新审核。
- [ ] 付款、分配、发票余额和日志在一致事务中更新；重复批准/重试/重复证据不会重复记账；异常中途失败不留下半笔结果。
- [ ] 部分付款只扣已批准金额，保留余款并更新后续催收金额；只有全额结清才停止催收。超额、币种或归属冲突按冻结规则转审核。
- [ ] 拒绝或尚未批准的匹配不改账本；`Matched` 只是候选状态，不等于银行已确认到账。
- [ ] 承诺日期调整预计收款情景；批准付款后实际/预计不重复计算，部分付款仅移除已收部分，预测变化可追溯。

## 证据

正常/部分/全额/拒绝/重复/并发修改案例、账本前后对照、余款催收记录及预测手算对照；所有支付动作明确为模拟。
