# XRain CLI 能力对齐待办

核对日期：2026-10-31。CLI 维护者：skills-hub；平台、Runtime、Workforce 与独立市场分别由原项目维护。

## 已完成的代码范围

当前 CLI 是 Node.js 实现，源码位于本仓 `src/xrain-cli/`，使用者只需完整 `shzw-xrain-cli` Skill 和 Node.js 22.12+。旧 .NET CLI、专属测试、依赖和旧消费入口已删除；all_in_one 退役与基线修复已提交推送至 `4e164be7`。CLI 运行不需要 .NET。

| 范围 | 本轮结果与使用入口 |
|---|---|
| 写入恢复 | 记录、权限及其余管理写入保留原目标和回读信息；超时、断连及损坏回执不自动重放。 |
| Runtime 工作台 | 显式停止、问题取消、子智能体、命令、模型及主业务对象引用；[智能体](../../skills/shzw-xrain-cli/references/agents.md)、[单次执行](../../skills/shzw-xrain-cli/references/runtime-runs.md)。 |
| 记录和文件导出 | 原生集合事务、跨对象查询、原值、分享、历史、Owner 与 XLSX；[记录操作](../../skills/shzw-xrain-cli/references/records.md)。 |
| 成员、授权、应用、Host | 生命周期、组织、权限、审计、受保护 Token 文件与目标绑定；[管理命令](../../skills/shzw-xrain-cli/references/management.md)。 |
| 应用包维护 | 卸载、组件与历史检查、策略预览和应用、恢复、撤回及 Host 本地导入；[应用维护](../../skills/shzw-xrain-cli/references/application-maintenance.md)。 |
| 在线元数据 | 对象、字段、部署失败恢复、视图、选项、记录类型、分享和触发器；[元数据](../../skills/shzw-xrain-cli/references/metadata.md)。 |
| 编排和维护 | 函数、编排、通用 Routine、HTTP、时间、变量、回收站；[编排与维护](../../skills/shzw-xrain-cli/references/workflows.md)。 |
| 文件与投递 | 文件授权、长度与内容类型，账户、模板、测试和发送记录、本人邮箱；[文件与投递](../../skills/shzw-xrain-cli/references/files-delivery.md)。 |
| 独立市场 | 精确版本详情、清单、组件、摘要校验下载、名称与发布版本维护、下架；[市场](../../skills/shzw-xrain-cli/references/market.md)。 |
| Workforce | 专用宿主 CLI API，复用原 Task、员工协作、频道、工作台和计划任务处理器；[业务命令](../../skills/shzw-xrain-cli/references/workforce.md)。Task grant 留在宿主内部。 |

这些结果是源码、原处理器和隔离服务验证范围。命令存在不证明任意已部署服务已支持，也不表示已对真实收件人发送消息或修改共享数据。

## 剩余验证与交付

| 状态 | 责任项目及剩余事项 | 恢复条件与验收 |
|---|---|---|
| 验证中 | skills-hub：本次最终源码的 Windows、Linux、macOS 及 Node 22.12/24 检查 | 本机完整检查和复制消费后，推送同一候选；回读现有 CI 六环境结果。发现的超时或路径差异修正后重新验证，不把其他系统的通过外推。 |
| 未验证 | Workforce：目标部署消费新增 `/api/cli/v1` 宿主入口 | 交付负责人按明确环境发布兼容宿主后，用受管固定成员核对 context、Task 创建与改派、原会话、消息回读、退出或撤权、计划任务及过期凭据。不在旧宿主上回退网页 Cookie 路由。 |
| 未验证 | XRain、Runtime、独立市场：各实际部署的新增命令消费 | 环境所有者明确服务版本及受管身份后，沿完整 Skill 从登录进入选定业务动作，核对权限拒绝、版本冲突、未知结果恢复和最终业务回读；发送及共享数据变更须有对应授权。 |

本任务类型为 Development。共享环境部署、独立系统测试及真实对外发送没有由本次命令实现自动建立。当前本机安装入口指向 Workforce 的完整 Skill；最终 Git 和消费核对沿原实施任务收口。

## 保留的产品边界

- Workforce 计划任务由宿主保存和调度。旧平台安排只读历史和暂停；不能用通用 Routine 恢复编辑、启用或旧执行链。
- 完整文件导入使用已有可恢复作业。旧原子导入不是分块资格不足时的自动回退，也不循环旧接口代替集合事务。
- Runtime 地址仍由服务方提供；没有跨实例自动发现合同，不猜域名、端口或内部目录地址。
- Host OAuth、Checkpoint、跨 Worker 接管及全树持久恢复不由 CLI 单方面补造；后续有明确目标时先由原能力所有者建立合同。
- 平台鉴权、业务权限、事务和运行状态继续由原服务持有。CLI 不增加数据库、全局凭据目录、身份映射或第二套执行状态。
