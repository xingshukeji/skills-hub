# 已安装应用的维护

追加原平台 `--profile <平台> --auth session --json`。先用 `app installation show <installationId>` 核对精确安装、revision 和原 operation；不根据名称选择目标。维护不会自动发布另一版本。

```text
app components <packageId> --version-id <versionId>
app installation components <installationId>
app installation history <installationId>
app installation check <installationId>
app uninstall <installationId> --expected-revision <原revision> --request-id <稳定apo操作ID> --wait
app component restore <installationId> <recordId> --expected-revision <原revision>
app policy preview <installationId>
app policy apply <installationId> --request-json <策略应用.json> --wait
app operation policy-apply <operationId> --request-json <转换.json>
app withdraw <packageId> --request-id <原提交ID>
app import-file <原文件.appkg> --scope host
```

uninstall 使用原安装版本比较，提交一次 DELETE；request-id 省略时生成并打印。收到操作号后用原 operation show/wait 恢复；未知结果不重新卸载或重放整批。component restore 针对安装中的原 recordId，允许 revision 为 0，不能创建同名替代组件。

policy preview 返回 proposed changes 与 requiredConfirmations。policy apply 请求必须有 targetPolicyVersion、expectedRevision，可带 restorePackageProperties、tenantBindings、configurationChanges、confirmations、requestId。confirmations 只使用本次预览的 `{recordId,unit,token}`，由调用者明确选择。operation policy-apply 只转换原操作，请求为 targetPolicyVersion、expectedRevision。冲突后重新查看差异，CLI 不自动确认。

withdraw 撤回原提交，以服务返回的同一操作号核对，不删除不可变包版本。Host 本地导入先检查归档身份，用原 Host 登录与服务权限提交；不安装、不发布。原文件不改写；响应丢失先查询原 packageId/versionId。
