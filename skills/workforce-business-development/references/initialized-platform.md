# 已初始化的平台基础与业务扩展

用下述平台基础直接选择扩展位置，目标回读用于确认状态、租户修改和版本差异。例如全员报修可复用自动权限来源、User 和记录所有权。

## 已有资源和扩展位置

| 已有基础 | 稳定身份或默认关系 | 本次业务通常补在哪里 |
| --- | --- | --- |
| 全体员工权限集 | `xrain-all-employees`，有效租户业务成员自动适用 | 单租户公共权限增补其本地条目；可安装应用声明自己的全员权限集 |
| 租户管理员 | `tenant_admin` 角色关联 `xrain-admin` 权限集 | 复用已有管理身份；业务职责用自己的角色和权限表达 |
| 业务人员对象 | `runtime.User`；对象 ID `00457d0cb59a8281762b` | 人员字段用 `UserRef`；业务扩展通过受支持的 User 扩展或关联业务对象实现 |
| 记录身份、Owner 与审计 | 标准 `id/ownerId/createdById/createdAt/updatedById/updatedAt` 等由平台提供 | 企业负责人、提交人等含义不同时再增加业务字段 |
| 对象和字段权限目录 | 有效元数据派生标准权限 | 权限集引用已有权限名；企业专有动作声明 `custom.*` 权限 |
| 当前主体条件变量 | `actor.userId`、`actor.roleIds`、`actor.orgMemberships` | 共享规则使用当前主体事实；独立公式记录和组织关系读取实际租户目录 |
| 租户默认选项 | `customerStage/recordStatus/priority/fieldDataType/httpInterfaceKind` | 语义一致的租户本地模型可复用；应用包遵守包内资源引用合同 |
| Workforce 协作资源 | 相应平台资源包安装后提供 Task、频道和员工智能体等模型 | 复用已安装资源与公共服务；业务包只增加自己的事实 |

仅核对本次需要的权限、选项、包安装和外部配置，预置名称不保证各目标状态相同。

## 全员基础权限：自动归属与增补

`xrain-all-employees` 的显示名称为“全体员工”，属于当前业务租户的系统权限集。适用主体必须通过租户成员准入，并在目标业务库有同 ID 的 active `User`。现有成员和后续加入的成员使用同一规则；Host 用户、其他租户用户、匿名用户、停用成员不自动适用。满足同样准入条件的自动化执行用户可适用；`applicationId` 非空的应用机器人不属于这个自动受众，不能按显示名称或岗位猜测。

平台动态合并固定集、已启用的全员包集、角色和直接分配来源；无需逐人写 `PermissionSetUser`、创建全员角色或修改 JWT。固定集的 `users/roles` 为空仍可有自动受众，同一权限也可有多个来源。

### 已有基础权限意味着什么

当前基础项包含 Runtime 查询、字段选项、读写、批量、计数、去重和导出入口，以及 `api.xrain.metadata.accessibleObjects.list`、`tenantApi.members.profiles.read`、`tenantApi.settings.self.manage`、`platform.aiInfra.automation.manage`；不覆盖整个接口目录。

接口入口通过后，仍检查对象、字段、记录范围、脱敏、实际执行身份和业务规则。例如已有 `api.xrain.runtime.records.export` 不等于能导出任意对象；仍须对象 export 和对应读取权限。完整元数据设计、安全治理、`record.readAll`、文件调用和业务自定义权限不能由“全员基础”推导出来。记录分享、历史读取沿其实际服务授权，不为它们猜造独立基础权限名。

租户安全初始化补充缺少的基础条目，保留已有条目的 deny、mute、范围、有效期及租户额外条目。删除产品基础条目后，再次初始化可能补回；业务初始化不应通过删除基础条目来实现自己的权限策略，也不应覆盖整个集合或重置已维护的授权效果。

### 单个租户的公共业务权限

已声明的 `custom.maintenance.submit` 若适用于当前及未来全体员工，可增量加入固定集；仅限维修部门时放入专项权限集。

