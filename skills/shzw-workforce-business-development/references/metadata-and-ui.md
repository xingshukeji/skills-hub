# 元数据驱动的业务能力与前端

产品事实：Workforce；涉及 Runtime、统一认证或平台 API 时沿该能力实际所有者核对。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

按“配置 → 平台解析与授权 → 有效描述 → 页面/工具”接入。HTTP 路径与响应见[业务 API](business-api.md)。

## 读配置定义，还是读有效描述

设计页维护配置，业务页消费当前用户的有效描述。

| 开发目的 | 可用入口与关键内容 |
| --- | --- |
| 设计标准 | entity-design 的 fieldTypes、presentationDefaults、presentationKinds；需要设计权限 |
| 业务表单 | `describeBusinessObject(entityCode)` 的字段、视图与 object.access |
| 数据与显示 | query 的 fields/records/metadataRevision，以及按需返回的 cellStyles/viewRevision |
| 选项候选 | `businessFieldOptions(entityCode, fieldApiName, {page, pageSize, search})`，仅选项类型 |
| 命名视图 | `businessListViewQuery(entityCode, viewName)` 返回的 query |
| 筛选器 | `businessQueryCapabilities()` 的操作符与值模式 |

字段身份分别为元数据 fieldApiName、Runtime 描述 apiName、记录 values 的键。选项管理项用 id/name，业务候选用 value/label/color。普通候选查询使用业务入口。

## 自定义权限也是业务声明

对象/字段权限由元数据派生；专有动作声明 custom.*。以下是包资源，替换稳定 ID 后使用，不是管理 HTTP 请求：

```json
{
  "id": "<分派权限的稳定ID>",
  "kind": "AuthenPermission",
  "values": {
    "name": "custom.maintenance.dispatch",
    "label": "维修工单分派",
    "isMuted": false
  }
}
```

name 用于授权，label 用于显示。权限集引用名称，处理器检查权限与业务状态；声明不会生成处理器或数据授权。分配见[授权](authorization.md)，全员来源见[初始化基础](initialized-platform.md)。

## 字段语义与推荐呈现

type 决定值与约束，presentation 决定录入和展示；旧 uiType 不再是可写类型。以下为已绑定多选字段的有效呈现摘录：

```json
{
  "type": "MultiPicklist",
  "valuePicklistId": "<选项集ID>",
  "presentation": {
    "editor": {"kind": "multiSelect", "searchable": true},
    "cell": {"kind": "tags", "maxVisibleItems": 3, "expandable": true},
    "detail": {"kind": "tags", "collapsed": false}
  }
}
```

editor/cell/detail 对应录入/列表/详情；显示 3 项不限制保存数量，省略时继承类型默认。绑定或类型错误需修复模型。

常见 editor：Text 的 text/email/phone/url，Boolean 的 booleanSelect/checkbox/switch，Picklist 的 select/radio，MultiPicklist 的 multiSelect/checkboxGroup，UserRef 的 userSelect，Lookup 的 recordSelect。以目标 kind/参数为准；邮箱样式、金额格式和显示范围不产生业务校验、币种或存储约束。

### 默认与覆盖如何保存

有效顺序为“类型默认 → 字段覆盖 → 当前视图 cell 覆盖”；视图不改变 editor/detail 或其他视图。

| 写入意图 | 当前契约 |
| --- | --- |
| 创建时使用默认 | 省略 `presentation` 或传 null；不保存一份默认快照 |
| PATCH 不修改显示 | 省略 `presentation`；传 `{}` 也没有显示差量 |
| 清除字段全部覆盖 | `presentation: null`，恢复当前类型默认 |
| 只恢复列表显示继承 | `presentation: {cell: null}`，保留其他节点覆盖 |
| 修改一个参数 | 只提交该路径；显式 false、0、空数组不能当成未提供，是否合法仍由参数合同决定 |
| 更换 kind | 清除旧 kind 专属参数，在新 kind 默认上应用本次参数；不改变其他节点 |

多选字段切换复选框组的 PATCH 差量：

```json
{"presentation": {"editor": {"kind": "checkboxGroup"}}}
```

PATCH `/api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}` 仅提交允许编辑的差量，不携带旧 kind 专属参数。管理表单读 presentationOverrides，业务组件读有效 presentation；保存/导出仅保留显式覆盖。回写有效值会固化默认，清除覆盖才恢复继承。

## 下拉选项、引用候选与稳定值

BizPicklist/BizPicklistItem 声明集合/成员，字段通过 valuePicklistId 绑定。name 是保存值，label/color 用于显示，isActive 控制启用；共享选项变更影响所有引用字段。新增项用 `POST /api/metadata/v1/picklists/{picklistId}/items`：

```json
{"name": "urgent", "label": "紧急", "color": "#DC2626", "isActive": true}
```

业务保存候选 value，例如 `priority__c: "urgent"`；MultiPicklist 保存规范名称数组，如 `["urgent", "followUp"]`，不保存 label、选项 ID 或逗号文本。

字段 options 接口支持分页/搜索，只用于 Picklist/MultiPicklist。查询 fields[].options 可能不完整，describe 没有同形数组；分页未命中不能清空已选值。保留历史/停用值与主选项顺序，按写入合同处理。

