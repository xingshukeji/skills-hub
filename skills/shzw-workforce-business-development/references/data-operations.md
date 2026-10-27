# 批量数据、统计与导出

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

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

先从目标服务的接口说明确认批量版本。支持 `allOrNone` 的入口省略或设为 true 时沿用原子语义：本次调用一项失败则回滚，创建/更新成功返回记录数组，删除成功为 204。显式 false 时返回 `{allOrNone, commitState, results}`，results 按输入顺序给出 index、success、recordId/record 和 errors；HTTP 200 不代表每项成功。`committed` 表示已提交，`pending` 仍取决于外层事务，不能立即报告最终持久成功。

只支持旧入口的服务按其原子合同调用，不能猜测 false 会被识别。拆成多个 HTTP 请求后分别提交；CLI 的多命令 batch 也不构成这一事务。外部副作用不随事务回滚，见[自动化](automation.md)。受保护 User 继续遵守其允许字段和写入动作，批量模式不增加账号管理权限。

expectedValues 仅用于更新；Owner 走[专用转移](organization-and-collaboration.md)。超时后先确认结果，冲突后重读，不降级为无条件更新。普通批量入口不提供按唯一字段自动 upsert 或跨请求事务；文件混合导入使用单独的导入能力。

## 使用目标已提供的文件导入

若目标接口说明提供导入能力、在线模板、预览、执行与批次结果，复用这组入口。先读取对象允许的唯一字段、编排及限制，取得在线 XLSX 模板；上传后核对预览的创建/修改/删除、清空与错误，再用原文件、选项、batchId 和 planToken 执行。结果未知先查询原批次回执，不能换批次重放。记录 ID、唯一字段匹配、空白保留/清空、引用映射与服务端允许操作分别处理，不在业务应用再实现一套平台导入框架。

本段说明已提供该合同的目标如何消费，不证明每个环境均已发布；目标缺少入口时记录版本缺口，并使用任务已接受的现有能力。

## 导出是授权后的数据读取

记录 `:export` 还要求对象 export 权限，返回当前页 JSON；它与文件导出是不同入口。目标提供文件导出时，按其合同选择导出用途、筛选及已选记录，并保留字段授权、脱敏和重新导入所需信息。只提供分页 JSON 的目标，才沿授权导出入口以固定筛选、字段和稳定排序分页生成文件；不用普通 query 绕过 export 权限。

分页期间数据可能变化；需冻结清单时使用明确的报表快照或业务批次。按月导出先计算[业务日期边界](regional-context.md)，统计与导出使用相同条件和金额单位。
