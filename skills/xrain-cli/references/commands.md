# 命令参考

所有命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后。只对未知参数查该子命令 --help，不遍历全集。示例对象、身份和地址须替换为目标实际值。

## 输出与输入

--json 的 stdout 为单个 {ok:true,data:...} 或 {ok:false,error:{code,message,...}}；错误可带 httpStatus/serverCode/requestId/hint 及脱敏 details。登录链接和进度在 stderr。退出 0 成功、1 失败；app status 的 data 恒为数组。

JSON 首选 --values-json/--query-json/--filter-json 的文件或 -（stdin），也支持对应内联及 @file/@-。--file 是完整 query/values 别名。完整 query 与分页/filter/fields/sort 快捷参数互斥；重复、未知或无关参数报错。普通 values 自动包成 {values:...}；已有 values 的完整请求原样发送，可含 expectedValues。

## 连接

```text
auth login --server <平台origin> --tenant <租户> --profile <名称>
auth login --exchange <市场origin> --profile <名称>
auth status --profile <名称> --json
doctor --profile <名称> --auth session --json
profile list
profile show --profile <名称>
auth logout --profile <名称>
```

set/login 仅保存配置，auth login 才认证；管理操作用 --auth session。本地 tokens ensure 不创建服务端权限。优先级、回调与存储见[配置](configuration.md)。

## Runtime 数据

按需 metadata entities / metadata describe <entity> 核对真实字段、约束和 Runtime 能力；元数据可见不等于可写。

```text
data query <entity> --fields name,status --page 1 --page-size 25 --sort name:asc
data query <entity> --query-json "<query.json>"
data get <entity> <id>
data create <entity> --values-json "<values.json>"
data update <entity> <id> --values-json "<update.json>"
data delete <entity> <id>
```

支持 --entity/--id 替代位置参数，每次只选一种。delete 仅单条 ID，不接 filter。更新并发条件按目标字段契约提供，完成后回读。

## 用户、角色、权限集

账号准备先读[账号与登录](login.md)。以下追加目标 --profile、--auth session、--json：

```text
security user show --user <固定登录名>
security user ensure --user <固定登录名> --values-json -
security user grant-role --user <固定登录名> --roles <已有角色>
security role show --role <角色>
security role grant-permission-set --role <角色> --permission-sets <权限集>
security permission-set show --permission-set <权限集>
security permission-set grant-permission --permission-set <权限集> --permissions <真实权限ID>
```

grant 对应 revoke；user 也支持直接 grant/revoke-permission-set。资源单/复数可互换，--names 支持逗号/分号列表、忽略大小写去重。创建用户 JSON 用平台字段（password/name/email/isAI 等），userName 若出现须与 --user 一致。ensure 仅在明确 user_not_found 时创建，现有用户不更新；原始 create 无查重保证。

按本次授权修改后回读。用户 show 的 permissionSets 含角色继承；撤销直接绑定不代表其他来源消失，不能为了拒绝测试删除无关角色。

## 应用包与市场

```text
app init --namespace <小写命名空间> --label <名称> --dir "<目录>"
app build --source "<source.json>" --output "<新文件.appkg>" --profile <平台>
app publish --file "<文件.appkg>" --profile <平台>
app status --package <namespace> --profile <平台> --json
app publish --file "<文件.appkg>" --exchange <市场origin> --profile <市场>
```

namespace 2–16 位，小写字母开头，仅小写字母/数字；label 1–256。source≤32 MiB、包≤16 MiB、根 manifest≤1 MiB。build 已服务端构建、校验并保存；只验证不保存才用 check，不先 check 再重复 build。输出已有则拒绝覆盖。

平台和市场分别 auth login。publish 带已知发布版本防并发覆盖，不自动重试；未知结果先同目标/profile 的 status 查询。status 查询发布状态；安装状态使用 app installation show 或 app operation show。

应用消费支持 app list、app versions、app import、app preview、app install 和 app operation 子命令。精确版本、请求输入、等待与恢复见[安装](installation.md)。app check 仍为构建验证，不检查已装应用的业务可用性。

## 批量

```json
[["metadata","entities","--profile","demo","--auth","session"],
 ["data","query","<entity>","--profile","demo","--auth","session"]]
```

batch --file "<workflow.json>" --json（或文件参数 -）先校验全部参数，再顺序执行。每步独立指定目标，不继承额外参数；首个失败即停，details.results/failedIndex 保留结果，之前写入不回滚。先查已完成项再接续，不整批重放。

浏览器登录先单独完成；步骤不允许嵌套 batch、浏览器登录或共享 stdin，JSON 数据用文件。依赖前一步结果的决策分批处理。
