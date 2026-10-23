# 用户可感知耗时

计时从用户动作到可操作或持久结果：登录到业务页、导航到数据可操作、新会话到身份/工具就绪、写入到可回读。模型首字与完整交付分开。HTTP 202、responseEnd 或骨架屏不代表完成。

用获准浏览器时间线或适合当前环境的已有测量入口；冷/热、前台/后台、身份权限、数据规模分组，失败和重试全部保留。少量样本可先定位，不为凑 p95 发起额外压测，也不清业务状态制造冷态。

| 观察 | 定位 |
| --- | --- |
| 建连慢 | 代理、通道、TLS、共享依赖 |
| 单接口等待长 | 同请求的排队、宿主与依赖；并行耗时不相加 |
| 接口快、页面慢 | 后续串行请求、渲染、标签页节流 |
| 首字慢 | 模型路由、排队、认证、限流 |
| 首字快、完成慢 | 工具、持久写回、交付 |

只导出时长、状态、路径类别及脱敏关联 ID，不复制含授权头/正文的 HAR。没有计时证据不编造数值。

## 本地汇总

```text
node "<skill目录>/scripts/summarize.mjs" "<样本.json>"
```

```json
{"samples":[
  {"scenario":"打开任务","phase":"warm","visibility":"foreground","outcome":"success","ms":850,"budgetMs":2000},
  {"scenario":"打开任务","phase":"warm","visibility":"foreground","outcome":"timeout","ms":10000,"budgetMs":2000}
]}
```

必填 scenario（无业务内容）、phase（cold/warm）、visibility（foreground/background）、outcome（success/error/timeout/cancelled）、ms（有限非负数）。可选 budgetMs 须大于零且同组一致；不接受额外字段。

输出总数、各结果数量、全部尝试最大耗时、成功样本 p50/p95 及 verdict。失败或超预算为 fail；无失败但成功少于 20 为 insufficient；未设预算为 not-assessed。p95 是本脚本的样本统计，不能代表总体保证；后台组不能证明前台体验。运行退出成功不等于达标。

修复后保持入口、版本可追溯、权限、数据量、网络及分组条件一致，比较完整样本与失败数。
