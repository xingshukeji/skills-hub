# 员工与会话配置

先按原入口选择使用资格，目录 API 由目标项目当前合同与实际 transport 确定：

| 使用场景 | 核对对象 |
| --- | --- |
| 个人工作台 | 本人可用/可发现目录、租户成员关系、定义 enabled 与个人订阅；当前个人入口示例为 /api/workbench/agents、/agent-catalog |
| 应用使用 | 原应用准入、应用选用的定义，以及宿主提供的应用标识和上下文；沿原应用 transport 查询该身份在此应用的目录与资格 |
| 员工/任务委托 | 原员工的委托配置及当前分派、执行与定义/工具配置；任务关联与执行资格按[任务生命周期](task-lifecycle.md)取证 |

同一身份和租户下，个人目录为 0、应用目录为 1，且原应用页面正常使用该助手，是不同资格上下文的合法结果；这不构成补个人订阅或权限的依据。原故障未复现时核对实际实例和入口，保留未验证范围。

## 应用有资格但本机没有定义

新电脑可连上平台不代表该电脑 Runtime 已有智能体定义。先核对原销售身份的租户、应用 ID、应用实际选用的 agentId 和当前 Runtime 地址；用同一身份读取应用资格及应用目录。资格 `canUse: true` 只说明平台允许使用，目录为空仍须检查该 Runtime 的定义、启用状态与工作区。普通销售查询定义管理得到 `AGENT_DEFINITIONS_FORBIDDEN` 可能是正常限制，不据此补管理员权限或改业务角色。

已有授权需要准备本机定义时，使用已有的定义管理身份和同一 Runtime，通过已安装 `shzw-xrain-cli` 的 [智能体参考](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-cli/references/agents.md)查询 `agent definition list`、`show <agentId>`、`options`；明确 404 或空目录才判断缺失，403、连接失败和不同租户不能当作缺失。先核对责任项目提供的版本 1 交换文件、应用当前选用的准确 ID、可用模型、工作方式、实际本机工作区和业务对象引用。已有定义先读取版本及内容，保留已有身份、启用状态和未要求改动；必要时按实际版本更新，冲突或结果未知先回读。

以下 `<cli>` 是 `node "<已安装shzw-xrain-cli目录>/scripts/xrain-cli.mjs"`；将占位项换成实际已核对的值，销售和管理连接各用原身份及同一租户。新电脑尚无连接时，用 `auth login --help` 选择当前支持的浏览器或原生登录，以各自已有身份建立连接；不要复制其他电脑的会话文件或创建替代账号。先用同一连接和 Runtime 的 `auth whoami --agent` 核对平台、租户和主体，再执行下列操作。平台资格命令不接收 `--runtime`；目录及定义命令须指向实际本机 Runtime：

```text
<cli> auth whoami --agent --profile <销售连接> --runtime <实际Runtime地址> --application-id <应用ID> --auth session --json
<cli> auth whoami --agent --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
<cli> agent qualifications --profile <销售连接> --application-id <应用ID> --auth session --json
<cli> agent directory --profile <销售连接> --runtime <实际Runtime地址> --application-id <应用ID> --auth session --json
<cli> agent definition show <应用选用的ID> --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
<cli> agent definition options --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
```

所选 ID 在此 Runtime 确实不存在时，`agent definition import --file ...` 会生成新 ID，不会创建应用原先选中的 ID。先以 `agent definition create --agent-id <应用选用的ID> --name <名称>` 创建该 ID 的停用定义，记录回执中的 revision；再用 `agent definition import --file <交换文件> --agent-id <同一ID> --expected-revision <实际revision>` 导入。按目标 `options` 和项目 Runbook 核对并绑定目标机器已有工作区与工作方式；工作区文件由项目的显式准备入口装配。再次读取 revision，准备完成后用 `agent definition enable <ID> --expected-revision <实际revision>` 启用并回读。命令均使用已核对的管理身份、租户和 `--runtime`；不要更换平台应用绑定或修改销售权限来掩盖本机定义缺失。创建/导入结果未知时按原 ID 回查，不能新建另一 ID 重试。

```text
<cli> agent definition create --agent-id <实际ID> --name <名称> --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
<cli> agent definition import --file <交换文件> --agent-id <实际ID> --expected-revision <创建回执的revision> --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
<cli> agent definition update <实际ID> --workspace-path <目标机器已有目录> --preset <实际工作方式> --expected-revision <导入回执的revision> --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
<cli> agent definition enable <实际ID> --expected-revision <最新revision> --profile <管理连接> --runtime <实际Runtime地址> --auth session --json
```

仅当目标目录需要变更时执行 `update`；已从交换文件正确绑定时保留现有配置，并使用最新回读的 revision 启用。每一步以实际回执决定下一版本，失败或结果未知先回读。

最后切回原销售身份及原应用，重新查询应用资格和应用目录，并在原页面验证该 ID 可选择；需要工具结果或显示时继续验证实际调用与对应回执。定义导入、管理身份能读或资格 `canUse` 不能替代销售页面及工具验收。该方法适用于项目明确交付定义并授权准备本机 Runtime；普通启动不自动覆盖定义、清空状态或更改共享环境。

个人 /agent-catalog 是可发现项，/agents 是本人可用项（前缀 /api/workbench）。已要求订阅/取消时，使用原页面对应的 POST/DELETE /agents/{id}/subscription。

按 source、runtimeKey、agentId、用户与租户核对原会话。同名不代表相同上下文。workspace/preset 不可变时，按宿主要求用新会话应用配置，保留旧历史；不要删除旧会话伪装刷新成功。

原会话 /sessions/{id}/models、/model 使用本实例模型目录。区分认证、配额、限流与连接问题，不假定各 provider 参数相同。

skill 被发现 → 内容加载 → 本会话有工具 schema → 调用获准成功是不同阶段。nativeTools 可为空，仅开放业务工具；缺工具不能自行放开权限。定义/工具变化按宿主装配机制生效，不手改 Runtime 状态。

已有授权下验证原身份/定义、实际模型请求、必要工具与业务回读；只读排查可用已有历史，不为取证另发外部消息。
