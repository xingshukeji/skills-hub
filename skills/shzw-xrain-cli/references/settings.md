# 设置管理

先按[配置与认证](configuration.md)选择实际平台、作用域和身份。以下命令省略共同的 `--profile <连接> --auth session --json`；CLI 不使用数据库、环境文件或个人偏好键来代替平台设置接口。

## 定义保存能力

智能体定义的异步导入和保存不再使用固定字节准入，CLI 已移除 host settings get/set agent-definition-limit。不要通过个人偏好或通用设置键恢复该门槛。

```text
agent definition limits --profile <租户连接> --auth session --json
```

此命令只在明确查询时读取 Runtime 声明。新版返回 maxDefinitionBytes: null，表示不设定义保存字节门槛，并保留轻量启停能力；旧 Runtime 可能仍返回正数字。创建、更新和导入不依赖该查询。旧服务的 413、权限失败或不可用错误保持原样，不自动重发。完整内容能保存不证明所选模型能消费全部内容。

## 个人偏好

当前接入 Workforce 实际消费的两项 USER 偏好：

```text
user settings get send-shortcut
user settings set send-shortcut --value ctrlEnter
user settings get unread-badge
user settings set unread-badge --value false
```

发送快捷键取 `enter` 或 `ctrlEnter`；未读角标取 `true` 或 `false`。平台明确返回设置不存在时显示 `configured: false`、`value: null` 和页面默认值；接口缺失等其他失败直接报告。读取和修改只针对当前租户中的本人，不能指定另一人。此接口没有旧值比较合同；命令只保存一项，不宣称并发条件写入或跨设置事务。结果未知先用同一命令回读。

## 其他配置

| 内容 | 当前入口 |
|---|---|
| 定义、模型、目录、工具及文件交换 | [智能体命令](agents.md)；由 Runtime 校验 |
| 订阅规则、本人订阅、审批与应用选用 | 原有 `agent policy/subscription/application` 命令；由平台授权 |
| CLI 平台、作用域、Runtime 与默认应用 | `profile set`；只保存 CLI 连接 |
| 服务进程启动配置 | 对应服务的运行入口；本 CLI 不修改环境文件或重启服务 |
| 其他 Host、租户或应用设置 | 尚未接入，不接受任意全局键写入 |

多命令 `batch` 按顺序执行；前一步成功的写入不会因后一步失败回滚。以上接口不构成跨平台、Runtime 和本机配置的共同事务。
