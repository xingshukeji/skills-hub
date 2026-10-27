# 平台首次接入

中心已认证但原应用拒绝时使用；目标不支持下列契约则回原管理界面。所有路径相对实际平台，保持同一 issuer/sub 与平台 userId。

## 成员

账号前缀 `/api/service/authen/v1`：
- 中心 **access token**（非 ID token）须匹配平台 scope/audience，用于 /account/sso、/account/sso/tenants、/account/sso/tenant。
- Host 会话维护租户成员，目标租户管理会话维护应用范围；普通用户租户会话用于本人验证。
- 原生管理员登录为 POST /account/login：Host 正文 {userName,password,scope:"host"}；租户正文另用 scope:"tenant",tenantId。凭据不跨环境推定相同。

1. 普通中心 token 调 POST /account/sso/tenant，正文 {tenantId}；成功核对真实 userId/tenantId。
2. 仅 403 / platform.authen.tenant_membership_required 才检查成员缺口；GET /account/sso/tenants 空列表不证明未建档。
3. 确需首次建档且已授权时，同 token POST /account/sso，正文 {}；按 issuer/sub 复用/创建全局用户，仅加入配置的默认租户。已有未绑定用户先走受管关联，不另造身份。
4. 目标非默认租户且接入已授权：Host GET /host/tenants/{tenantId}/members?page=1&pageSize=100，按 totalCount 读完并匹配原 userId。确实缺失才 POST 同集合 {userId,isAdministrator:false}；停用成员不视作缺失。
5. 回读成员，重新交换目标租户会话，核对原 userId。超时/冲突先查，不重放；其他 SSO 错误不触发建档或加权。

## 应用准入

前缀 `/api/xrain/v1/applications/{applicationId}`：
1. 原用户租户会话 POST /admission，读取 allowed/reason/userId/applicationId。
2. 仅 publication_out_of_scope 且接入已授权时，租户管理会话 GET /publication-scope；在原 selected 集合去重加入目标 userId，保留其他 userIds 与 departments。
3. PUT 同路径 {mode,userIds,departments,expectedRevision}，revision 用刚读值；冲突重读合并，已在范围不写，不扩大为全员。
4. 重新检查原用户准入并从原应用登录；页面准入与对象/字段/记录权限分别验证，不以管理员成功替代。
