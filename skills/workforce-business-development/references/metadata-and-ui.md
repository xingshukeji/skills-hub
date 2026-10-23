# 元数据驱动的业务能力与前端

按“配置定义 → 平台解析与授权 → 有效描述 → 页面/工具消费”接入元数据。本文覆盖权限声明、字段呈现、候选、视图与有效访问；接口、触发器和应用配置见[系统集成](integration.md)、[自动化](automation.md)及[应用交付](shared-services.md)。

## 读配置定义，还是读有效描述

设计页面维护配置，业务页面使用当前用户可见的有效描述；两者的权限、响应和保存行为不同。

| 开发目的 | 可用入口与关键内容 |
| --- | --- |
| 设计字段及推荐显示 | `GET /api/metadata/v1/standards/entity-design`：`fieldTypes`、`presentationDefaults`、`presentationKinds`；设计管理权限入口 |
| 组织普通业务页面 | `XRainRuntimeClient.describeBusinessObject(entityCode)`：对象、字段、视图及当前 `object.access` |
| 读取本次数据与显示描述 | 记录查询返回的 `fields`、`records`、`metadataRevision`，以及请求相应能力时的 `cellStyles`、`viewRevision` |
| 加载选项字段候选 | `businessFieldOptions(entityCode, fieldApiName, {page, pageSize, search})`，仅 Picklist/MultiPicklist |
| 使用命名视图 | `businessListViewQuery(entityCode, viewName)`，读取返回的 `query` 再用于记录查询 |
| 配置选项集和记录类型 | `/api/metadata/v1/picklists`、`/entities/{entityCode}/record-types` 等管理入口 |
| 构建筛选器 | `businessQueryCapabilities()`，按字段类型取得操作符与值模式；普通用户不需要设计管理权 |
| 组织自定义操作 | `context()` 的有效权限、应用准入，以及业务入口的动作资格 |

路径相对 XRain origin，变量编码为单个 segment。普通用户候选查询使用业务接口，无需元数据管理权。

按入口适配字段身份：元数据用 `fieldApiName`，Runtime 字段描述用 `apiName`，记录在 `values` 中按字段 API 名取值；选项管理项用 `id/name/label`，运行候选用 `value/label/color?`。

## 自定义权限也是业务声明

对象与字段的标准权限由有效元数据生成；企业特有动作可声明 `custom.*` 权限。下面是应用包中一项权限资源的示意，ID 需替换为项目已有或生成的稳定身份；它不是权限管理 HTTP 请求：

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

`name` 用于授权与绑定，`label` 用于显示。权限集引用权限名称；专项分配见[业务授权](authorization.md)，全员能力使用[固定集或包的全员声明](initialized-platform.md)。

服务处理器检查该权限与业务状态，页面据有效能力展示入口。声明本身不注册分派处理器，也不授予工单、字段或记录范围权限。

## 字段语义与推荐呈现

`type` 决定真实值、基数、绑定、校验和查询能力；`presentation` 决定怎样录入与阅读。当前使用 `type` 与 `presentation`，不再将旧 `uiType` 当作第二种可写字段类型。

已绑定选项集的多选字段，其有效呈现摘录如下（省略其他属性及不适用的 null 参数）：

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

`editor/cell/detail` 分别用于录入、列表和详情。显示 3 项不限制保存数组长度；省略呈现时使用类型默认。缺绑定或类型无效需修复模型，不能退回普通文本框。

典型编辑方式有 Text 的 text/email/phone/url、Boolean 的 booleanSelect/checkbox/switch、Picklist 的 select/radio、MultiPicklist 的 multiSelect/checkboxGroup、UserRef 的 userSelect、Lookup 的 recordSelect。以目标目录支持的 kind 与参数为准。

呈现不改变业务语义：邮箱样式不补齐业务校验，金额格式不决定币种，进度范围不是数据库约束，可空 Boolean 区分 false 与空。值传输见[建模](modeling.md)。

### 默认与覆盖如何保存

有效顺序是“类型默认 → 字段覆盖 → 当前视图的 cell 覆盖”。视图覆盖只影响该视图单元格，字段的 editor/detail 及其他视图保持各自配置。

| 写入意图 | 当前契约 |
| --- | --- |
| 创建时使用默认 | 省略 `presentation` 或传 null；不保存一份默认快照 |
| PATCH 不修改显示 | 省略 `presentation`；传 `{}` 也没有显示差量 |
| 清除字段全部覆盖 | `presentation: null`，恢复当前类型默认 |
| 只恢复列表显示继承 | `presentation: {cell: null}`，保留其他节点覆盖 |
| 修改一个参数 | 只提交该路径；显式 false、0、空数组不能当成未提供，是否合法仍由参数合同决定 |
| 更换 kind | 清除旧 kind 专属参数，在新 kind 默认上应用本次参数；不改变其他节点 |

