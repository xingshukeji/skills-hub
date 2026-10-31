# 应用安装、升级与恢复

所有命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后。目标平台使用已有租户浏览器会话，追加 `--profile <平台> --auth session --json`。package、version-id、installation、operation 使用服务返回的精确 ID；显示名和版本字符串不作身份。

## 查找与导入

```text
app list
app versions --package <packageId>
app list --exchange <市场origin> --profile <市场>
app versions --package <packageId> --exchange <市场origin> --profile <市场>
app import --package <packageId> --version-id <versionId>
```

平台 list 返回本地可见包及安装指针。市场 list/versions 使用独立市场浏览器会话。import 使用目标平台配置的市场来源，不能附加 --exchange、任意下载地址或本地包文件。导入成功不表示安装或发布；Host 本地包使用 `app import-file <文件.appkg> --scope host` 及原 Host 会话。

versions 列出历史版本；平台决定当前版本是否可安装。CLI 不替调用者选“最新版”，不重新发布旧版来实现回退。导入响应丢失时，先在同一平台查询 versions，不自动重复导入。

## 预检与提交

```text
app preview --package <packageId> --version-id <versionId>
app install --package <packageId> --version-id <versionId> --wait
app install --package <packageId> --request-json "<安装请求.json>" --wait
```

install 同时用于初装和升级。平台在提交时执行预检，不必先重复运行 preview。需要提前查看 changes、conflicts、requiredBindings 和 requiredConfirmations 时才单独 preview；ready=false 是检查结果，不表示检查命令执行失败。

--request-json 接受 API 请求对象的文件或 `-`（stdin），--file 是同义选项。versionId 必须由 --version-id 或请求对象提供。expectedRevision、requestId、maintainInstalledVersion 分别可用 --expected-revision、--request-id、--maintain-installed-version 指定；同一字段不能在 JSON 和命令选项中重复提供。

安装请求允许 versionId、expectedRevision、tenantBindings、confirmations、requestId 和 maintainInstalledVersion。preview 使用相同输入，但不接收 requestId。升级时提供已检查的 expectedRevision；0 是合法初始修订号。修订冲突后重新读取当前事实，CLI 不改写修订号后自动重试。

只提交本次已决定的 tenantBindings 和 confirmations。绑定键保留服务返回的 recordId/binding 及大小写，凭据使用引用。影响确认使用当前响应中的 `{recordId,unit,token}`；CLI 保留这些非登录 token，其他凭据字段仍脱敏。maintainInstalledVersion 仅用于维护当前已装版本，不能借此安装任意旧版。

## 回执与等待

未提供 requestId 时，install 和 operation retry 生成 `apo` 开头的 20 字符 ID，并在提交前写到 stderr。服务器接受请求后，该 requestId 即 operation ID。保存该编号；HTTP 的追踪 requestId 与安装 requestId 分别保留在 error.requestId 和 error.details.requestId，不混用。

```text
app installation show --installation <installationId>
app operation show --operation <operationId>
app operation wait --operation <operationId> --wait-timeout 300 --poll-interval 2
```

--wait 用于 install、resolve、retry、continue。--wait-timeout 默认 300 秒，覆盖本次提交和查询等待；--poll-interval 默认 2 秒。两项均为 1–86400 的整数秒；非 wait 命令只有附带 --wait 时才接受它们。--timeout 保持原来的单次 HTTP 时限，并受剩余总等待时间限制。

wait 只读取原操作；等待结束或进程退出不会取消服务器操作。网络异常、超时或响应身份不符均不会自动重放写入。未收到提交响应时，先用已打印的 ID 查询；不要把安装的 latestOperationId 直接认作自己的操作。

| 返回状态 | CLI 行为与含义 |
| --- | --- |
| Pending / Running / Finalizing | 不带 --wait 时返回已受理的 operation；带 --wait 时继续查询 |
| WaitingForResolution | 写入或等待命令退出 1，error.code=operation_requires_resolution，保留所需输入和原 operation |
| Succeeded | 本次操作已完成；安装记录、组件与原用户业务结果仍按本次验收范围核对 |
| Failed | 写入或等待命令退出 1，error.code=operation_failed，保留服务端 errorCode |
| Cancelled | 等待命令退出 1，error.code=operation_cancelled；显式 cancel 成功则退出 0 |
| 已取得操作后耗尽总等待时限 | 退出 1，error.code=operation_wait_timeout，保留最近一次 operation；可用 wait 接续查询 |

show 是读取命令，读取 Failed 或 WaitingForResolution 仍退出 0。JSON 的 ok=true 只表示命令成功，必须同时读取 operation.status。成功读取的数据位于 data；写入或等待失败时，已取得的最近回执位于 error.details.operation。首次响应尚未取得时只保留请求和操作编号；单次 HTTP 超时仍使用 timeout 错误码。先取出相应对象，再交给回执工具，不把整个 CLI 输出当作 API 响应。

## 补充输入与恢复

```text
app operation resolve --operation <operationId> --request-json "<解决请求.json>" --wait
app operation continue --operation <operationId> --wait
app operation retry --operation <失败operationId> --wait
app operation cancel --operation <operationId>
```

WaitingForResolution 使用 resolve。请求必须包含本次已检查的 expectedRevision，可附 tenantBindings、configurationChanges、confirmations 和受该冲突路径支持的 resolutions。配置编辑范围和可选决策由平台提供；CLI 不生成确认、不选择冲突处理策略。resolve 会推进原操作，无需随后自动 continue。

确认 Running/Finalizing 操作中断后，使用 continue 接续原操作。Failed 的根因排除后使用 retry；它使用新 requestId，失败回执的 error.details.sourceOperationId 保留原失败 ID。--request-id 必须不同于原失败 ID。retry 的 --request-json 接受 requestId 和 expectedRevision，平台仍检查原 sourceRevision。出现 requiresResubmission 或 application_operation_resubmission_required 时，恢复原变更输入、重新检查影响，再显式提交。

只有平台允许的 Pending/Waiting 操作可以 cancel。取消不回滚先前已经完成的业务变更。卸载、组件恢复和策略迁移继续使用原管理入口，本组命令不代行这些操作。

批量步骤不得共享 stdin。批量遇到需要处理、失败或等待超时会停止，并在 results 中保留原操作；之前写入保持生效，不能整批重放。
