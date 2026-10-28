# 批量数据、统计与文件操作

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

用于报表、批量、去重，以及记录文件的导入和导出。基本读写见[建模](modeling.md)，请求与返回集中在[业务 API](business-api.md)；使用现有认证封装或已导出的 SDK 方法。

## 按结果选择查询

以下查询均用 POST，完整路径见业务 API。query 取一页，count 取可见总数，single 验证唯一性，first 按显式排序取首条；firstOrDefault/singleOrDefault 在无匹配时返回 null。

distinct 按字段组合去重，只接受 fields 和可选 filter，不支持 search/sort/aggregates/分页/总数；受保护 User 不支持此操作。例如：

```json
{
  "fields": ["status__c", "departmentCode__c"],
  "filter": {"field": "status__c", "op": "eq", "value": "open"}
}
```

## 全范围汇总

query.aggregates 使用 `{field, function, alias}`；支持 count/sum/avg/min/max 与相应类型的直接字段，不接受关联路径或 SQL 表达式。下面同时取一页申请与完整筛选范围的费用汇总：

```json
{
  "page": 1,
  "pageSize": 25,
  "includeTotalCount": true,
  "fields": ["subject__c", "estimatedCost__c"],
  "filter": {"field": "status__c", "op": "eq", "value": "open"},
  "aggregates": [
    {"field": "estimatedCost__c", "function": "sum", "alias": "estimatedTotal"},
    {"field": "estimatedCost__c", "function": "avg", "alias": "estimatedAverage"}
  ]
}
```

结果 aggregates 含 alias/field/function/value，保留金额精确文本；聚合与 count 遵守当前主体的数据范围和字段权限，不能用当前页求和代替。

RuntimeRecordQuery 没有通用 groupBy。分组可按已知条件分别聚合、调用原系统报表或建立必要统计事实；多查询可用 queryBatch，不能拼接局部结果冒充全量。

## 批量写入

批量入口见业务 API。输入非空，更新/删除 ID 不重复，每项执行权限、范围和引用校验。HTTP 删除集合为 recordIds，Trigger 删除事件为 ids，分别适配。

batchUpdate 关闭两条仍为 open 的申请：

```json
{
  "records": [
    {"recordId": "<申请A的实际ID>", "values": {"status__c": "closed"}, "expectedValues": {"status__c": "open"}},
    {"recordId": "<申请B的实际ID>", "values": {"status__c": "closed"}, "expectedValues": {"status__c": "open"}}
  ]
}
```

先从目标服务的接口说明确认批量版本。支持 `allOrNone` 的入口省略或设为 true 时沿用原子语义：本次调用一项失败则回滚，创建/更新成功返回记录数组，删除成功为 204。显式 false 时返回 `{allOrNone, commitState, results}`，results 按输入顺序给出 index、success、recordId/record 和 errors；HTTP 200 不代表每项成功。`committed` 表示已提交，`pending` 仍取决于外层事务，不能立即报告最终持久成功。

只支持旧入口的服务按其原子合同调用，不能猜测 false 会被识别。拆成多个 HTTP 请求后分别提交；CLI 的多命令 batch 也不构成这一事务。外部副作用不随事务回滚，见[自动化](automation.md)。受保护 User 继续遵守其允许字段和写入动作，批量模式不增加账号管理权限。

expectedValues 仅用于更新；Owner 走[专用转移](organization-and-collaboration.md)。超时后先确认结果，冲突后重读，不降级为无条件更新。普通批量入口不提供按唯一字段自动 upsert 或跨请求事务；文件混合导入使用单独的导入能力。

## 文件导入与导出

XRain 已实现面向租户业务对象的 XLSX 模板、预览、整批导入、原批次查询和独立文件导出。目标环境仍须核对对应服务、组件版本和当前主体的接口、对象、字段及记录权限；受保护 User、Host 安全对象和元数据不因此获得普通文件写入能力。应用包的导入安装与业务记录文件导入是不同操作。

