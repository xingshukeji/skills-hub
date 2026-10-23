# 模型变更、恢复与应用升级

用于已有业务的字段调整、删除恢复、应用包升级和中断处理。新模型与制品构建见[建模](modeling.md)，包、宿主和应用启用的关系见[公共服务与应用交付](shared-services.md)。

## 模型保存与实际可用状态

普通模型不是默认的草稿/发布双态，但字段结构变更仍可能部署失败。管理描述的 `deployment` 用于判断变化是否真正可用：

| 属性 | 用途 |
| --- | --- |
| `availability/operation` | 当前可用性及正在处理的结构动作 |
| `effectiveDefinition` | 当前实际生效的类型、长度、精度和可空性 |
| `requestedDefinition` | 本次希望达到的定义，不能直接当成生效结构 |
| `failureCode/lastAttemptAt` | 定位失败及上次尝试 |
| `canRetry/canRevise/canAbandon` | 当前允许哪些恢复动作，页面据此提供操作 |

例如把文本长度由 160 缩成 80 时，现存值可能不满足新定义。保留原值并处理具体冲突；不能只因模型请求已经提交就按 80 字符的新协议写入，也不能自动截断旧业务数据。

以下用 fieldPath 表示 `/api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}`，普通字段恢复入口为：

| 请求 | 用途 |
| --- | --- |
| `POST {fieldPath}:retryDeployment` | 原意图在问题解决后重试 |
| `PATCH {fieldPath}/failed-deployment` | 在允许修订时提交修正后的字段定义差量 |
| `DELETE {fieldPath}/failed-deployment` | 在允许放弃时结束该失败变更；查看结果的 `fieldRemoved/field` |

这些管理变更使用返回的 ETag 作为 `If-Match`，修订入口还支持原操作的 `Idempotency-Key` 语义；按目标合同保存和使用实际值。冲突后回读当前定义，不能用缺省 ETag 覆盖他人的新修改。新字段创建失败与已有字段修改失败的放弃结果可能不同，不能把 abandon 一律显示成“恢复旧字段”。

若错误中带有应用包操作 `operationId`，继续追踪该操作；不要同时调用普通字段恢复和另一次包安装来竞争处理同一变化。业务页面只消费有效模型和 Runtime 可用状态，字段管理权限无需下放给录入者。

## 删除影响与回收站

对象与字段删除影响分别通过 `GET /api/metadata/v1/entities/{entityCode}/delete-impact`、`GET /api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}/delete-impact` 读取。响应有 `metadataRevision/dependencies/requiresConfirmation/impactToken`；实际 DELETE 按目标要求带当前 `If-Match` 与 `X-Impact-Token`。影响令牌证明检查对应哪次变化，不是用户授权的替代品。

普通对象/字段的结构删除可能删除实际表、列及数据，元数据的删除标记不保证这些数据能恢复。包管理的定义退出另有保留规则，不能把两者混用。

回收站基址为 `/api/service/recycle-bin/v1`：

| 请求 | 结果与消费 |
| --- | --- |
| `GET /resources` | 当前支持的 `{resourceKey, label, deletedCount}` 列表 |
| `GET /resources/{resourceKey}/items?page=1&pageSize=25&search=...` | 分页 `{items, page, pageSize, totalCount}`；项有 `itemId/displayName/code/deletedAt/deletedById` |
| `POST /resources/{resourceKey}/items/{itemId}/restore` | 恢复指定资源，返回 `{resourceKey, itemId, displayName}` |

resourceKey 从资源列表取得，不从对象 API 名拼造。当前回收站入口还要求对象设计管理与明确记录管理权限，不是所有业务用户都能恢复自己看过的数据。`recycle_bin.resource_not_supported` 表示没有该能力，`recycle_bin.restore_conflict` 表示恢复条件冲突；回读并处理当前名称、引用或状态，不能自动删除占用项来腾位置。

恢复后重新检查资源及其业务引用。这里没有通用的“所有记录撤销删除”“一键恢复整库”或永久清理 API 承诺；需要哪类恢复，先用资源目录和对应资源合同确定。

## 先读资源的管理边界

已安装包的管理 DTO 可附带 `management`：`origin/state/package/editableProperties/allowedActions/restrictions/policyVersion/revision`。配置表单按这个描述组织编辑，提交原资源接口允许的差量；`management` 是响应描述，不作为请求内容回传，也不是最终授权结论。

| 内容归属 | 升级时如何处理 |
| --- | --- |
| 稳定身份、API 名等身份属性 | 沿用既有身份；不能靠改名或同名重建完成升级 |
| 发布者控制的定义 | 由目标包版本推进；租户不能通过普通编辑覆盖包代码或结构规则 |
| 租户可配置属性 | 保留显式配置；未覆盖的属性跟随目标包默认。显式值即使等于旧默认，也不是“没有覆盖” |
| 租户本地子资源 | 保持本地来源，并校验父对象与引用继续有效，不按同名自动收编 |
| 包初始化的业务数据 | 只初始化真正首次出现的身份，不重复覆盖、补建或复活已经修改/删除的业务记录 |

允许隐藏的包视图在升级后继续保留隐藏状态；字段、权限或执行定义不能一概套用同一隐藏/保留规则。退役资源的“保留历史”也不等于仍能执行旧代码或继续授予旧权限。