管理入口相对 XRain origin，使用项目已有的目标租户管理会话：

| 用途 | 请求 |
| --- | --- |
| 读取固定集 | `GET /api/service/authen/v1/security/permission-sets/xrain-all-employees` |
| 取得实际权限身份 | `GET /api/service/authen/v1/security/permissions/catalog` |
| 增量添加权限 | `POST /api/service/authen/v1/security/permission-sets/xrain-all-employees/permissions` |

最后一个请求的 body：

```json
{"names":["custom.maintenance.submit"]}
```

按稳定名称读取并确认 `permissionSetName/isSystem/status/automaticAudience`，与现有 `permissions` 比较后仅添加缺项。POST 为增量添加；已有 deny/mute 或条件限制的条目不属于缺项，保留其配置。

固定集的名称、删除和停用受系统控制，本地权限条目可维护。缺失或身份冲突应排查初始化，不另建同名普通集；用户/角色绑定接口拒绝手工分配固定集。

### 随应用包交付的全员权限

应用拥有并随版本变化的能力，使用包自己的 `AuthenPermissionSet`，声明 `assignmentAudience: "allEmployees"`，成员仍引用本包权限集。下例是三个包资源片段；占位 ID 由本项目生成器分配，放入已有 `records`，不是完整安装请求：

```json
[
  {
    "id":"<本包业务权限ID>",
    "kind":"AuthenPermission",
    "values":{"name":"custom.maintenance.submit","label":"发起报修"}
  },
  {
    "id":"<本包权限集ID>",
    "kind":"AuthenPermissionSet",
    "values":{
      "name":"maintenanceEmployeeBasics",
      "label":"员工报修基础能力",
      "isMuted":false,
      "assignmentAudience":"allEmployees"
    }
  },
  {
    "id":"<本包权限条目ID>",
    "kind":"PermissionSetItem",
    "values":{
      "refPermissionSetId":"<本包权限集ID>",
      "refPermissionName":"custom.maintenance.submit"
    }
  }
]
```

对应权限集组件的租户安装绑定配置为以下片段；它不是包 `values`，也不是完整安装 body：

```json
{"allEmployeesEnabled":true}
```

`assignmentAudience` 仅支持 `explicit/allEmployees`，缺失按 explicit。新安装的全员声明，以及从 explicit 改为 allEmployees，按目标 true 进入预检；平台要求租户管理员确认覆盖当前和未来员工的安全影响，只有安装与绑定提交成功后生效。这是平台安装合同，业务开发不另设一套审批流程。存量全员声明缺少开关按 false；升级、重试和同一安装重引入保留已明确关闭的 false。

运行时将启用、有效且未 mute 的包权限集作为独立来源合并，不把包条目复制进 `xrain-all-employees`。包不能声明该保留名，不能用 `PermissionSetItem` 写固定集或其他包的权限集。卸载或退役退出该包来源；本地或其他角色仍可能提供相同权限。安装与恢复的实际调用见[资源生命周期](lifecycle.md)。

“全员”覆盖整个目标租户的有效员工，不仅是已获准进入某应用的人员。应用准入、对象字段和记录范围仍各自成立。需要“全员可发起、只看本人”时，分别配置通用动作、必要数据权限和 Owner/共享范围，不以全员接口权限代替记录授权。

## 人员对象、标准字段与派生权限

受保护 User 是可直接引用的平台对象，不是铵帮专有模型。当前包格式中的人员字段 `values` 可以这样声明：

```json
{
  "entityDefinitionId":"<本应用对象ID>",
  "fieldApiName":"assigneeId__c",
  "label":"维修负责人",
  "type":"UserRef",
  "targetEntityDefinitionId":"00457d0cb59a8281762b",
  "nullable":true
}
```

