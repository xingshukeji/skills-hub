---
name: shzw-xrain-cli
description: 使用自带CLI操作XRain与Workforce的现有资源：Workforce独立邮箱邮件和回复草稿、Task待办、成员部门与联系方式、群聊附件、业务记录、顾客、计划、智能体定义与工作空间完整发布、配置与工具管理及应用包。按用户目标和前文确定系统，目标未定先澄清，无需点名CLI。业务开发、登录或403、人员职责变更、客户端和服务发布部署由对应技能组织。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain
  runtime-requirements: Node.js 22.12+ and command execution; browser, device or native tenant/Host login.
---

# XRain CLI

用户明确指定的系统优先，否则沿前文。XRain/Workforce与飞书的同名任务、邮箱和通讯录分别处理。目标仍不明时先澄清；明确目标后只用该系统的命令与参考。

查改已有资源时直接使用CLI；新增业务逻辑、诊断故障或改变人员职责时由对应任务技能组织。已有明确任务入口时沿用。

## 选择能力

只需解释或建议时按已知事实给出下一步，不重复索要已确认的目标或授权。实际操作按命中专题继续；工具或权限不足时说明具体缺项。

- Task、群聊、附件和计划：[Workforce](references/workforce.md)。
- 邮箱和顾客：[子应用](references/applications.md)；记录及导入导出：[命令](references/commands.md)。
- 智能体定义、工具和工作区：[智能体](references/agents.md)；定义与工作空间完整发布、配置查询和管理：[发布与配置](references/agent-publication.md)；人员权限：[管理](references/management.md)；应用包：[安装与恢复](references/installation.md)。
- 从项目源码发布函数或运行指定版本用例：[项目函数](references/project-functions.md)。组装、发布版本、应用选用和业务调用分别核验。

能力归属不清时查[任务选择](references/task-selection.md)。首次连接、选择凭据或复杂恢复时查[执行前提](references/operation-boundaries.md)。命令已明确时直接查其帮助。

## 执行与回读

用 `resourceBase.path` 或实际 `SKILL.md` 父目录替换 `<skill目录>`，直接运行随附脚本。需要Node.js 22.12+；短命令按需注册，方法见执行前提。

```text
node "<skill目录>/scripts/xrain-cli.mjs" <具体子命令> --help
```

业务请求前，用后续命令相同的目标和凭据核对 server、tenantId、userId、scope；目标和身份未变时复用结果。管理与应用包操作使用 `--auth session`。token绑定租户，`--tenant` 不换身份；管理权或元数据可见不证明业务权限。只执行用户已授权的动作。

明确拒绝和版本冲突保留原错误；缺少有效回执时保留未知，先按原ID/请求键回查，不换键、重建或重放整批。batch失败保留此前写入。受理、保存、执行完成和业务成功分别判断。

审批须由用户明确作答。秘密经受保护文件、环境或stdin传递；只用已获准工具，不修改生成脚本。认证中心身份通过其自身网页管理。
