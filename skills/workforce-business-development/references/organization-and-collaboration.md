# 租户、组织与记录协作

用于人员选择、部门范围、跨部门分享和负责人交接。对象/字段动作与自定义权限的基本组合见[业务授权](authorization.md)；这里补充人员来源和记录范围的实际落地。

## 身份、成员与业务人员资料

| 信息 | 用途与边界 |
| --- | --- |
| 全局用户身份 | 登录身份及全局属性；同一维护者可通过成员关系参与多个租户，不因新增应用重复建人 |
| 当前租户成员 | 此人能否在当前租户工作、是否活跃，以及该租户的角色与权限；有全局身份不等于属于所有租户 |
| 租户成员资料 | 用于人员卡片、选择和协作，返回受控的小型资料；不是全量通讯录或权限管理接口 |
| 业务 User 对象 | 受保护的人员业务对象及允许的扩展字段；普通记录写入不能替代账号、成员和角色管理 |
| 组织树与成员关系 | 多棵组织树、稳定节点 ID、父子关系和节点成员；部门编码、节点 ID、显示名称分别使用 |
| 用户与租户设置 | 界面偏好和租户默认配置；不承担业务记录或授权事实的职责 |

当前上下文的 HTTP 入口是 `GET /api/service/authen/v1/account/context`，含 `userId/tenantId/scope/effectivePermissions/regionalContext`。实测 Workforce 0.3.8 的 `XRainRuntimeClient.context()` 只返回 `tenantId/userId/effectivePermissions`；需要 scope 或地区上下文时使用宿主提供的完整上下文或该 HTTP 入口，不能从这个 SDK 返回值读取被省略的字段。切换租户使用宿主或平台的租户切换入口，随后重建当前客户端、人员候选和缓存。不要通过业务参数里的 tenantId 假装切换身份。

受保护业务 User 已由平台提供，`UserRef` 使用固定对象身份；有效成员还自动适用 `xrain-all-employees` 的基础权限。新增应用通常复用这些关系，具体引用和增补位置见[初始化基础](initialized-platform.md)。人员目录、全员接口资格和业务记录范围仍是不同能力。

人员展示可以使用 `GET /api/tenant/v1/members?page=1&pageSize=20&search=...`，返回 `{items, totalCount}`；详情是 `GET /api/tenant/v1/members/{userId}`。条目包含 `userId/name/isAI/jobTitle/jobDescription/isActive/avatar/applicationId` 等受控资料。接口不接收 tenantId，也不返回邮箱、电话、凭据、角色和任意 User 扩展字段；目录可见性还会影响实际结果。Lookup 选择器按真实目标对象查询；UserRef 可用受控人员资料展示，再沿业务动作与写入合同核对资格。字段 `/options` 当前只支持选项类型，不能用于 UserRef；见[候选值消费](metadata-and-ui.md)。

目录可见模式为 `allMembers`、`sameDepartment`、`selfOnly`，由 `/api/service/authen/v1/security/directory-visibility` 对应管理能力维护。它控制人员目录可见性，不自动授予同部门业务记录。读取人员更多业务属性时，沿业务 User 的 describe、字段权限和查询契约操作。

组织配置位于 `/api/service/authen/v1/security` 下的 `org-trees`、`org-trees/{orgTreeId}/nodes`、`org-trees/{orgTreeId}/nodes/{orgTreeNodeId}/members`；用户组织关系使用 `users/{userName}/org-memberships`。这些是受管组织入口，配置请求按目标管理合同提交；业务表单无需因此获得组织管理权限。公司组织树中的节点按部门解释，不从节点名称推断岗位或管理职责。

例如新增售后应用时，复用现有成员和组织树；业务新增的是“客户经理”“维修负责人”等字段及职责。人员的 `managerUserId` 可表达直接上级，但不会自动授予全部下属记录。账号准备或迁移按项目已有固定账号约定执行。

## 共享规则的三个独立部分

共享规则管理入口为 `/api/metadata/v1/sharing-rules`。规则引用对象元数据 ID `refObjectId`，配置读、改、删范围；对象动作和字段权限仍须成立。

| 配置 | 表达什么 | 保存形状 |
| --- | --- | --- |
| 主体条件 | 哪些当前用户符合本规则 | `subjectConditionJsonStr`，序列化后的条件树字符串 |
| 记录条件 | 符合主体条件的人可访问哪些记录 | `filterItemsJsonStr`，序列化后的记录条件数组 |
| 角色直授 | 哪些角色直接适用本规则 | `roleIds` 数组，读取可见 `sharedRoles` |
| 范围允许的动作 | 该规则是否授予读取、修改、删除 | `readable/updateable/deleteable` |

角色直授与主体条件按 **OR** 合并；主体内部的 `all` 是交集，`any` 是并集。因此“研发部的项目经理”应把部门和角色都放在 `all` 内，并留空角色直授。若又把项目经理角色放入 `roleIds`，其他部门同角色的人也可能命中规则。

