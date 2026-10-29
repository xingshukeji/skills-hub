# 业务 API 与返回合同

产品事实：XRain；公共基础设施由 AiInfra 维护，业务差异由目标项目维护。
维护与适用：本专题由 skills-hub 维护，面向公开能力的业务使用；接口、示例与历史实测的原有适用条件继续有效。内部修改由目标项目入口定位源码与测试。

按业务动作查接口，细节见各专题。HTTP、SDK、管理请求和包资源分别适配。[验证范围](api-verification.md)区分实测与合同核对；[响应样例](../assets/http-contract-samples.json)已替换环境标识，responseExcerpt 为摘录。

## 调用前确定三个身份

使用现有已认证客户端或请求封装，路径相对 XRain origin，路径参数编码为单个 segment。

| 身份 | 取值与用途 |
| --- | --- |
| 调用者和租户 | 从真实会话/执行绑定取得；body 里的 userId、tenantId 不替代认证 |
| 对象 | 运行路径使用目录的 entityCode；自定义对象通常与 entityApiName 同值，User 实测为 runtime.User / User |
| 资源和记录 | objectId、fieldId、recordId、应用 resourceId、functionId、versionId 分别使用；标签不是 ID |

实测使用租户登录态，API Token 另查准入。入口权限不包含数据授权：普通成员可读查询能力与人员资料，未授权对象仍返回 403。

## 记录、统计与协作

下表的 `R` 表示 `/api/data/v1/entities/{entityCode}/records`。记录字段值在 values 中，不把元数据描述传入 values。

| 业务动作 | HTTP 与输入 | 成功返回 |
| --- | --- | --- |
| 分页查询 | `POST R:query`；`{page, pageSize, fields, filter?, sort?, includeTotalCount?, aggregates?, presentation?}` | `{entityCode, metadataRevision, page, pageSize, totalCount, fields, records, queryPlan, aggregates, temporalContracts}`；使用视图呈现时另有 cellStyles/viewRevision |
| 读取一条 | `GET R/{recordId}` | `{recordId, entityCode, createdAt, updatedAt, values}`；敏感显示值另在 maskedDisplayValues |
| 新建 | `POST R`；`{values}` | HTTP 201，单条记录 |
| 修改 | `PUT R/{recordId}`；`{values, expectedValues?}` | HTTP 200，更新后的单条记录 |
| 删除 | `DELETE R/{recordId}` | HTTP 204，空正文 |
| 同对象批量创建 | `POST R:batchCreate`；`{records: [{values}, ...]}` | 记录数组 |
| 同对象批量修改 | `POST R:batchUpdate`；`{records: [{recordId, values, expectedValues?}, ...]}` | 记录数组 |
| 同对象批量删除 | `POST R:batchDelete`；`{recordIds: [...]}` | HTTP 204，空正文 |
| 计数 | `POST R:count`；查询条件 | JSON 数字，例如 `2`，没有 count 外层 |
| 指定字段组合去重 | `POST R:distinct`；`{fields, filter?}` | `{entityCode, metadataRevision, fields, rows, queryPlan}`；每行 `{values}` |
| 第一条或唯一一条 | `POST R:first / R:single`；查询条件 | 单条记录；无匹配为错误，single 多条也为错误 |
| 允许无匹配 | `POST R:firstOrDefault / R:singleOrDefault` | 单条记录或 JSON null；不是空数组 |
| 授权导出 | `POST R:export`；分页查询 | 与查询同形的当前页 JSON；另检查 export 权限，不自动生成文件 |
| 多对象/多条件一起读取 | `POST /api/data/v1/records:queryBatch`；`{queries: [{entityCode, query}, ...]}` | `{results: [{entityCode, result}, ...]}`，最多 8 项 |
| 记录历史 | `GET R/{recordId}/history?page=1&pageSize=20` | `{page, pageSize, totalCount, items}`；项含 action、操作者和 changes |
| 按需读取敏感原值 | `POST R/{recordId}/original-values`；`{fields: ["contact__c"]}` | `{recordId, values}`；按有效访问选择直接敏感字段，非敏感字段实测 400 |
| Owner 交接 | `POST R/{recordId}:transferOwner`；`{ownerId}` | 合同为 `{recordId, ownerId}`；本次验证了无目标对象 Read 权限时的拒绝 |

表中批量返回是原子调用的默认形态。支持双模式的目标可在上述请求增加 `allOrNone`；false 返回逐项结果而非原记录数组/204，必须检查每项错误和 commitState。先核对目标实际合同，详见[批量与文件操作](data-operations.md)。文件导入/导出也先查目标能力入口，不从普通 `:export` 的 JSON 返回推断没有 XLSX 能力。