例如给已有多选字段换成复选框组，对字段 PATCH 的显示差量为：

```json
{"presentation": {"editor": {"kind": "checkboxGroup"}}}
```

字段 PATCH 路径为 `/api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}`，仍受目标资源的管理权限与属性可编辑范围约束。不要同时带上属于 multiSelect 的 `searchable` 等不兼容参数。

管理表单读取 `presentationOverrides`，业务组件读取有效 `presentation`。保存和包导出只保留显式覆盖；回写完整有效值会固化默认。显式设为当前默认值仍是覆盖，清除才恢复继承。

## 下拉选项、引用候选与稳定值

选项集是独立资源，可被多个字段复用。`BizPicklist` 声明集合，`BizPicklistItem` 声明成员，字段通过 `valuePicklistId` 绑定集合。成员的 `name` 是记录中的规范值，`label` 是显示文本，`color` 供支持的组件显示，`isActive` 控制当前启用情况；修改共享主选项会影响使用它的字段。

例如在已有选项集下调用 `POST /api/metadata/v1/picklists/{picklistId}/items`，创建一项：

```json
{"name": "urgent", "label": "紧急", "color": "#DC2626", "isActive": true}
```

普通业务端从字段选项接口取得类似 `{value: "urgent", label: "紧急", color: "#DC2626"}` 的候选，保存 `priority__c: "urgent"`，不保存标签、颜色或选项元数据 ID。MultiPicklist 保存规范名称的 JSON 数组，例如目录已定义相应选项时使用 `["urgent", "followUp"]`，不保存逗号分隔文本，也不按标签或自行转小写猜选项身份。

选项入口 `GET /api/data/v1/entities/{entityCode}/fields/{fieldApiName}/options` 支持 page、pageSize、search，返回 `{page, pageSize, totalCount, items}`。它只支持 Picklist/MultiPicklist；实测 UserRef 返回 400、`platform.data.validation_failed`，说明为 `Options are available only for picklist fields.`。不能给人员或关联字段套用这个调用。

Runtime 查询的 `fields[].options` 可能只有局部结果；元数据 describe 的字段使用 `valuePicklistId` 等定义，不提供同形 options。搜索结果也不是完整值域。分页切换或搜索未命中，不应自动清空已选值。停用或历史无效值需要与“当前可新选的值”分别呈现，沿服务端写入合同处理；不要为了使表单看起来正常，静默丢掉历史数组成员。排序使用目标主选项返回的顺序，不把 label 排序变成新的持久化身份。

Lookup 选择器根据运行字段的 `referenceTargetEntityCode` 查询目标对象，按可读的标签字段展示并保存真实 recordId；元数据字段的 `targetEntityApiName` 是另一层描述。UserRef 可结合受控 `/api/tenant/v1/members` 做人员展示；需要业务 User 字段时按 `runtime.User` 的查询与字段授权读取。目录可见、对象可读、当前引用可写分别判断，最终写入仍由平台校验，不能把目录中所有人员承诺为某个业务动作的合法接收人。

### 记录类型的选项范围

当前记录类型提供选项范围元数据，**不会自动限制通用 Runtime 写入、分派表单、选择默认类型或授予人员权限**。业务若要按类型切换候选，需要明确消费配置；若范围是必须满足的业务规则，还要在对应业务操作中校验。仅隐藏候选不能替代服务端约束。

管理读取：`GET /api/metadata/v1/entities/{entityCode}/record-types/picklist-options?recordTypeId=...`，返回该类型的 `fields`；每项有 `fieldId`、`fieldApiName`、`usesAllActiveOptions` 和带 `id/name/label/color/isEnabled` 的 `options`。这个管理接口需要设计权限，不直接作为普通用户的表单数据源；受管业务入口可提供该场景所需的有效候选。

写入记录类型时，`picklistFields` 每项使用 `{fieldId, usesAllActiveOptions, enabledOptionIds}`。这里 `enabledOptionIds` 是选项元数据 ID，业务记录仍保存选项 name。`usesAllActiveOptions: true` 使用全部当前启用主选项且不携带选定 ID；false 加空数组表示显式空范围，不能退回“全部”。记录类型不另存自己的选项顺序。

`picklistFields` 是整组范围替换：修改其中一个字段时保留其他字段的显式配置；省略该属性才表示不修改。下面的业务辅助函数消费上述管理响应的完整 `fields`，为“修改一个字段的指定子集”准备 PATCH 差量；它不是平台 SDK 方法：

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

