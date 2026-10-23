# 权限定位

按原请求查第一个拒绝：

| 层 | 核对 |
| --- | --- |
| 认证 | 会话类型与错误码；authentication_method_not_allowed 不能靠加权解决 |
| 主体/租户 | 验证后的 userId、issuer/sub、token 绑定 tenantId 与启用成员；同名不是关联 |
| 应用准入 | 原用户 admission 的 allowed/reason |
| 能力 | 实际动作的登记权限及有效角色/权限集；按钮或健康检查不是证据 |
| 数据 | 对象操作、字段读写、记录范围、Runtime 实体支持 |
| 自动化/机器人 | 执行主体及应用能力授权，不能用发起人管理员权限替代 |

前缀 /api/xrain/v1/applications/{applicationId}：
- 原用户 POST /admission。仅 publication_out_of_scope 且已授权修复时，管理身份 GET /publication-scope，再 PUT {mode,userIds,departments,expectedRevision}；保留原集合，冲突重读，不扩大为全员。
- 管理身份 GET /execution-authorization、/grant-directory 查执行能力；目录缺登记不臆造权限。
- 用户/角色/权限集可由已有 CLI 的 security ... show --auth session 查询。

中心成功但缺成员，用受管关联/Host 成员入口处理原 userId，不再建全局身份。普通用户不能管理元数据可能正确；用真实范围内/外记录验证业务权限，空数据与管理员成功不能替代。
