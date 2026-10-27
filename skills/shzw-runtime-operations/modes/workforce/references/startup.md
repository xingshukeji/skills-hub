# 启动与连接

`<模式目录>` 指本技能目录下的 `modes/workforce`，不是目标项目目录。

Workforce 根入口是 `npm start` → `scripts/start-development.mjs`；dev、preview、serve、debug、start:development、start:local、start:ui 转交同一入口。开发宿主要求 Node.js 24，Windows 可用 Start.cmd。

启动参数由目标项目的 `scripts/development-configuration.mjs` 解释。当前 Workforce 使用 `config/development.json` 提供公共配置，`config/development.local.json` 提供可选本机覆盖；显式配置路径替代默认本机覆盖，进程环境变量优先。`connectionScript` 仅在实例确需连接器时配置，支持接收 `start` 参数的 Node.js 或 Python 脚本。默认共享测试地址无需连接器或本机代理。

应用、Runtime、定义、会话与工作区在本机；共享平台、认证及模型按配置连接。参数缺失时恢复原接入配置，不创建新身份或清空状态。

仅在排查配置与入口时调用文件检查：

```text
node "<模式目录>/scripts/inspect-launch.mjs" "<项目根>" ["<已有配置路径>"]
```

检查器调用目标项目的 `developmentConfiguration` 导出，复用正常启动的字段、默认值和覆盖顺序。它检查已解析的路径及 package.json 启动别名，不执行启动脚本，不读取业务应用配置正文，不输出环境变量值。`readyToInvoke` 只表示入口文件存在、别名一致及已配置连接器的脚本类型受支持；不表示 Node 版本、连接器系统兼容或服务健康已通过。检查器是显式排障工具；启动程序不调用它，也不读取本说明。

运行 `npm start -- --check` 检查当前配置的共享平台健康与认证发现；该命令会调用已配置连接器。用 `npm start -- <配置 JSON 路径>` 启动显式配置。默认启动入口与实例参数以目标项目当前 Runbook 为准。

| 失败处 | 检查 |
| --- | --- |
| 配置 | 原配置路径、必需字段及进程环境覆盖；空字符串会覆盖文件值 |
| 连接 | 已配置连接器、实际共享服务地址及远端健康；本地监听不证明远端可达 |
| 宿主 | 原终端、应用配置与 `/health/ready` 的 `status:ready` |
| 宿主就绪仍失败 | 原用户登录、业务请求或模型调用；转对应排障 |

入口在当前进程启动业务应用。重启前在原终端正常停止对应进程；端口冲突先核对归属。保留 Runtime、定义、会话与工作区。只修本机连接时，不重启共享依赖。

铵帮业务开发消费锁定的公共包；相邻 Workforce/Harness 源码修改不会自动进入应用。缺依赖时按既有准备入口恢复固定包或配置来源。最终从当前入口复测原动作及持久结果。
