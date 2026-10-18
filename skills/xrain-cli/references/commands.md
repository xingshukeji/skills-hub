# 命令参考

以下命令均接在 `node <skill绝对路径>/scripts/xrain-cli.mjs` 后。PowerShell 可先设置 `$cli` 为该脚本的绝对路径，再执行 `node $cli ...`。所有命令支持 `--help`；成功退出码为 0，失败为 1。

## 脚本输出与参数

Agent 和脚本使用 `--json`。stdout 始终只有一个 JSON 文档：成功为 `{"ok":true,"data":...}`，失败为 `{"ok":false,"error":{"code":"...","message":"...",...}}`。错误按实际情况附带 `httpStatus`、`serverCode`、`requestId`、`hint` 和脱敏的 `details`；登录链接与进度位于 stderr。

`app status --json` 的 data 始终为数组，零个匹配项返回 `[]`；批量命令的 data 为按执行顺序排列的结果数组。其他 API 命令的 data 保留服务端响应结构。默认模式保留兼容输出；多应用 status 也会输出一份数组，避免拼接多个 JSON 对象。

选项按子命令校验。未知选项、重复选项、无关选项、多余位置参数，以及 JSON 文件与内联输入冲突都会报错。`data delete` 只接受一个实体与记录 ID，不接受 filter。`data delete --help` 显示该命令的参数；`help metadata` 显示元数据命令组。

## Profile 与诊断

```text
auth login --server http://127.0.0.1:5410 --tenant tenant-xrain-demo --profile demo
auth status --profile demo --json
doctor --profile demo --auth session --json
profile list
profile show
profile set --profile demo --server http://127.0.0.1:5410 --tenant tenant-xrain-demo
profile use demo
profile path
profile remove demo
security tokens ensure
security tokens show
security tokens path
health ready
health live
health healthz
metadata standards
metadata entities --auth session --json
metadata describe <entityCode> --auth session --json
auth logout --profile demo
logout --profile demo
```

`profile use` / `remove` 的目标可用位置参数、`--name` 或 `--profile`，每次只选一种写法。普通 API 请求支持 `--profile`、`--server`、`--tenant`、`--token-name`、`--auth` 和 `--timeout`。完整环境变量与认证优先级见 [配置与认证](configuration.md)。

`login` / `profile set` 只保存连接，不执行浏览器认证；已有脚本可继续使用 `login --profile demo --check` 检查健康接口。`app login/logout` 是 `auth login/logout` 的兼容别名。`auth logout` 保留 profile；顶层 `logout` 删除 profile 与平台会话。

当前服务的管理接口拒绝 API Token，`--token-name admin` 不能代替浏览器登录。`security tokens ensure` 仅准备本地凭据；使用 API Token 调用已开放的数据接口前，服务端须已配置同一 token，并已授予主体相应权限。

## Runtime 数据

先运行 `metadata entities`，再用 `metadata describe <entityCode>` 查看字段、类型和约束。下面的 `customer` 与字段名仅为格式示例，须替换成发现的真实业务对象。元数据目录可见、字段可描述，均不代表该对象开放 Runtime CRUD 或当前账号有写权限。

```text
data query customer --fields name,status --page 1 --page-size 25 --sort name:asc --search Acme
data query customer --query-json query.json
data query customer --filter-json filter.json --no-total
data get customer rec0000000000000001
data create customer --values-json values.json
data update customer rec0000000000000001 --values-json update.json
data delete customer rec0000000000000001
```

实体和记录可改用 `--entity` / `--id`；不要再提供重复的位置参数。支持 `--pageSize` 别名。JSON 可用 `--values '{"name":"Acme"}'`、`--values @values.json` 或文件参数，优先使用文件避免 shell 引号差异。`--file` 是完整 query / values 文件的别名，filter 使用独立 `--filter-json`。

`--values-json -`、`--query-json -`、`--filter-json -` 和 `--file -` 从标准输入读取 UTF-8 JSON；`--values @-` 等写法也支持。适合上游程序直接管道传入数据，不需要先写临时文件。

普通 values 对象会包装为 `{"values": ...}`；已包含 `values` 字段的请求原样发送，因此可使用 `expectedValues` 等并发控制字段。完整 query JSON 与分页、字段、filter、sort 等快捷参数互斥，不再静默忽略其中一组输入。

## 用户、角色与权限集

