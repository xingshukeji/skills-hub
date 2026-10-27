# 维护与退出

前缀 /api/application/v1；从当前 installation、revision、未完 operation 开始，按用户本次动作选择路径。

## 版本与定制

有发布者的应用仅允许当前 PublishedVersionId，或 maintainInstalledVersion 维护当前已装版本；市场还核对发布指针与来源。历史版本存在不等于可回退。application_publication_changed / application_exchange_source_changed 先核对来源，不擅自重新发布旧版给所有消费者。

渠道允许所选旧版才 preview/install 并检查兼容、删除、绑定及权限；版本变小不等于安全回退，包回退不等于回滚数据。只修当前配置不切“最新版”。

managed_property_read_only、managed_component_delete_forbidden、managed_extension_forbidden 是管理策略边界，不直写元数据。租户配置按策略保留；$configuration 只按 editableProperties/editorContext 修改，不能改用通用 KeepTenant/UsePackage。

## 隐藏组件

GET /installations/{id}/components。POST /installations/{id}/components/{recordId}:restore 仅支持 **Hidden 的 BizListView**，正文 {expectedRevision}；要求当前策略、有效安装、无未完操作及资源权限。回读新 revision/effective 并查普通用户列表，不能恢复任意已删除对象/字段。

## 策略迁移

managed_policy_upgrade_required 时，POST /installations/{id}/policy:preview 读当前/目标策略、revision、differences、configurationConflicts、requiredBindings/Confirmations。

已有授权涵盖实际影响后，POST /installations/{id}/policy:apply 使用 targetPolicyVersion、expectedRevision、restorePackageProperties、tenantBindings、configurationChanges、confirmations、requestId，保留返回 operation。挂起操作另有 /operations/{id}/policy:apply，仅 targetPolicyVersion/expectedRevision；两类请求不混用。迁移不是单改版本号，也不自动授权丢弃定制。

## 卸载

明确要求卸载时核对关联与保留资源，DELETE /installations/{id}，可带 {requestId,expectedRevision}。仍跟踪 operation 并回读安装/组件及残留业务数据；成功不代表所有业务数据删除。

停用准入、撤执行权限、隐藏视图与卸载是不同动作；取消操作不撤销之前已完成变更。失败先查当前提交状态与受管恢复，不手工清绑定或还原旧库。