query 的条件叶子是 `{field, op, value}`，and/or 组成非空条件组；选项值、精确数值、日期时间遵守字段合同。实测金额 `"10.20"` 原样作为字符串返回，业务时刻的七位小数输入被规范为六位微秒 UTC。查询 pageSize 为 1、总记录数为 3 时，聚合仍返回完整筛选范围的 `"60.90"`，不能拿当前页代替汇总。

关联字段可按目标支持的路径选取，例如 `parentId__c.name__c`；实测结果在 values 中使用同名点路径键，不返回自行猜测的嵌套 parent 对象。标准字段、敏感值和历史差异的消费见[对象基础](object-foundation.md)及[元数据与前端](metadata-and-ui.md)。

人工分享的能力、候选、资格和已有分享分别读取 `R/{recordId}/shares/capability`、`/recipients`、`/eligibility?userId=...`、分享根路径；列表使用 `{page, pageSize, totalCount, items}`。capability 和 eligibility 都有独立 DTO，不能用一个通用 allowed 字段代替。分享写入、Owner 资格和历史旧值语义见[组织与协作](organization-and-collaboration.md)；批量事务、去重限制、聚合及导出见[数据操作](data-operations.md)。

## 页面所需的元数据与候选

| 目的 | HTTP | 返回和消费方式 |
| --- | --- | --- |
| 当前可见业务对象 | `GET /api/metadata/v1/business-objects` | `{metadataRevision, objects}`；无可见对象时 objects 可为空 |
| 描述一个对象 | `GET /api/metadata/v1/entities/{entityCode}/describe` | `{object, fields, listViews, metadataRevision, temporalContracts}`；object.access 是当前主体的有效访问描述 |
| 字段目录 | `GET /api/metadata/v1/entities/{entityCode}/fields` | `{entityCode, entityApiName, metadataRevision, fields, temporalContracts}`；不要当作 fields 裸数组 |
| 查询运算符和值模式 | `GET /api/data/v1/query-capabilities` | `{fieldTypes, operatorSets, operators, limits}` |
| Picklist/MultiPicklist 候选 | `GET /api/data/v1/entities/{entityCode}/fields/{fieldApiName}/options?page=1&pageSize=50&search=...` | `{page, pageSize, totalCount, items}`；项 `{value, label, color}` |
| 视图列表和修订 | `GET /api/metadata/v1/entities/{entityCode}/views` | `{metadataRevision, listViews}` |
| 视图转换为查询 | `GET /api/metadata/v1/entities/{entityCode}/views/{viewName}/runtime-query` | 取响应中的 query；外层 filter 是说明文本，不是查询 AST |
| 当前身份可选的视图字段路径 | `GET /api/metadata/v1/entities/{entityCode}/view-field-catalog` | `{entityCode, metadataRevision, fields}`；不代表完整保存定义，也不替代运行时数据授权 |
| 设计标准 | `GET /api/metadata/v1/standards/entity-design` | 类型、命名、呈现、筛选和时间合同；开发管理入口 |

实测：describe 用 fieldApiName，查询字段描述用 apiName；describe 无 fields[].options；`/options` 仅支持选项类型，UserRef 返回 400。人员读受控成员资料，Lookup 查询目标对象。

视图转换实测 `query.presentation: null`；显示覆盖与条件填色需在 presentation 中提交 `{viewName, viewRevision: views.metadataRevision}`。配置、保存差量、记录类型和前端消费见[元数据与前端](metadata-and-ui.md)。

## 当前用户、人员、设置与时间

| 目的 | HTTP | 返回 |
| --- | --- | --- |
| 完整调用上下文 | `GET /api/service/authen/v1/account/context` | `{tenantId, userId, effectivePermissions, scope, regionalContext}` |
| 受控人员资料 | `GET /api/tenant/v1/members?page=1&pageSize=20&search=...`；`GET /api/tenant/v1/members/{userId}` | 列表 `{items, totalCount}`；单人 `{userId, name, isAI, jobTitle, jobDescription, isActive, avatar, applicationId}` |
| 个人应用设置 | `GET/PUT /api/tenant/v1/settings/{settingApp}/{key}`；PUT `{value: string}` | 已配置合同为 `{settingApp, key, value}`；实测未配置 GET 为 404 空正文 |
| 租户地区默认 | `GET /api/tenant/v1/settings/regional-defaults` | 可为 `{}`；不能据此补造已配置的业务时区 |
| 当地时间解析 | `POST /api/service/authen/v1/account/temporal/resolve`；`{items: [{key, localDateTime, timeZoneId, temporalContractId, offset?}]}` | `{key, utc, errorCode, candidates}` 数组；逐项判断错误 |
| 业务日边界 | `POST /api/service/authen/v1/account/temporal/day-range`；`{date, timeZoneId}` | `{startUtc, endUtc}`，半开区间；夏令时切换日不必为 24 小时 |