使用已取得的 `@xrain/record-file` React 组件或其 `createRecordFileClient` 时，按该版本公开类型接入并保留真实主体与租户。独立界面还须实现原批次恢复和跨页面批次认领；不能仅凭发出请求判定提交。不要在业务应用重复实现平台文件解析、匹配和批次框架。

令 `E=/api/data/v1/entities/{entityCode}`。目标提供相应合同后，文件接口如下：

| 目的 | 方法与路径 | 关键结果 |
| --- | --- | --- |
| 查询导入或导出能力 | `GET E/imports/capabilities`、`GET E/exports/capabilities` | 唯一匹配字段、有效编排、限制和导入协议；两类目录权限分别检查 |
| 下载在线模板 | `POST E/imports/template` | 用导入选项生成 XLSX；保留表头和文件内描述 |
| 预览文件 | `POST E/imports/preview` | multipart 上传，核对目标动作、值、来源和问题；仅 `ready` 给出可执行批次 |
| 提交原批次 | `POST E/imports/execute` | 使用同一文件、选项及预览返回的 `batchId`、`planToken`；整批成功或回滚 |
| 查看原结果 | `GET E/imports/{batchId}`、`GET E/imports/{batchId}/file` | 查询原批次及下载可授权的结果；结果未知时不要换批次重放 |
| 导出记录文件 | `POST E/records:exportFile` | 按筛选或选中记录生成维护文件或展示文件 |

模板选项包括 `uniqueField`、`filePurpose`、`blankPolicy` 和可选 `importBinding`；按目标 capabilities 选择，不能猜测唯一字段或编排。预览和执行的 multipart 都要发送 `coordination=coordinated-v1`，执行接受原预览中用途受保护的 `xrain-coordinated-v1.` 令牌；调用方还须在执行前保存并认领原批次标识。预览不写业务记录，提交前核对创建、修改、删除、空白清空及问题。断线、超时或 `ready` 不能证明未提交；先查原批次，确认结果后再决定下一步。

独立导出默认取当前筛选范围，可选择其中勾选的记录；超出目标容量时收窄筛选。`roundTrip` 是具备维护条件的回导文件，`display` 是阅读文件、不能回导；移除维护文件中的行不会删除记录。导出不还原原始来源表或导入前的拆合数据。记录 `:export` 是另一入口，返回当前页 JSON；仅提供分页 JSON 的旧目标需自行生成文件，并继续使用 export 权限，不能用普通 query 绕过。

导出遵守当前读取范围、字段权限和脱敏规则，不承诺跨页一致快照。按月导出先计算[业务日期边界](regional-context.md)，统计与导出使用相同条件和金额单位。

## 导入中的业务编排

标准文件导入可不绑定编排；需要业务规则时，入口使用稳定的 `importSourceKey`，可指定 `orchestrationId` 和固定 `parameters`，由平台解析实际版本。业务作者在编排版本的 `inputModel.import` 声明输入列及需要的阶段，原有 `execute(ctx)` 按 `ctx.input.phase` 分派，不另建脚本引擎。例如，来源表的重量列可以先按业务提供的单位规则转换，再匹配业务记录并校验整批；来源专用列不因此创建对象字段。

| 阶段 | 作用和边界 |
| --- | --- |
| `transform` | 转换来源数据，可拆分、合并或显式跳过，并保留真实来源；维护回导跳过此阶段 |
| `normalizeIdentity` | 只规范化选定的业务匹配键，保持记录 Id 和其他数据；只允许纯计算 |
| `prepareRecord` | 平台匹配并合并后，计算新增或修改候选的共同业务字段 |
| `validate` | 检查最终批次并返回问题，不修改记录 |

平台继续负责真实身份授权、匹配、正常写入、Trigger 与回执；导入编排运行在受限 profile，不能借此执行普通写入、投递或原始 HTTP。维护回导仍执行已声明的共同阶段，删除行跳过来源转换及候选准备。完整声明、包内引用和字段约束见[应用包编写说明](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-app-package/modes/authoring/references/authoring.md)；具体阶段 DTO 和受限调用按目标接口与版本核对。
