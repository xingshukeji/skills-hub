# 模型变更、恢复与应用升级

用于字段变更、删除恢复、包升级与中断接续；构建见[建模](modeling.md)，交付层次见[公共服务](shared-services.md)。

## 模型保存与实际可用状态

普通模型没有默认草稿/发布双态，结构变更仍可能失败。按 deployment 判断生效：

| 属性 | 用途 |
| --- | --- |
| `availability/operation` | 当前可用性及正在处理的结构动作 |
| `effectiveDefinition` | 当前实际生效的类型、长度、精度和可空性 |
| `requestedDefinition` | 本次希望达到的定义，不能直接当成生效结构 |
| `failureCode/lastAttemptAt` | 定位失败及上次尝试 |
| `canRetry/canRevise/canAbandon` | 当前允许哪些恢复动作，页面据此提供操作 |

例如缩短文本长度须处理存量冲突，不能以已提交的 requestedDefinition 代替有效结构或自动截断旧值。

以下用 fieldPath 表示 `/api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}`，普通字段恢复入口为：

| 请求 | 用途 |
| --- | --- |
| `POST {fieldPath}:retryDeployment` | 原意图在问题解决后重试 |
| `PATCH {fieldPath}/failed-deployment` | 在允许修订时提交修正后的字段定义差量 |
| `DELETE {fieldPath}/failed-deployment` | 在允许放弃时结束该失败变更；查看结果的 `fieldRemoved/field` |

管理变更使用实际 ETag/If-Match，修订沿原操作 Idempotency-Key；冲突后重读。放弃新建失败与修改失败的结果可能不同，读取 fieldRemoved/field。若带包 operationId，沿该操作恢复，不与普通字段恢复或新安装并行竞争。

## 删除影响与回收站

对象/字段删除前，分别 GET `/api/metadata/v1/entities/{entityCode}/delete-impact` 或 `/api/metadata/v1/entities/{entityCode}/fields/{fieldApiName}/delete-impact`，读 metadataRevision/dependencies/requiresConfirmation/impactToken；DELETE 带当前 If-Match/X-Impact-Token。普通结构删除可能删除表、列和数据，不等于记录软删除；包资源退出另按管理策略。

回收站基址为 `/api/service/recycle-bin/v1`：

| 请求 | 结果与消费 |
| --- | --- |
| `GET /resources` | 当前有已删内容的受支持资源 `{resourceKey, label, deletedCount}` 列表；空数组不表示没有恢复能力 |
| `GET /resources/{resourceKey}/items?page=1&pageSize=25&search=...` | 分页 `{items, page, pageSize, totalCount}`；项有 `resourceKey/itemId/displayName/code/deletedAt/deletedById` |
| `POST /resources/{resourceKey}/items/{itemId}/restore` | 恢复指定资源，返回 `{resourceKey, itemId, displayName}` |

resourceKey 从列表取并编码为单个 segment，普通记录实测为 `runtime-record:<entityCode>`。入口需对象设计及明确记录管理权；`recycle_bin.resource_not_supported` 表示不支持，`recycle_bin.restore_conflict` 表示条件冲突。冲突后核对名称/引用，不删除占用项来腾位置。

普通记录已实测软删后 GET 404、恢复后 200，保留 recordId/createdAt/Owner/父引用并产生删除/恢复历史。“归档/作废”仍是业务状态；恢复后核对引用与补偿，不等于重放通知或跨系统回滚。

## 先读资源的管理边界

管理 DTO 的 management 含 origin/state/package/editableProperties/allowedActions/restrictions/policyVersion/revision。按可编辑属性提交原接口差量，不回传 management 或以它代替最终授权。

| 内容归属 | 升级时如何处理 |
| --- | --- |
| 稳定身份、API 名等身份属性 | 沿用既有身份；不能靠改名或同名重建完成升级 |
| 发布者控制的定义 | 由目标包版本推进；租户不能通过普通编辑覆盖包代码或结构规则 |
| 租户可配置属性 | 保留显式配置；未覆盖的属性跟随目标包默认。显式值即使等于旧默认，也不是“没有覆盖” |
| 租户本地子资源 | 保持本地来源，并校验父对象与引用继续有效，不按同名自动收编 |
| 包初始化的业务数据 | 只初始化真正首次出现的身份，不重复覆盖、补建或复活已经修改/删除的业务记录 |

可隐藏视图在升级后保留隐藏，其他资源按各自策略；保留历史不保证旧代码或授权仍有效。全员包集的 allEmployeesEnabled 保留显式 false，首次启用/扩权按[初始化合同](initialized-platform.md)确认。

## 安装与升级的公开操作

包管理基址 `/api/application/v1`，使用有管理资格的租户登录态；packages:build 的 Token 准入例外不适用于其余管理入口。

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

preview/install 使用相同请求；已有安装升级示例：

```json
{
  "versionId": "<已取得的目标版本ID>",
  "expectedRevision": 12,
  "tenantBindings": {},
  "confirmations": [],
  "requestId": "<本次操作稳定请求ID>"
}
```

revision 取当前安装；绑定结构与确认 recordId/unit/token 从实际预览取得。相同操作沿用 requestId，结果未知先查已有操作，不盲目重发。

resolve 提交 expectedRevision 和当前缺口所需的 tenantBindings/confirmations/resolutions/configurationChanges，仅修改可编辑属性。身份或发布者属性冲突需兼容版本/业务修正；成功前不消费候选定义。

managed_policy_upgrade_required 等旧安装提示按策略预览/转换处理，不以同版本重装绕过；策略转换不代替数据修复。

## 根据状态接续

| 状态 | 对业务的含义与下一步 |
| --- | --- |
| `Pending` | 等待处理或在途执行结束；按当前操作继续观察，可在允许时取消 |
| `WaitingForResolution` | 有绑定、兼容性或确认缺口；保留输入，按当前 revision 解决并重新预检 |
| `Running` / `Finalizing` | 已开始分阶段变更，本应用可能返回 `application_change_in_progress`；继续同一操作，不能取消或另建操作覆盖 |
| `Failed` | 按 errorCode 和详情判断能否 retry；要求重新提交时恢复完整输入后发起新请求 |
| `Succeeded` | 操作已完成，再检查安装版本、组件及本次业务结果 |
| `Cancelled` | 操作已取消，不据此宣称目标版本生效 |

Running/Finalizing 中断保留 operationId，通过 continue 接续，不能当作未写入或承诺跨库回滚。

卸载退出当前版本并处理资源可用性，保留必要绑定、结构、变量、业务数据与历史；仍须处理依赖。重装不重复种子初始化，切旧版本也须通过当前结构/数据兼容性校验。
