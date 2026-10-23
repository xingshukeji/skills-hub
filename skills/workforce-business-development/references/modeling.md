# 建模与数据开发

## 把业务含义变成平台模型

从实际要查询、编辑、关联和执行的业务对象出发。已有模型可以增量修改；新对象通常要明确业务身份、字段含义、关联对象、负责人以及状态变化。角色与数据范围的设计见[业务授权](authorization.md)。

平台已提供受保护 User、标准记录字段、默认选项和元数据派生权限。直接复用语义相同的基础；具体稳定标识、初始内容和可扩展位置见[初始化基础](initialized-platform.md)，无需用户先列出平台已有资源。

先判断这些事实是否已由 ERP、CRM 等原系统维护。只有页面或智能体要读取原数据时，可直接[接入原系统 API](integration.md)；新增的本地事实再建模。混合模型记录外部系统、租户和记录 ID，明确字段来源与可编辑方；不把外部单号伪装成 XRain 原生记录 ID。

例如维修业务可以有设备、维修申请与处理记录：申请关联设备，处理记录关联申请，负责人引用 User。是否拆成三个对象取决于是否需要独立查询、多次处理和历史保留，不按示例数量建表。

下表说明常见字段的业务用途，不是所有环境的完整类型清单。类型可用性、属性与传输格式从目标设计标准和字段描述取得。

| 业务数据 | 字段选择与语义 |
| --- | --- |
| 名称、编号 | `Text`，明确长度；需要平台唯一键时使用目标支持的唯一字段定义 |
| 说明、原文、复杂结构快照 | `LongText`；需独立筛选、关联或授权的属性适合单独字段 |
| 数量、度量、金额 | `Number`、`Decimal`、`Money`；单位、精度与舍入属于业务含义，读取目标字段描述确定传输方式 |
| 日期或发生时刻 | `Date` 表达日历日期；`DateTime` 按目标时间格式约定表达时刻，不把日期自动补成某时区午夜 |
| 开关 | `Boolean`，区分 false 与未知/未填写 |
| 固定业务选项 | `Picklist`、`MultiPicklist`，绑定选项集；显示 label，保存 value |
| 关联另一业务对象 | `Lookup`，声明真实目标对象；一对多通常由子对象引用父对象表达 |
| 关联人员 | `UserRef` 指向平台受保护 User；选择目标租户的合法候选，人员档案与登录身份可以有不同用途 |

业务字段类型决定存储和默认呈现；`presentation` 的 editor、cell、detail 配置表达控件与展示，不改变字段类型、原始值或授权。推荐呈现、默认继承、选项和前端消费的完整用法见[元数据与前端](metadata-and-ui.md)。读写权限、选项与校验来自元数据及实际访问描述，字段标签不参与接口寻址。当前数值协议用精确文本传输 Number/Decimal/Money，避免把平台值随手转成有精度损失的浮点数；算法输入与外部接口另按各自合同转换。Date 使用日期值，DateTime 表达带偏移的时刻。

记录类型可声明选项子集，例如不同维修类别使用不同故障选项。当前这只是范围配置，业务需要主动决定类型并消费它，不自动限制通用 Runtime 写入、分派表单或授权人员。业务必须执行的限制在实际操作中落实。保存规范选项名称（业务候选中的 value），展示 label；历史选项与当前可选项也可能不同。

多对多如果需要独立属性或历史，可以用中间业务对象表达。跨应用引用、可用关联类型和删除行为以目标交付契约为准；先确认目标对象如何引用，再选择同包对象、受支持的外部引用或业务集成方式。

## 元数据、记录与资源包

资源包中的 `kind: "BizObject"`、`kind: "BizField"` 是模型资源的序列化名称，按资源格式声明；运行时记录 API 保存业务实例。新增一条业务记录不能创建字段；修改页面字段数组也不会更新平台模型。

模型可通过交付的对象设计入口维护，或随应用资源包交付。直接使用管理 API 时，取得该版本完整的创建/更新请求定义；不要把包内 `values` 片段当作管理接口请求。已由包管理的模型，沿用项目包源码或管理入口支持的扩展方式维护。

包源码的基本结构是：

```text
packageId, namespace, label, versionId, version, records
records 中每项：{ id, kind, values }
```

铵帮模型生成中使用了以下资源关系，可帮助理解字段为什么需要引用对象或选项集：

```text
BizObject ← BizField.entityDefinitionId
BizPicklist ← BizPicklistItem.refPicklistId
BizField.valuePicklistId → BizPicklist
BizField.targetEntityDefinitionId → 目标 BizObject
```

