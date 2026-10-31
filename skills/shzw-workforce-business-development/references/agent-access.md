# 智能体定义、订阅与应用选用

产品事实：Workforce；涉及 Runtime、统一认证或平台 API 时沿该能力实际所有者核对。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

用于选择器、订阅和启动资格；指令与工具开发见[业务接入](implementation.md)。

## 定义与文件

Runtime 持有定义的名称、工作要求、模型、工作模式、工作目录、文件与通用工具、业务工具、推荐问题、业务操作和侧栏配置。XRain 另持有个人订阅、批准和应用选用；定义本身不创建 AI 员工或授予业务权限。新建定义先保存为停用；已有定义的启停单独立即生效，不提交其他编辑草稿。

定义详情支持导出已保存内容。新建或编辑时选择“从文件导入”：读取成功后直接更新当前草稿，保存后生效；无法还原的目录或无法核对的工具会提示。文本或 Markdown 只替换工作要求；旧 JSON 工作文件包含 `instructions` 和 `assistantTools`，导入后替换这两项。取消选择、错误或迟到的读取不覆盖现有输入。

页面导出文件顶层为 `format: "xrain-workforce-agent-definition"`、`version: 1` 和 `definition`。`definition` 包含 `name`、`enabled`、`instructions`、`provider`、`model`、`reasoningEffort`、`agentPreset`、`workspace`、`nativeTools`、`assistantTools`、`suggestedQuestions`、`businessActions` 和 `uiPlugins`。其中 `enabled` 仅记录导出时的状态；导入保留目标身份、版本、启用状态及使用范围。`nativeTools: null` 表示继承工作模式，空数组表示不选可选工具；`uiPlugins: null` 表示沿用默认侧栏，空数组表示不显示。`assistantTools: []` 表示没有业务工具。

`workspace.kind` 为 `direct` 时有当前 Runtime 机器的 `path`；为 `registered` 时有工作区 `id` 及可取得的 `path`；`none` 表示未设置，`unavailable` 表示导出时不能取得路径。导入后仍由当前环境核验目录和工作模式。无法确认的登记目录和已启用定义的空目录会保留目标设置并提示；支持恢复继承的 Runtime 可按文件恢复工具继承，旧版本保留目标选择并提示。模型、业务工具和业务对象也须在当前环境可用；工具目录变化时核对完整工具描述，不按名称猜测或自动替换。定义文件及保存请求的大小上限由 Runtime 的 `XRAIN_AGENT_DEFINITION_MAX_BYTES` 统一配置，默认 2 MiB。

此文件不是 Runtime 存储文件，也不是 CLI 的 `--values-json` 更新请求。使用 CLI 管理定义时先读取目标定义和可用选项，再按实际命令合同构造修改字段；不要把导出文件直接当作完整在线写入。实际版本及权限以目标环境为准。

## 分清定义、订阅、应用绑定与执行

| 状态或配置 | 实际含义 |
| --- | --- |
| 智能体定义存在且 enabled | Runtime 有相应定义且允许执行；仍需满足使用资格 |
| 策略 visibility | 当前策略为 `public` 或 `private`，影响用户订阅是否需要审批 |
| 订阅 selected 与 approvalStatus | 用户是否仍选用、订阅是否获准；selected 本身不足以启动 |
| 应用 bindings | 此应用选择了哪些 agentId；历史 requireUserSubscription 读写均规范为 false |
| defaultAgentId | 应用优先展示的选择，必须属于 bindings；不是绕过授权的默认身份 |
| 业务工具授权 | 实际工具按执行主体检查数据和业务权限，不因获准使用智能体自动扩大 |

个人订阅需 selected=true 且 approvalStatus=approved；public 可直接获准，private 需审批，缺策略须处理缺口。应用使用只要求当前认证用户通过既有应用准入、应用已选用且定义启用，不再要求 caller_client、客户端映射或个人订阅；具体工具和数据权限仍逐次检查，public 不表示匿名执行。

## 业务使用与管理入口

基址 `/api/xrain/v1/agents`，使用真实会话或执行绑定：

| 请求 | 用途 |
| --- | --- |
| `GET /directory?applicationId=...&mine=true&page=1&pageSize=20` | 支持平台目录模式时取得名称、enabled、canUse、reason 等条目；mine 只在个人目录筛选订阅，应用返回全部选用项 |
| `GET /qualifications?applicationId=...` | 应用准入通过后返回选用项及 defaultAgentId；无 applicationId 才读取本人订阅 |
| `POST /{agentId}/subscription` | 当前用户申请订阅，读取返回的实际状态 |
| `DELETE /{agentId}/subscription` | 当前用户取消选用 |
| `POST /{agentId}/use` | body `{applicationId}` 或 `{}`，返回 `allowed/reason`；它检查资格，不创建 Session/Run |
| `GET /policies`、`PUT /{agentId}/policy` | 有相应定义管理资格时维护策略，PUT body 为 `{visibility}` |
| `GET /subscription-requests` | 有订阅审批权限时读取申请与可处理订阅 |
| `POST /subscription-requests/{id}/decision` | `{decision: "approved"}`，也支持 `rejected`、`revoked` |

应用管理员通过 `GET/PUT /api/xrain/v1/applications/{applicationId}/agents` 维护选用：

```json
{
  "bindings": [
    {"agentId": "<维修助手实际ID>", "requireUserSubscription": false},
    {"agentId": "<应用公共说明助手实际ID>", "requireUserSubscription": false}
  ],
  "defaultAgentId": "<维修助手实际ID>"
}
```

bindings 是完整替换，保留其他选用项，agentId 不重复，defaultAgentId 必须在列表中。应用宿主固定 applicationId，平台检查用户及租户的应用准入，Runtime 保留原会话所属应用。旧版本实测曾返回 403、agents.application_context_required；现行源码已取消该额外门槛，出现时核对实际运行版本，不补映射或扩大用户权限。资格 DTO 见[业务 API](business-api.md)。

## 与 Runtime 目录配合

目录返回 409、agents.runtime_owned_catalog 时，从 Runtime 目录读名称、enabled 和工具，按 agentId 合并 XRain qualifications。后者仅证明订阅/应用资格，不证明定义存在；执行仍走宿主完整资格链，不缓存 allowed 绕过撤销。

选择器保留当前合法选择，其次用合法默认项；个人入口的 pending 显示待审批，subscription_required 引导订阅，应用的 application_agent_not_selected 提示未选用。目录故障不当作空列表，也不自动换高权限助手。验证分别覆盖助手可启动和工具数据/动作权限，并区分源码定向测试与实际运行制品的业务复验。
