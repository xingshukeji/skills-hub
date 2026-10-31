# 编排、Routine、HTTP 与维护

追加已核对的 `--profile <平台> --auth session --json`。完整请求使用 `--request-json <文件或->`，查询键使用 `--query-json`。命令只选择固定业务接口；调试或调用可能写入记录、访问外部服务，须有对应用户要求。

## 编排与函数

```text
orchestration list
orchestration versions <id>
orchestration callables
orchestration create --request-json <定义.json>
orchestration update <id> --request-json <定义.json>
orchestration debug --request-json <调试.json>
orchestration policy get
orchestration policy set --request-json <策略.json>
function list
function create --request-json <函数.json>
function update <id> --request-json <函数.json>
```

编排创建使用 label、name、helpText、source、isActive、inputFields，可带 import、recordBatchScope。inputFields 项为 name、label、type、required、description、example；source 是服务端支持的编排源码。函数创建使用 key、label、helpText、signature、source、isActive、contractJson；修改保留原 id，不能借修改改 key。两组 delete 均带原 id。调试使用原编排输入与服务执行身份；返回错误或业务失败须保留，收到 HTTP 200 不等于外部效果完成。

租户应用函数使用 `application function list/statistics/set/execute/versions/version-create/version-test`。前四项先带 application-id；execute 再带 id，请求为 `{"input":{},"expectedVersionId":"<原版本>"}`。set 为 `{"expectedRevision":<原版本>,"changes":[...]}`。versions/version-create 带函数 id；version-test 带 version-id 和测试请求。不要将编排辅助函数和应用函数混用。

## 通用 Routine

`routine` 支持 list、show、create、definition、schedule、owner、enable、pause、run、delete、versions、active-runs、history、schedule-preview、execution-user get/set。除列表、预览和 execution-user 外，先带原 id。create/definition/schedule/owner/execution-user set 带请求文件。

创建字段为 name、orchestrationId、inputJson、ownerId、scheduleType、executeTime、timeZoneId。definition 只改 name、orchestrationId、inputJson；owner 为 `{"ownerId":"<已有成员>"}`；execution-user set 为 `{"userId":"<已有执行成员>"}`。inputJson 是 JSON 字符串；时间和时区按平台解析，先用 schedule-preview 检查。CLI 不代选执行成员。Workforce 计划任务由宿主维护；旧 Workforce Routine 的编辑、启用和运行仍由平台拒绝。

routine list 默认使用 page=1、pageSize=20。通过 --page、--page-size 或 --query-json 指定其他分页。

## HTTP 集成

`http connector` 支持 list/show/create/update/patch/delete/token-set/token-clear；`http request` 支持 list/show/create/update/delete/debug；`http interface` 支持 list/catalog/create/update/delete/from-orchestration/policy get/policy set/invoke/debug。connector 以 name 定位；request 先带 connector，再带 name；interface 以 id 定位。创建和更新带请求文件。

连接器创建为 label、name、helpText、baseAddress；update 为 label、helpText、baseAddress、expectedUpdatedAt。token-set 为 `{"token":"<秘密>"}`，只经 stdin 或受保护文件传递。请求创建为 label、name、helpText、method、path、query、headers、body、isActive；update 另带 expectedUpdatedAt。interface 创建为 requestId 或 orchestrationId、label、name、helpText、isActive、kind；update 使用原 expectedUpdatedAt。invoke/debug 的请求文件可包含任意 JSON 值，不强制包装为对象。读取 statusCode、isSuccess、body 和业务错误判断结果；调试不表示只读，不自动重试。

http interface invoke 和 orchestration debug 的原生 isSuccess=false 返回非零退出码、execution_failed 和完整结果；batch 在该步骤停止。历史查询中的失败记录仍可正常读取。成功回执结构异常时，写入结果按 outcome_unknown 处理，不自动补发。

http request debug 与 http interface debug 返回原始响应的 statusCode、headers、body 和 encoding。UTF-8 文本保留为字符串；二进制、其他字符集或无效 UTF-8 使用 base64。敏感凭据头在终端输出中隐藏。使用 `--out <新文件>` 保存原始字节，输出改为文件路径及字节数；该文件可能包含业务数据或凭据，应妥善保管。CLI 在发起调试前排他创建文件，已有文件不会被覆盖。非成功 HTTP 响应返回非零退出码，并在 error.details.response 保留响应信息；已收到的响应文件仍保留。断连不重发，未收到完整响应时清理本次创建的空文件。

security api-debug 使用同一原始响应处理，输入为 catalogKey、tokenId、input，目标仍由平台公开目录决定。三个调试命令的 408、5xx、超时和断连保留 outcome_unknown，不能据此认定外部动作未发生；401、403、409 等明确拒绝保留原错误。

## 地区、变量与回收站

```text
user regional get
user regional set --request-json <本人偏好.json>
tenant regional get
tenant regional set --request-json <租户默认.json>
time resolve --request-json <时间.json>
time day-range --request-json <日期.json>
variable list
variable set --request-json <变量.json>
recycle resources
recycle list <resource>
recycle restore <resource> <id>
```

time resolve 为 `{"items":[{"key":"due","localDateTime":"2026-11-01T09:00:00","timeZoneId":"Asia/Shanghai"}]}`；有歧义时从 candidates 明确选择 offset 后再解析。day-range 为 `{"date":"2026-11-01","timeZoneId":"Asia/Shanghai"}`。变量写入为 variableKey、value；输出仅返回 HasValue 等元数据。Host 可用原生 tenantId 查询指定租户变量，省略表示 Host；租户身份不能改变令牌绑定。回收站恢复沿服务端冲突与当前权限处理。

time resolve/day-range 接受原生 Host 或租户身份；使用 Host profile 时不补造租户。