先在管理端创建目标测试用户 `cli-test-user`、自建角色 `custom.cli.reader` 和权限集 `custom.cli.reader`。这些示例使用已有权限 `platform.entity.customer.read`；若目标环境采用其他业务对象，替换为它实际存在的权限。系统角色的只读限制由服务端执行。

```text
security user show --user cli-test-user
security user grant-role --user cli-test-user --roles custom.cli.reader
security user revoke-role --user cli-test-user --roles custom.cli.reader
security user grant-permission-set --user cli-test-user --permission-sets custom.cli.reader
security user revoke-permission-set --user cli-test-user --permission-sets custom.cli.reader
security role show --role custom.cli.reader
security role grant-permission-set --role custom.cli.reader --permission-sets custom.cli.reader
security role revoke-permission-set --role custom.cli.reader --permission-sets custom.cli.reader
security permission-set show --permission-set custom.cli.reader
security permission-set grant-permission --permission-set custom.cli.reader --permissions platform.entity.customer.read
security permission-set revoke-permission --permission-set custom.cli.reader --permissions platform.entity.customer.read
```

`users`、`roles`、`permission-sets` 可替代单数资源名。对象名可使用 `--name` 或操作后的首个位置参数。成员列表可统一用 `--names`，支持逗号或分号分隔，并忽略大小写去重。先查实际授权，再进行已获授权的变更，最后重新 `show` 验证。

用户 `show` 中的 permissionSets 包括角色继承的有效权限集。撤销直接绑定后，角色仍可让该权限集继续出现在结果里；验证撤销时区分直接绑定与角色继承，或先在专用测试用户上撤销该角色再检查。

## 平台应用和独立市场

```text
auth login --server http://127.0.0.1:5410 --tenant tenant-xrain-demo --profile demo
auth login --profile demo --no-browser
app init --namespace myapp --label 我的应用 --dir ./myapp
app build --source ./myapp/source.json --output ./myapp/first.appkg --profile demo
app publish --file ./myapp/first.appkg --profile demo
app status --package myapp --profile demo --json
auth logout --profile demo
auth login --exchange https://market.example.com --profile marketplace
auth status --exchange https://market.example.com --profile marketplace --json
app publish --file ./myapp/first.appkg --exchange https://market.example.com --profile marketplace
app status --exchange https://market.example.com --profile marketplace --json
auth logout --exchange https://market.example.com --profile marketplace
```

示例市场地址需要替换成实际地址。`app init` 的 namespace 长度 2–16，仅含小写字母和数字且以字母开头；label 长度 1–256。新建源码包含一个状态选项集和“待处理”选项，初始应用版本为 `1.0.0`。应用包的业务版本与本仓库不设 skill 版本的策略无关。

源码上限 32 MiB，包上限 16 MiB，包内根目录 `manifest.json` 上限 1 MiB。`app build` 一次完成服务端构建、完整性校验和产物保存，默认输出到源码旁的 `<packageId>-<version>.appkg`。源码和包归用户项目管理。

只需要验证且不保存包时，单独运行 `app check --source ./myapp/source.json --profile demo`。它同样执行完整服务端构建，随后 build 会再构建一次，因此常规打包流程直接用 build。明确指定的输出以及可从源码确定的默认输出若已存在，会在联网前报错；最终保存仍使用排他写入，防止并发覆盖。

发布会带上已知当前发布版本，防止覆盖并发更新；不会自动重试。`app status` 仅查询，不执行安装。平台输出已发布的版本；独立市场按市场返回的版本列表显示。

## 连续执行

将需要执行的完整参数列表存入 `workflow.json`，每条命令是一个字符串数组：

```json
[
  ["auth", "status", "--profile", "demo", "--auth", "session"],
  ["health", "ready", "--profile", "demo", "--auth", "session"],
  ["metadata", "entities", "--profile", "demo", "--auth", "session"]
]
```

执行 `batch --file workflow.json --json`；也可用 `batch --file - --json` 从 stdin 接收计划。批量输入不包含脚本路径，不向子命令继承额外选项；每条命令照常解析自己的 profile 和目标。

CLI 会先检查全部命令的参数形状，再逐条执行。同一进程复用已解密的会话，文件变化、退出或过期仍会使缓存失效。首个失败立即停止，并在 `batch_failed` 的 details.results 中返回已执行结果和 failedIndex；之前完成的修改保留，不自动回滚或重试。

浏览器登录先单独完成。批量步骤不允许嵌套 batch、浏览器登录或共享 stdin；步骤中的 JSON 使用文件或内联值。需要先前结果才能决定下一步时，分批执行并检查输出。
