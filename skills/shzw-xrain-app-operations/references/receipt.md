# 本地回执工具

Node.js 22.12+；输入/输出留私有目录。工具不请求服务、不输出绑定值或确认 token。

```text
node "<skill目录>/scripts/inspect-operation.mjs" "<回执.json>"
```

输入：
- target: {tenantId,packageId,versionId,operationId?}；卸载 versionId=null。
- installation: 原 GET /installations/{id} 响应。
- operation: 原 GET /operations/{id} 响应，可选但缺失不算成功。
- preview/components/check: 可选的原响应，字段用 HTTP camelCase。

退出 2 表示无效输入/未知状态，1 表示关联/版本/revision 冲突，0 仅表示检查完成。始终读 next、blockers、evidenceGaps；installedVersionMatchesTarget 只比版本，不证明租户/包/操作匹配。建议的 resolve/continue/retry 仍受[实际状态](operations.md)约束，businessVerified 不自动为真。

## 生成原操作的 resolve 请求

原 target/installation/operation 必须属于同一活动 WaitingForResolution 操作，当前 revision 与 sourceRevision 一致。已有决定后加入 selections：

```json
{"selections":{
  "bindings":[{"recordId":"apr-connector","binding":"baseAddress","value":"https://orders.example.invalid"}],
  "configuration":[{"recordId":"apr-view","property":"fieldNames","present":true,"value":["name","amount"]}],
  "confirmations":[]
}}
```

```text
node "<skill目录>/scripts/prepare-resolution.mjs" "<私有输入.json>" --output "<新请求.json>"
```

bindings 来自 requiredBindings；configuration 来自原 $configuration 的 editableProperties，每个配置冲突至少一项决定。移除允许的可选属性用 present:false 且无 value；具体值由服务端验证。

每项已明确决定的影响才加入 confirmations 的 {recordId,unit}，工具取当前原响应 token，不自动全选。普通属性通用合并、组件退役、旧策略或 revision 变化回受管编辑/预检处理。

输出新文件拒绝覆盖，stdout 只含方法/路径/数量。已提供 shzw-xrain-cli 时，可用 app operation resolve --operation <原operationId> --request-json "<新请求.json>" --wait 提交；否则通过原管理入口执行。回读同一 operation；状态变化重新取回执，未知结果先查询，不重放文件。