全员包权限集还有独立的租户授权选择：发布者维护 `assignmentAudience`，租户安装绑定保存 `allEmployeesEnabled`。升级、重试及同一安装重引入保留显式 false，不能用包默认值重新开启；首次启用和已启用集扩权会产生当前及未来员工的安全影响。协议、示例和固定集的区别见[初始化基础](initialized-platform.md)。

## 安装与升级的公开操作

包管理 API 基址为 `/api/application/v1`。安装、预览、查看组件和恢复等通常使用具备实际管理资格的租户登录态；`packages:build` 的 Token 准入例外不自动开放其余管理接口。

| 请求 | 用途 |
| --- | --- |
| `POST /packages/{packageId}/preview` | 只读预览目标版本，返回 ready、变更、绑定缺口、冲突与影响确认 |
| `POST /packages/{packageId}/install` | 初装或切换版本，创建可追踪的操作 |
| `GET /installations/{installationId}` | 当前版本、revision、activeOperationId/latestOperationId |
| `GET /installations/{installationId}/components` | 组件状态、是否有效、允许的绑定及管理描述 |
| `POST /installations/{installationId}/components/{recordId}:restore` | 对允许恢复的隐藏组件提交 `{expectedRevision}`，不代表所有包资源都能恢复 |
| `GET /installations/{installationId}/operations` | 历史操作，分页结果使用 hasMore |
| `POST /installations/{installationId}/check` | 按当前调用者检查安装资源状态，不等于完整业务验收 |
| `GET /operations/{operationId}` | 操作状态、错误及 requiredBindings/requiredConfirmations/conflicts 等详情 |
| `POST /operations/{operationId}/resolve` | 补齐当前操作允许的配置和处理方案 |
| `POST /operations/{operationId}/retry` | 可重试失败重新预检，可能产生新操作 |
| `POST /operations/{operationId}/continue` | 继续原 Running/Finalizing 操作的冻结计划，不接受新目标 |
| `POST /operations/{operationId}/cancel` | 取消允许取消的 Pending/Waiting 操作 |
| `DELETE /installations/{installationId}` | 受管卸载操作，不等于删除全部业务数据 |

preview 与 install 使用同一请求形状，例如已存在安装的版本升级：

```json
{
  "versionId": "<已取得的目标版本ID>",
  "expectedRevision": 12,
  "tenantBindings": {},
  "confirmations": [],
  "requestId": "<本次操作稳定请求ID>"
}
```

revision 取自当前安装；绑定键、绑定值结构、确认的 `recordId/unit/token` 都从实际预览或操作详情取得，不拿旧环境的用户、变量或确认令牌照搬。空对象只是例子；目标有缺口时提交对应合法绑定。相同操作重试使用原 requestId，结果未知先查询安装及已有操作；不能每次网络重试创建新意图。

resolve 的 body 包含 `expectedRevision`，并按实际缺口提交 `tenantBindings/confirmations/resolutions/configurationChanges`。只修改服务端给出的可编辑属性；包身份或发布者控制属性冲突时，选择兼容版本或修正业务设计，不把全部冲突机械设成“采用租户值”。候选配置在操作成功生效前不作为当前运行定义。

旧安装若返回 `managed_policy_upgrade_required` 或来源控制待核对，按受管策略预览与转换入口处理其具体差异；不能把旧租户覆盖自动标记成合法新策略，也不能用同版本重装绕开控制。转换完成与业务数据修复是不同结果。

## 根据状态接续

| 状态 | 对业务的含义与下一步 |
| --- | --- |
| `Pending` | 等待处理或在途执行结束；按当前操作继续观察，可在允许时取消 |
| `WaitingForResolution` | 有绑定、兼容性或确认缺口；保留输入，按当前 revision 解决并重新预检 |
| `Running` / `Finalizing` | 已开始分阶段变更，本应用可能返回 `application_change_in_progress`；继续同一操作，不能取消或另建操作覆盖 |
| `Failed` | 按 errorCode 和详情判断能否 retry；要求重新提交时恢复完整输入后发起新请求 |
| `Succeeded` | 操作已完成，再检查安装版本、组件及本次业务结果 |
| `Cancelled` | 操作已取消，不据此宣称目标版本生效 |

当前安装恢复是沿原操作继续完成，不能笼统承诺跨库回滚。Running/Finalizing 的网络或服务中断不代表“什么都没写”；保留 operationId，通过 continue 和管理入口恢复，避免直接写库、清除状态或重新初始化。

卸载会清除当前安装版本并处理实际自动化等资源的可用性，仍保留必要绑定、结构、变量、业务数据和历史；依赖冲突仍需处理。重装不重复初始化已处理过的业务种子。选择较旧版本也需要通过当前数据与结构兼容性校验，不是数据库时间点回滚。

例如升级维修应用时，企业自定的列标签和允许的环境绑定应保留，新包业务逻辑随版本推进；旧数据不满足新增必填约束时，先采用兼容过渡版本或本次已授权的数据修复，再继续同一升级目标。交付结果分别说明包操作是否成功、宿主代码是否更新，以及哪些业务行为已实际验证。
