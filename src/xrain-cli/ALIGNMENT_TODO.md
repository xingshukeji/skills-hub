# XRain CLI 能力对齐待办

核对日期：2026-10-31。CLI 维护者：skills-hub；平台、Runtime、Workforce 与独立市场分别由原项目维护。

## 本轮修复与验证范围

当前 CLI 是 Node.js 实现，源码位于本仓 `src/xrain-cli/`，使用者只需完整 `shzw-xrain-cli` Skill 和 Node.js 22.12+。旧 .NET CLI、专属测试、依赖和旧消费入口已删除；all_in_one 退役与基线修复已提交推送至 `4e164be7`。CLI 运行不需要 .NET。

本轮按已确认缺陷修改现有命令。可选功能扩展与原生服务尚未提供的协议从实施范围中移除。CLI 不新增登录、授权、调度、执行状态或自动重试机制。

| 范围 | 本轮结果与使用入口 |
|---|---|
| 原生必填分页 | routine list、metadata picklist list、metadata picklist-item list 默认 page=1、pageSize=20；显式参数与查询文件覆盖默认值。 |
| Runtime 临时文本 | directory/generate 传递 profile 或单次选择的应用 ID，支持 --personal；普通单次执行继续使用原协议。[使用说明](../../skills/shzw-xrain-cli/references/runtime-runs.md)。 |
| HTTP 原始调试 | 保留状态、响应头及原始内容。文本或 base64 输出注明编码；--out 排他保存原始字节，已有文件在请求前拒绝。失败响应仍可检查，断连不重发。[使用说明](../../skills/shzw-xrain-cli/references/workflows.md)。 |
| 执行结果与 batch | HTTP interface invoke、orchestration debug 的 isSuccess=false 返回非零退出码并停止 batch。查询历史中的失败记录仍可读取；不从任意业务 JSON 推断执行失败。 |
| Host 合法操作 | app versions 支持同一 Host 导入身份回读原版本；time resolve/day-range 接受原生 Host 身份。其他操作保留原租户要求。[应用维护](../../skills/shzw-xrain-cli/references/application-maintenance.md)。 |
| 写入恢复与关键回执 | 管理写入保留原请求键、ETag 及安全目标标识。对象、字段及字段部署恢复校验原生版本和目标；异常回执结果未知，原生删除及权限重建的 204 保持有效。[元数据](../../skills/shzw-xrain-cli/references/metadata.md)。 |

验收覆盖原缺陷、显式参数、Host 与租户边界、正常 204、业务失败停止、异常回执不重发及输出文件不覆盖。独立完整 Skill 从复制后的目录运行，验证默认分页、应用上下文、原始 HTTP 响应及原有文件与 Workforce 接入。其余能力入口见完整 Skill；本表不表示平台全部接口均已映射。

本机检查使用 npm run check，交付前重新构建独立脚本并核对 Workforce 完整消费副本。源码与隔离服务验证不证明实际部署已升级，也不表示已对真实收件人发送消息或修改共享数据。Windows、Linux、macOS × Node 22.12/24 使用仓库既有 CI 矩阵；当前变更以自身提交的检查结果为准，不能沿用旧制品的通过记录。

## 剩余验证与交付

| 状态 | 责任项目及剩余事项 | 恢复条件与验收 |
|---|---|---|
| 受阻 | Workforce：GitHub 云端完整 Web 检查 | `00d15c44` 的 [Actions 检查](https://github.com/xingshukeji/xrain-workforce/actions/runs/41186391390)因账号付款或额度限制未启动，未执行代码及测试。仓库账号维护者恢复 Actions 额度后重跑该提交；本机宿主 28 项定向回归及文档检查已通过，不能代替云端完整 Web 检查。 |
| 未验证 | Workforce：目标部署消费新增 `/api/cli/v1` 宿主入口 | 交付负责人按明确环境发布兼容宿主后，用受管固定成员核对 context、Task 创建与改派、原会话、消息回读、退出或撤权、计划任务及过期凭据。不在旧宿主上回退网页 Cookie 路由。 |
| 未验证 | XRain、Runtime、独立市场：各实际部署的新增命令消费 | 环境所有者明确服务版本及受管身份后，沿完整 Skill 从登录进入选定业务动作，核对权限拒绝、版本冲突、未知结果恢复和最终业务回读；发送及共享数据变更须有对应授权。 |

本任务类型为 Development。共享环境部署、独立系统测试及真实对外发送没有由本次修复自动建立。后续按表中责任与具体环境继续。

## 未纳入本轮的能力扩展

| 责任项目 | 尚未覆盖范围 | 采用条件 |
|---|---|---|
| Workforce / skills-hub | 附件、表情、已读、草稿、群成员与角色、群主转移、消息转发 | 有明确 CLI 用户动作后，通过宿主当前用户授权接口接入；通用平台文件命令不替代宿主附件授权。 |
| XRain / skills-hub | Host 受控数据库结构查看 | 消费服务枚举的来源与结构接口，不提供任意连接或 SQL 执行。 |
| 独立市场 / skills-hub | 匿名读取公开包 | 明确需要未登录消费后，单独开放只读路径；包维护继续要求原身份。 |
| XRain / skills-hub | 旧原子文件导入接口 | 当前主入口使用可恢复导入作业；确有原子导入场景时再接入，不作为自动回退。 |

## 保留的产品边界

- Workforce 计划任务由宿主保存和调度。旧平台安排只读历史和暂停；不能用通用 Routine 恢复编辑、启用或旧执行链。
- 完整文件导入使用已有可恢复作业。旧原子导入不是分块资格不足时的自动回退，也不循环旧接口代替集合事务。
- Runtime 地址仍由服务方提供；没有跨实例自动发现合同，不猜域名、端口或内部目录地址。
- Host OAuth、Checkpoint、跨 Worker 接管及全树持久恢复不由 CLI 单方面补造；后续有明确目标时先由原能力所有者建立合同。
- 平台鉴权、业务权限、事务和运行状态继续由原服务持有。CLI 不增加数据库、全局凭据目录、身份映射或第二套执行状态。
