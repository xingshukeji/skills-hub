# 智能体订阅与应用选用

用于应用中的智能体选择器、订阅申请和启动资格判断。指令、工具定义及处理器开发见[业务实现与接入](implementation.md)；本专题说明已有智能体如何被具体用户和应用使用。

## 分清定义、订阅、应用绑定与执行

| 状态或配置 | 实际含义 |
| --- | --- |
| 智能体定义存在且 enabled | Runtime 有相应定义且允许执行；仍需满足使用资格 |
| 策略 visibility | 当前策略为 `public` 或 `private`，影响用户订阅是否需要审批 |
| 订阅 selected 与 approvalStatus | 用户是否仍选用、订阅是否获准；selected 本身不足以启动 |
| 应用 bindings | 此应用选择了哪些 agentId，是否要求个人订阅 |
| defaultAgentId | 应用优先展示的选择，必须属于 bindings；不是绕过授权的默认身份 |
| 业务工具授权 | 实际工具按执行主体检查数据和业务权限，不因获准使用智能体自动扩大 |

普通个人订阅需同时 `selected=true`、`approvalStatus="approved"`。公开策略下发起订阅可直接获准，私有策略需要审批；没有策略时返回缺口，不把“公开”理解为匿名可执行。应用绑定 `requireUserSubscription=false` 可采用应用选用资格，但应用准入、定义可用性和工具业务权限仍成立。

## 业务使用与管理入口

下表以 `/api/xrain/v1/agents` 为基址。用现有真实会话或执行绑定；不要从工具输入接收 userId 来替代调用者。

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

应用的选用配置使用 `GET/PUT /api/xrain/v1/applications/{applicationId}/agents`，由应用管理员或相应管理主体维护。示例请求：

```json
{
  "bindings": [
    {"agentId": "<维修助手实际ID>", "requireUserSubscription": true},
    {"agentId": "<应用公共说明助手实际ID>", "requireUserSubscription": false}
  ],
  "defaultAgentId": "<维修助手实际ID>"
}
```

bindings 是该次提交的完整选择，编辑一项时保留其他需要的绑定；agentId 不重复，默认项不能指向列表外。应用消费资格还要求可信宿主提供匹配该应用的调用上下文，并通过应用准入；任意附带 applicationId 不会产生这种资格。管理配置接口与普通用户使用接口的权限不同。

实测同一普通成员调用不带 applicationId 的 `/qualifications` 返回 200，结构为 `{tenantId, userId, applicationId, items, defaultAgentId}`；自行在普通登录态请求中加应用 ID 则返回 403、`{"error":"agents.application_context_required"}`。此时应接续宿主的可信应用调用链，不伪造应用头或把错误当作空资格列表。

## 与 Runtime 目录配合

有些部署由智能体 Runtime 拥有定义目录，XRain 的 `/directory` 会返回 `agents.runtime_owned_catalog`；本次真实响应为 HTTP 409、`{"error":"agents.runtime_owned_catalog"}`。此时从已交付的 Runtime 目录读取名称、enabled 和工具信息，再按 agentId 合并 XRain `/qualifications`；不要把该错误显示成“没有智能体”，也不要在 XRain 重建一份定义。

在这种模式下，XRain 的资格结果仅表达它负责的订阅和应用选用，不能证明 Runtime 定义存在或已启用。真正创建会话/执行时仍走宿主的完整资格链路。其他模式下也不长期缓存一次 allowed 结果来绕过后续撤销或停用。

选择器优先保留当前合法选择，其次考虑合法默认项；`pending` 显示待审批，`subscription_required` 引导已有订阅动作，`application_agent_not_selected` 说明应用未选用，定义缺失/停用由 Runtime 或实际目录状态说明。配置或目录暂不可用时保留可解释状态，不自动换成权限更大的助手。

例如维修应用新增助手后，需要分别完成定义与工具装配、应用绑定、必要的用户订阅。用有申请读取权的用户验证助手能够查询，再用没有关闭权限的用户验证关闭工具被拒绝；订阅批准只解决助手使用资格。
