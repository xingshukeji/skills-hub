# 已初始化的平台基础与业务扩展

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

先复用下列基础，再回读目标状态与租户差异后增补。

## 已有资源和扩展位置

| 已有基础 | 稳定身份或默认关系 | 本次业务通常补在哪里 |
| --- | --- | --- |
| 全体员工权限集 | `xrain-all-employees`，有效租户业务成员自动适用 | 单租户公共权限增补其本地条目；可安装应用声明自己的全员权限集 |
| 租户管理员 | `tenant_admin` 角色关联 `xrain-admin` 权限集 | 复用已有管理身份；业务职责用自己的角色和权限表达 |
| 业务人员对象 | `runtime.User`；对象 ID `00457d0cb59a8281762b` | 人员字段用 `UserRef`；业务扩展通过受支持的 User 扩展或关联业务对象实现 |
| 记录身份、Owner、审计与删除状态 | 普通对象自带 11 个系统管理字段，见[对象基础](object-foundation.md) | 企业负责人、申请人等含义不同时再增加业务字段 |
| 对象和字段权限目录 | 有效元数据派生标准权限 | 权限集引用已有权限名；企业专有动作声明 `custom.*` 权限 |
| 当前主体条件变量 | `actor.userId`、`actor.roleIds`、`actor.orgMemberships` | 共享规则使用当前主体事实；独立公式记录和组织关系读取实际租户目录 |
| 租户默认选项 | `customerStage/recordStatus/priority/fieldDataType/httpInterfaceKind` | 语义一致的租户本地模型可复用；应用包遵守包内资源引用合同 |
| Workforce 协作资源 | 相应平台资源包安装后提供 Task、频道和员工智能体等模型 | 复用已安装资源与公共服务；业务包只增加自己的事实 |

预置名称不保证目标当前状态相同，只核对本次所需资源。

## 全员基础权限：自动归属与增补

`xrain-all-employees`（全体员工）适用于通过租户成员准入、且业务库有同 ID active User 的主体，包括满足条件的自动化执行用户。Host、跨租户、匿名、停用成员及 applicationId 非空的应用机器人不自动适用。

平台动态合并固定集、已启用全员包集、角色和直接来源，无需逐人写 PermissionSetUser、创建全员角色或修改 JWT；users/roles 为空仍可有自动受众。

### 已有基础权限意味着什么

基础包含 Runtime 查询/选项/读写/批量/统计/导出入口，以及 api.xrain.metadata.accessibleObjects.list、tenantApi.members.profiles.read、tenantApi.settings.self.manage、platform.aiInfra.automation.manage。它不授予全部数据、设计管理、安全治理、record.readAll、文件或自定义业务权限；例如导出仍需对象 export 与读取权。

初始化只补缺项，保留 deny/mute/范围/有效期和租户额外条目。被删的产品基础项可能再次补回，业务授权用增量配置，不覆盖整个集合。

### 单个租户的公共业务权限

如 custom.maintenance.submit 面向当前及未来全员，可增量加入固定集；仅限某部门则用专项集。目标租户管理入口：

| 用途 | 请求 |
| --- | --- |
| 读取固定集 | `GET /api/service/authen/v1/security/permission-sets/xrain-all-employees` |
| 取得实际权限身份 | `GET /api/service/authen/v1/security/permissions/catalog` |
| 增量添加权限 | `POST /api/service/authen/v1/security/permission-sets/xrain-all-employees/permissions` |

最后一个请求的 body：

```json
{"names":["custom.maintenance.submit"]}
```

回读 permissionSetName/isSystem/status/automaticAudience 和 permissions，只添加缺项；受限条目不是缺项。固定集身份、删除/停用受系统控制，不能手工分配给用户/角色；缺失或冲突应修复初始化，不新建同名普通集。

### 随应用包交付的全员权限

应用能力使用本包 AuthenPermissionSet，声明 assignmentAudience=allEmployees，条目引用本包集。以下资源放入 records，ID 由项目生成器分配，不是安装请求：

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

对应组件的租户安装绑定片段（不是包 values）：

```json
{"allEmployeesEnabled":true}
```

assignmentAudience 支持 explicit/allEmployees，缺省 explicit。新全员声明按 true 预检，须完成平台要求的租户管理员影响确认与安装绑定后生效；存量缺开关按 false，升级/重试/重引入保留显式 false。这是平台合同，不额外增加开发审批。

有效、启用且未 mute 的包集独立合并，不复制进固定集。包不得声明 xrain-all-employees，或用 PermissionSetItem 写固定集/其他包集；卸载退役只退出本包来源。调用见[生命周期](lifecycle.md)。

全员覆盖整个租户的合格员工，应用准入与数据授权仍独立。“全员发起、只看本人”分别配置动作、字段与 Owner/共享范围。

## 人员对象、标准字段与派生权限

包内 UserRef 的 values 示例：

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

该固定 User 引用是包合同例外，不允许任意外部 ID；业务负责人不自动成为 Owner。User 已有 name/employeeNo/companyCode/departmentCode/managerUserId/isActive/isAI/applicationId/jobTitle/jobDescription 等属性，按[人员接口与字段权限](organization-and-collaboration.md)读取。

标准记录字段见[对象基础](object-foundation.md)，包不重复声明；租户来自可信上下文。独立申请人、审批时间等另建业务字段。

元数据派生对象 read/create/edit/delete/export、业务字段 read/create/edit、标准字段 read；无字段 export。包用 PermissionSetItem.refPermissionName 引用目录中的派生权限，不重复声明 AuthenPermission；目录存在不等于已授予。

## 默认选项、主体变量与公式目录

租户创建准备以下选项集；按 name 识别，标签、颜色与启停读取目标状态：

| 选项集 | 初始选项名称 | 使用时的含义 |
| --- | --- | --- |
| `customerStage` | prospect、qualified、negotiation、active、closed | 客户阶段；初始 closed 为停用选项，不能仅按清单作为当前候选 |
| `recordStatus` | active、inactive、archived | 通用记录状态词汇，不会自动实现归档或生命周期 |
| `priority` | low、medium、high、urgent | 优先级词汇，不会自动决定排序或调度 |
| `fieldDataType` | Text、LongText、Number、Money、Date、DateTime、Boolean、Picklist | 初始化字典，不是完整字段类型能力目录；类型能力仍读设计标准 |
| `httpInterfaceKind` | raw、orchestrated | 对应原始 HTTP 请求与业务编排接口 |

管理读 `/api/metadata/v1/picklists` 及 `/{picklistId}/items`，传 page/pageSize，按 name 解析 ID。业务表单用字段 options，取得按权限与状态过滤的候选。

初始化仅补缺项，保留标签/颜色/启停；租户创建及恢复触发，普通登录不补回已删项。本地模型可复用同义选项集，可安装包仍须引用包内选项，不能绑定某租户默认 ID。

actor.userId/actor.roleIds/actor.orgMemberships 是主体变量；$R 公式必须已有实际目录记录，不能由变量名推断。共享配置见[组织与协作](organization-and-collaboration.md)。

## 应用基础、环境配置与示例数据

tenant_admin → xrain-admin 与 Host sysadmin 属于不同上下文。管理基础不保证新增动态授权自动补回；platform.files.invoke 和 Workforce 定义管理等仍按用途授权。

workforce__task__c、workforce__chatChannel__c、workforce__taskChannel__c、workforce__employeeAgent__c 来自资源包，安装状态与 npm 宿主依赖分别确认，见[公共服务](shared-services.md)。凭据、邮箱、助手选用和执行成员读取实际配置；示例客户、组织、guest 或批量人物不作为生产必建数据。
