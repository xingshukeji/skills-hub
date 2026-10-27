# 批量数据、统计与导出

用于报表、批量、去重和导出。基本读写见[建模](modeling.md)，请求与返回集中在[业务 API](business-api.md)；使用现有认证封装或已导出的 SDK 方法。

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

普通对象同次批量写入使用同一租户事务，一项失败则回滚该批；拆成多个 HTTP 请求后分别提交。外部副作用不随事务回滚，见[自动化](automation.md)。受保护 User 的写入另有合同。

expectedValues 仅用于更新；Owner 走[专用转移](organization-and-collaboration.md)。超时后先确认结果，冲突后重读，不降级为无条件更新。导入层负责解析和引用映射；普通批量入口不提供自动 upsert 或跨批次事务。

## 导出是授权后的数据读取

export 还要求对象 export 权限，只返回当前页 JSON。沿该入口按固定筛选、字段和稳定排序分页，再生成 CSV/XLSX；每页保留授权与脱敏，不用普通查询绕过导出权。

分页期间数据可能变化；需冻结清单时使用明确的报表快照或业务批次。按月导出先计算[业务日期边界](regional-context.md)，统计与导出使用相同条件和金额单位。