这是当前包合同允许的固定系统对象引用例外，不能推广成可引用任意外部对象 ID。业务负责人字段不自动成为记录 Owner。平台 User 已有 `name/employeeNo/companyCode/departmentCode/managerUserId/isActive/isAI/applicationId/jobTitle/jobDescription` 等人员属性；姓名展示、候选和组织规则按[人员与协作](organization-and-collaboration.md)的公开接口使用。邮箱、电话和扩展属性仍受各自读取限制。

复用记录身份、租户、Owner 和审计字段；“代客户提交的业务申请人”等独立事实另设字段。包定义不重复声明标准审计字段，也不写入具体 tenantId、Owner 或执行历史。

有效对象/字段元数据会生成标准权限。引用目录中的实际名称即可：对象动作有 read/create/edit/delete/export，业务字段动作有 read/create/edit，标准字段只有 read；不存在字段 export。可安装包用 `PermissionSetItem.refPermissionName` 引用允许的派生权限，不重新声明同名 `AuthenPermission`。权限目录存在与已经授予业务用户是两件事。

## 默认选项、主体变量与公式目录

租户创建会准备以下默认选项集；表中的名称是识别已有资源的依据，实际标签、颜色、启停和新增项读取当前租户：

| 选项集 | 初始选项名称 | 使用时的含义 |
| --- | --- | --- |
| `customerStage` | prospect、qualified、negotiation、active、closed | 客户阶段；初始 closed 为停用选项，不能仅按清单作为当前候选 |
| `recordStatus` | active、inactive、archived | 通用记录状态词汇，不会自动实现归档或生命周期 |
| `priority` | low、medium、high、urgent | 优先级词汇，不会自动决定排序或调度 |
| `fieldDataType` | Text、LongText、Number、Money、Date、DateTime、Boolean、Picklist | 初始化字典，不是完整字段类型能力目录；类型能力仍读设计标准 |
| `httpInterfaceKind` | raw、orchestrated | 对应原始 HTTP 请求与业务编排接口 |

管理读取为 `GET /api/metadata/v1/picklists?page=1&pageSize=50` 和 `GET /api/metadata/v1/picklists/{picklistId}/items?page=1&pageSize=50`，分页后按 name 解析当前 ID。业务表单的可选项用字段 options 接口，不能以管理字典替代经过字段权限和有效状态过滤的候选。

默认选项初始化只添加缺失项，不重置已有标签、颜色或启停；它挂在租户创建及相应恢复中，普通登录不会恢复管理员已删除的默认选项。本地模型语义相同时可引用现有选项集；当前可安装包要求字段选项引用包内选项集，不能把某租户的默认选项 ID 塞进包里。平台已有数据与可移植资源引用范围是不同问题。

主体条件使用 `actor.userId/actor.roleIds/actor.orgMemberships`。它们与 `$R<formulaName>` 公式引用不同：后者需要目录中的实际记录，2026-10-23 测试租户的 `GET /api/metadata/v1/sharing-rule-formulas` 返回 `[]`，不能因初始化定义含系统公式就假定目标已有记录。已有系统公式只读复用；业务仍需配置共享规则，见[组织与记录协作](organization-and-collaboration.md)。

## 应用基础、环境配置与示例数据

租户管理员 `tenant_admin → xrain-admin` 与 Host 平台 `sysadmin` 属于不同上下文。管理员基础覆盖产品管理能力，但不表示所有新增动态对象权限永远自动补回，也不表示文件服务调用已获准。`platform.files.invoke` 虽在目录登记，仍需按服务用途显式授权；Workforce 定义管理权限也不能推导成全员已具备。

Workforce 的 `workforce__task__c`、`workforce__chatChannel__c`、`workforce__taskChannel__c`、`workforce__employeeAgent__c` 来自对应资源包。已安装时复用公共服务；只有 npm 宿主包存在，不表示租户模型、应用选用和权限已经就绪。参考[公共服务](shared-services.md)和[铵帮案例](anbang.md)。

连接器凭据、邮箱、文件主体、助手订阅、应用绑定及自动化执行成员需核对目标配置；内置变量也可能无值。保留已有设置，开发环境的 guest、示例客户、组织和批量人物不作为生产必建数据。
