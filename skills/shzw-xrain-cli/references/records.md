# 记录集合、共享与文件导出

先核对当前服务器、租户及实际身份，再从元数据取得真实对象与字段。以下命令仍由服务端执行对象、记录及字段权限检查。

## 查询与集合写入

```text
data capabilities
data query-batch --request-json <跨对象查询.json>
data count <entity> --request-json <查询.json>
data distinct <entity> --request-json <查询.json>
data export <entity> --request-json <查询.json>
data single <entity> --request-json <查询.json>
data single-or-default <entity> --request-json <查询.json>
data first <entity> --request-json <查询.json>
data first-or-default <entity> --request-json <查询.json>
data batch-create <entity> --request-json <集合.json>
data batch-update <entity> --request-json <集合.json>
data batch-delete <entity> --request-json <集合.json>
```

这些 `--request-json` 参数接受文件或 `-`，`--file` 是别名。查询文件使用完整查询对象，如 `{"page":1,"pageSize":25,"fields":["name"],"includeTotalCount":true}`；过滤、排序和聚合与 `data query --query-json` 相同。`export` 返回记录 JSON，下载 XLSX 使用下方 `export-file`。

跨对象查询为 `{"queries":[{"entityCode":"<对象>","query":{"page":1,"pageSize":25}}]}`。每个对象单独保留原权限和查询结果，不跨租户拼接。

集合创建为 `{"records":[{"values":{"name":"<值>"}}],"allOrNone":true}`；更新为 `{"records":[{"recordId":"<ID>","values":{"status":"<新值>"},"expectedValues":{"status":"<原值>"}}],"allOrNone":true}`；删除为 `{"recordIds":["<ID>"],"allOrNone":true}`。

集合命令只发送一次原生集合请求。`allOrNone` 沿用平台规则，省略时使用服务端默认值；不要把 CLI `batch` 当成集合事务。选择 `false` 时，逐条结果可能部分成功；CLI 对已返回的失败项以 `collection_failed` 退出，并在 `error.details.result` 中保留原提交状态及全部逐条结果。先检查已完成项，不整批重放。

`single` 与 `first` 的无记录或多记录结果由原查询规则判断；不会用另一端点重查。服务不支持某接口或拒绝权限时，保留其错误。

## 字段、历史与所有者

```text
data field-options <entity> <field> --page 1 --page-size 25 --search <搜索>
data original-values <entity> <recordId> --fields name,status
data history <entity> <recordId> --page 1 --page-size 25
data owner-transfer <entity> <recordId> --request-json <所有者.json>
```

所有者请求为 `{"ownerId":"<目标用户ID>"}`。CLI 不把 Owner 转移改写成通用字段更新，也不添加服务未声明的并发字段。原值与历史仅返回当前主体获准读取的内容。

## 共享

```text
data share list <entity> <recordId>
data share recipients <entity> <recordId> --search <搜索>
data share capability <entity> <recordId>
data share eligibility <entity> <recordId> --user-id <用户ID>
data share grant <entity> <recordId> --request-json <共享.json>
data share update <entity> <recordId> <shareId> --request-json <共享.json>
data share revoke <entity> <recordId> <shareId>
```

共享请求为 `{"userId":"<用户ID>","readable":true,"updateable":false,"deleteable":false}`。先读能力及可选成员，再按用户明确要求授予或修改。暂停、共享原因及可授予范围由平台持有；命令不自动选择接收人或扩大权限。list、recipients 支持分页，recipients 支持 search。

## 文件导出

```text
data export-capabilities <entity>
data export-file <entity> --request-json <导出.json> --out <新文件.xlsx>
```

导出请求为 `{"query":{"page":1,"pageSize":25,"fields":["name"]},"exportPurpose":"roundTrip"}`，可按服务合同补充 `options` 和 `selectedRecordIds`。应用限制存在时，带同一 `--application <应用ID>`。服务端决定哪些记录、字段、工作表及导出用途可用。

CLI 读取服务声明的文件限额，校验响应类型、编码、大小和完整长度，流式保存到新文件。已有目标及下载中断时不覆盖原文件，不保留未完成目标。权限拒绝不会回退到通用记录查询拼文件。

## 结果未知

单条更新、删除、未带键创建、集合与共享写入遇到网络中断、超时或不可用回执时，返回 `outcome_unknown`，保留 profile、服务器、租户、对象及原记录等安全上下文，并提供 `readback` 参数数组。不会自动重试或增加未声明的幂等字段。

按原主体和目标回读。当前值匹配只能证明当前状态，不能证明本次请求成功；无键创建也不能仅凭同名记录确认。带键创建继续使用 `data creation-result`。批量脚本先检查前面已完成的结果及失败项，再决定后续动作。
