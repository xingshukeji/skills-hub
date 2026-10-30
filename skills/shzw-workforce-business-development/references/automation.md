# 函数、业务编排与自动化

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

## 三种能力分别解决什么

| 能力 | 作用 | 常见用途 |
| --- | --- | --- |
| 可复用函数 | 提供有输入输出契约的计算或操作，供其他业务调用 | 费用计算、数据规范化、重复使用的业务规则 |
| 业务编排 | 一次 `execute(ctx)` 组合数据、函数和已登记接口 | 校验并更新业务记录、组合平台与外部系统结果 |
| Trigger / Routine | 在记录事件或某个时间执行编排 | 记录校验、提交后处理、定时同步或提醒 |

编排使用结构化输入与受控 JavaScript；Routine 选择编排、固定输入和调度。人工审批用原系统流程或业务状态/操作与 Task 协作实现，不将其当作拖拽审批流或自主智能体。

导入 XLSX 时也可绑定现有业务编排，用于来源转换、身份规范化、候选准备及批次校验。导入使用受限执行 profile，不能照搬下方普通编排的写入和投递调用；阶段、文件入口和回导边界见[导入中的业务编排](data-operations.md#导入中的业务编排)。

## 编排的调用模型

`GET /api/orchestration/v1/callables` 返回数组，含 key/source/label/helpText/signature/implementation。signature/implementation 可为 null，需结合 helpText 与合同，不保证存在完整 JSON Schema。使用实际 key：

| key 或类别 | 用途 |
| --- | --- |
| `identity.currentUser`、`identity.roles` | 当前执行者及其角色，不是任意用户管理接口 |
| `runtime.records.query`、`runtime.records.get` | 按实体和查询/记录 ID 读取平台记录 |
| `runtime.records.create`、`runtime.records.update` | 按 `{entityCode, values}` 或 `{entityCode, recordId, values, expectedValues?}` 写入 |
| 记录的 count、distinct、batch、所有权、分享、历史能力 | 统计、批量及专用记录动作，签名从目录取得 |
| `tenant.*` | 当前租户的可复用函数，使用该前缀并保留系统函数名称 |
| 已登记的 raw HTTP 接口名称 | 调用[系统集成](integration.md)中的外部接口 |
| `delivery.sms.send`、`delivery.email.sendByTemplate`、`delivery.feishu.sendByTemplate` | 使用已配置的投递能力，见[公共服务](shared-services.md) |

上下文提供 `ctx.input`、`ctx.profile`、`ctx.system` 与 `ctx.sdk.fn.invoke(key, input)`，不开放 npm、fetch、文件、进程或宿主 API。需要这些能力时放到企业宿主或受支持集成。查询已有维修申请对象示例：

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

inputFields 支持 name/label/type/required、说明与示例；type 为 string/integer/number/boolean/object/array，不是任意 JSON Schema。查询仍按执行者权限返回真实分页。

定义入口 `/api/orchestration/v1/definitions` 及 `/{id}`，创建字段为 label/name/helpText?/source/isActive/inputFields，source 为函数文本；版本在 `/{id}/versions`。租户函数在同域 `/functions` 维护源码与 contractJson。

debug 请求与返回见[业务 API](business-api.md)。它真实执行 callable，包括写入和投递副作用。读取 isSuccess、output、errorCode/errorMessage、sourceValid；supportsTrigger/contractIssues 是额外的 Trigger 合同检查。普通查询可成功而 supportsTrigger=false、contractIssues 含 trigger_response_contract_invalid，不能据此判普通执行失败。

## 函数版本与应用选择

源码、不可变版本、应用关联与当前选用分别维护。包可含 BizOrchestration/BizOrchestrationVersion/BizOrchestrationFunction，执行还需应用选用和授权。

已发布 `XRainRuntimeClient` 提供：

| 需要做什么 | 客户端方法 |
| --- | --- |
| 读应用当前函数关联 | `applicationFunctions(applicationId)` |
| 修改关联或当前选择 | `changeApplicationFunctions(applicationId, expectedRevision, changes)` |
| 读取函数版本 | `functionVersions(functionId)` |
| 创建当前函数的版本 | `createFunctionVersion(functionId)` |
| 试算指定版本 | `testFunctionVersion(versionId, input)` |
| 按应用选择执行 | `executeApplicationFunction(applicationId, resourceId, input, expectedVersionId)` |

createFunctionVersion 不收源码参数，先保存源码/合同再创建版本。changes 按当前管理合同；应用关联项 id 对应 resourceId，不等于 functionId/versionId。

执行带 expectedVersionId，修改选择带 expectedRevision；冲突后重读。正式函数及依赖须在应用有效关联中。不可变版本不冻结外部数据或动态依赖；需要历史重现时保存必要输入与依据。

## 事务与外部副作用

一次编排中的原生记录写入使用同一租户事务，有效完成后提交，失败回滚；Host/Tenant 不构成跨库原子事务。HTTP、邮件等外部副作用不回滚。组合操作按业务使用幂等键、结果查询或补偿，区分完成、受理中、失败与未知。

## 记录事件 Trigger

对象 triggersEnabled 与 Trigger.isActive 共同控制触发。绑定通过 supportsTrigger/合同校验的编排；工作台提供 Before/After × Insert/Update/Delete 模板。

| 时点 | 数据与失败语义 |
| --- | --- |
| Before | 在记录提交前同步运行，可用于业务校验；失败回滚本次写入批次 |
| After | 数据提交后调度，失败保留已经提交的记录；查看运行结果再处理 |

单条/批量共用集合输入：Insert/Update 为 records[]，Delete 为 ids[]；其余字段按模板。每个写入批次触发一次。After 保留事件操作者、上下文和选定版本，Worker 不变为管理员。

eventId 不等于单次投递唯一键，按运行记录与业务标识处理重复；不承诺 exactly-once。后续写入按实际变化限制，避免无条件自更新循环。

## 定时执行 Routine

Routine 引用编排、固定输入、Owner 和调度；支持 Manual/Daily/Workday。用 schedule-preview 核对 timeZoneId、下一次时刻和工作日，地区语义见[时间上下文](regional-context.md)。

基址 `/api/automation/routines`：列表必须传 page/pageSize；`/{id}` 下有 definition/schedule/enable/pause/runs/history/versions，活动运行在 `/{id}/active-runs`。读取执行人与调度预览的 DTO 见业务 API；其他写入按当前编辑合同。

Owner 是维护者，普通 Routine 由 automationExecutionUserId 指向的活跃成员执行，运行时检查权限；复用适用身份。

Workforce 新建的周期智能体安排和新登记的员工一次性检查由 Workforce 后端保存并调度，通过已有 Runtime 连接执行。周期安排由负责人本人启用并以其身份运行；一次性检查使用员工身份并核验原事项。两者的频率、停机恢复和时限分别判断，不创建普通 Task。

平台 Routine 继续处理平台业务自动化和尚未清理的旧 Workforce 安排；旧安排不自动迁移。不能通过普通 Routine 列表判断 Workforce 新安排是否存在。实际环境使用的版本与部署状态须分别核对。

启用和运行 ID 不证明业务完成；检查对应运行的输出、失败码及外部动作结果。
