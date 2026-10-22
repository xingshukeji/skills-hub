# 平台首次接入

仅在认证中心登录成功、XRain 业务应用仍拒绝接入时读取。以下是平台现有受管 HTTP 契约；优先使用目标提供相同能力的管理界面。实例不支持这些契约时，查该实例的受管入口，不尝试数据库或内部仓储。

## 固定目标与凭据类型

从原应用配置确定平台地址、目标 `tenantId`、应用 ID 和 OIDC client。认证中心管理密码、普通用户的中心 access token、平台 Host 会话及租户会话各有不同用途，不能互换。

| 凭据 | 用途 |
| --- | --- |
| 普通用户通过正常授权码 + PKCE 获得的中心 access token | 平台 `/account/sso`、`/account/sso/tenants`、`/account/sso/tenant`；须有该平台认可的 scope/audience，不使用 ID token |
| 现有平台 Host 管理员会话 | 查询目标租户成员，将已存在的全局用户加入目标租户 |
| 现有目标租户管理会话 | 查询和维护该租户的应用发布范围 |
| 普通用户的目标租户会话 | 检查本人应用准入，再验证原应用实际登录 |

有原生管理密码的目标通过 `POST /api/service/authen/v1/account/login` 登录。Host 请求为 `{userName,password,scope:"host"}`；目标租户请求为 `{userName,password,scope:"tenant",tenantId}`。复用该平台目录的原管理员；其他环境的同名账号不能证明凭据相同。密码和返回会话只保留在受保护上下文，不输出响应全文。

## 保持同一主体进入目标租户

1. 先用普通用户的中心 access token 请求 `POST /api/service/authen/v1/account/sso/tenant`，正文为 `{tenantId}`。成功时核对返回的真实 `userId`、`tenantId`，无需首次建档。
2. 仅当服务器明确返回 `403 / platform.authen.tenant_membership_required` 时，区分未建档与已有成员缺口。`GET /api/service/authen/v1/account/sso/tenants` 列出现有成员；空列表也可能是已有身份没有可用成员，不能单凭空列表判定需创建。
3. 对确需首次建档且本次已授权的身份，用同一中心 token 请求 `POST /api/service/authen/v1/account/sso`，正文为 `{}`。平台按 `issuer/sub` 复用或创建全局用户，首次只加入平台配置的默认租户。核对返回的 `userId` 和实际租户；不要把目标非默认租户硬填入这个接口。已有未绑定业务用户需要保留时，先使用目标获准的关联入口，不能用首次建档另造一个用户。
4. 默认租户与目标不同且已获准接入时，用 Host 会话读取 `GET /api/service/authen/v1/host/tenants/{tenantId}/members?page=1&pageSize=100`，按 `totalCount` 读完并精确匹配同一 `userId`。成员已存在且启用则复用；成员停用或身份冲突转原身份处理。仅在确实缺少时，提交该集合的 `POST`，正文为 `{userId,isAdministrator:false}`。
5. 重新读取成员并再次调用 `/account/sso/tenant`，确认返回目标租户和原 `userId`。普通新成员不授管理员、不改全局默认租户。超时或冲突先查现状，不盲目重发。

`sso_identity_conflict`、`sso_user_inactive`、`sso_identity_invalid`、`sso_not_configured` 以及其他 401/403 需要处理各自原因，不能作为首次建档、重建身份或加权的依据。首次建档部分成功后若默认成员仍缺失，复查原全局身份并由 Host 处理同一成员，重复交换不会自动恢复被停用或缺失的旧成员。

## 检查原应用准入

1. 用普通用户的目标租户会话请求 `POST /api/xrain/v1/applications/{applicationId}/admission`。读取 `allowed`、`reason`、`userId` 和 `applicationId`；管理员的准入结果不能代替普通用户的结果。
2. 仅当原因为 `publication_out_of_scope` 且该用户接入已授权时，由目标租户管理会话读取 `GET /api/xrain/v1/applications/{applicationId}/publication-scope`。`mode:"selected"` 时，将该用户去重加入原 `userIds`，保留原 `departments`。
3. 向同一路径 `PUT` 提交 `{mode,userIds,departments,expectedRevision}`，其中 `expectedRevision` 使用刚读取的 `revision`。冲突时重读并重新合并；用户已在范围内时不写入。不改成全员可见，不改变应用启用状态或角色来绕过其他拒绝原因。
4. 重新检查普通用户准入，再从原应用发起新一轮登录。核对实际个人资料、目标租户和本次需要的页面。

应用准入与业务数据权限分开判断。页面能打开不代表所有数据操作获准。所需业务操作被拒绝时，按该业务已有角色契约及本次授权处理；不得为了验证通过而给普通用户管理员权限。报告具体通过的页面和操作，不把准入通过写成完整业务验收通过。
