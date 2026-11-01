---
name: shzw-xrain-cli
description: Workforce 独立邮箱：读邮件、查客户来信、起草回复、把回复保存为草稿，使用本技能。也用自带 CLI 办理 XRain/Workforce 通讯录查人、员工部门和联系方式、任务/待办及原提交回查、智能体定义/工具/工作区的查看和管理，以及群聊附件、顾客、记录、元数据、导入导出、权限设置、计划和应用包。原提交超时先回查；目标已知但缺工具或无权时报告限制，不重问目标。无需用户提CLI，同名业务沿已确定的系统处理。业务开发、登录或403、人员职责变更、客户端、发布部署由领域技能组织。认证中心身份使用其自身网页。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain
  runtime-requirements: Node.js 22.12+ and command execution; browser, device or native tenant/Host login.
---

# XRain CLI

先按前文确定系统、应用和业务目标。XRain/Workforce 的同事、待办、邮箱等沿该系统处理，不因通用词改到其他平台；系统未定且上下文不能判断时才澄清。已有任务技能继续负责业务结果，CLI 提供现有资源操作。新增逻辑、访问修复、客户端和服务部署仍由对应任务入口组织。

## 先判断，再按需读取

只判断意图时，确认系统归属、用户要读/改/恢复什么，以及已知限制；无需认证、注册命令或读取执行细节。缺少命令、文件或等价业务工具时报告具体缺项，技能不授予工具或权限。查询不自动变为写入，未授权动作不执行。

实施时先读[执行前提与恢复边界](references/operation-boundaries.md)，再读命中专题：

- 能力归属及全部专题：[任务选择](references/task-selection.md)。
- 任务、群聊、附件、计划、反馈与语音：[Workforce](references/workforce.md)。
- 记录、导入导出及元数据：[命令](references/commands.md)。
- 邮箱及顾客：[子应用](references/applications.md)；人员和权限：[管理](references/management.md)。
- 定义及对话：[智能体](references/agents.md)；安装及操作恢复：[应用包](references/installation.md)。

## 调用与结果

用真实 skill 目录：技能工具返回的 `resourceBase.path`，或直接读取的 `SKILL.md` 父目录。将示例占位符换成该绝对路径。脚本已打包，只需 Node.js 22.12+，无需 npm 或 .NET。

```text
node "<skill目录>/scripts/xrain-cli.mjs" <具体子命令> --help
```

操作前核对实际 server、tenantId、userId、scope，与后续使用相同目标和凭据；身份或目标未变化时复用结果。token 绑定租户，`--tenant` 不换身份，管理权和元数据可见不证明业务权限。

明确的401、403或版本冲突按原拒绝/失败处理，不改成结果未知；只有缺少有效回执的超时、断流等才保留未知。未知结果先按原 ID/请求键回查，不换键、不重建、不重放整批；batch 失败保留此前写入。受理、保存、执行完成与业务成功分别判断。审批须由用户明确作答。秘密经受保护文件、环境或 stdin 传递；只用获准工具，不修改生成脚本。
