# 智能体完整发布与配置管理

用于将项目交付的智能体定义和配套工作空间一起交付到目标 Runtime。定义、工具和目录由 Runtime 保存；个人订阅策略、审批和应用选用由 XRain 保存。连接、登录与身份核对沿[智能体命令](agents.md)执行。

## 完整发布

准备版本 1 的 `xrain-workforce-agent-definition` 文件，以及只包含本次交付内容的工作空间目录。目录中的隐藏技能、脚本、二进制文件和空目录都会交付；符号链接、特殊文件、跨平台冲突名称及 Runtime 保留的 `.xrain-` 名称会被拒绝，不静默忽略文件。不要将包含凭据、真实业务数据或运行状态的开发目录作为交付源。

以下命令接在 `node "<skill目录>/scripts/xrain-cli.mjs"` 后，省略已保存连接与 `--auth session --json`：

```text
agent publish --file <定义.json> --source <交付工作空间目录> --agent-id <稳定ID> --workspace-path <Runtime目标目录> --check
agent publish --file <定义.json> --source <交付工作空间目录> --agent-id <稳定ID> --workspace-path <Runtime目标目录> --enable
agent publish --file <定义.json> --source <交付工作空间目录> --agent-id <稳定ID> --workspace-path <Runtime目标目录> --update
agent workspace status <稳定ID> --workspace-path <Runtime目标目录>
```

省略 `--agent-id` 时，从当前应用的默认或唯一选用解析已有稳定 ID；没有唯一选用时不创建新身份。目标目录优先取显式 `--workspace-path`，其次取已有直接目录或定义的逻辑工作区在 Runtime 中的配置目录；不会将源电脑导出的直接路径当作另一台机器的默认目标。工作模式取定义中的 `agentPreset`，也可用 `--preset` 明确选择目标可用模式。目标目录不存在时，在已有父目录下创建一层目录；父目录准备仍可用 `agent workspace create`。

CLI 先生成完整文件快照和摘要，检查目标文件及定义版本，再交付工作区、校验完整定义、条件保存，最后回读定义及全部交付文件和目录。首次保存为停用，`--enable` 在保存后启用；已有定义保留启用状态。内容相同时保持定义版本；已有交付内容变化须明确 `--update`。应用选用、订阅、员工关系和会话历史保留原值。

`--check` 不写文件或定义。目标目录已存在时，同时检查完整定义的运行准备；目录尚不存在时，只检查交付计划并返回 `definitionValidated: false`，实际发布创建目录后继续检查。它不创建会话或调用模型，检查通过也不预留版本。

Runtime 在工作区的 `.xrain-workspace-publication.json` 保存本租户、本智能体交付的文件清单及摘要。更新只替换或删除清单管理且仍与原摘要一致的文件，移除不再交付的空目录，保留其他运行文件和非空目录；与新内容完全一致的已有文件可纳入清单。本地修改、不同内容的未受管同名文件、链接或其他租户/智能体的交付清单发生冲突时保留现场，不提供自动强制覆盖。`workspace status` 返回每个交付文件及目录的 `intact`、`missing` 或 `modified` 状态，不返回文件正文。

文件交付与定义保存分别确认，不承诺跨文件系统与定义存储的原子事务。普通文件写入失败会尝试恢复已改文件；进程中断或恢复失败须按原目录核对。定义校验或保存失败时，已成功交付的工作区保留，错误中提供 `stage`、`workspacePublished`、原 `agentId`、目录、摘要和已确认版本；不会自动启用或换 ID 重建。回执丢失为 `outcome_unknown`，先查询原定义及 `workspace status`，不自动重放。发布不冻结运行中的文件写入；并发修改由冲突及回读结果报告，实际模型加载与业务结果仍须在原场景验证。

文件快照、Base64 编码和 HTTP JSON 当前使用内存缓冲，不另设 CLI 固定容量门槛，也不承诺常量内存。目标 Runtime 须声明 `supportsWorkspacePublication` 与完整定义校验能力；旧 Runtime 返回不支持，按所属项目的运行入口更新配套程序，不通过远程 shell 绕过管理接口。

## 配置查询与管理

```text
agent config show <agentId>
agent config update <agentId> --expected-revision <实际版本> --values-json <配置补丁.json>
agent definition enable <agentId> --expected-revision <实际版本>
agent definition disable <agentId> --expected-revision <实际版本>
agent tool show <agentId>
agent tool set <agentId> --expected-revision <实际版本> --values-json <工具选择.json>
agent policy list
agent policy set <agentId> --visibility private
agent application show <应用ID>
agent application set <应用ID> --values-json <完整选用.json>
agent subscription list
agent subscription decide <申请ID> --decision approved
```

`config show/update` 与定义读取/局部更新使用同一合同，覆盖名称、工作要求、模型及推理等级、工作目录和模式、推荐问题、业务操作、侧栏与工具；省略字段保留原值。`tool show` 一起返回当前选择、是否继承、原生和业务工具目录；目录故障保留原错误，仍可用 `config show` 查看已保存选择。`tool set` 只接收 `nativeTools` 和/或 `assistantTools`，不改变其他设置。`nativeTools: null` 恢复继承，`[]` 明确清空；业务工具使用目录返回的完整工具描述，不按名称编造。

启停、工具和配置更新均使用实际读取的版本。应用 `set` 替换全部 bindings 和默认项，须保留仍需要的选用。可见性、订阅、审批、应用准入和业务权限分别生效；选择工具或发布文件不授予业务权限。其余策略、订阅、资格及目录命令见[智能体命令](agents.md)。
