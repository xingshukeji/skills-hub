# XRain CLI 用户功能对齐

核对日期：2026-10-31。范围：XRain 平台、Workforce 标准功能及现有公共子应用。CLI 维护者为 skills-hub；各产品仍持有自己的业务规则。

## 对齐口径与结论

对齐以用户任务为单位：用户在产品中能完成什么，CLI 是否能以同一身份和权限完成相同操作，并取得可继续使用的业务结果。存在接口、通用记录命令或通过工程检查，均不能单独证明子应用功能已经对齐。

已补齐确认的用户功能：群管理与本人附件、其他消息操作、个人功能组合及应用目录、原邮件 AI、顾客接待、企业发现及公开浏览，以及保留本人确认的账号和企业管理页面入口。复审后补齐原应用消息发布与回查、助手回答反馈和语音，并移除客户端固定下载上限。实现复用原业务处理器和权限规则；没有另建业务存储或执行状态。

“已有主要入口”只表示源码中存在相应业务命令，不表示每个角色、字段和失败场景均已完成实环境验收。“部分覆盖”分别列出已能完成的动作和缺失环节，不把整个模块判为已有或没有。

## XRain 平台

| 用户任务 | CLI 现状 | 功能结论与剩余事项 |
|---|---|---|
| 登录、查看当前身份、发现及选择企业 | auth login/whoami/tenants、profile。 | 本人企业发现使用当前平台会话读取原 security/tenants；不借用 Host 企业列表，不切换当前连接。 |
| 查询、录入和修改业务记录 | data 提供查询、单条及集合写入、字段选项、原值。 | 已有主要入口；按实际对象权限使用。不能因此认定具体子应用的完整流程已覆盖。 |
| 分享记录、转移负责人、查看历史 | data 的分享、Owner 与历史命令。 | 已有主要入口；保持平台的对象、字段及记录范围。 |
| 导入和导出业务文件 | data import、export-file 等命令。 | 已有主要入口；当前可恢复导入路径已经覆盖的用户任务，不因缺少旧接口别名另算功能缺口。 |
| 设计对象、字段、视图、选项、记录类型和触发器 | metadata 命令组。 | 已有主要入口；创建、修改、删除和恢复仍按平台业务约束判断。 |
| 管理企业成员、角色、权限集和组织 | security、host tenant member 等命令。 | 已有主要入口；区分全局身份与当前企业成员资格。 |
| 配置应用、应用角色、使用范围和函数 | application 命令组。 | 已有主要入口；不能代替 Workforce 的本人可用应用目录和功能组合。 |
| 配置编排、自动化、HTTP 集成、投递和存储 | orchestration、function、routine、http、email/feishu/sms、storage/file。 | 已有主要入口。这些是平台用户功能，沟通消息附件仍需单独对齐。 |
| 构建、发布、安装、升级和维护应用包 | app、market 命令组。 | 已有主要入口；发布包、租户安装和本人能否打开应用是三种不同用户结果。 |
| 浏览 Host 平台库及已就绪企业库的结构和样例 | host database sources/catalog/table；原 metadata dblink 保留。 | 已接入现有受控数据源、结构及样例读取；使用 Host 登录，数据源和读取范围由服务器决定。 |

## Workforce

