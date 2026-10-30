# 智能体命令

所有命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后。先按 [SKILL.md](../SKILL.md) 核对平台、租户和当前身份；以下示例省略共同的 `--profile <连接> --auth session --json`。Runtime 命令还须提供准确的 `--runtime <Runtime origin>`，所选平台凭据会发送到该 Runtime。该地址从责任项目的现有配置或 Runbook 确定，不能从平台地址推断。

## 职责和顺序

Runtime 持有智能体定义、工作区和工具配置；XRain 持有个人订阅规则、申请、批准和应用选用。新建定义先保存为停用；完成模型、工作方式和有效工作区后再按明确要求启用。公开策略允许个人主动订阅，私有策略的申请需批准。个人资格和应用选用分别判断：应用使用按应用准入和业务权限，不要求个人订阅；管理权也不等于个人订阅。定义与订阅不创建 AI 员工账号。

先读可用选项和当前定义，按实际管理权限配置；再按用户要求分别配置个人订阅或应用选用。工具配置不会赋予业务数据权限，工作区属于 Runtime 所在机器。

## 查询和定义

```text
agent definition options --runtime <Runtime origin>
agent definition list --runtime <Runtime origin>
agent definition show <agentId> --runtime <Runtime origin>
agent directory --runtime <Runtime origin>
agent directory --mine --runtime <Runtime origin>
agent directory --application-id <应用ID> --runtime <Runtime origin>
agent qualifications [--application-id <应用ID>]
agent use <agentId> [--application-id <应用ID>]
```

`directory` 汇合 Runtime 定义与平台资格，默认展示可发现项；`--mine` 仅列本人获批准的订阅。`qualifications` 和 `use` 只读取平台判断，不证明 Runtime 定义已启用或工作区可用，也不执行智能体。

## 发起和继续对话

`agent chat` 使用 Runtime 的真实会话、所选定义及当前主体权限；工具可能读取或修改实际资料。按明确授权发送输入，验证时可使用不涉及业务写入的合成问题。应用入口带实际 `--application-id`；个人入口省略它并遵循本人订阅规则。续聊、等待和回答待处理事项时使用原会话相同的应用上下文。

```text
agent chat start <agentId> --message-file <输入.txt> --runtime <Runtime origin> [--application-id <应用ID>]
agent chat send <sessionId> --message-file <输入.txt> --runtime <Runtime origin> [--application-id <应用ID>]
agent chat list --runtime <Runtime origin>
agent chat list --all --runtime <Runtime origin>
agent chat history <sessionId> --runtime <Runtime origin>
agent chat wait <sessionId> --request-id <原请求ID> --runtime <Runtime origin> [--application-id <应用ID>]
agent chat pending --session-id <sessionId> --runtime <Runtime origin>
agent chat respond <actionRef> --values-json <回答.json> --runtime <Runtime origin> [--application-id <应用ID>]
```

`--message-file -` 从标准输入读取 UTF-8 文本，也可用 `--message` 直接提供短输入。新建会话使用 `xrain-cli` 来源；默认列表只列该来源，`--all` 显示当前主体的其他来源。`start` 建立新会话并发送一条输入，`send` 继续准确指定的已有会话。命令在提交前输出 sessionId 和 requestId；也可通过 `--request-id` 显式指定本次输入的稳定 ID。

命令等待本次请求自己的 `turn/end`，默认最多 120 秒，可用 `--wait-timeout` 调整。返回 `completed` 和文本答复只证明该轮运行完成，不证明答复正确或业务写入成功；`toolCalls` 的状态反映 Runtime 工具回执。历史只展示可见用户、助手、工具及结束状态，`hasMore` 表示当前返回并非完整历史。

