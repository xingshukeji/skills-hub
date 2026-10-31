# 在线元数据维护

使用有设计权限的租户会话，追加 `--profile <平台> --auth session --json`。在线设计即时修改平台；先读取原对象和版本。`--request-json <文件或->` 提交原请求对象，`--query-json` 提交命令帮助列出的查询键。不要把 describe 返回值整体当作写入请求。

## 对象、字段与部署恢复

```text
metadata entity list
metadata entity business-objects
metadata entity show <entity>
metadata entity create --if-match <原ETag> --request-key <稳定键> --request-json <对象.json>
metadata entity update <entity> --if-match <原ETag> --request-json <修改.json>
metadata field list <entity>
metadata field create <entity> --if-match <原ETag> --request-key <稳定键> --request-json <字段.json>
metadata field update <entity> <field> --if-match <原ETag> --request-json <修改.json>
metadata field delete-impact <entity> <field>
metadata field delete <entity> <field> --if-match <原ETag> --impact-token <本次影响令牌>
metadata field retry-deployment <entity> <field> --if-match <原ETag>
metadata field revise-deployment <entity> <field> --if-match <原ETag> --request-key <稳定键> --request-json <修正.json>
metadata field abandon-deployment <entity> <field> --if-match <原ETag>
metadata field reconcile-permissions <entity> <field>
```

entity list/show、field list 和 view list/field-catalog 将响应放在 `value`，实际版本头放在 `headers.etag`。原 ETag 包含的双引号也须保留。冲突后重新核对差异，由调用者决定下一次修改；CLI 不刷新版本并重放。

对象创建字段为 entityApiName、label、description、searchFields、visibility、share2AllRoles，可选 manualSharingEnabled、triggersEnabled。字段创建使用 fieldApiName、label、type、description、required、searchable、sortable、length、precision、nullable、presentation、uiLength、targetEntityApiName、valuePicklistId、isSensitive、maskingPolicy、allowActorPolicyReference。字段类型和目标先从标准及现有设计确定；不同类型不接受全部选项。更新只提交实际修改；清空 length、precision、targetEntityApiName、valuePicklistId、maskingPolicy 时分别使用相应的 `...Specified` 字段，避免将省略误当清空。

删除对象改用 `metadata entity delete-impact <entity>` 和 `metadata entity delete`。无依赖时也保留服务签发的 impactToken；令牌绑定主体、目标和版本，过期或已使用时重新检查影响。部署失败时先查看 field.deployment 的 canRetry/canRevise/canAbandon，再明确选择动作；重试不创建同名字段。

## 视图与其他设计

| 命令组 | 支持动作与目标 |
|---|---|
| `metadata view` | list、field-catalog、show、query、create、patch、update、delete；先带 entity，单项再带 view；写入带原 If-Match。 |
| `metadata sharing-rule` | list、show、create、update、patch、delete；单项带 id。 |
| `metadata sharing-formula` | list、show、create、update、delete；单项带 id。 |
| `metadata record-type` | list、create、update、patch、delete、picklist-options；先带 entity。 |
| `metadata trigger` | list、create、update、delete、dispatches；先带 entity。dispatches 用 query-json 筛选。 |
| `metadata picklist` | list、show、create、clone、patch、update、delete。 |
| `metadata picklist-item` | list、create、patch、update、delete；先带 picklist id，单项再带 item-id。 |
| `metadata entity` | permission、access-governance 读取实际授权。 |
| `metadata dblink` | catalog；table 带 schema、table，query-json 可带 previewLimit。 |

创建、更新或补丁带请求文件；update 使用服务要求的完整配置，patch 只提交变化。分享、记录类型和触发器各自接受其原生设计结构；先读取同类配置并保留明确 ID、关联对象和服务要求的比较字段。删除、禁用和访问授权不是同一动作。结果未知先按原 ID 回读；元数据可见不证明运行数据可读写。