组织叶子使用 `actor.orgMemberships`、`inOrgNodes`，值含 `orgTreeId/orgNodeIds/scope`。`exact` 仅指定节点，`subtree` 包含后代；一个叶子的多个节点表示任一命中。角色叶子使用 `actor.roleIds` 与 `containsAny/containsAll`；用户叶子使用 `actor.userId` 与 `eq/in`。主体条件当前限制为深度 8、节点 100，空组不是有效条件。

下面是生成共享规则创建 body 的示例。参数来自当前租户目录和业务模型，示例部门字段 `departmentCode__c` 存稳定编码。返回值交给已有认证请求封装，以 `POST /api/metadata/v1/sharing-rules` 提交：

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

ruleName 使用该规则稳定且唯一的名称，如 `serviceRdManagers`；不同部门分别建规则时不复用同一名称。这里共享规则记录条件使用 `operator`，而 Runtime 查询 AST 使用 `op`，不能直接互换。这个例子表达一条规则，不清除其他既有授权；同一用户仍可能从 Owner、其他规则或人工分享取得更大范围。一个人负责多个部门时可配置各部门规则，主体匹配和记录所属部门都要表达。

记录条件可引用 `$USER.<路径>`，但路径必须由当前 Actor 字段元数据允许，例如 `allowActorPolicyReference`；敏感或未声明字段不能引用。公式使用目录中的 `$R<formulaName>`，目录为 `/api/metadata/v1/sharing-rule-formulas`，非空时返回 `name/valueKind/isSystem/referenceCount` 等描述。主体条件内的 `actor.userId/actor.roleIds/actor.orgMemberships` 是受支持变量，不等于当前租户一定有三条同名公式记录；本次测试目录实际为 `[]`。引用 `$R...` 前须取得相应记录，不能自行补造 ID。已有只读系统公式沿其管理描述复用；组织成员关系不转换成每个部门一条公式或枚举全部用户的 Share 行。浏览器不执行公式表达式。

管理页面保存后使用服务端返回值重新显示。未知历史条件应保留并说明无法编辑，不能静默清空；读取目录失败也不能解释成“没有任何限制”。验证这类规则时，可对照“同部门有角色、其他部门有角色、同部门无角色”在同一记录查询和修改中的结果，避免只验证按钮显示。

## 单条记录的人工分享

人工分享适合把某条申请交给具体协作人，不需要为每次协作新增角色。以下路径共同使用前缀 `/api/data/v1/entities/{entityCode}/records/{recordId}/shares`：

| 请求 | 用途 |
| --- | --- |
| `GET /capability` | 读取 `supportsManualSharing/manualSharingEnabled/canManageManualShares/canGrantUpdate/canGrantDelete/pausedManualShareCount` |
| `GET /recipients?page=1&pageSize=25&search=...` | 查询本记录的受管接收人候选 |
| `GET /eligibility?userId=...` | 核对所选人的 `eligible/errorCode/message`；写入时仍再次检查 |
| `GET` | 分页读取已有分享 |
| `POST` | 新增分享，body 为 `{userId, readable, updateable, deleteable}` |
| `PATCH /{shareId}` | 修改指定分享，使用同一请求形状 |
| `DELETE /{shareId}` | 撤销指定分享 |

按 capability 组织操作，不把“记录可编辑”直接当成“可以分享或授予删除”。分享行的 `paused` 和 `shareCause/teamRoleName` 也要保留含义；并非所有来源的行都是人工分享。关闭人工分享与删除全部历史分享不同，恢复开关后按平台实际状态显示。接收人还须满足对象、字段等业务权限，分享不会自动替他补齐。

## Owner 转移与业务交接

`POST /api/data/v1/entities/{entityCode}/records/{recordId}:transferOwner` 的 body 为 `{ownerId}`，结果为 `{recordId, ownerId}`。编排 callable `runtime.records.transferOwner` 使用 `{entityCode, recordId, ownerId}`。普通 create/update/batchUpdate 不接受用 `ownerId` 进行转移。

通用转移要求操作者具备对象 Edit，且是当前 Owner 或显式持有 `platform.entity.record.manage`；新 Owner 必须是本租户活跃成员，并拥有该对象 Read。共享带来的可见或可编辑范围、管理员角色名称，均不能替代这项资格。直接 HTTP 入口还有自己的调用权限；编排入口继续执行相同业务校验。

平台在服务端以旧 Owner 作并发条件，并沿记录 Trigger 和历史链路执行；HTTP body 不接受调用者自造的 expectedOwnerId。冲突后重新读取再处理。Owner 转移不会自动改业务负责人、调整群成员或迁移关联记录，这些属于企业交接操作。历史查询 `/history` 可以返回 `OwnerTransfer`，旧值与新值继续受读取和脱敏限制。

例如“维修人员离岗交接”可以先由业务操作核对接任人职责，再转移适用记录的 Owner，并按业务需要修改负责人字段；通用转移成功本身不代表整项交接已经完成。