`action_required` 会给出待处理问题或审批的 actionRef；不能自动批准。用户明确选择后可发送 `{"outcome":"allowed-once"}` 或 `{"outcome":"rejected"}`，问题按服务返回的 question ID 提供 `{"answers":[{"id":"<问题ID>","selected":["<选择>"],"custom":"<可选文字>"}]}`。响应有独立的 responseId，结果未知时先检查原事项；提交后使用原 sessionId/requestId 的 `wait` 读取该轮结果，不重发对话。超时、断流、会话创建或输入结果未知也先查 `list`、`history` 或 `wait`；历史分页导致无法确认时不能把旧回复当作新结果。

创建可提供 `--agent-id <稳定ID>`；省略时生成 ID 并在提交前写入 stderr。请保留此 ID，不按名称认领另一条定义。`--name` 给出名称，其他配置以 JSON 对象提供。下例的值须取自实际 `options`；工作要求可包含多行：

```json
{
  "instructions": "按用户要求整理资料。",
  "provider": "已有提供者",
  "model": "已有模型",
  "workspaceChange": { "operation": "bind", "workspaceId": "已有工作区ID", "agentPreset": "已有工作方式" },
  "nativeTools": []
}
```

```text
agent definition create --name <名称> --values-json <定义.json> --runtime <Runtime origin>
agent definition update <agentId> --expected-revision <读到的版本> --values-json <修改.json> --runtime <Runtime origin>
agent definition enable <agentId> --expected-revision <读到的版本> --runtime <Runtime origin>
agent definition disable <agentId> --expected-revision <读到的版本> --runtime <Runtime origin>
```

创建时名称也可放在 JSON 的 `name`，但不能同时使用 `--name`；无 JSON 可先创建空的停用定义。`update` 接收待修改字段，保留原定义的其他字段。每次更新或启停都必须提供实际读取的版本；冲突时重读比较，不自动改用新版本。更换目录或工作方式使用上述 `workspaceChange: {operation:"bind",...}`；`{operation:"clear"}` 仅能用于停用的定义。未改工作区时保留原绑定。原生工具和业务工具显式空数组表示清空，省略表示保留。

如果写入返回 `outcome_unknown`，用同一 Runtime 和 agentId `show`，对照修改及版本，再决定是否重试。不要仅凭名称新建，也不要自动重放。新建本身不运行模型。

## 工作区与工具

```text
agent tool native --workspace-id <工作区ID> --preset <工作方式> --runtime <Runtime origin>
agent tool business --runtime <Runtime origin>
agent workspace browse --values-json <目录查询.json> --runtime <Runtime origin>
agent workspace create --values-json <目录创建.json> --runtime <Runtime origin>
agent workspace register --values-json <工作区登记.json> --runtime <Runtime origin>
```

目录查询 JSON 为 `{"path":"<Runtime机器上的目录>"}`；创建为 `{"parent":"<已有父目录>","name":"<目录名>"}`；登记为 `{"path":"<已有目录>","name":"<显示名称>","agentPresets":["<可用工作方式>"]}`。目录和工作区写入需要用户明确要求及对应管理权；结果未知先检查原位置和登记，避免重复创建。

## 个人订阅与审批

```text
agent policy list
agent policy set <agentId> --visibility public
agent policy set <agentId> --visibility private
agent subscribe <agentId>
agent unsubscribe <agentId>
agent subscription list
agent subscription decide <申请ID> --decision approved
agent subscription decide <申请ID> --decision rejected
agent subscription decide <申请ID> --decision revoked
```

订阅以当前登录人为主体；私有申请可能返回 pending，不能当成已批准。审批需要对应权限和明确操作；取消只影响个人订阅，保留历史和应用选用。结果未知先查询资格或申请，不重复提交。

## 应用选用

```text
agent application list
agent application show <应用ID>
agent application set <应用ID> --values-json <完整选用.json>
```

读取后根据明确要求构造完整集合，例如 `{"bindings":[{"agentId":"<已有ID>"}],"defaultAgentId":"<已有ID>"}`。`set` 替换该应用的全部选用和默认项，不是追加；先保留仍需要的绑定。平台执行实际权限检查，结果未知先按原应用 ID 回读。
