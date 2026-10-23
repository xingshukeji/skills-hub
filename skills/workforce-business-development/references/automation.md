# 函数、业务编排与自动化

## 三种能力分别解决什么

| 能力 | 作用 | 常见用途 |
| --- | --- | --- |
| 可复用函数 | 提供有输入输出契约的计算或操作，供其他业务调用 | 费用计算、数据规范化、重复使用的业务规则 |
| 业务编排 | 一次 `execute(ctx)` 组合数据、函数和已登记接口 | 校验并更新业务记录、组合平台与外部系统结果 |
| Trigger / Routine | 在记录事件或某个时间执行编排 | 记录校验、提交后处理、定时同步或提醒 |

当前业务编排是结构化输入模型和受控 JavaScript 源码，不是步骤数组、拖拽节点或 AI 指令。Routine 选择编排、固定输入和调度；它也不是自主运行的智能体。需要人员审核或确认的业务，用原业务流程或业务状态与操作表达，必要时结合 Workforce Task。

## 编排的调用模型

通过 `GET /api/orchestration/v1/callables` 取得当前可调用能力，响应是数组。条目有 `key/source/label/helpText/signature/implementation`；实测多个系统 callable 的 signature 和 implementation 为 null，输入说明写在 helpText 中，不能假设每项都有可生成表单的 JSON Schema。源码使用实际 key，结合条目说明和对应接口合同，不根据页面标题猜测。常用类别包括：

| key 或类别 | 用途 |
| --- | --- |
| `identity.currentUser`、`identity.roles` | 当前执行者及其角色，不是任意用户管理接口 |
| `runtime.records.query`、`runtime.records.get` | 按实体和查询/记录 ID 读取平台记录 |
| `runtime.records.create`、`runtime.records.update` | 按 `{entityCode, values}` 或 `{entityCode, recordId, values, expectedValues?}` 写入 |
| 记录的 count、distinct、batch、所有权、分享、历史能力 | 统计、批量及专用记录动作，签名从目录取得 |
| `tenant.*` | 当前租户的可复用函数，使用该前缀并保留系统函数名称 |
| 已登记的 raw HTTP 接口名称 | 调用[系统集成](integration.md)中的外部接口 |
| `delivery.sms.send`、`delivery.email.sendByTemplate`、`delivery.feishu.sendByTemplate` | 使用已配置的投递能力，见[公共服务](shared-services.md) |

脚本上下文包含 `ctx.input`、`ctx.profile`、`ctx.system` 和 `ctx.sdk.fn.invoke(key, input)`。调用通过平台受控入口完成；不导入 npm 模块，不使用任意 `fetch`、文件、进程或宿主 API。需要项目依赖、特殊网络协议或原系统用户凭据适配时，在企业宿主实现并通过已支持的集成方式组合。

例如已建模维修申请对象后，可写一段查询编排：

```js
function execute(ctx) {
  const result = ctx.sdk.fn.invoke('runtime.records.query', {
    entityCode: 'service__request__c',
    query: {
      page: 1,
      pageSize: 25,
      includeTotalCount: true,
      fields: ['subject__c', 'status__c'],
      filter: { field: 'status__c', op: 'eq', value: ctx.input.status },
    },
  });
  return { records: result.records, totalCount: result.totalCount };
}
```

配套 `inputFields`：

```json
[
  {"name": "status", "label": "申请状态", "type": "string", "required": true, "example": "open"}
]
```

字段模型支持 `name`、`label`、`type`、`required`、可选说明和示例；类型包括 `string`、`integer`、`number`、`boolean`、`object`、`array`。不要给它自行加上未提供的任意 JSON Schema 层级。上例使用既有字段及选项值，并保留真实分页；平台按实际执行者检查字段和记录访问。

管理定义通过 `/api/orchestration/v1/definitions` 及 `/{id}`，创建内容为 `label`、`name`、可选 `helpText`、`source`、`isActive`、`inputFields`；`source` 是上述函数文本。版本读取使用 `/{id}/versions`。可复用租户函数在同域 `/functions` 管理，其源码与 `contractJson` 由函数编辑入口维护。

`POST /api/orchestration/v1/debug` 接受 `{source, input, inputFields}`，返回成功状态、输出、失败码、console、源码及合同校验结果，包括 `supportsTrigger`。调试会真实执行 callable，可能写记录或向外发送消息；对有副作用的示例先使用项目已有测试资源或模拟接口，不能把 debug 当作无副作用预览。

实测普通查询编排返回 `{isSuccess, output, errorCode, errorMessage, console, consoleTruncated, statements, allocatedBytes, sourceValid, supportsTrigger, contractIssues}`。`isSuccess: true`、`sourceValid: true` 可以与 `supportsTrigger: false`、`contractIssues: ["trigger_response_contract_invalid"]` 同时出现：该结果表示本次普通编排成功，但不满足 Trigger 输出合同，不能把这项 Trigger 检查误判为普通调用失败。读取业务结果用 output，不能虚构统一的 result/data 外层。

## 函数版本与应用选择

区分函数当前源码、不可变版本、应用与函数的关联、应用当前选择的版本。平台资源包可以包含 `BizOrchestration`、`BizOrchestrationVersion`、`BizOrchestrationFunction` 等受支持资源；能否执行还取决于目标应用的关联、选用和授权。铵帮选择将模型包与算法产物分开，这是案例设计，不是平台只能打包模型。