| 用户任务 | CLI 现状 | 功能结论与剩余事项 |
|---|---|---|
| 找人、发起私聊、创建群聊和退出群聊 | workforce people、channel list/dm/group/leave。 | 已有主要入口。 |
| 邀请成员、申请入群、处理申请、改群设置、调整角色、移除成员、转让群主 | workforce group show/update/invite/apply/decide/member-role/remove-member/transfer。 | 已接入原群治理，保留邀请凭据、当前版本及群主、管理员和普通成员规则。 |
| 发送、读取、编辑、撤回消息及按会话检索 | workforce message 命令组。 | 已有主要入口；仍使用原消息和会话身份。 |
| 转发消息、添加或撤销表情、明确标读或标未读、恢复草稿、跨会话搜索消息 | workforce message forward/react/read/read-all/unread、draft get/set、search。 | 已接入同一原消息和本人草稿；保留冲突、搜索游标及来源会话隔离。每个转发目标有独立请求和结果。 |
| 从本地上传附件、发入会话、按会话权限查看和下载附件 | workforce attachment upload/list/download，再使用 message send。 | 已接入本人的原文件处理器，独立核验文件及消息范围；不以平台服务凭据代替本人权限。 |
| 以已授权应用机器人发布通知并查原回执 | workforce application-message send/lookup。 | 使用原执行者凭据、发布应用及目标，机器人保留作者身份；accepted 与 saved 分开，回执不明不自动重发。 |
| 建立任务、确认交办、改派、更新状态、挂载会话、请求 AI 协助、提醒和查看执行对话 | workforce task 命令组。 | 已有主要入口；需要按人工负责、AI 负责和主动协助分别验收。 |
| 新建和修改计划任务、启用、暂停、查看历史、处理运行中的问题或取消 | workforce schedule 命令组。 | 已有主要入口；不把原产品没有提供的操作编造成 CLI 功能。 |
| 在我的助手中选择智能体、开始和继续对话、读历史、停止、响应问题和审批、切换模型 | agent 与 workforce session 命令组。 | 已有主要入口；界面中的侧栏显示、切页和布局不要求复制成终端界面。 |
| 对原助手回答提交、读取和撤销反馈 | workforce session feedback list/set。 | 原 Runtime 核验会话和助手回答，反馈按原本人身份保存和读取，撤销继续提交原回答。 |
| 选择已有语音服务、准备或取消准备、将本地音频转成文字 | workforce speech catalog/configure/prepare/cancel-preparation/transcribe。 | 复用原 speech Remote、选择及输入能力；保留原不可用和拒绝结果，不自动准备模型或发送识别文字。 |
| 与 AI 员工消息协作或交办工作 | 原消息处理器及 task assist 等命令可达。 | 已有主要入口。自然语言请求继续进入原员工处理流程，不要求每个 AI 工具另造 CLI 命令。 |
| 修改本人在线功能组合 | workforce composition get/set。 | 已接入当前选择、可选功能及原依赖处理；只保存本人的在线选择，关闭功能不删除业务数据。 |
| 查看本人实际可用的独立应用及其打开地址 | workforce applications。 | 已接入原应用中心目录，保留实际接入、本人准入、打开地址及 incomplete；不以包安装代替可用性。 |
| 查看本人已绑定登录方式并发起绑定 | workforce account open，可用 --no-browser 仅取入口。 | 打开原账号页面；本人验证和第三方授权仍在原页面完成，不后台绑定或替换身份。 |

## 公共子应用

| 子应用及用户任务 | CLI 入口及复用能力 | 当前用户结果 |
|---|---|---|
| 个人邮箱：管理多个账户、检查连接、查看文件夹、搜索和读取邮件、保存原生草稿 | mail 命令已有这些主要入口，访问原邮箱而非创建邮件副本库。 | 基础动作已有入口；仍需用邮箱实际用户场景核验同一账户、原邮件引用和保存目标。 |
| 个人邮箱：在当前邮件中选择 AI，总结邮件或拟写回复，再明确保存草稿 | mail ai list/subscribe、mail assist、mail app accounts/folders/search/read/draft。 | 已接入邮箱原 AI 目录和原邮件 assist；摘要/拟稿不保存、不发送。明确保存时写入原邮箱的新草稿。 |
| 顾客接待：查找、登记、编辑顾客 | retail context/customers/customer describe/show/create/update。 | 已接入接待应用的实际对象、字段与原资料读写；按本企业元数据和原权限登记、修改并回读，不假定所有企业使用相同字段。 |
| 顾客接待：选定顾客、查原接待对话、选择获准智能体、新建或续接同一顾客的对话 | retail context/customers/customer、agents、conversation list/start、session。 | 已接入实际对象和字段、原顾客关联及应用选定 AI。默认查复用原对话；明确 createNew 才另开话题，保存后回读原资料。 |
| 企业管理：查看和开通成员、编辑资料、停用或恢复成员资格、分配已有角色 | 子应用和 CLI 使用相同的平台成员及角色接口。 | 主要动作可复用，不能误报整个企业管理缺失；仍需按企业管理员的实际角色验收。 |
| 企业管理：以成员身份查看工作页面并返回 | workforce enterprise open。 | 打开原企业管理页，由管理员在原页面选择成员、确认代登录及返回。CLI 不签发或保存代登录身份。 |
| 智能体定义管理：创建、修改、启停、导入导出、选择工具和工作目录、配置个人订阅或应用选用 | agent definition/tool/workspace/policy/subscription/application。 | 已有主要入口。表单展示差异不单独算 CLI 缺口，实际配置和使用资格仍需一致。 |
| 应用开发与应用市场：应用治理、包开发发布、版本查看、安装升级和维护 | application、app、market。 | 主要动作已有入口；不要把包安装等同应用已在 Workforce 目录可用。 |
| 应用市场：未登录浏览公开包 | app list --exchange；market show/versions/manifest/components/download。 | 公开只读不再强制登录，服务仍决定公开版本范围；维护及本人发布历史继续使用原市场身份。 |

## 本轮工作项结果

已认可的工作项均已落实到 CLI 和相应业务入口。操作及原 DTO 示例随完整 Skill 交付，见 [Workforce](../../skills/shzw-xrain-cli/references/workforce.md)与[子应用](../../skills/shzw-xrain-cli/references/applications.md)。本轮没有遗留的功能实现项；共享部署与真实角色验收的证据范围见下文。

