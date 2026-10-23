# STEP-4：银行 CSV 导入与确定性 matcher

GitHub：[#20](https://github.com/jake2ace/SDC-Tracker/issues/20)

**状态：TODO · Owner role：Codex · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17))、STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))**

## 目标

把合成银行 CSV 转成可追溯交易，并按明确规则提出匹配候选，供人工审核。

## 范围与允许目录

`src/`、`data/seed/`、`data/eval/`、`tests/`、`eval/`、`docs/`；接口变化同步 `contracts/`，前端展示由 STEP-3 ([#19](https://github.com/jake2ace/SDC-Tracker/issues/19)) 处理。

## 完成标准

- [ ] 按冻结格式校验列、金额、日期和币种；错误行给出原因及处理结果，不默默丢失或篡改数据。
- [ ] 重复导入同一文件/交易不会重复记账；保存来源、导入批次和原始交易标识。
- [ ] matcher 按 STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17)) 的金额、日期、参考信息等确定性规则返回候选、证据和理由，相同输入得到相同结果。
- [ ] 30 个冻结案例覆盖正常、部分付款、差 RM10、同额歧义、银行记录未出现、错误客户和重复截图；全部按预期判定，歧义/证据不足转人工，不强行选中。
- [ ] 匹配仅创建建议，不自动记已收款、不扣余款、不停止催收；合成 CSV 不声称来自实时银行接口。

## 证据

CSV fixtures、导入与重复处理记录、30 案例预期/实际对照、匹配解释样例；量化结果在 STEP-7 ([#23](https://github.com/jake2ace/SDC-Tracker/issues/23)) 汇总。
