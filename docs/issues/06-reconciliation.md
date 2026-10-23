# STEP-6：审批入账、部分付款与现金流联动

GitHub：[#22](https://github.com/jake2ace/SDC-Tracker/issues/22)

**状态：DONE · 职责：后端开发 · 依赖：STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))、STEP-4 ([#20](https://github.com/jake2ace/SDC-Tracker/issues/20))、STEP-5 ([#21](https://github.com/jake2ace/SDC-Tracker/issues/21))**

## 目标

把提取、匹配和人工决定接回账本，使余额、余款催收、付款承诺与现金流保持一致。

## 范围与允许目录

`src/`、`tests/`、`data/seed/`、`data/eval/`、`eval/`、`docs/`；契约变更同步 `contracts/`，界面交互交给 STEP-3 ([#19](https://github.com/jake2ace/SDC-Tracker/issues/19))。

## 完成标准

- [x] 有权限的人明确检查/批准后才进行演示入账；批准对象绑定当时的证据和金额，资料变化后要求重新审核。
- [x] 付款、分配、发票余额和日志在一致事务中更新；重复批准/重试/重复证据不会重复记账；异常中途失败不留下半笔结果。
- [x] 部分付款只扣已批准金额，保留余款并更新后续催收金额；只有全额结清才停止催收。超额、币种或归属冲突按冻结规则转审核。
- [x] 未批准的匹配不改账本；关闭审核或选择不批准时保持 pending，MVP 不提供持久化的“拒绝匹配”状态。匹配成功只是待批准结果，不等于银行已确认到账。
- [x] 承诺日期调整预计收款情景；批准付款后实际/预计不重复计算，部分付款仅移除已收部分，预测变化可追溯。

## 证据

- [接口与账本行为](../RECONCILIATION.md)：Finance 审批、部分/全额收款、承诺确认及 30 天现金流接口已实现；全部为合成数据的演示入账。
- `tests/integration/reconciliation.test.ts`：6 组集成场景覆盖审批前账本不变、部分到全额收款、余款催收、权限和版本检查、重复/并发批准、异常回滚及承诺确认。
- `tests/integration/forecast.test.ts`：4 组场景覆盖手算对照、实际/预计去重、日期边界、租户隔离和非法输入；测试与业务代码分开。
- 验证结果：`npm run check`、全部 46 项测试、13 组契约/数据检查通过。
- [预测评测](../evaluation/STEP6-FORECAST.md)：4 个冻结案例、40 个独立手算每日余额及预计收款日程全部精确一致，保存完整 30 天输出。

本步骤完成后端联动；前端页面接入和产品端到端演示由 STEP-3、STEP-7 继续完成。
