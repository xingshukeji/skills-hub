# 本轮历史汇总

把获准 /history 响应 {records:[{event:{seq,type,data}}],hasMore} 存私有文件；以本次输入前已确认的持久序号执行：

```text
node "<skill目录>/scripts/summarize-history.mjs" "<历史.json>" --after-seq <水位>
```

Node.js 22.12+，无外部依赖；不连接服务、不继续执行、不输出正文/工具参数。只统计 seq>水位，重复页去重，同序号内容冲突拒绝；支持 V4 tool-role 与 V3 tool-result。

检查 failed/unresolved、hasOlderPages、unpairedResults、unknownEvents。分页缺失按原水位补齐；水位未知就不能断言本轮完成。失败不被后续助手文字覆盖。

succeeded 仅表示协议未标 isError；原结果 ok:false、业务拒绝、异步处理中仍须解释。turn/end completed 仅代表回合结束，approval 数量不代表仍等待。工具始终 businessVerified:false；业务状态及消息交付从原任务回读。