Lookup 按 Runtime 的 referenceTargetEntityCode 查询目标并保存 recordId；元数据 targetEntityApiName 属于定义层。UserRef 用受控成员资料展示，扩展字段按 runtime.User 权限读取。目录可见不保证引用可写或动作合格，最终由写入校验。

### 记录类型的选项范围

记录类型仅提供选项范围元数据，不自动选择类型、分派表单、授权或限制 Runtime 写入。业务需消费候选；强制规则还需服务端校验。

管理读取 `GET /api/metadata/v1/entities/{entityCode}/record-types/picklist-options?recordTypeId=...`，fields 项含 fieldId/fieldApiName/usesAllActiveOptions/options，选项含 id/name/label/color/isEnabled。该入口需设计权限，普通表单通过受管业务入口消费所需范围。

写入 picklistFields 项为 `{fieldId, usesAllActiveOptions, enabledOptionIds}`：true + 空 ID 数组继承全部启用项；false + 空数组是显式空范围。ID 用于配置，name 用于记录，顺序沿主选项。

picklistFields 整组替换，省略才不修改。下面的项目辅助函数保留其他字段配置，只改变指定字段；输入完整管理 fields，返回 PATCH 差量：

```js
export function replaceRecordTypeOptionScope(fields, fieldId, enabledOptionIds) {
  if (!fields.some(field => field.fieldId === fieldId)) {
    throw new Error('Field is not in this record type configuration');
  }
  return {
    picklistFields: fields.map(field => {
      if (field.fieldId === fieldId) {
        return { fieldId, usesAllActiveOptions: false, enabledOptionIds: [...new Set(enabledOptionIds)] };
      }
      return {
        fieldId: field.fieldId,
        usesAllActiveOptions: field.usesAllActiveOptions,
        enabledOptionIds: field.usesAllActiveOptions
          ? []
          : field.options.filter(option => option.isEnabled).map(option => option.id),
      };
    }),
  };
}
```

服务端校验字段/选项归属；分别验证配置回读与业务消费。

## 视图、条件与前端列表

视图配置 fieldNames/conditions/sort、标签与呈现覆盖、cellColorRules；关联路径从 view-field-catalog 取得。条件用 fieldName/operator/value，Runtime 用 field/op/value。

视图保存的是完整共享配置，不是保存者的字段授权。实际读取时使用当前用户的对象、字段和记录权限，列表只显示本次 query 响应中可读的字段；不能把配置字段目录补成未获权的列。已保存视图仍可包含其他用户无权读取的字段，例如同一视图对甲显示姓名和金额，对乙只显示姓名；切换身份或编辑其他设置不得删除原定义。不可读字段的颜色规则不执行；若筛选或排序依赖不可读字段，查询拒绝并保留原条件，不能静默去掉条件扩大结果。目录只反映当前主体可选字段，不代表保存定义的完整范围或授予数据权限；权限变化后重新读取并验证目标版本的实际行为。

`businessListViewQuery` 返回的 query 才是查询 body，外层 filter 是说明文本。附加条件与原条件合并，按需覆盖分页，保留排序与列。筛选器按查询能力选操作符：无值操作不收值，集合操作收数组；maxCollectionValues 为 null 表示没有项数门槛。

视图转换的 query.presentation 实测为 null。需显示覆盖/填色时加入 `presentation: {viewName, viewRevision: views.metadataRevision}`，修订取 views 接口。平台返回 cellStyles（recordId → fieldName → colorToken）和 viewRevision；未命中可为空对象，前端直接渲染。旧修订 409 时重读配置并保留输入。

视图筛选/隐藏列不构成数据授权，视图修订也不等于记录 API 支持 If-Match。

## 前端与工具如何消费有效访问

object.access 提供 allowedActions、readableFieldApiNames、creatableFieldApiNames、editableFieldApiNames、originalReadableFieldApiNames；Runtime 字段提供 readOnly、allowRuntimeCreate、allowRuntimeUpdate、isSystemGenerated、masked。创建/编辑表单分别取对应能力，只写本次变动且可写的字段，满足约束与有效部署状态。

敏感原值从普通 values 省略，显示 `maskedDisplayValues[fieldApiName]`。按 originalReadableFieldApiNames 向记录 POST /original-values 显式请求 1–50 个直接敏感字段；入口检查字段/记录读取权并审计。普通查询仍遮罩，禁止回写占位值或无意扩散原值。

历史敏感差异用 oldDisplayValue/newDisplayValue，普通差异可用 oldValue/newValue，并结合 hasOldValue/hasNewValue。未返回与 null 分别处理。

数值按 precision/scale、时间按 temporalContractId 和[地区上下文](regional-context.md)解释；页面与工具保持同一值语义。公共组件仅用已导出入口；自定义页面映射有效描述，未知 kind 保留可理解的只读显示。

## 配置归属与一次业务变更

包定义、租户覆盖、记录值分别维护；按 management 提交可编辑差量，按 deployment 消费有效定义，见[生命周期](lifecycle.md)。改标签保留 API 名和选项 name。

缓存区分目标、租户、主体，随修订与权限变化刷新；切换上下文后丢弃旧响应，不把管理员描述共用于其他主体。