对象 API 名示例为 `service__request__c`，业务字段示例为 `subject__c`；它们用于代码寻址，标签用于显示。新包和资源的身份、命名及记录前缀按交付的生成入口和设计标准分配，已有项目保留已有合法身份。不要从一个企业的 ID、前缀或系统对象常量推导所有目标的取值；元数据 ID 和业务记录前缀也不是同一种身份。

以下是包中字段的 `values` 示意，`<本应用对象ID>` 需要替换为对应对象的真实稳定身份；它不是完整包，也不是管理 API 请求：

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

在这类包模型中，`Lookup` 通过 `targetEntityDefinitionId` 指向包内目标，`Picklist`/`MultiPicklist` 通过 `valuePicklistId` 选择包内选项集。当前 `UserRef` 明确支持平台固定 User 对象 `00457d0cb59a8281762b`，这属于系统合同，不是企业案例常量；完整字段片段见[初始化基础](initialized-platform.md)。这一例外不允许任意跨包对象或租户现有选项 ID 引用。

同一包的模型跨环境交付时保留稳定身份；一个全新应用按自己的资源身份生成。重命名技术身份、改变字段类型或关联目标不是普通文案修改。新增字段时结合存量数据决定 nullable 和补数据方式；增加唯一性或必填约束时，核对目标支持的类型、长度、重复值和缺值处理。不要把缺值自动补成 0 或空字符串。

普通模型编辑保持既有 API 名不变，改显示标签不需要更换代码寻址。当前模型不是默认的草稿/发布双态，但结构变更仍可能部署失败；读取实际有效定义及部署状态。删除元数据资源与物理删除历史数据的行为也应分别识别，具体见[模型变更与恢复](lifecycle.md)。需要替换技术身份时沿目标支持的迁移方式处理，不能通过重新生成全套 ID 更新旧应用。

已有 XRain CLI 时，`app init --namespace <命名空间> --label <名称> --dir <目录>` 可生成基础 `source.json`；它不是完整业务模型。需要构建时，`app build --source <source.json> --output <应用.appkg>` 使用目标服务构建并校验返回包；默认使用已配置的连接和登录状态。

相应服务入口为 `POST /api/application/v1/packages:build`，body 是原始 source JSON 对象，成功返回 `.appkg` 字节。使用项目已有封装或 CLI 可以复用身份与完整性校验，无需获取平台源码或安装 .NET。构建、发布、安装按当前任务需要执行，不把生成模型理解为必须立刻发布。

## 读取、查询与保存

优先复用已认证的 `XRainRuntimeClient`：`query(entityCode, query)`、`get(entityCode, recordId)`、`create(entityCode, values)`、`update(entityCode, recordId, values, options)`、`delete(entityCode, recordId)`。这里的 `values` 是字段值对象；HTTP 请求中的外层封装由客户端处理。

直接接入记录 HTTP API 时，使用对象目录返回的 `entityCode`，路径变量编码为一个 URL segment。自定义对象的 entityCode 通常与 entityApiName 相同；受保护 User 实测为 `entityCode: "runtime.User"`、`entityApiName: "User"`，该目标也接受 `User` 别名，不由这个例外推导任意别名。以下也是已交付 CLI 数据命令使用的请求方式：

| 动作 | 请求 |
| --- | --- |
| 查询 | `POST /api/data/v1/entities/{entityCode}/records:query` |
| 读一条 | `GET /api/data/v1/entities/{entityCode}/records/{recordId}` |
| 新建 | `POST /api/data/v1/entities/{entityCode}/records`，body 为 `{values: {...}}` |
| 修改 | `PUT /api/data/v1/entities/{entityCode}/records/{recordId}`，body 含 `{values: {...}}`，条件更新另见下文 |
| 删除 | `DELETE /api/data/v1/entities/{entityCode}/records/{recordId}` |

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

该示例使用平台字段条件，`open` 是示例对象已定义的选项值；实际项目使用自己的字段和选项。查询能力由 `businessQueryCapabilities()` 或 `GET /api/data/v1/query-capabilities` 描述，包括字段类型、运算符和值模式。叶子条件为 `{field, op, value}`，组合使用目标定义的非空 and/or 条件组；关联路径也执行被访问对象和字段的授权，不能借关联查询绕过权限。

