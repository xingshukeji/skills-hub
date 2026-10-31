# 命令参考

所有命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后。只对未知参数查该子命令 --help，不遍历全集。示例对象、身份和地址须替换为目标实际值。

## 输出与输入

--json 的 stdout 为单个 {ok:true,data:...} 或 {ok:false,error:{code,message,...}}；错误可带 httpStatus/serverCode/requestId/hint 及脱敏 details。登录链接和进度在 stderr。退出 0 成功、1 失败；文件导入本地中断为 130。app status 的 data 恒为数组。

JSON 首选 --values-json/--query-json/--filter-json 的文件或 -（stdin），也支持对应内联及 @file/@-。--file 是完整 query/values 别名。完整 query 与分页/filter/fields/sort 快捷参数互斥；重复、未知或无关参数报错。普通 values 自动包成 {values:...}；已有 values 的完整请求原样发送，可含 expectedValues。

## 连接

```text
auth login --server <平台origin> --tenant <租户> --profile <名称>
auth login --device --server <平台origin> --tenant <租户> --profile <名称>
auth login --exchange <市场origin> --profile <名称>
auth status --profile <名称> --json
auth whoami --profile <名称> --json
auth whoami --profile <名称> --auth session --json
doctor --profile <名称> --auth session --json
profile list
profile show --profile <名称>
auth logout --profile <名称>
```

set/login 仅保存配置，auth login 才认证；whoami 查询服务器认出的平台身份，与后续操作采用相同目标和凭据；应用包管理及其身份查询用 --auth session。通用 metadata/data/security 和 Host 成员命令也可按[配置](configuration.md)选择正常原生登录的短期 Bearer。本地 tokens ensure 不创建服务端权限。

## Runtime 数据

按需 metadata entities / metadata describe <entity> 核对真实字段、约束和 Runtime 能力；元数据可见不等于可写。

```text
data query <entity> --fields name,status --page 1 --page-size 25 --sort name:asc
data query <entity> --query-json "<query.json>"
data get <entity> <id>
data create <entity> --values-json "<values.json>"
data create <entity> --request-key <业务请求稳定键> --values-json "<values.json>"
data creation-result <entity> --request-key <原业务请求稳定键>
data update <entity> <id> --values-json "<update.json>"
data delete <entity> <id>
```

支持 --entity/--id 替代位置参数，每次只选一种。delete 仅单条 ID，不接 filter。更新并发条件按目标字段契约提供，完成后回读。

原生集合事务、跨对象查询、原值、共享、历史、Owner 与 XLSX 导出见[记录操作](records.md)。成员、组织、角色、服务端 Token、审计、租户应用与 Host 扩展见[管理命令](management.md)。普通写入的 `outcome_unknown` 会携带原目标和回读参数；当前值不证明原请求成功，不整批重放。

### 单记录创建恢复

目标服务支持 keyed creation 时，在第一次创建前由调用者选定并保存稳定 `requestKey`（非空字符串，最多 160 字符）。可以用 `--request-key`，或在完整请求 JSON 中提供 `{"values":{"name":"示例"},"requestKey":"<业务请求稳定键>"}`；两种方式不能同时提供。CLI 在发送前将键写入 stderr，不自动生成、换键、查询或重试。未提供键时保留原创建请求，不向旧服务注入字段。

服务按当前租户、执行主体、对象和键恢复原创建；相同键及相同 values 返回原记录，不同 values 返回冲突。连接中断、超时或回执无效时，`outcome_unknown` 保留对象和键。保持相同平台、租户和身份，先执行 `data creation-result`；该命令只查询 `records:creationResult`，不创建记录。`completed` 返回原记录，`unknown` 只表示当前查询没有可返回的结果，不能当作从未创建的证明。查询重新检查当前读取权限，记录隐藏、删除或权限变化不能靠切换主体绕过。

旧服务可能拒绝键或未提供查询入口。400、403、404 及冲突仍明确报错；查询入口不可用不代表原写入失败，CLI 不会删除键再写一次，也不退回宽泛条件查重。自行处理未知结果后再决定下一步；不要把一次调用变成新键重建或整批重放。此能力只覆盖单记录创建，不为更新、删除或 CLI `batch` 增加事务或幂等保证。

### 完整文件导入

先核对目标服务和对象是否支持 `xrain-import-jobs-v1`。使用相同主体、租户和选项下载模板、检查完整文件；如应用限定导入范围，每条命令都带相同的 `--application <应用ID>`。服务尚未实现或未启用该协议时命令会拒绝，不能改为循环调用旧原子导入。

```text
data import template --entity <对象> --options-json <选项.json> --out <新模板.xlsx>
data import check --entity <对象> --options-json <选项.json> --file <完整文件.xlsx> --wait
data import issues --entity <对象> --job <作业ID>
data import rows --entity <对象> --job <作业ID>
data import confirm --entity <对象> --job <作业ID> --plan-revision <已核对的修订> --wait
data import show --entity <对象> --job <作业ID>
data import wait --entity <对象> --job <作业ID>
data import pause --entity <对象> --job <作业ID> --wait
data import resume --entity <对象> --job <作业ID> --plan-revision <当前修订> --action continue --wait
data import resume --entity <对象> --job <作业ID> --plan-revision <当前修订> --action recheck --wait
data import cancel --entity <对象> --job <作业ID> --wait
data import download --entity <对象> --job <作业ID> --purpose result --out <新结果.xlsx>
```

选项文件使用平台 RuntimeImportOptions；省略时使用 Id 匹配、来源导入和保留空值。预检不写业务记录。`confirm` 确认指定修订；分块处理时，后续块失败不会撤销已提交的记录。上传前 stderr 会显示 requestId；响应丢失时使用 `data import list --entity <对象> --request-id <原请求ID>` 查找，不自动换键重传。确认响应丢失时可重发相同作业和修订的确认。