以完整配置和选中 ID 生成差量，提交记录类型 PATCH；服务端校验字段与选项归属。恢复全部主选项用 true 和空 ID 数组。分别验证配置回读和业务候选消费。

## 视图、条件与前端列表

视图配置包括 `fieldNames`、`conditions`、`sort`、`fieldLabelOverrides`、`fieldPresentationOverrides` 和 `cellColorRules`。按当前字段目录配置显示、排序、筛选和填色能力；获准的关联路径从 `view-field-catalog` 取得，不自行拼出未授权路径。列标签覆盖只改变该视图的显示名称。

视图配置条件用 `fieldName/operator/value`，Runtime 条件用 `field/op/value`，两者不是同一个 DTO。`businessListViewQuery(entityCode, viewName)` 返回 `{entityCode, entityApiName, viewName, selectedFields, groupBy, filter, query, explain}`；将其中的 `query` 交给 `client.query(entityCode, query)`，按需只覆盖分页等本次参数。外层 filter 是解释文本，不应替代 query.filter。额外业务条件与原条件合并，保留原排序和列定义，不把整份转换响应当作查询 body。

字段显示方式与筛选器也分开：先由类型和查询能力决定操作符、值模式，再选择对应条件输入。无值操作符不显示输入，集合操作符使用真实数组，普通字符串中的逗号不自动拆项。`maxCollectionValues: null` 表示该能力没有项数门槛，不能解释成 0，也不能恢复一个自己设定的 100 项上限。

条件填色由平台按真实查询语义计算。实测视图转换返回的 `query.presentation` 是 null，直接执行只得到数据；要应用视图显示覆盖和填色，读取 `GET /api/metadata/v1/entities/{entityCode}/views` 的 `metadataRevision`，作为查询 `presentation.viewRevision`，并传真实 `viewName`。例如在现有 query 上合并 `presentation: {viewName, viewRevision: views.metadataRevision}`，不写死修订值。

响应 `cellStyles` 按 recordId → fieldName → colorToken 给出样式，并带 `viewRevision`；未命中规则的记录可以对应空对象。浏览器渲染这些结果，不在客户端重写一套数字、日期或空值比较。旧修订实测返回 409、`view_revision_conflict`；读取新配置并保留用户输入。元数据视图的修订机制不代表普通记录 API 支持 If-Match。

视图可用权限、对象访问、字段权限和记录范围分别判断。视图显示哪些列不是字段授权，筛选“本人”也不是记录授权；企业专用页面与通用组件都继续消费服务端实际返回的范围。

## 前端与工具如何消费有效访问

业务描述中的 `object.access` 提供 `allowedActions`、`readableFieldApiNames`、`creatableFieldApiNames`、`editableFieldApiNames`、`originalReadableFieldApiNames` 等有效信息。Runtime 字段描述还包含 `readOnly`、`allowRuntimeCreate`、`allowRuntimeUpdate`、`isSystemGenerated`、`masked` 等实际能力。新增和编辑表单分别使用创建、编辑能力，不用一个 `disabled` 规则代替两者。

写入只包含本次实际修改且允许写入的字段。必填、当前可写性和模型部署状态优先于控件推荐；字段“推荐用下拉框”不证明用户能改它。敏感字段按描述显示脱敏结果，需要原值时沿实际获准入口读取；脱敏占位值不能提交回去，原值不能因换个控件出现在 Tooltip、复制结果或工具参数里。

精确数值使用 `precision`、`scale` 等值语义，日期时间按返回的 `temporalContractId` 和时间合同解释，不从字段标签猜单位、时区或精度。工具返回与页面展示可以不同，但字段身份、选项值、金额单位和业务动作含义应一致。

日期输入还要消费当前用户的 regionalContext；业务日期范围、显示地区与周期安排的区别及接口示例见[国际化与时间上下文](regional-context.md)。人员候选和部门条件见[组织与协作](organization-and-collaboration.md)，避免把目录可见性当成记录授权。

复用公共包已导出的组件，自定义页面自行映射有效描述。管理 UI 组件未必公开导出，元数据也不会自动改造任意 React 页面。未识别的 kind 保留可理解的只读显示并指出缺口。

## 配置归属与一次业务变更

应用包定义、租户覆盖与记录值分别维护。配置表单按资源管理描述提交可改属性的差量，定义只读不代表记录只读。跨环境沿用稳定身份，改标签不换字段 API 名或选项 name。

management、deployment、删除影响和安装恢复见[生命周期](lifecycle.md)；编辑与预览需区分候选定义和当前有效定义。

有效描述缓存区分目标、租户和主体，随元数据修订与权限变化刷新。切换租户、账号或记录后丢弃旧响应，不能共享管理员配置作为所有人的业务描述。
