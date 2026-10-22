---
name: xrain-cli
description: 使用内置 Node.js CLI 连接 XRain，快速创建或复用固定测试账号，处理统一认证建号、激活和登录验证，管理用户角色与权限集、runtime 实体数据及应用包。用于 XRain CLI、快速登录验证、测试账号准备、租户连接、权限验证、数据操作、应用开发和独立应用市场操作；不用于部署 XRain 服务或绕过权限。
metadata:
  runtime-requirements: Requires Node.js 22.12+ and network access to the target XRain API. Browser login uses a local loopback callback. Windows session protection uses built-in Windows PowerShell; no npm packages or .NET SDK installation is required.
---

# XRain CLI

使用本 skill 自带的 `scripts/xrain-cli.mjs`。先根据本次加载的 `SKILL.md` 位置确定绝对路径，再执行：

```text
node <skill绝对路径>/scripts/xrain-cli.mjs --help
```

Node.js 24 LTS 推荐，最低版本 22.12。脚本已包含依赖。不要要求用户安装全局 `xrain-cli`、运行 `npm install`、安装 .NET SDK，或寻找其他仓库的构建产物。不要在安装副本内修改生成脚本。

## 连接、发现与执行

遇到缺少测试账号、注册或激活未完成、登录失败时，先读 [快速登录验证](references/login.md)。在已授权的开发验证范围内连续完成账号查重、必要建号、激活和原应用登录，不把“没有账号”直接留给用户处理。统一认证账号与平台业务用户分别由各自入口创建。

1. 根据用户指令与 `profile list` / `profile show` 确认服务器、租户和 profile。显式指定不存在的 profile 会报错；创建连接使用 `auth login` 或 `profile set`。仅在目标信息缺失且无法从上下文确定时询问。
2. 用 `auth status --json` 查看凭据来源、会话过期时间和本地状态；它不验证服务器是否接受凭据。需要核验连接时运行 `doctor --json`，其结果只覆盖实际探测的接口。
3. 管理操作需要浏览器会话时，运行 `auth login`，并用 `--auth session` 明确选择它，避免环境变量中的旧 token 覆盖会话。凭据选择与接口准入见 [配置与认证](references/configuration.md)。
4. 操作业务数据前，按需用 `metadata entities` 和 `metadata describe <entity>` 找到真实对象、字段与约束。能描述元数据不代表该对象开放 Runtime CRUD，也不代表当前账号拥有写权限。
5. 执行用户已授权的操作，再读取对应数据、权限或发布状态复核。不重复索取已有授权；超出原任务范围时说明具体影响。报告实际验证范围，不把模拟服务检查称为真实服务器验收。

Agent 和脚本调用优先加 `--json`：stdout 只有一个成功或失败 JSON 对象，登录链接和进度写入 stderr。子命令的 `--help` 只显示对应命令。文件与内联 JSON 不得同时指定，完整 query JSON 不得再混用分页、字段、filter 等快捷参数；错误选项和多余位置参数会在联网前拒绝。

## 普通 API 与权限

- `auth login|status|logout` 分别完成浏览器登录、查看本地认证状态和删除会话。`app login/logout` 保留为兼容别名；`login` / `profile set` 只保存连接参数，`--check` 探测 `/health/ready`。
- 当前服务的权限管理、元数据标准及健康检查使用浏览器登录会话。API Token 仅用于服务端开放的数据接口；向不接受 API Token 的接口发送它，会返回 `platform.authen.authentication_method_not_allowed`，不要绕过该限制。
- `data` 支持浏览器会话或已授权的 API Token。默认 `--auth auto` 保持原有凭据优先级；`--auth session` 显式使用匹配的浏览器会话，不回退到 API Token。它不能与 `--bearer` / `--token-name` 同时指定。
- 本地 `admin` / `guest` 令牌只用于已配置同一令牌的开发环境。`security tokens ensure` 只创建本地令牌文件，不会在服务器授予权限。
- `security user ensure` 按固定用户名查询，存在时原样复用，缺失时用 JSON 创建平台用户。它不修改已有密码、角色或权限，也不创建统一认证账号。建号与实际登录路径见 [快速登录验证](references/login.md)。
- 优先使用现有 token alias 或 `XRAIN_TOKEN` 环境变量。不要把真实 bearer 值写入命令行、聊天、日志或 Git。
- 租户由服务端验证后的 token 确定。`--tenant` 不能切换 token 的租户，不发送覆盖租户或伪造用户的 header。
- 403 时检查身份与实际授权；不要自动升级到管理员、切换租户或添加权限来让测试通过。用户明确授权开发环境能力验证时，可使用已有开发测试入口，并创建专用合成用户、角色、权限集和数据；保持真实服务的认证、授权与租户校验。

完整命令、JSON 输入方式和示例见 [命令参考](references/commands.md)。

## 应用开发

按任务需要执行：

```text
auth login --server <url> --tenant <tenantId>
app init --namespace myapp --label 我的应用 --dir <工作目录>
app build --source <工作目录>/source.json --output <工作目录>/myapp.appkg
app publish --file <工作目录>/myapp.appkg
app status --json
```

- `auth login` 通过浏览器完成 OIDC。无法自动打开时使用 `--no-browser`，在浏览器打开 stderr 给出的当次登录链接。使用本次已获准的固定账号凭据自动填写并完成正常认证；只有确实需要本人提供验证码或批准时才交给本人。保留 MFA 与服务端认证校验。
- `app build` 完成服务端构建、源码摘要、包摘要、包标识和 manifest 校验后保存产物；无需先运行 `app check`。只想验证而不保存包时使用 `app check`，它同样会执行一次服务端构建。
- `app init` / `app build` 不覆盖已有输出。更换路径或明确处理旧文件。
- `app publish` 会更改目标服务器中的发布记录。发布遇到超时或响应异常，先运行 `app status` 确认结果，再决定是否重试；不自动重复发布。
- 独立市场使用 `auth login|status|logout --exchange <marketUrl>` 和 `app publish|status --exchange <marketUrl>`，其会话与平台会话分开。构建仍在平台完成。
- `auth logout` / `app logout` 只删除浏览器会话；顶层 `logout` 删除所选 profile 及其平台浏览器会话。

连续调用可用 `batch --file <plan.json> --json`，输入为命令参数数组的数组，详见 [命令参考](references/commands.md)。它先检查所有命令的参数形状，再逐条执行，复用本进程内的解密会话；会话文件变化、退出、过期、服务器或租户不匹配时不再使用。首个失败会停止，已完成的修改保留；重试前先核对当前状态。浏览器登录须先单独完成。

不要直接读取或输出 `~/.xrain` 中的令牌和会话文件内容。排查使用 `auth status`、`doctor`、`profile show`、`security tokens show` 及经过脱敏的错误对象。401 时区分凭据失效与认证方式不受支持；403 时查实际授权，不通过更换身份或自动提权解决。
