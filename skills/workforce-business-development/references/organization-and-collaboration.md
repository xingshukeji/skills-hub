# 租户、组织与记录协作

用于人员选择、组织范围、分享和交接；对象/字段动作见[业务授权](authorization.md)。

## 身份、成员与业务人员资料

| 信息 | 用途与边界 |
| --- | --- |
| 全局用户身份 | 登录身份及全局属性；同一维护者可通过成员关系参与多个租户，不因新增应用重复建人 |
| 当前租户成员 | 此人能否在当前租户工作、是否活跃，以及该租户的角色与权限；有全局身份不等于属于所有租户 |
| 租户成员资料 | 用于人员卡片、选择和协作，返回受控的小型资料；不是全量通讯录或权限管理接口 |
| 业务 User 对象 | 受保护的人员业务对象及允许的扩展字段；普通记录写入不能替代账号、成员和角色管理 |
| 组织树与成员关系 | 多棵组织树、稳定节点 ID、父子关系和节点成员；部门编码、节点 ID、显示名称分别使用 |

完整上下文与 SDK context 的差异见[业务 API](business-api.md)。切换租户走宿主入口，并重建客户端、候选与缓存；body.tenantId 不改变身份。UserRef 和全员基础复用[初始化资源](initialized-platform.md)。

人员展示使用 members 列表/详情，只返回受控资料，不含邮箱、电话、凭据、角色或任意扩展字段。Lookup 查询目标对象，UserRef 展示成员后仍核对动作资格；字段 options 不用于人员，见[候选消费](metadata-and-ui.md)。

目录可见模式 allMembers/sameDepartment/selfOnly 由 `/api/service/authen/v1/security/directory-visibility` 管理，只影响人员目录。更多 User 属性沿字段权限查询，managerUserId 不自动授予下属记录。

组织管理基址 `/api/service/authen/v1/security`：`org-trees`、`org-trees/{orgTreeId}/nodes`、`org-trees/{orgTreeId}/nodes/{orgTreeNodeId}/members`，用户关系为 `users/{userName}/org-memberships`。按管理合同配置，业务表单不需组织管理权；部门编码、节点 ID、职责分别使用。

## 共享规则

共享规则入口 `/api/metadata/v1/sharing-rules`，refObjectId 引用对象元数据 ID；规则授予记录范围，对象/字段权限仍须成立。

| 配置 | 表达什么 | 保存形状 |
| --- | --- | --- |
| 主体条件 | 哪些当前用户符合本规则 | `subjectConditionJsonStr`，序列化后的条件树字符串 |
| 记录条件 | 符合主体条件的人可访问哪些记录 | `filterItemsJsonStr`，序列化后的记录条件数组 |
| 角色直授 | 哪些角色直接适用本规则 | `roleIds` 数组，读取可见 `sharedRoles` |
| 范围允许的动作 | 该规则是否授予读取、修改、删除 | `readable/updateable/deleteable` |

角色直授与主体条件按 **OR** 合并，主体 all 为交集、any 为并集。“研发部的项目经理”须将部门和角色放进 all，roleIds 留空，否则其他部门的同角色也会命中。

组织叶子：actor.orgMemberships + inOrgNodes，值含 orgTreeId/orgNodeIds/scope；exact 仅当前节点、subtree 含后代，多节点任一命中。角色用 actor.roleIds + containsAny/containsAll，用户用 actor.userId + eq/in。主体条件最大深度 8、节点 100，组非空。

以下项目辅助函数生成 POST body；参数取当前目录，departmentCode__c 保存稳定部门编码：

```js
export function departmentManagerRule({ ruleName, objectId, treeId, nodeId, roleId, departmentCode }) {
  const subject = { all: [
    { variable: "actor.orgMemberships", operator: "inOrgNodes",
      value: { orgTreeId: treeId, orgNodeIds: [nodeId], scope: "exact" } },
    { variable: "actor.roleIds", operator: "containsAny", value: [roleId] }
  ] };
  return {
    name: ruleName,
    label: "本部门项目经理处理申请",
    helpText: "同时满足组织成员与角色条件，只允许本部门记录。",
    refObjectId: objectId,
    roleIds: [],
    subjectConditionJsonStr: JSON.stringify(subject),
    filterItemsJsonStr: JSON.stringify([
      { field: "departmentCode__c", operator: "eq", value: departmentCode }
    ]),
    readable: true,
    updateable: true,
    deleteable: false
  };
}
```

ruleName 保持唯一稳定。共享条件用 operator，Runtime 查询用 op。此规则不撤销 Owner、其他共享等来源，多个部门分别配置主体与记录条件。

`$USER.<路径>` 仅可引用 Actor 元数据允许的非敏感字段（allowActorPolicyReference）。`$R<formulaName>` 须对应 `/api/metadata/v1/sharing-rule-formulas` 中的实际记录；actor.* 变量不是公式记录。复用系统公式，浏览器不执行表达式。

保留未知历史条件，读取失败不当作无限制。用“同部门有角色、其他部门有角色、同部门无角色”验证实际查询/修改结果。

## 单条记录的人工分享

人工分享用于单条记录协作，无需新角色。前缀 `/api/data/v1/entities/{entityCode}/records/{recordId}/shares`：

| 请求 | 用途 |
| --- | --- |
| `GET /capability` | 读取 `supportsManualSharing/manualSharingEnabled/canManageManualShares/canGrantUpdate/canGrantDelete/pausedManualShareCount` |
| `GET /recipients?page=1&pageSize=25&search=...` | 查询本记录的受管接收人候选 |
| `GET /eligibility?userId=...` | 核对所选人的 `eligible/errorCode/message`；写入时仍再次检查 |
| `GET` | 分页读取已有分享 |
| `POST` | 新增分享，body 为 `{userId, readable, updateable, deleteable}` |
| `PATCH /{shareId}` | 修改指定分享，使用同一请求形状 |
| `DELETE /{shareId}` | 撤销指定分享 |

按 capability 提供动作，可编辑不等于可分享。保留 paused、shareCause/teamRoleName 的来源和暂停状态；关闭开关不等于删除历史分享。接收人资格由 eligibility 判断，分享不补齐对象/字段权限。

## Owner 转移与业务交接

HTTP transferOwner 的 body 为 `{ownerId}`、结果为 `{recordId, ownerId}`；callable `runtime.records.transferOwner` 用 `{entityCode, recordId, ownerId}`。普通 CRUD 不改 Owner，路径见[业务 API](business-api.md)。

操作者须有对象 Edit，且为当前 Owner 或显式持有 platform.entity.record.manage；目标须为本租户活跃成员且有对象 Read。HTTP 入口权限与这些业务资格分别检查。

服务端以旧 Owner 并发保护，并执行 Trigger/历史链；body 不收 expectedOwnerId。冲突后重读，历史可含 OwnerTransfer。业务负责人、群成员、关联记录仍按交接需求分别处理。
