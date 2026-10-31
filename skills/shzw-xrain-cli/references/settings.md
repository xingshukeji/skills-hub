# 设置管理

先按[配置与认证](configuration.md)选择实际平台、作用域和身份。以下命令省略共同的 `--profile <连接> --auth session --json`；CLI 不使用数据库、环境文件或个人偏好键来代替平台设置接口。

## Host 平台上限

Host 登录必须显式选择作用域。将已有账号的密码原文通过受保护来源传入 stdin，不在命令参数中填写：

```text
auth login --profile <Host连接> --server <平台地址> --scope host --native --user <已有Host账号> --password-stdin
auth whoami --profile <Host连接> --auth session --json
host settings get agent-definition-limit
host settings set agent-definition-limit --mib 16
host settings set agent-definition-limit --bytes 16777216 --expected-bytes <此前读到的字节数或null>
```

`--mib` 和 `--bytes` 互斥。1 MiB 为 1,048,576 字节，MiB 按页面相同规则四舍五入到整数字节；结果必须为正安全整数。读取结果分别保留平台配置的 `maxDefinitionBytes`、其 MiB 值，以及服务端的默认值。平台配置为 null 时，不推断某个 Runtime 的实际限额。

设置默认先读当前值，将它作为 `expectedMaxDefinitionBytes` 随 PUT 发送。脚本可显式提供此前观察值；`null` 表示平台尚未设置。当前值相同则不写入。旧值冲突保留原请求，不更新比较基线后重试。租户管理员不因此获得 Host 权限；401、403、校验失败与服务故障按原错误报告。

响应丢失、无效或超限时，命令返回 `outcome_unknown`，只回读同一设置一次。`readBack.matchesRequested` 为 true 只说明当前值满足要求；`provesThisWrite` 仍为 false。命令不重复 PUT。正常成功由服务端事务回执确认，不要求预览。

运行中的租户 Runtime 使用自己的连接读取实际值：

```text
agent definition limits --profile <租户连接> --auth session --json
```

结果包含实际 `maxDefinitionBytes` 与轻量启停能力。没有平台覆盖时，Runtime 可以采用自身启动配置；Host 命令不修改该配置，也不依赖 Runtime 地址。CLI 不提供删除上限或恢复默认命令。

## 个人偏好

当前接入 Workforce 实际消费的两项 USER 偏好：

```text
user settings get send-shortcut
user settings set send-shortcut --value ctrlEnter
user settings get unread-badge
user settings set unread-badge --value false
```

发送快捷键取 `enter` 或 `ctrlEnter`；未读角标取 `true` 或 `false`。未保存时显示 `configured: false`、`value: null` 和页面默认值。读取和修改只针对当前租户中的本人，不能指定另一人。此接口没有旧值比较合同；命令只保存一项，不宣称并发条件写入或跨设置事务。结果未知先用同一命令回读。

## 其他配置

| 内容 | 当前入口 |
|---|---|
| 定义、模型、目录、工具及文件交换 | [智能体命令](agents.md)；由 Runtime 校验 |
| 订阅规则、本人订阅、审批与应用选用 | 原有 `agent policy/subscription/application` 命令；由平台授权 |
| CLI 平台、作用域、Runtime 与默认应用 | `profile set`；只保存 CLI 连接 |
| 服务进程启动配置 | 对应服务的运行入口；本 CLI 不修改环境文件或重启服务 |
| 其他 Host、租户或应用设置 | 尚未接入，不接受任意全局键写入 |

多命令 `batch` 按顺序执行；前一步成功的写入不会因后一步失败回滚。以上接口不构成跨平台、Runtime 和本机配置的共同事务。
