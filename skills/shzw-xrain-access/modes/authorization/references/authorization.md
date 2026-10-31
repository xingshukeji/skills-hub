# 授权来源、变更与撤回

主体、成员、应用启用/准入通过后，沿 role → users/permission-sets → items → permissionId/scopeJson 查来源。role 须 active，权限集须未 muted；关系存在不代表有效，全局与应用来源可同时授权。

前缀 /api/xrain/v1/applications/{applicationId}，读取 roles、permission-sets、grant-directory、grant-ceiling、resources。按目录映射真实动作与 resource/baseline/implicit 来源，不自造目录外权限。

/roles/{roleId}/users、/roles/{roleId}/permission-sets、/permission-sets/{id}/items 的 PUT **替换集合**。按已核实的稳定 ID 与授权来源列出本次拟改差异和保留项，核对目标存在及角色对应关系，不按显示名称猜身份；只改当前管理合同允许的租户配置。使用目标实际支持的并发合同，不自行给接口增加 revision 或参数；冲突后重读、重算差异，提交后把实际集合与目标比较，保留无关项。没有可用保护时不能声称已验证并发安全。包声明的权限集条目由包版本维护，不能用这些接口或本地附加权限集掩盖包定义缺陷；人员与角色分配仍按标准管理。创建权限集不等于绑定给用户。

删除或收缩前，POST /authorization-impact {action,targetIds}；action 取当前表单/契约。读取 digest、sources、affectedSourceCount、canRetain。写入若要求 impactDigest/decisions，使用本次 digest 与实际 sourceId 的已决定选择；canRetain 不表示已授权保留。并发或摘要过期重读预览，不能去掉校验。

撤直接来源后，其他角色或包权限集仍可能授同一权限；不为让测试拒绝而删除无关来源。发布准入与数据权限分别复测。原用户正常刷新/登录，用允许、拒绝与字段/记录边界核对 API 新结果，区分旧界面缓存。

本次命中撤权或恢复时，先确定改变的是成员资格、应用准入、授权来源还是凭据。按目标合同核对变更前已有连接、变更后的新请求，以及进行中写入和迟到结果；已提交的业务结果与变更后新写入分开判断，同时检查应保留的工作。取不到相关连接或结果证据时标未验证。不从一项资格变化推定所有 token 的失效或恢复，也不在恢复时重授已撤销的其他来源。

初始化反复漏授权时，先分清缺的是包定义、平台初始化还是租户分配入口，再修对应来源并验证受影响的初装或升级；不以逐人补权收口。
