# 授权来源、变更与撤回

主体、成员、应用启用/准入通过后，沿 role → users/permission-sets → items → permissionId/scopeJson 查来源。role 须 active，权限集须未 muted；关系存在不代表有效，全局与应用来源可同时授权。

前缀 /api/xrain/v1/applications/{applicationId}，读取 roles、permission-sets、grant-directory、grant-ceiling、resources。按目录映射真实动作与 resource/baseline/implicit 来源，不自造目录外权限。

/roles/{roleId}/users、/roles/{roleId}/permission-sets、/permission-sets/{id}/items 的 PUT **替换集合**，先读并保留无关项，只改本次目标。创建权限集不等于绑定给用户。

删除或收缩前，POST /authorization-impact {action,targetIds}；action 取当前表单/契约。读取 digest、sources、affectedSourceCount、canRetain。写入若要求 impactDigest/decisions，使用本次 digest 与实际 sourceId 的已决定选择；canRetain 不表示已授权保留。并发或摘要过期重读预览，不能去掉校验。

撤直接来源后，其他角色仍可能授同一权限；不为让测试拒绝而删除无关来源。发布准入与数据权限分别复测。原用户正常刷新/登录，用允许、拒绝与字段/记录边界核对 API 新结果，区分旧界面缓存。初始化反复漏授权须修登记/初始化并在受控新用户或新安装验证。