列表结果使用 `records` 和请求的 `totalCount`，还包含 `entityCode/metadataRevision/page/pageSize/fields/queryPlan/aggregates/temporalContracts`。单条记录为 `{recordId, entityCode, createdAt, updatedAt, values}`；没有统一的 `data` 外层。新建返回 HTTP 201，更新返回 200，删除返回 204 空正文。分页当前页不代表完整结果集。要数量、去重或汇总时，优先使用平台提供的 count、distinct、聚合能力，并按合同选择字段和函数；当前查询没有通用 groupBy 参数。具体请求、批量写入与授权导出见[数据操作](data-operations.md)，不要只在当前页数组上求和后声称是总计。

Picklist/MultiPicklist 的选项通过 `businessFieldOptions(entityCode, fieldApiName, {page, pageSize, search})` 取得。Runtime 查询的 `fields[].options` 可能只是局部结果；元数据 describe 的字段响应没有这个 options 数组。使用选项分页和搜索取得需要的项，不把已加载的一页当作完整写入白名单。该方法不自动应用记录类型范围，也不支持 Lookup/UserRef；实测人员字段返回 400。关联记录按字段的真实目标对象查询，人员展示可用受控成员资料，写入仍执行引用校验。具体见[元数据与前端](metadata-and-ui.md)。

命名视图可通过 `businessListViewQuery(entityCode, viewName)` 取得查询定义。视图描述列、排序和筛选等读取方式；将页面附加筛选与原视图条件正确组合，不能悄悄覆盖已有条件。视图方便组织列表，但字段和记录权限仍由服务端执行，隐藏某列不等于撤销字段访问。

`POST /api/data/v1/records:queryBatch` 接受 `{queries: [{entityCode, query}, ...]}`，当前最多 8 个查询，HTTP 响应的 `results` 数组按请求顺序包含 `{entityCode, result}`；任一查询失败则整个请求失败，不返回混合成功的部分结果。`XRainRuntimeClient.queryBatch(queries)` 在实测的 Workforce 0.3.8 中已解包为各个查询 result 的数组，不能再读取 SDK 返回值的 `.results`。这适合一个页面读取多个平台对象，不提供与外部 ERP 的跨系统 join，也不代替业务所需的一致性设计。

多人编辑同一记录时，用已读取的字段旧值表达本次修改所依赖的条件。铵帮通过 `client.update(entityCode, recordId, values, {expectedValues})` 使用该能力；下面是相应的 HTTP body 示例：

```json
{
  "values": {"status__c": "closed"},
  "expectedValues": {"status__c": "open"}
}
```

这里表达“仅在状态仍为 open 时改成 closed”。实测旧值不符返回 HTTP 409、`errorCode: "platform.data.concurrency_conflict"`；保留输入并重新读取业务状态。视图修订冲突也可返回 409，但 errorCode 不同，不能只按状态码归类。若还依赖其他字段，同样纳入条件；如果需要检测所有并发修改，仅检查状态并不充分。空值、缺省条件以及版本控制方式以目标契约为准。条件写入不自动实现“谁可以关闭申请、关闭前要完成哪些事”，这些由业务授权和逻辑决定。

创建遇到超时可能已经保存。若业务已有唯一请求键，可据原键读取结果后接续；是否需要请求键、快照或历史对象由业务的重入和追溯需求决定。

## 所有权、分享与历史

平台有专门的所有权转移、记录分享与历史查询能力，编排目录中的 `runtime.records.transferOwner` 使用 `{entityCode, recordId, ownerId}`，分享和历史操作按各自 callable 签名调用。更新业务负责人字段与转移标准 Owner 有不同含义，沿实际业务选择对应动作。

平台变更历史帮助查看记录修改；“一次审核”“一次交付”“一次维修处理”若是需要独立查询或授权的业务事实，可有自己的业务对象。普通字段改动无需为每次修改另建一套业务历史表。

部门与角色条件、人工分享的能力/接收人查询，以及 Owner 转移的资格、并发和交接边界，见[组织与记录协作](organization-and-collaboration.md)。

## 一次字段改动怎样完成

例如给设备增加“额定功率”：修改模型定义，选择数值类型并明确单位；让目标元数据生效；在需要的视图、页面或工具结果中使用该字段；为实际读写人补齐对应字段授权。只修改本次用到的部分，现有元数据驱动页面可能无需再写专用控件。

多人开发时共享字段的稳定名称与语义，比共享某人本机导出的记录 ID 更有用。模型源码变化后，以目标 `describe` 和一次对应业务读写确认生效；保留了历史数据的模型变更还要核对旧记录的表现。
