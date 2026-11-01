# 从业务任务选择命令

按当前请求、前文和应用配置确定业务系统。名称相同的任务、邮箱或客户目录可能属于不同应用；未确定目标时先查已有连接和应用配置，仍有多个实际候选时才请用户选择。CLI 的安装不授予平台、应用或员工工具权限。

## 选择现有能力

只读命中的领域参考，再运行具体子命令的 `--help`。下表用于选择命令族；请求字段、版本和结果判断以对应参考及目标服务为准。用户已给出有效命令及目标时，直接沿该操作继续，无需遍历其他命令。

| 用户要完成的工作 | 先选择的能力 | 使用参考与结果检查 |
| --- | --- | --- |
| 查客户、订单等记录，筛选、汇总或修改字段 | `metadata describe`、`data query/get/update`；分享、负责人和历史使用 `data` 对应子命令 | [记录](records.md)与[命令](commands.md)。使用实际对象及字段，核对查询范围、分页和持久结果 |
| 下载模板、导入完整文件、继续原批次或导出表格 | `data import`、`data export-capabilities/export-file` | [命令](commands.md)中的文件导入与[记录](records.md)中的文件导出。先读当前能力，保留作业 ID、进度、游标及逐项失败；不逐行另造导入流程 |
| 查同事、当前企业成员或员工资料 | `member`、`workforce people`、`workforce employee` | [管理](management.md)与[Workforce](workforce.md)。按普通成员可见目录读取；不为查人改用 Host 或管理员全量目录 |
| 查群聊、搜索消息、读附件，或按要求发送、回复和转发 | `workforce channel/message/search/attachment` | [Workforce](workforce.md)。保留原频道、消息序号、发送者和分页；上传附件不等于发送消息 |
| 查本人待办、建立或交办 Task、修改负责人和状态 | `workforce task` | [Workforce](workforce.md)。沿原 Task 的确认和状态规则操作；任务保存、AI 接纳和任务完成分别判断 |
| 建立或调整周期安排、暂停、查历史和原运行 | `workforce schedule` | [Workforce](workforce.md)。使用实际时区、负责人和计划选项；保存默认暂停，启用由原负责人明确执行 |
| 查邮箱、搜索或读取邮件、请求 AI 建议、保存草稿 | 独立邮箱使用 `mail app/ai/assist`；平台个人邮箱使用 `mail account/folders/search/read/draft` | [子应用](applications.md)与[文件和投递](files-delivery.md)。先区分独立邮箱应用与平台邮箱；建议、草稿保存和发送分别判断 |
| 查顾客、登记资料、改字段或继续顾客对话 | `retail context/customers/customer/conversation` | [子应用](applications.md)。读取实际对象、字段选项及原顾客引用；保留原会话和并发版本 |
| 找可用助手、订阅或继续原对话 | `workforce agent/session`，直接 Runtime 使用 `agent directory/chat` | [Workforce](workforce.md)与[智能体](agents.md)。宿主入口沿其实际 Runtime；定义可发现、本人获准使用和工具权限分别核对 |
| 编辑定义、工具、工作区、订阅策略和应用选用 | `agent definition/tool/workspace/policy/subscription/application` | [智能体](agents.md)。先读当前选项和版本，保留其他选用项；管理员资格不代替个人订阅或业务权限 |
| 调整成员关系、组织、角色、权限和设置 | `security`、`member`、`host`、`user`、`application` | [管理](management.md)、[设置](settings.md)与[登录](login.md)。身份恢复和职责变更由访问权限技能组织，只修改已授权差额 |
| 维护函数和编排、调用应用函数或 HTTP 接口、管理 Routine | `function/orchestration/application function/http/routine` | [编排](workflows.md)。先读取实际输入与执行条件；调试可能产生真实外部效果 |
| 查应用版本、构建原源码、安装升级或恢复原操作 | `app`、`market` | [安装](installation.md)、[市场](market.md)与[应用维护](application-maintenance.md)。使用精确版本和原操作 ID；包构建不自动授权发布、安装或服务部署 |
| 上传下载文件、处理语音、提交回答反馈或调整本人功能 | `file`、`workforce speech/session feedback/composition` | [文件和投递](files-delivery.md)与[Workforce](workforce.md)。按原服务能力操作；转写不自动发送，反馈只作用于原回答 |

## 执行并核对结果

1. 按技能入口确定当前工具路径、平台、租户、应用和主体。命令执行、文件读取或目标服务不可用时，报告具体缺项；不自动给员工增加工具或改用高权限身份。
2. 读取所选能力要求的当前事实。例如对象字段、群消息、Task 状态、计划选项、邮箱账号或定义版本。目标已明确且本轮已核对的事实可复用。
3. 按原授权执行最小动作。用户要求查询时只读取；发送消息、保存草稿、调整权限、启用计划和发布安装分别需要该动作的授权。
4. 核对原资源或原请求的回执。完整查询按服务游标续取，结果不完整时保留范围；写入未知时先回查，不更换请求键、不重建资源、不重放整批。业务回执中的拒绝、部分完成和未完成状态不能当作全部成功。

例如“帮我看看 Workforce 还有哪些待办”应从当前主体的 `workforce task list` 开始，按实际角色及状态整理结果；无需用户补说“用 CLI”。“这里要增加一种新的审批流程”则由业务开发技能先判断现有能力及配置差额，CLI 只承担已支持的资源操作。

## 在产品内员工工作区装配

Codex 项目的技能目录与 Workforce 员工的 Runtime 技能目录分别核对。先从当前 Runtime 的 `agent definition show/options` 读取定义的工作区关联和实际 `cwd`。使用文件系统技能提供方时，将选定的完整技能目录交付至该工作区的 `.agents/skills/`，或沿用服务方已经配置的技能根；不能从 Codex 能读取文件推断员工也已加载。更新时核对完整文件集合及内容，保留其他工作区资源。

员工须已有技能加载、参考文件读取和命令执行能力，或目标动作的等价业务工具。技能装配、`install-cli.mjs` 注册命令、员工工具选择和平台业务授权是不同动作；缺少工具或权限时报告缺口，不自动修改定义或提高权限。按原任务需要交付 CLI 与相关业务技能，无需安装全部团队技能。

使用员工原会话入口验证自然业务请求，保留实际技能选择、加载位置、命令参数、服务器确认的主体及原业务回执。已有工具能执行命令，或独立加载器能读目录，只证明该局部能力；不能代替员工实际选用和业务结果。对照验证使用新会话隔离上下文，保留同一主体、定义和工具，不把改后的解释或命令答案加入原请求。