暂停后 continue 保留原进度；检查阶段尚无计划时修订为 0。recheck 只检查未提交来源，形成的新修订仍须核对并确认。需要修改来源时先结束作业，再以 `--purpose remaining` 下载未完成资料，编辑后作为新作业检查；其他下载用途为 issues 和 maintenance。下载不覆盖已有文件。等待超时或 Ctrl+C 只结束本地等待；再次查询原作业，只有 pause 或 cancel 会改变服务端状态。

## 智能体

定义、工作区与工具由 Runtime 提供，订阅、审批及应用选用由 XRain 平台提供。命令、请求示例、版本冲突和写入结果恢复见[智能体命令](agents.md)。

## 用户、角色、权限集

账号准备先读[账号与登录](login.md)。以下追加目标 --profile、--json；浏览器会话另加 --auth session，正常原生登录的 Bearer 使用配置中的当前进程路径：

```text
security user show --user <固定登录名>
security user ensure --user <固定登录名> --values-json -
security user grant-role --user <固定登录名> --roles <已有角色>
security role show --role <角色>
security role grant-permission-set --role <角色> --permission-sets <权限集>
security permission-set show --permission-set <权限集>
security permission-set grant-permission --permission-set <权限集> --permissions <真实权限ID>
security permissions catalog
security permission-set ensure --permission-set <固定权限集名> --values-json <创建资料.json>
```

grant 对应 revoke；user 也支持直接 grant/revoke-permission-set。资源单/复数可互换，--names 支持逗号/分号列表、忽略大小写去重。创建用户 JSON 用平台字段（password/name/email/isAI 等），userName 若出现须与 --user 一致。ensure 仅在明确 user_not_found 时创建，现有用户不更新；原始 create 无查重保证。

`security user` 面向当前租户成员，输出中的状态是成员状态，不展示全局账号状态。停用或删除成员会阻止该成员的租户会话和 API token 通过准入；恢复后尚未到期或撤销的凭据可能再次生效。删除的成员从租户回收站恢复，不用 `ensure` 代替恢复。

`security permissions catalog` 读取当前实际权限目录，不按名称拼造权限。权限集的 `create/ensure` 使用 `{name,label,helpText}`，`name` 必须与 `--permission-set` 一致。`ensure` 已存在返回 `{created:false,permissionSet}` 并保留名称、权限与绑定；只有明确 `404 / platform.authen.permission_set_not_found` 才按所给资料创建，返回 `created:true`。创建权限集不自动加权限或绑定用户，后续使用 grant 命令。

### 既有全局人物加入租户

以下命令需要已有且获准的 **Host 登录凭据**。`--tenant-id` 指定被维护的租户资源，不改变令牌绑定身份；不使用租户会话或 `--tenant` 代替 Host 资格。既有原生 Host 登录返回的 Bearer 可仅通过当前进程 `XRAIN_TOKEN` 提供，不保存到 profile。浏览器会话仍用 `--auth session` 明确选择其自身已获准范围。

```text
host tenant member list --tenant-id <租户ID> --profile <Host连接> --json
host tenant member ensure --tenant-id <租户ID> --user-id <已有全局用户ID> --profile <Host连接> --json
```

`list` 支持 `--page/--page-size/--search`。`ensure` 按准确 userId 查完匹配分页；已存在返回 `{created:false,member}`，不恢复停用、不改角色或默认租户。确实没有成员关系时，把原 userId 加为普通成员，返回 `created:true`；不新建全局身份、不授管理员。查目录失败、响应不完整或创建冲突时保留错误，不改用其他身份或重放写入。

按本次授权修改后回读。用户 show 的 permissionSets 含角色继承；撤销直接绑定不代表其他来源消失，不能为了拒绝测试删除无关角色。

## 应用包与市场

```text
app init --namespace <小写命名空间> --label <名称> --dir "<目录>"
app build --source "<source.json>" --output "<新文件.appkg>" --profile <平台>
app publish --file "<文件.appkg>" --profile <平台>
app status --package <namespace> --profile <平台> --json
app publish --file "<文件.appkg>" --exchange <市场origin> --profile <市场>
```

namespace 2–16 位，小写字母开头，仅小写字母/数字；label 1–256。构建源及包的传输大小由目标服务判断，CLI 不复制固定业务上限。包文件流式传递；CLI 保留身份、摘要及根 manifest 的 1 MiB 解压读取保护，不展开其他条目。build 已服务端构建、校验并保存；只验证不保存才用 check，不先 check 再重复 build。输出已有则拒绝覆盖。

平台和市场分别 auth login。publish 带已知发布版本防并发覆盖，不自动重试；未知结果先同目标/profile 的 status 查询。status 查询发布状态；安装状态使用 app installation show 或 app operation show。

应用消费支持 app list、app versions、app import、app preview、app install 和 app operation 子命令。精确版本、请求输入、等待与恢复见[安装](installation.md)。app check 仍为构建验证，不检查已装应用的业务可用性。

## 批量

```json
[["metadata","entities","--profile","demo","--auth","session"],
 ["data","query","<entity>","--profile","demo","--auth","session"]]
```

batch --file "<workflow.json>" --json（或文件参数 -）先校验全部参数，再顺序执行。每步独立指定目标，不继承额外参数；首个失败即停，details.results/failedIndex 保留结果，之前写入不回滚。先查已完成项再接续，不整批重放。

浏览器登录先单独完成；步骤不允许嵌套 batch、浏览器登录或共享 stdin，JSON 数据用文件。依赖前一步结果的决策分批处理。
