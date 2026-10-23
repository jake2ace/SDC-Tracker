# STEP-4：银行 CSV 导入与确定性 matcher

GitHub：[#20](https://github.com/jake2ace/SDC-Tracker/issues/20)

**状态：DONE · 职责：后端开发 · 依赖：STEP-1 ([#17](https://github.com/jake2ace/SDC-Tracker/issues/17))、STEP-2 ([#18](https://github.com/jake2ace/SDC-Tracker/issues/18))**

## 目标

把合成银行 CSV 转成可追溯交易，并按明确规则提出匹配候选，供人工审核。

## 范围与允许目录

`src/`、`data/seed/`、`data/eval/`、`tests/`、`eval/`、`docs/`；接口变化同步 `contracts/`，前端展示由 STEP-3 ([#19](https://github.com/jake2ace/SDC-Tracker/issues/19)) 处理。

## 完成标准

- [x] 按冻结格式校验列、金额、日期；币种固定 MYR，CSV 不接受额外币种列。错误行给出原因，整批拒绝。
- [x] 重复导入同一文件/交易不会重复记账；保存来源哈希、文件名、批次、原始交易标识和逐行结果。
- [x] matcher 按 STEP-1 的金额、日期、参考信息等确定性规则返回候选、证据和理由，相同输入得到相同结果。
- [x] 30 个冻结案例全部按预期判定；歧义/证据不足转人工，不强行选中。
- [x] 匹配仅创建建议，不自动记已收款、不扣余款、不停止催收；合成 CSV 不声称来自实时银行接口。

## 证据

[导入与匹配说明](../BANK_MATCHING.md)、[30 案例实测结果](../evaluation/matcher-results.json)。类型检查、18 组后端测试、13 组契约检查通过；`npm run evaluate:matcher` 可重复执行 30 个冻结合成案例。没有修改 gold，没有真实银行接入、OCR 或付款入账。收据上传与提取仍由 STEP-5 实现，HTTP 匹配测试使用预构造的合成收据。
