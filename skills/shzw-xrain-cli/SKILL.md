---
name: shzw-xrain-cli
description: 使用自带 CLI 查询或操作 XRain 平台、应用市场的用户、授权、元数据、业务记录、智能体定义及订阅和应用包。用于明确要求 CLI、命令或批量 API 操作的请求；登录失败、403、人员开通及业务开发通常由对应任务入口组织，按需调用本工具。认证中心身份通过其自身网页管理。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain
  runtime-requirements: Node.js 22.12+ and command execution; browser callback or device login.
---

# XRain CLI

从本 skill 目录（Workforce 的 `resourceBase.path`）执行，依赖已打包，无需 npm 或 .NET：

```text
node "<skill目录>/scripts/xrain-cli.mjs" <子命令> --help
```

需要执行 CLI 业务操作时，先运行 `node "<skill目录>/scripts/install-cli.mjs" --json`。使用结果的 `commandPath` 执行后续命令，避免 PATH 中同名旧命令；注册失败时直接用上述 Node 脚本。重复注册会复用现有入口，技能原地更新后入口直接使用新脚本；无需 npm。只查本地帮助或配置无需注册。

先从当前请求、任务上下文和责任项目配置确定预期平台、租户及执行主体；身份查询和后续操作使用相同目标，优先显式指定预期 `--server` 与命令支持的 `--tenant`，若依赖默认值，先用本地 `auth status --json` 核对解析的服务地址。访问平台业务前用 `auth whoami --json` 按后续操作实际采用的目标和凭据核对服务器认出的身份。对照实际服务地址、tenantId、userId 和作用域；不一致或预期无法确定时先定位并恢复已授权连接，不从活动 profile 名称猜测，也不创建身份或扩大权限。同一任务上下文未变化时复用判断；目标、凭据或登录身份改变后重新核对。只查本地帮助或配置无需连接服务器。

- 连接、401、回调：[配置与认证](references/configuration.md)。
- 平台账号准备：[账号与登录](references/login.md)。
- 数据、权限、应用包、批量：[命令参考](references/commands.md)。
- 智能体定义、工作区、订阅和应用选用：[智能体命令](references/agents.md)。
- 应用查询、市场导入、安装升级与操作恢复：[安装](references/installation.md)。

管理操作选 `--auth session`，避免旧 API Token 抢先；应用包命令检查身份也选 `--auth session`，与其实际凭据一致。租户由 token 绑定，`--tenant` 不能换身份；Host 身份的 tenantId 为 null，目标租户由操作参数单独确定。身份查询不证明具体业务权限，检查后会话若被并发替换也不构成强绑定。元数据可见不等于可写。构建直接用 `app build`，不先重复 `app check`；发布未知先查 `app status`。CLI 多命令 `batch` 失败会保留此前命令的写入，不能整批重放；它不是记录集合接口的 `allOrNone` 事务。记录操作按目标服务实际返回判断。

安装用精确 packageId/versionId；`app install` 自带服务端预检，`app preview` 用于提前看影响。保留提交前打印的 operation ID；结果未知先 `app operation show/wait`。只有 `Succeeded` 表示该操作完成；绑定、配置和影响确认由调用者明确提供，CLI 不自动代选。

智能体定义归 Runtime，订阅和应用选用归平台。定义命令显式指定已核实的 `--runtime`，向该 Runtime 发送所选平台凭据；定义新建默认停用，编辑使用明确版本。先查选项和当前事实，不以管理权推断个人订阅，也不自动审批或替换应用选用。写入结果未知先按原 ID 回读；不新建同名定义或自动重放。

秘密用受保护文件、环境或 stdin 传递；只用获准工具，不修改生成脚本或寻找其他仓库制品。
