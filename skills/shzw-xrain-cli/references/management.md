# 人员、授权、应用与 Host 管理

管理命令默认使用已核验的真实用户会话，建议显式 `--auth session`。API Token 仅用于服务器允许的开放接口。所有操作保持原服务器及令牌绑定的租户，不以请求 JSON 或查询参数替换身份。

新增命令的完整请求使用 `--request-json <文件或->`，`--file` 是别名。GET 查询参数可使用 `--query-json <文件或->`，其键使用服务端字段名。部分列表另支持 page、page-size、search、status；完整查询文件与这些快捷参数互斥。命令不替调用者补齐版本、影响决定或权限。

## 租户成员与组织

普通成员查询可见人员时使用 `member list --page 1 --page-size 20 --search <姓名>` 和 `member show <userId>`。命令使用平台原窄目录，只返回当前身份可见的同租户成员资料。此读取不要求用管理员目录代替，也不取得账号凭据或授权详情。目录被拒绝时保留原错误。

本人企业发现使用 `auth tenants`。Host 数据库浏览使用 `host database sources`、`host database catalog <sourceId>`、`host database table <sourceId> <schema> <table>`，要求已保存的 Host 登录。sourceId 从实际返回的数据源中选择；table 可用 `--query-json` 指定 previewLimit。服务决定就绪数据源、结构和样例范围；命令不接受连接字符串或任意 SQL。

```text
security user list --page 1 --page-size 20 --search <搜索>
security user update <用户名> --request-json <成员.json>
security user org-memberships <用户名>
security user deactivate <用户名>
security user activate <用户名>
security user membership-validity <用户名> --request-json <有效期.json>
security user delete <用户名>
security directory
security directory-visibility get
security directory-visibility set --request-json <可见范围.json>
security org-tree list
security org-tree deleted
security org-tree show <treeId>
security org-tree create --request-json <组织树.json>
security org-tree update <treeId> --request-json <组织树.json>
security org-tree delete <treeId>
security org-tree restore <treeId>
security org-node create <treeId> --request-json <节点.json>
security org-node update <treeId> <nodeId> --request-json <节点.json>
security org-node delete <treeId> <nodeId>
security org-node add-members <treeId> <nodeId> --request-json <成员ID数组.json>
security org-node remove-members <treeId> <nodeId> --request-json <成员ID数组.json>
```

