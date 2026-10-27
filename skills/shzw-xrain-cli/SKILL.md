---
name: shzw-xrain-cli
description: 使用自带 CLI 查询或操作 XRain 平台、应用市场的用户、授权、元数据、业务记录及应用包。用于明确要求 CLI、命令或批量 API 操作的请求；登录失败、403、人员开通及业务开发通常由对应任务入口组织，按需调用本工具。认证中心身份通过其自身网页管理。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain
  runtime-requirements: Node.js 22.12+ and command execution; browser callback must reach the CLI host.
---

# XRain CLI

从本 skill 目录（Workforce 的 `resourceBase.path`）执行，依赖已打包，无需 npm 或 .NET：

```text
node "<skill目录>/scripts/xrain-cli.mjs" <子命令> --help
```

复用已知目标、profile 和有效会话，直接执行所需命令并用 `--json` 回读；不必先跑整套诊断。

- 连接、401、回调：[配置与认证](references/configuration.md)。
- 平台账号准备：[账号与登录](references/login.md)。
- 数据、权限、应用包、批量：[命令参考](references/commands.md)。
- 应用查询、市场导入、安装升级与操作恢复：[安装](references/installation.md)。

管理操作选 `--auth session`，避免旧 API Token 抢先；租户由 token 绑定，`--tenant` 不能换身份。元数据可见不等于可写。构建直接用 `app build`，不先重复 `app check`；发布未知先查 `app status`。CLI 多命令 `batch` 失败会保留此前命令的写入，不能整批重放；它不是记录集合接口的 `allOrNone` 事务。记录操作按目标服务实际返回判断。

安装用精确 packageId/versionId；`app install` 自带服务端预检，`app preview` 用于提前看影响。保留提交前打印的 operation ID；结果未知先 `app operation show/wait`。只有 `Succeeded` 表示该操作完成；绑定、配置和影响确认由调用者明确提供，CLI 不自动代选。

秘密用受保护文件、环境或 stdin 传递；只用获准工具，不修改生成脚本或寻找其他仓库制品。
