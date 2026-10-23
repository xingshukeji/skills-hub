# 批量数据、统计与导出

用于报表、批量处理、候选去重和导出。基本对象读写、字段值和条件更新见[建模与数据开发](modeling.md)。下述 HTTP 请求使用现有认证封装；公共 SDK 没有导出对应方法时可调用这些受支持的接口，不猜造 SDK 方法。

## 按结果选择查询

以下后缀均接在 `/api/data/v1/entities/{entityCode}/records` 后，使用 POST；entityCode 取自实际对象目录，路径参数编码为单个 segment。

| 后缀 | 返回与用途 |
| --- | --- |
| `:query` | 分页 `{records, totalCount, fields, ...}`；按需附带聚合结果 |
| `:count` | 一个数字，统计符合查询条件且当前主体可见的记录数量 |
| `:distinct` | `{entityCode, metadataRevision, fields, rows, queryPlan}`，每行有 `values`，用于指定字段组合去重 |
| `:single` / `:singleOrDefault` | 查询应唯一的记录；多条匹配为错误，无匹配时前者报错、后者返回 null |
| `:first` / `:firstOrDefault` | 取查询顺序的第一条；无匹配时分别报错或返回 null，不验证唯一性 |
| `:export` | 按导出权限返回分页记录数据，形状与普通查询一致 |

要唯一结果时使用 single 或业务唯一键；first 用于“最近一条”等场景并显式排序。查询的一页、总数量、去重结果和汇总是不同数据，不相互冒充。

实测 `single` 多条匹配为 HTTP 400、`platform.data.query.multiple_records_matched`；无匹配为 404、`platform.data.record_not_found`。`singleOrDefault/firstOrDefault` 无匹配均为 HTTP 200 和 JSON `null`。count 返回 JSON 数字，不能按 `{count: ...}` 解析；批量创建/更新返回记录数组，批量删除成功为 204 空正文。真实请求与返回见[业务 API](business-api.md)。

`distinct` 当前只接受有意义的 `fields` 和可选 `filter`；不支持附加 search、sort、aggregates、自定义分页或 includeTotalCount，也不返回分页总数。受保护的业务 User 不支持该 distinct 能力。对业务申请按状态和部门去重的 body 可以是：

```json
{
  "fields": ["status__c", "departmentCode__c"],
  "filter": {"field": "status__c", "op": "eq", "value": "open"}
}
```

## 汇总不受当前页大小代替

在 `:query` body 的 `aggregates` 中声明 `{field, function, alias}`。当前函数为 `count/sum/avg/min/max`，具体字段类型还须支持该函数；使用直接字段，不能把关联字段路径或任意 SQL 表达式当聚合字段。

例如申请对象已有 `estimatedCost__c` 金额字段，页面同时要一页申请和当前筛选范围的费用汇总：

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

读取响应 `aggregates` 中的 `alias/field/function/value`，保留精确数值传输语义；不要用 records 当前页重算全量金额，也不要把金额文本先转为 JavaScript 浮点数。聚合与 count 继续使用当前主体的数据范围和字段权限。

当前公开 RuntimeRecordQuery 没有通用 `groupBy` 字段。按部门分组报表可以按已知部门条件分别请求平台聚合、使用原系统已有报表接口，或按业务需要建立统计事实；不能悄悄拉一页明细后伪装成全租户分组汇总。多查询可使用 `POST /api/data/v1/records:queryBatch`，最多 8 项，详情见[建模](modeling.md)，它不是跨系统联表。

## 批量写入

同一对象的批量操作使用下列 POST 入口。批量更新/删除中的记录 ID 不能重复，输入不能为空；每项仍校验对象、字段、记录范围和引用资格。

| 后缀 | body | 成功结果 |
| --- | --- | --- |
| `:batchCreate` | `{records: [{values: {...}}, ...]}` | 新建记录数组 |
| `:batchUpdate` | `{records: [{recordId, values: {...}, expectedValues?: {...}}, ...]}` | 更新后的记录数组 |
| `:batchDelete` | `{recordIds: [...]}` | 无内容 |

注意 HTTP 批量删除字段叫 `recordIds`；Trigger 事件的删除集合叫 `ids`。同名业务动作的 HTTP、callable 和事件 DTO 不应互相复制。

例如一次关闭两条仍处于 open 的申请：

```json
{
  "records": [
    {"recordId": "<申请A的实际ID>", "values": {"status__c": "closed"}, "expectedValues": {"status__c": "open"}},
    {"recordId": "<申请B的实际ID>", "values": {"status__c": "closed"}, "expectedValues": {"status__c": "open"}}
  ]
}
```

普通业务对象的单次批量写入参与同一租户事务；某项授权、条件或写入失败时不能按“其余已成功”显示。拆成多个 HTTP 批次后，各批次有各自提交结果，不再是一次整体原子操作。外部邮件、HTTP 请求等副作用不随数据库回滚，相关组合见[自动化](automation.md)。受保护业务 User 有专用写入限制，不把普通对象的批量入口当成账号管理。

`expectedValues` 只用于更新，并表达本次动作实际依赖的旧值；创建不带它。字段权限不允许的 Owner 转移使用[专用操作](organization-and-collaboration.md)。批量超时意味着结果可能未知，先按稳定业务身份查询结果；不能为避开冲突改成无条件更新，也不能把一次超时直接当成全部未保存而重发。

数据导入可在企业业务层解析输入、校验字段映射和引用，再使用批量入口保存；这里没有承诺通用 Excel 导入设计器、自动 upsert 或跨批次事务。

## 导出是授权后的数据读取

`:export` 在通常的对象、字段和记录读取权限之外，还要求对象 export 权限。它返回当前请求页的 JSON 数据，平台不会因这个后缀自动生成 Excel 文件或遍历所有记录。

企业导出实现沿该入口分页读取，保留稳定排序、字段列表和筛选，按需求生成 CSV/XLSX。每页都执行授权，脱敏值仍按返回描述处理；不能改走普通查询来绕过导出权限。若记录在导出期间变化，普通分页不保证整份文件对应同一时刻快照；业务确实要求冻结清单时，使用已有的报表快照或显式业务批次。

例：“本月已完成维修费用表”先按[业务地区日期边界](regional-context.md)取得 UTC 范围，再把状态、部门和日期条件组合后分页导出。页面显示的全量费用使用同一条件的聚合，文件中保留单位和精确金额。导出后的行数核对只能说明已导出的集合，不能替代未请求的总数或快照保证。