| 工作项 | 用户结果与责任方 | 已实现与隔离验证的结果 |
|---|---|---|
| 1 | Workforce 与 skills-hub：群管理和本人附件。 | 原群角色、邀请及审批、移除与转让已接通；本人附件经原上传与授权下载入口传递。 |
| 2 | Workforce 与 skills-hub：消息转发、回应、已读、草稿和跨会话搜索。 | 操作原消息和草稿，保留版本冲突与来源隔离；各转发目标分别提交及记录结果。 |
| 3 | Workforce 与 skills-hub：本人组合和实际可用应用。 | 组合保存后可回读、不同成员隔离；目录反映原应用准入与打开地址，失权后拒绝新增选择。 |
| 4 | 邮箱应用与 skills-hub：原邮件 AI。 | 原邮箱和原邮件引用进入临时 AI；没有自动保存或发送，保存草稿是独立显式命令。 |
| 5 | 顾客接待应用与 skills-hub：顾客到原对话。 | 顾客按实际字段保存及回读，旧对话按原顾客和 AI 查找复用，明确新建保持原业务对象关联。 |
| 6 | 平台、市场与 skills-hub：本人企业、Host 数据库及公开包浏览。 | 本人企业读取不切换连接；Host 使用受控数据源；公开包匿名读取，维护仍要求市场登录。 |
| 7 | 原账号与企业管理网页。 | CLI 仅打开或返回原页面和预期身份；本人验证、代登录确认与返回均保留原交互。 |
| 8 | 文件服务与 skills-hub：下载大小职责。 | 移除本人附件、原文件及预览资产的客户端固定下载上限；大于原上限的流式下载、拒绝、断流清理及已有文件保护通过隔离回归。 |
| 9 | Workforce 与 skills-hub：应用通知及公告。 | 原发布与原请求回查可达；保留执行者、机器人作者、原目标和请求号，失败及回执丢失均不自动重发。 |
| 10 | Workforce 与 skills-hub：回答反馈。 | 对原助手回答提交、读取和撤销反馈；原会话拒绝、非助手消息及不同成员隔离通过原处理器验证。 |
| 11 | Workforce 与 skills-hub：语音。 | 目录、配置、准备、取消准备及转写接入原 Remote；原字节、选择、服务输入能力、当前准入及未就绪分支通过隔离验证。 |

## 不计为 CLI 缺口的内容

- 窗口、Dock、页面排版、主题动画、拖拽布局、侧栏展开位置和本地焦点等纯显示或设备交互，不机械复制成终端功能。
- 产品尚未实现、仍暂停或只是需求目标的能力，先由原产品确认交付范围，不能只记成 CLI 漏实现。
- 演示应用、企业私有应用和任意第三方应用，不因目录里存在源码就默认属于已交付的公共子应用；按实际接入和用户任务另行核对。
- CI 额度、包锁、操作系统矩阵、Runtime 内部恢复机制及已经完成的协议修复，不作为本次用户功能对齐的主待办。
- 个人邮箱本期不提供的发信、删除、批量移动或归档，不因有底层服务能力就擅自加入个人入口。

## 依据与验证边界

验证包含 CLI 消费、完整 Skill 独立消费及原业务处理器的隔离回归：群角色、邀请与审批、草稿冲突、转发隔离、附件范围、大文件传输、应用发布及回查、原回答反馈、语音 Remote、本人组合、应用准入、原邮箱 AI、顾客保存和对话关联。企业和市场读取保留原登录与匿名范围，错误身份和失权不触发业务写入。代码及隔离验证不代表共享环境中每个角色的实测签收；本轮未部署、未创建共享账号、未发送真实消息、下载语音模型或修改共享业务数据。旧服务需要更新到支持这些 CLI 路径的版本；不做网页 Cookie 回退。

- 平台功能范围：[产品能力边界](../../../all_in_one/文档/项目/项目_XRain/产品契约/DOC-0020-低代码平台功能树.md)及其用户操作清单。
- Workforce 标准功能：[产品需求目录](../../../xrain-workforce/文档/项目/项目_XRAIN_WORKFORCE/PRD/PRD-0000-功能目录.md)。
- CLI 实际入口：[命令定义](schema.mjs)、[Workforce 命令](workforce-operations.mjs)、[管理命令](management.mjs)。
- 消息与群：[业务处理器](../../../xrain-workforce/src/backend/plugins/messaging/host/routes.mjs)。
- 功能组合与目录：[成员入口](../../../xrain-workforce/src/backend/bootstrap/http-server.mjs)、[应用目录](../../../xrain-workforce/src/backend/plugins/app-center/host/index.mjs)。
- 邮箱 AI：[原邮件操作](../../../xrain-workforce/applications/mail/backend/routes/personal-mail-message-routes.mjs)。
- 顾客接待及原记录对话：[资料与对话入口](../../../xrain-workforce/src/backend/plugins/xrain-records/host/routes.mjs)。
- 企业管理复用：[成员入口](../../../xrain-workforce/src/backend/plugins/enterprise-management/host/index.mjs)、[平台客户端](../../../xrain-workforce/src/backend/platform/xrain-client.mjs)。
