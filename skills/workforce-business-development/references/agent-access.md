# 智能体订阅与应用选用

用于选择器、订阅和启动资格；指令与工具开发见[业务接入](implementation.md)。

## 分清定义、订阅、应用绑定与执行

| 状态或配置 | 实际含义 |
| --- | --- |
| 智能体定义存在且 enabled | Runtime 有相应定义且允许执行；仍需满足使用资格 |
| 策略 visibility | 当前策略为 `public` 或 `private`，影响用户订阅是否需要审批 |
| 订阅 selected 与 approvalStatus | 用户是否仍选用、订阅是否获准；selected 本身不足以启动 |
| 应用 bindings | 此应用选择了哪些 agentId，是否要求个人订阅 |
| defaultAgentId | 应用优先展示的选择，必须属于 bindings；不是绕过授权的默认身份 |
| 业务工具授权 | 实际工具按执行主体检查数据和业务权限，不因获准使用智能体自动扩大 |

个人订阅需 selected=true 且 approvalStatus=approved；public 可直接获准，private 需审批，缺策略须处理缺口。应用 requireUserSubscription=false 可免个人订阅，但仍检查可信应用资格、定义状态与工具权限；public 不表示匿名执行。

## 业务使用与管理入口

基址 `/api/xrain/v1/agents`，使用真实会话或执行绑定：

| 请求 | 用途 |
| --- | --- |
| `GET /directory?applicationId=...&mine=true&page=1&pageSize=20` | 支持平台目录模式时取得名称、enabled、selected、approvalStatus、canUse、reason 等条目；mine 筛选已选且获准的订阅 |
| `GET /qualifications?applicationId=...` | 当前用户的订阅与应用选用资格，含 defaultAgentId |
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
    {"agentId": "<维修助手实际ID>", "requireUserSubscription": true},
    {"agentId": "<应用公共说明助手实际ID>", "requireUserSubscription": false}
  ],
  "defaultAgentId": "<维修助手实际ID>"
}
```

bindings 是完整替换，保留其他选用项，agentId 不重复，defaultAgentId 必须在列表中。应用使用需匹配的可信宿主上下文与准入；普通登录态仅附 applicationId 实测返回 403、agents.application_context_required。资格 DTO 见[业务 API](business-api.md)。

## 与 Runtime 目录配合

目录返回 409、agents.runtime_owned_catalog 时，从 Runtime 目录读名称、enabled 和工具，按 agentId 合并 XRain qualifications。后者仅证明订阅/应用资格，不证明定义存在；执行仍走宿主完整资格链，不缓存 allowed 绕过撤销。

选择器保留当前合法选择，其次用合法默认项；pending 显示待审批，subscription_required 引导订阅，application_agent_not_selected 提示应用未选用。目录故障不当作空列表，也不自动换高权限助手。验证分别覆盖助手可启动和工具数据/动作权限。
