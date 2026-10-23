# 启动与连接

当前根入口是 `npm start` → `scripts/start-development.mjs`；dev/preview/serve/debug/start:development/start:local/start:ui 转交同一入口。开发宿主要求 Node.js 24，Windows 可用 Start.cmd；不再依赖根 PowerShell 启动器。机器的连接器仍可能依赖 Windows PowerShell，其他系统须用其已登记兼容连接器。

`.workforce/development-launch.json` 持有：
- 相对项目根的 applicationDirectory、connectionScript、proxyScript；applicationConfiguration 相对应用目录。
- applicationUrl 为宿主，browserUrl 为用户入口。HTTPS 另需 proxyTlsConfiguration；其 pfxFile 相对证书配置目录，省略用同目录 localhost.pfx。
- 连接脚本为 Node.js 或 Python，统一接收 start；Python 连接器需要 Python 3。

配置缺失恢复原接入材料。应用、Runtime、定义、会话与工作区在本机，共享平台、认证及模型按配置连接；测试平台可有多个租户，选已获准配置，不按研发人数新建租户。

按需检查本地文件（不执行脚本、不读应用秘密）：

```text
node "<skill目录>/scripts/inspect-launch.mjs" "<项目根>" ["<已有配置路径>"]
```

检查器按 package.json 识别 Node 入口、解析应用脚本及 HTTPS 配置路径。`readyToInvoke` 只证明这些登记文件存在、别名一致及脚本扩展名受支持；不证明 Node 版本、连接器系统兼容、证书内容/信任或服务健康。自定义配置启动用 `npm run start:development -- <配置路径>`。

| 失败处 | 检查 |
| --- | --- |
| 连接 | 原连接器状态、转发目标及远端就绪；本地监听不证明远端可达 |
| 代理 | browserUrl、TLS 信任、上游；日志在 .workforce/development-launch/ |
| 宿主 | 原终端、应用配置与 /health/ready 的 status:ready |
| 宿主就绪仍失败 | 原用户实际登录/业务请求、模型调用；停止无关重启 |

启动器仅复用源码、依赖、配置及代理目标匹配的宿主。输入变化按入口提示正常停止对应进程再启动；旧 PowerShell 实例先在原终端停止。Ctrl+C 停宿主，通道和代理可保留复用。端口冲突先核对进程归属；只修本机连接不重启共享依赖，不清空状态。

铵帮业务开发消费锁定的公共包；相邻 Workforce/Harness 源码修改不会自动进入应用。缺依赖按原准备入口恢复固定包或配置来源，不重打公共包绕过锁定摘要。最终从 browserUrl 复测原动作及持久结果。