已发布 `XRainRuntimeClient` 提供：

| 需要做什么 | 客户端方法 |
| --- | --- |
| 读应用当前函数关联 | `applicationFunctions(applicationId)` |
| 修改关联或当前选择 | `changeApplicationFunctions(applicationId, expectedRevision, changes)` |
| 读取函数版本 | `functionVersions(functionId)` |
| 创建当前函数的版本 | `createFunctionVersion(functionId)` |
| 试算指定版本 | `testFunctionVersion(versionId, input)` |
| 按应用选择执行 | `executeApplicationFunction(applicationId, resourceId, input, expectedVersionId)` |

`createFunctionVersion` 没有源码参数，先通过对应函数管理入口保存源码与合同再创建版本；不要给 SDK 方法增加猜测的上传 body。关联的 `changes` 结构从当前交付接口取得。应用关联项的 `id` 对应这里的 `resourceId`，与 `functionId`、`versionId`、应用修订分别使用。

保存源码、创建版本、试算、应用采用版本和正式执行是不同结果。执行时使用预期版本，变更选择时使用应用修订；发生冲突就读取当前选择并处理实际差异。应用正式函数及依赖按本应用有效关联执行，不能通过旧函数 key 绕过应用停用。

选择不可变函数版本不冻结外部数据，也不等于冻结所有动态依赖。需要重现历史计算时，业务结果保存实际版本以及所需的输入、政策或外部数据依据；普通查询不必普遍增加快照体系。

## 事务与外部副作用

一次编排中的原生 Runtime 记录写入在同一租户事务中执行：源码完成并产生有效结果后提交，执行失败回滚该事务的记录写入。涉及 Host 与 Tenant 的不同数据库不构成跨库原子事务。

HTTP、邮件、短信等外部动作不能随数据库回滚。先调用 ERP 成功，再写本地记录失败，ERP 的动作仍可能已生效。平台编排本身不提供通用补偿事务或任意自动重试；根据业务选择原系统幂等键、结果查询、可恢复状态或已有补偿逻辑。返回值区分已完成、受理中、失败和结果未知。

## 记录事件 Trigger

对象级 `triggersEnabled` 与单条 Trigger 的 `isActive` 共同控制触发。绑定支持 Trigger 合同的编排；工作台提供 Before/After × Insert/Update/Delete 起步模板，并通过 `supportsTrigger` 和合同校验反馈适配结果。模板生成的是同一类编排，不产生另一种流程定义。

| 时点 | 数据与失败语义 |
| --- | --- |
| Before | 在记录提交前同步运行，可用于业务校验；失败回滚本次写入批次 |
| After | 数据提交后调度，失败保留已经提交的记录；查看运行结果再处理 |

单条和批量操作共用集合输入：Insert/Update 使用 `records[]`，Delete 使用 `ids[]`；按事件模板读取其余字段，不假定所有事件都有一条 `record`。一个 Trigger 对一个写入批次执行一次，避免逐记录调用外部接口导致重复发送或过量请求。

After 执行保留事件时的操作者、上下文及选定版本，不因为由 Worker 执行就变成管理员。事件链中的 `eventId` 不等于每次投递的唯一键；是否会重试、是否已经处理需要用实际运行记录和业务标识判断，不宣称 exactly-once。需要防止循环更新时，按业务变化条件限制后续写入，避免 Trigger 无条件更新自身。

## 定时执行 Routine

Routine 引用编排、固定输入、Owner 和调度。现有调度包括 Manual、Daily、Workday；使用目标 schedule preview 核对时区和下一次执行时间，不把本机时区或某种工作日算法写死。

显示地区、租户业务地区和安排自身 timeZoneId 分别处理；用户更改显示偏好不改已有周期安排。当地时间解析、夏令时歧义和按业务日筛选的具体接口见[时间上下文](regional-context.md)。

管理列表为 `GET /api/automation/routines?page=1&pageSize=20`，返回 `{totalCount, page, pageSize, items}`。当前 page/pageSize 是必要查询参数，实测省略时返回 400 空正文。定义、调度、启停、发起运行和历史分布在 `/{id}` 下的 `definition`、`schedule`、`enable`、`pause`、`runs`、`history`、`versions` 等入口；当前活动运行使用 `/{id}/active-runs`。

`GET /api/automation/routines/execution-user` 返回 `{userId}`，实测未配置为 null。`POST /api/automation/routines/schedule-preview` 可用 `{scheduleType: "Daily", executeTime: "09:00", timeZoneId: "Asia/Shanghai"}`，返回 `{nextRunAt, timeZoneId, offset}`；这是时刻预览，不会创建或启用任务。其他写入 body 从当前调度编辑器或交付合同取得，不把编排源码当作 Routine 的步骤列表。

Owner 是维护责任人，不自动成为运行主体。普通租户自动化使用租户设置 `automationExecutionUserId` 指向的实际活跃成员，并在运行时核对其权限；配置已有适用身份即可，不能把调度任务数量当成新建账号数量。Workforce 员工定时任务可能有专门执行链路，不直接套用普通 Routine 的身份结论。

启用不等于执行成功，返回运行 ID 也不等于业务完成。通过当前运行与历史结果核对输出、失败码及外部动作结果。调整公式验证业务样例，调整 Trigger 验证对应事件和批次，调整定时执行验证目标执行者与时间；只做与本次变更有关的检查。