成员编辑维护租户成员资料，包括 companyCode、departmentCode、managerUserId、employeeNo、avatar 和 email，提交时按平台请求格式带现有 name。本人密码通过 [auth password change](login.md#修改本人密码) 修改。列表中的 isActive 是租户成员状态。停用、恢复、有效期、移除及组织关系按各自命令操作。

组织成员文件是 `["<ID1>","<ID2>"]` 所示的 JSON 数组。组织树和节点使用平台原生对象字段；父子节点、默认树和删除影响由服务器检查。先读取原树再准备修改，不复制另一租户的对象或身份。

## 角色与权限集

```text
security role list
security role create --request-json <角色.json>
security role update <角色名> --request-json <角色.json>
security role deactivate <角色名>
security role delete <角色名>
security role object-permissions <角色名>
security role object-permission <角色名> <entity>
security role api-permissions <角色名>
security role grant-api <角色名> --request-json <名称数组对象.json>
security role revoke-api <角色名> --request-json <名称数组对象.json>
security role sharing-rules <角色ID>
security role grant-sharing-rule <角色ID> --request-json <规则ID数组.json>
security role revoke-sharing-rule <角色ID> --request-json <规则ID数组.json>
security permission-set list
security permission-set update <权限集名> --request-json <权限集.json>
security permission-set activate <权限集名>
security permission-set deactivate <权限集名>
security permission-set clone <权限集名> --request-json <克隆.json>
security permission-set delete <权限集名>
security permission list
security permission show <权限名>
security permission create --request-json <权限.json>
security permission update <权限名> --request-json <权限.json>
security permission delete <权限名>
```

角色创建和修改使用 name、label、helpText；API 授权请求为 `{"names":["<权限名称>"]}`。共享规则关系使用 ID 数组，并以角色 ID 定位。普通角色 show、用户授予角色、角色授予权限集、权限集授予权限沿用原命令。对象授权写入仍由对象访问治理接口持有，不能用角色接口伪造。

先从目录和权限目录取得当前实际名称；不猜测权限名，不把创建角色或权限集当作已完成授予。删除和撤权后的实际访问效果由原服务判断。

## 服务端 Token 与审计

```text
security api-token subjects --search <搜索>
security api-token list --query-json <筛选.json>
security api-token create --request-json <签发.json> --out <新凭据文件.json>
security api-token reveal <tokenId> --out <新凭据文件.json>
security api-token revoke <tokenId>
security api-catalog
security api-registry --scope host
security api-debug --request-json <调试.json>
security audit --query-json <审计筛选.json>
```

签发请求为 `{"subjectUserId":"<已有主体ID>","expiresAtUtc":"<UTC时间>"}`。只使用已核验的受管主体，不因签发 Token 另建身份。凭据必须写入明确的新文件；Windows 使用当前用户 DPAPI，其他系统使用 0600 文件，不打印 Token。通过 `--token-file <文件>` 或 `XRAIN_TOKEN_FILE` 供支持的 API 命令使用；文件绑定原服务器、租户和作用域，不能在另一目标发送。会话管理继续使用 `--auth session`，不接受显式 Token 文件覆盖。

签发后保存失败会返回 `credential_save_failed`；原 Token 可能已经签发，先查原列表并恢复已有凭据，不重复签发。旧文件始终保留。该文件不是浏览器登录会话，也不扩大 API 准入。

Token 列表的查询键为 page、pageSize、search、status、subjectUserId。审计筛选必须有 from、to、resourceType，可带 pageSize、cursor、actorId、agentId、resourceId、action、outcome；时间使用服务要求的 UTC 格式。API 调试请求为 catalogKey、tokenId、input；它可能产生业务写入或外部效果，必须有对应用户要求，不能用来绕过正常 API 权限。

## 租户内应用

`application` 管理租户应用资料与授权；`app` 继续管理应用包。

```text
application list
application capabilities
application show <applicationId>
application create --request-json <应用.json>
application update <applicationId> --request-json <应用.json>
application resource-catalog <applicationId>
application grant-directory <applicationId>
application authorization-impact <applicationId> --request-json <影响请求.json>
```

应用创建为 `{"name":"<名称>","description":"<说明>","enabled":false}`；修改还需 expectedRevision。publication、resources、administrators、grant-ceiling 各提供 get/set，set 另带完整请求文件。grant-baseline 提供 get/set/impact。保留原列表和版本，不从部分输入推断删除其他资源或管理员。

`application role` 与 `application permission-set` 提供 list/create/update/delete；角色另有 users、permission-sets，权限集另有 items。目标先带 applicationId，单项修改或删除再带原 ID；写入带请求文件。删除保留服务器给出的 impactDigest 和明确 decisions，不自动确认影响。

execution-authorization 提供 get/grant，grant 接收请求文件。message-robot set、message-authorization、admission 不接收请求正文；directory members/departments 为读取。命令保留原授权及准入结果，管理权不代表具体业务执行资格。

## Host

```text
host tenant list
host tenant show <tenantId>
host tenant create --request-key <稳定键> --request-json <租户.json>
host tenant create --help
host tenant workforce show <tenantId>
host tenant workforce set <tenantId> --request-json <服务变更.json>
host tenant workforce import <tenantId> --request-json <原应用.json>
host tenant update <tenantId> --if-match <原ETag> --request-json <租户.json>
host tenant activate <tenantId>
host tenant suspend <tenantId>
host tenant connection set <tenantId> <连接名> --request-json <连接.json>
host tenant connection check <tenantId> <连接名>
host tenant member list <tenantId> --query-json <成员筛选.json>
host tenant member create <tenantId> --request-json <成员.json>
host tenant member update <tenantId> <userId> --request-json <成员.json>
host tenant member delete <tenantId> <userId>
host user ai get <userId>
host user ai set <userId> --request-json <AI标记.json>
```

使用已有 Host 登录及实际管理权限。租户创建保留显式 Idempotency-Key，修改使用原 If-Match，冲突不更新基线重试。连接凭据经文件传递，不打印或写入命令参数。成员创建复用既有全局 userId；普通添加优先沿用 member ensure，不自动改成管理员。Host 用户 AI 标记与租户成员字段分别判断。

Host member list 的查询文件支持 page、pageSize、search、isActive；例如 `{"page":1,"pageSize":20,"isActive":false}` 读取目标租户的停用成员。基础分页和搜索也可使用原快捷参数；不要与完整查询文件混用。

创建业务租户默认同时申请标准 Workforce。用 Host 管理员登录后，准备包含 `{"name":"demo"}` 的 `tenant.json`，执行 `xrain-cli host tenant create --request-key demo-001 --request-json tenant.json`。平台在租户激活时记录申请。回执里的 `standardWorkforce.enabled` 为 `true` 表示申请已受理，关闭终端后系统仍会继续准备。将回执中的 `tenantId` 传给 `host tenant workforce show` 可以查询开通选择和修订号。获准成员从原门户登录，准备尚未完成时可点击“继续开通 Workforce”。

暂时只需要业务租户时，可加 `--no-standard-workforce`，也可在租户 JSON 中设置 `"standardWorkforce": false`。已有脚本中的 `--standard-workforce` 仍表示显式开通。用原请求键和相同租户资料回读时，平台保留原申请的选择。执行 `xrain-cli help host tenant create` 或 `xrain-cli host tenant create --help` 均可查看示例。

变更已有租户时先用 `workforce show` 读修订，再用 `workforce set` 提交选择。例如对修订 1 的租户提交 `{"enabled":false,"expectedRevision":1}` 即可停用。修订冲突后重读。已有静态部署在首次开通前，可用 `workforce import` 提交原应用的 `workforceApplicationId` 和 `definitionsApplicationId` 以保留原发布范围。

以上写入结果未知时保留目标、原请求标识和回读入口。服务器拒绝、版本冲突和未知结果分别处理，不换身份、自动授予或重放。
