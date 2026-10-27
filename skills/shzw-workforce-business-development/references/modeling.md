# 建模与数据开发

## 把业务含义变成平台模型

先按[对象自带能力](object-foundation.md)确定平台已有实现，只为独立业务事实新增模型。受保护 User、默认选项和派生权限见[初始化基础](initialized-platform.md)；ERP/CRM 已维护的事实直接[接入原 API](integration.md)。混合模型明确来源系统、租户、记录 ID 和可编辑方。

例如设备、维修申请和处理记录是否拆分，取决于独立查询、多次处理与追溯需求。下面是常见类型；完整能力与传输格式以目标设计标准和字段描述为准。

| 业务数据 | 字段选择与语义 |
| --- | --- |
| 名称、编号 | `Text`，明确长度；业务号与标准 id 分开，编号生成与唯一性按目标实际支持的合同实现 |
| 说明、原文、复杂结构快照 | `LongText`；需独立筛选、关联或授权的属性适合单独字段 |
| 数量、度量、金额 | `Number`、`Decimal`、`Money`；单位、精度与舍入属于业务含义，读取目标字段描述确定传输方式 |
| 日期或发生时刻 | `Date` 表达日历日期；`DateTime` 按目标时间格式约定表达时刻，不把日期自动补成某时区午夜 |
| 开关 | `Boolean`，区分 false 与未知/未填写 |
| 固定业务选项 | `Picklist`、`MultiPicklist`，绑定选项集；显示 label，保存 value |
| 关联另一业务对象 | `Lookup`，声明真实目标对象；一对多通常由子对象引用父对象表达 |
| 关联人员 | `UserRef` 指向平台受保护 User；选择目标租户的合法候选，人员档案与登录身份可以有不同用途 |

Number/Decimal/Money 按当前协议传精确文本；算法或外部接口另行转换，避免浮点精度损失。Date 保存日历日期，DateTime 按[时间合同](regional-context.md)传时刻。选项保存 value、展示 label。

`presentation` 只控制 editor/cell/detail，不改变值或授权；记录类型范围还需业务端消费与校验，见[元数据与前端](metadata-and-ui.md)。多对多有独立属性或历史时可建中间对象；跨包/跨应用引用按目标支持范围处理。

## 元数据、记录与资源包

`BizObject/BizField` 声明模型，记录 API 保存实例。模型通过设计入口或资源包维护；包内 values 不是管理 HTTP 请求。包管理的模型沿用包源码或受支持扩展方式。

包源码的基本结构是：

```text
packageId, namespace, label, versionId, version, records
records 中每项：{ id, kind, values }
```

以下资源关系说明字段如何引用对象或选项集：

```text
BizObject ← BizField.entityDefinitionId
BizPicklist ← BizPicklistItem.refPicklistId
BizField.valuePicklistId → BizPicklist
BizField.targetEntityDefinitionId → 目标 BizObject
```

对象 API 名如 `service__request__c`，字段如 `subject__c`；标签只用于显示。新资源由受支持生成入口分配身份和前缀，已有资源保留稳定身份；元数据 ID 与业务记录前缀分别使用。

字段资源的 values 示例；对象 ID 替换为实际稳定身份：

```json
{
  "entityDefinitionId": "<本应用对象ID>",
  "fieldApiName": "subject__c",
  "label": "申请事项",
  "type": "Text",
  "length": 160,
  "nullable": true
}
```

包内 Lookup 使用 `targetEntityDefinitionId`，选项字段使用 `valuePicklistId`。UserRef 可引用固定 User `00457d0cb59a8281762b`，见[初始化基础](initialized-platform.md)；该例外不允许任意跨包引用。

跨环境交付沿用包资源身份，改标签不换 API 名。类型、关联目标或必填等约束变化需处理存量值；新增字段明确 nullable 与补数据方式。以实际 effectiveDefinition/deployment 判断生效，结构删除与恢复见[生命周期](lifecycle.md)。

已有 CLI 可用 `app init --namespace <命名空间> --label <名称> --dir <目录>` 生成基础 source.json，`app build --source <source.json> --output <应用.appkg>` 调目标服务构建并校验。HTTP 为 `POST /api/application/v1/packages:build`，body 是原始 source JSON，返回包字节。构建、发布、安装按任务分别执行，无需平台源码或 .NET。

## 读取、查询与保存

复用已认证的 `XRainRuntimeClient`：`query(entityCode, query)`、`get(entityCode, recordId)`、`create(entityCode, values)`、`update(entityCode, recordId, values, options)`、`delete(entityCode, recordId)`。SDK 负责 HTTP 外层封装；方法、返回与错误见[业务 API](business-api.md)。entityCode 取实际对象目录，User 使用 `runtime.User`，不猜别名。

例如查询已存在的维修申请对象：

```json
{
  "page": 1,
  "pageSize": 25,
  "includeTotalCount": true,
  "fields": ["subject__c", "status__c"],
  "filter": {"field": "status__c", "op": "eq", "value": "open"}
}
```

示例字段和 `open` 必须已定义。`businessQueryCapabilities()` 描述类型、运算符与值模式；条件用 `{field, op, value}` 和非空 and/or 组，关联路径也受目标对象/字段授权。

列表取 records 和请求的 totalCount；统计、批量和导出见[数据操作](data-operations.md)。选项、引用候选与视图使用[元数据与前端](metadata-and-ui.md)的消费方式，页面追加条件应与原视图条件组合。

多查询 queryBatch 最多 8 项，按请求顺序返回；任一失败则整体失败。HTTP 包装与 SDK 解包差异见业务 API；它不提供跨系统 join。

条件更新使用 `client.update(entityCode, recordId, values, {expectedValues})`。HTTP 示例表示仅在状态仍为 open 时关闭：

```json
{
  "values": {"status__c": "closed"},
  "expectedValues": {"status__c": "open"}
}
```

旧值不符返回 409、`platform.data.concurrency_conflict`；保留输入并重读。把本次决策依赖的字段都纳入条件，仅检查状态不能检测所有修改。业务权限与状态规则仍由对应入口执行。

创建超时先按稳定业务身份确认结果再重试。字段变更以目标 describe、相应角色的读写和旧记录表现确认；例如新增功率字段需同时落实单位、有效模型、展示和字段授权。
