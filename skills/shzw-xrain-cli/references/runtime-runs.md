# 主业务对象、单次执行与临时文本

使用已配置 Runtime 的平台 profile，先 `auth whoami --agent` 核对原主体、租户和入口。下列命令追加 `--profile <平台> --json`。应用场景用 --application-id，个人场景用 --personal；所选员工必须当前仍有使用资格。

## 带主业务对象的对话

```text
agent chat start <agentId> --context-json <对象引用.json> --message-file <输入.txt>
```

对象引用为 `{"businessSourceId":"<已有业务来源>","objectType":"<已有类型>","objectId":"<原对象ID>"}`。三项各为 1–160 字符。Runtime 绑定该引用；实际对象访问与工具执行继续核验权限。该文件不接收 taskId、grantId 或任意工具授权。

Task grant 由 Workforce 内部向受信 Runtime 签发，包含本人、租户、任务及指派/控制版本，并在改派和撤权后失效。通过 [Workforce 业务命令](workforce.md)的 `session create` 提交原 taskId，由宿主准备和保管 grant；不能在对象引用文件中直接传入 grant，也不能用通用记录更新代替 Task 业务动作。

## 受管单次执行

```text
agent run start <agentId> --message-file <输入.txt>
agent run show <原runId>
```

start 使用 Runtime 原生 `/xrain/runs` 协议，提交 agentId、prompt 和明确应用上下文。它不装配工作台工具，也不复用普通 chat 的 Session 或历史。返回 accepted 仅表示受理；用同一身份查询原 runId，直到 succeeded，再检查 result 的业务含义。failed/cancelled 返回非零退出码及原错误。

runId 由服务生成。回执丢失时没有客户端请求键可恢复，CLI 不自动再发起一次。结果是 Runtime 有界内存状态，重启或淘汰后可能返回 not_found；不据此重放外部操作。普通对话需要工具、续聊或历史时仍使用 agent chat。

## 临时文本

```text
agent ephemeral directory
agent ephemeral generate <agentId> --message-file <输入.txt>
```

先从目录取得当前可用员工。generate 只返回 answer，不创建 Session、工具或历史；输入最多 64000 字符。Runtime 在生成前后核验资格，失败或中断不自动重试。临时文本没有 runId 或结果查询；不要把文本回答当作业务写入完成。

directory 和 generate 均使用 profile 中的默认 applicationId。通过 --application-id 单次覆盖，或 --personal 选择个人上下文；目录与生成须使用同一上下文。CLI 将应用 ID 传给 Runtime，由原服务核验使用资格。
