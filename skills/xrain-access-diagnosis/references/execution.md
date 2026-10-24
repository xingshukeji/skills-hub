# 自动化与消息权限

应用准入和顾客等业务操作已通过，但智能体目录失败时，分别核对 Runtime 定义、平台 qualifications、应用选用与可信客户端上下文。`GET /api/xrain/v1/agents/qualifications?applicationId=...` 仍要求匹配的调用客户端；仅在普通会话中附 applicationId 不能建立这种关系。保留外层 HTTP 状态、CONNECTOR_FORBIDDEN 等上游原因与原用户，不能把所有 503 都当作停机，或通过重建账号、重复选用和广授角色解决。管理员读取应用 bindings 只证明选用配置，不能替代原人调用成功。

GET /api/xrain/v1/applications/{applicationId}/execution-authorization，读 configurationSource/key、executionUserId/readinessReason、roles、permissionSets、messageRobot、capabilityChecks、unverifiedScopes。

| 结果 | 处理 |
| --- | --- |
| execution_user_missing/inactive/unavailable | 查原固定执行身份、配置与成员，不建替代管理员 |
| allowed | 该能力通过；unverifiedScopes 仍未证明字段/记录范围 |
| missing 且 canGrantInApplication | 已授权时补目录中的最小 permissionId 集合 |
| unverified | 解决配置/身份/查询失败；未知不等于缺权 |
| 未登记或不能在应用授权 | 查包资源/初始化，不自造权限 |
| robot not_established/inactive/invalid | 查受管建立状态及归属，不让机器人登录 |

已授权补能力：PUT 同应用 /execution-authorization/grants {permissionIds:[...]}，回读原角色/权限集及诊断，保留其他项。

PUT /message-robot 可建立固定应用机器人并登记发送能力，须本次已涵盖建立。机器人是可见发送身份，不可登录/签发 Token；代发权属于实际调用者。POST /message-authorization 返回 executor/robot/application 关联，不代表已发送。

诊断或补权不授权向人发消息。明确发送验证才用约定接收方，分别回读存储和交付；未知先查原消息 ID。
