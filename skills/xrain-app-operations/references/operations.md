# 安装与恢复

新安装/升级核对市场、平台、租户、packageId、versionId 与摘要；显示名不作身份。市场 GET /api/exchange/v1/packages 供消费浏览；平台 GET /api/application/v1/exchange 给出所用市场。capabilities 是当前身份能力提示；catalog-bootstrap 的 unavailable:true 是版本读取失败。

以下平台路径前缀 /api/application/v1，使用目标租户管理会话：

| 目标 | 方法/路径 |
| --- | --- |
| 目录/版本 | GET /packages、/packages/{packageId}/versions |
| 导入市场指定版 | POST /exchange/packages/{packageId}/versions/{versionId}:import |
| 预检/安装 | POST /packages/{packageId}/preview、/packages/{packageId}/install |
| 安装/原操作 | GET /installations/{id}、/operations/{id} |
| 组件/操作历史 | GET /installations/{id}/components、/installations/{id}/operations?page=1&pageSize=20 |
| 当前身份检查 | POST /installations/{id}/check |

导入是写操作，属于安装/导入授权范围，不与 Host 原包导入混用。

## 预检与状态

使用实际 versionId、当前 expectedRevision、所需 tenantBindings/confirmations；安装可带 requestId。读 ready、requiredBindings、requiredConfirmations、conflicts、changes 及源/目标版本。确认项为原响应 {recordId,unit,token}，不造 token 或沿用过期影响。

提交返回 operation，保存 id/installationId/sourceRevision/status；未知结果按原 request、activeOperationId/latestOperationId 与历史恢复关联，不误认别人的最新操作。

| status | 接续 |
| --- | --- |
| Pending | 跟踪原操作；明确取消目标时用 /cancel |
| WaitingForResolution | POST /operations/{id}/resolve，当前 revision 与已决定绑定/配置/确认；会推进执行，不用 continue |
| Running/Finalizing | 跟踪；确认中断且获准恢复才 POST /operations/{id}/continue |
| Failed | 根因排除且安装仍为 sourceRevision 时 POST /operations/{id}/retry，使用新 requestId，跟踪返回的新 operation |
| Cancelled | 不继续；重新要求安装则从当前记录和新预检开始 |
| Succeeded | 核对安装版本、组件和原用户结果 |

没有 WaitingForBindings 状态。requiresResubmission:true 或 application_operation_resubmission_required 要恢复原变更输入、重读 revision/影响再提交，不能反复 retry。状态/revision 变化先查期间变更。

## 绑定与配置

tenantBindings 键为原响应的 recordId/binding，保留大小写。BizConnector/baseAddress 属于连接器记录，不属于引用它的 BizHttpRequest。只选目标租户受管资源，秘密只用凭据引用。

当前策略不接受普通属性 KeepTenant/UsePackage；升级按策略保留租户配置，包控制/不可变属性不可通用合并。$configuration 或 managed_contract_incompatible 冲突，读 editableProperties/editorContext，只提交获准可编辑项：

```json
{"configurationChanges":{"apr-view/fieldNames":{"present":true,"value":["name","amount"]}}}
```

明确移除允许的可选属性用 {present:false}，不能带 value。resolutions 的 recordId/unit 属组件退役等独立路径；$delete 可 Retain 的种类有限，枚举存在不证明当前路径支持。旧式普通属性冲突先查部署策略/迁移，包控制属性交包维护。

原 WaitingForResolution 操作已有选择时，用[请求生成器](receipt.md#生成原操作的-resolve-请求)，状态变化后重新读取，不发旧文件。

/check 仅 CurrentActorObjectReadOnly；NotChecked 不是通过。核对组件 effective/state/baseVersionId/changedProperties，再用原普通用户验证相关查询、保存或交付。
