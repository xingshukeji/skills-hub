---
name: xrain-cli
description: 用自带 CLI 连接 XRain 平台或应用市场，操作平台用户、权限、数据及应用包；认证中心账号由 xrain-auth 处理。
metadata:
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

管理操作选 `--auth session`，避免旧 API Token 抢先；租户由 token 绑定，`--tenant` 不能换身份。元数据可见不等于可写。构建直接用 `app build`，不先重复 `app check`；发布未知先查 `app status`。批量失败保留此前写入，不能整批重放。

秘密用受保护文件、环境或 stdin 传递；只用获准工具，不修改生成脚本或寻找其他仓库制品。