成员资料不含任意 User 扩展、角色、邮箱或电话，目录可见不代表业务动作资格。详见[组织与协作](organization-and-collaboration.md)、[运行配置](configuration-and-api.md)和[时间上下文](regional-context.md)。

## 规则、集成与自动执行

| 目的 | 入口 | 如何使用返回 |
| --- | --- | --- |
| 发现可调用能力 | `GET /api/orchestration/v1/callables` | 数组；用 key 调用，signature 可能为 null，结合 helpText 和合同 |
| 编排一次业务动作 | `POST /api/orchestration/v1/debug`；`{source, input, inputFields}` | 检查 isSuccess/errorCode，业务结果在 output；supportsTrigger 是另一项判断 |
| 读取编排定义 | `GET /api/orchestration/v1/definitions` | 定义数组；源码、输入模型和运行结果分开使用 |
| 读取应用函数选择 | `GET /api/xrain/v1/applications/{applicationId}/functions` | `{revision, items, catalog}`；项的 id 是调用所用 resourceId |
| 执行应用所选函数 | `POST /api/xrain/v1/applications/{applicationId}/functions/{resourceId}:execute`；`{input, expectedVersionId}` | 沿函数合同和实际执行结果解析；此次核对了选择目录，未执行现有业务算法 |
| 发现已配置的外部接口 | `GET /api/integration/v1/http-interfaces/catalog` | `{baseUrl, generatedAtUtc, status, items}`；读取 invokeMethod/invokePath/permissionName/inputVariables |
| 调用已登记外部接口 | `POST /api/integration/v1/http-interfaces/{interfaceId}`；输入对象直接作 body | 合同为 `{statusCode, isSuccess, headers, body}`；此次未向外部系统执行动作 |
| 查看定时任务 | `GET /api/automation/routines?page=1&pageSize=20` | `{totalCount, page, pageSize, items}`；必须提供分页参数 |
| 查看实际执行成员 | `GET /api/automation/routines/execution-user` | `{userId}`；null 表示未配置 |
| 预览调度 | `POST /api/automation/routines/schedule-preview`；`{scheduleType, executeTime, timeZoneId}` | `{nextRunAt, timeZoneId, offset}`，不会启用任务 |

debug 会真实执行动作；正式调用使用函数、接口或 Routine 入口。Trigger 合同与后台执行成员分别核对，事务边界见[自动化](automation.md)和[系统集成](integration.md)。

## 应用、助手、通知和文件

| 业务能力 | 入口或接入方式 | 需要区分的结果 |
| --- | --- | --- |
| 应用准入 | `POST /api/xrain/v1/applications/{applicationId}/admission`，body `{}` | `{allowed, reason, applicationId, userId}` |
| 应用消息资格 | 同应用路径 `/message-authorization`，POST `{}` | 可独立返回 403；应用 admission 成功不包含发送权 |
| 应用选用的智能体 | 同应用路径 `/agents`，GET | `{bindings, defaultAgentId}`，不包含智能体完整定义 |
| 个人/应用助手资格 | `GET /api/xrain/v1/agents/qualifications`，可选 applicationId | `{tenantId, userId, applicationId, items, defaultAgentId}`；应用只按既有准入返回选用项，无 applicationId 时读取本人订阅 |
| 智能体定义目录 | `GET /api/xrain/v1/agents/directory` 或已交付的 Runtime 目录 | Runtime 负责目录时，XRain 返回 409 与 agents.runtime_owned_catalog |
| 个人邮箱 | `/api/delivery/v1/email/me/providers`、`/accounts`；再按账号调用检索、正文、草稿入口 | 两个发现入口均返回数组；空 accounts 不证明检索/草稿已可用 |
| 组织通知 | 已登记的 delivery.sms/email/feishu callable 或已配置的 HTTP 接口 | 通道状态、发送资格、受理和送达分别判断 |
| 附件 | Workforce/企业宿主附件服务；平台 `/api/service/files/v1/files` 使用受支持服务主体 | fileId、业务附件关系、读取权及预览结果分别处理 |
| Task、消息和会话工作区 | 复用 Workforce 公共宿主与服务 | 不把更新 Task 数据或一次智能体运行等同于通知送达或业务完成 |

接入细节见[助手资格](agent-access.md)、[个人邮箱](personal-email.md)和[公共服务](shared-services.md)；本次未实测邮件内容操作与文件服务。

## 开发配置与交付接口

管理入口维护配置，业务入口消费生效资源：

