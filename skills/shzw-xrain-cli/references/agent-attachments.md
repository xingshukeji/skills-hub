# 对话附件

沿用[智能体对话](agents.md#发起和继续对话)的 Runtime、本人身份和应用上下文。

```text
agent chat start <agentId> --message "读取附上的资料" --attach <资料.pdf> --attach <数据.csv>
agent chat send <sessionId> --attach <补充资料.txt>
```

`--attach <文件>` 可重复指定，也可单独发送附件。CLI 在联网前核对本地文件，按二进制上传到本次原会话，再在同一输入中提交原生上传回执；不会把本机路径作为模型附件引用。返回的 attachments 和 history 保留文件编号、名称和字节数。文件读取仍取决于所选定义的原生能力；后续定时运行需要独立可读的持久资料，创建对话的附件不会自动转给未来会话。

上传计入同一等待预算。上传结果未知时，错误保留原 sessionId、requestId、attachment-upload 阶段及 inputSubmitted=false，不自动重传或发送输入；多个附件中已取得的回执也保留在错误中。明确拒绝则保留原 HTTP 错误。附件不支持子智能体输入；当前 Runtime 未提供会话上传时保留其不支持错误，不能改用全局上传或其他人的会话。