| 配置能力 | 主要读取/操作入口 | 返回或边界 |
| --- | --- | --- |
| 全员基础权限 | `GET /api/service/authen/v1/security/permission-sets/xrain-all-employees` | permissionSetName/permissions/automaticAudience 等；users/roles 为空不表示没有自动受众 |
| 选项集与记录类型 | `/api/metadata/v1/picklists`、`/entities/{entityCode}/record-types/picklist-options` | 管理项用 id/name；运行候选用 value；不是同形 DTO |
| 组织与共享规则 | `/api/service/authen/v1/security/org-trees`；`/api/metadata/v1/sharing-rules` 和 `/sharing-rule-formulas` | 租户目录可为空，不能补造系统记录 |
| 平台变量 | `GET /api/variables/items` | 元信息数组；hasValue 表达是否配置，不返回明文 |
| 对外 API 目录 | `GET /api/service/authen/v1/security/tenant-api-catalog?catalog=external` | `{baseUrl, generatedAtUtc, catalogExposure, items, temporalContracts}`；不覆盖所有业务模块 |
| 完整租户 OpenAPI | `GET /api/service/authen/v1/security/tenant-api-catalog?catalog=directory&format=openapi` | OpenAPI 3.1；版本、业务分组、参数、响应与权限；租户管理员登录后可从“API 访问 → 接口文档”查阅，不含 Host 接口 |
| 包、安装与组件 | `/api/application/v1/packages`；`/installations/{installationId}`、`/components`、`/operations` | 包为数组；安装为对象；组件有 items；操作列表用 hasMore |
| 升级/安装操作状态 | `GET /api/application/v1/operations/{operationId}` | `{id, installationId, sourceVersionId, targetVersionId, sourceRevision, status, errorCode, details, createdAt, updatedAt}` |
| 模型删除影响 | `/api/metadata/v1/entities/{entityCode}/delete-impact` | 当前 metadataRevision/impactToken；DELETE 使用 If-Match/X-Impact-Token |
| 回收站中有内容的资源 | `GET /api/service/recycle-bin/v1/resources` | `{resourceKey, label, deletedCount}` 数组；只列当前有已删内容的受支持资源，空数组不表示不支持恢复 |

配置和交付细节见[初始化基础](initialized-platform.md)、[运行配置](configuration-and-api.md)和[生命周期](lifecycle.md)。应用包中的 `kind/values` 是资源序列化，不是这些 HTTP 接口的请求 DTO。

## HTTP、SDK 与错误解析

实测 Workforce 0.3.8：`context()` 仅保留 tenantId/userId/effectivePermissions；`queryBatch()` 将 HTTP results 解为查询结果数组。其他方法查公开导出和类型，不按路由猜名称。

HTTP 无统一 `{success, data, error}` 外层；先判断状态码和正文，再按接口解析。以下均为实测：

| 情况 | 状态与错误结构 | 业务处理 |
| --- | --- | --- |
| 对象/接口权限不足 | 403，Problem 风格对象的 `errorCode: platform.security.permission_denied` | 保留具体缺少的权限原因，不改成管理员重试 |
| 条件更新冲突 | 409，`errorCode: platform.data.concurrency_conflict` | 保留用户输入，重读记录后处理 |
| 视图修订变化 | 409，`errorCode: view_revision_conflict` | 重读视图及 metadataRevision |
| 唯一查询命中多条 | 400，`errorCode: platform.data.query.multiple_records_matched` | 处理业务唯一性，不能静默取第一条 |
| 非选项字段查询 options | 400，`errorCode: platform.data.validation_failed` | 改用对应目标对象/人员接口 |
| 普通写入系统管理字段 | 403，`errorCode: platform.data.field_not_writable` | 按有效写入字段提交；Owner 使用专门转移入口 |
| 旧版本助手额外门槛 | 历史实测 403，`{error: "agents.application_context_required"}` | 现行规则已取消，核对运行制品与源码修复；不通过加客户端映射或个人订阅绕过 |
| 未配置个人设置 | 404，空正文 | 使用应用明确的缺省值 |
| 旧版本目录扩展/OpenAPI 服务错误 | 历史实测 500，`{message, details, traceId}` | 核对部署版本和[验证记录](api-verification.md)，保留错误及 traceId；不当成空列表 |
| Text 超过声明长度 | 本次 25 字符写入长度 24 的字段返回 500，`{message, details, traceId}` | 保留服务错误并提示实际长度限制；不能假定所有字段校验均返回 400 |

记录与元数据错误通常有 type/title/status/errorCode/message，部分含 traceId；智能体 error 则可能是字符串，按各自结构解析。未实测操作见[验证范围](api-verification.md)。
