---
name: shzw-integrate-workforce-application
description: 在 XRain Workforce 开发环境将独立应用接入应用中心，或修复已有接入时使用。按既有配置完成独立应用身份、统一登录、目录贡献、启动与真实验证。普通页面修改、仅查看应用列表及正式部署不触发此技能。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-integrate-workforce-application/SKILL.md
---

# 独立应用接入应用中心

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## 目标与依据

让已授权用户从应用中心打开独立应用并完成实际业务操作。先读取已有事实，只调查缺失或不一致的环节，不从零探索接入流程，也不把可从开发配置查到的地址和应用 ID 转交用户寻找。

固定入口：

- 项目入口（目标项目的 `文档/项目/项目_XRAIN_WORKFORCE/AGENTS.md`）：当前任务和源码路由。
- RUN-0001（目标项目的 `文档/项目/项目_XRAIN_WORKFORCE/运行/RUN-0001-XRain接入检查.md#独立应用接入操作入口`）：管理契约、配置来源、命令与各应用当前实例。
- DOC-0010（目标项目的 `文档/项目/项目_XRAIN_WORKFORCE/产品契约/DOC-0010-独立应用与邮箱客户端.md`） 与 ADR-0009（目标项目的 `文档/项目/项目_XRAIN_WORKFORCE/决策/ADR-0009-独立应用维护与接入边界.md`）：产品入口和独立维护边界。
- DOC-0007（目标项目的 `文档/项目/项目_XRAIN_WORKFORCE/技术设计/DOC-0007-React前端.md`）：目录、打开方式及当前前端事实。

开发接入及其验证属于 Development。当前用户已授权的同目标登记、配置和修复继续执行，不因每个环节涉及多个服务而反复确认；本技能不自行授权部署、扩大业务权限或迁移既有数据。

## 固定接入顺序

### 1. 读取现有配置，确定差异

从目标应用目录、Runbook、本地非秘密配置、启动脚本及实际监听进程核对平台地址、租户、应用 ID、Web 地址、OAuth client 和后端依赖。显式进程配置优先于本地默认配置。先核对已运行实例，不把默认端口当成当前运行事实。

参考邮箱或智能体定义的相同机制，不复制它们的应用 ID、端口、凭据或业务特例。明确这次是首次接入、补配置还是修复；保留不相关服务和数据。

### 2. 登记独立应用身份

通过 Runbook 指向的 ManagedApplication 管理契约查询目标租户。已有同一应用则复用，确认不存在才创建；创建响应不确定时先重读，不能盲目重试创建。身份不明确时核对已有配置与应用详情，不仅凭相似名称认领。

分别核对启用状态、发布范围、当前用户 admission 与业务 read/manage/execute 权限。按用户业务范围设置发布对象，不能将全租户发布视作通用默认值；卡片可见不证明管理或执行权限成立。禁止借用门户或邮箱身份。

### 3. 配置独立统一登录客户端

查询并复用该应用的 public client；缺失时通过认证中心已有管理入口登记。配置准确的 callback、post-logout、origin、API scope 和 Provider。scope 必须已有对应 API audience/resource，不能为接入随意放宽授权。

凭据仅在服务端从现有有效秘密配置读取，按实际配置覆盖关系解析；缺失值不是空密码，不猜测凭据或反复试登录。不要把秘密写入代码、命令参数、日志或本地非秘密配置。通过统一登录完成真实回调，不能用构造浏览器会话替代验证。

### 4. 准备服务和可重复启动配置

独立应用持有自己的页面、服务、依赖与构建。按 Runbook 写入非秘密本地配置和固定启动命令；门户仅在目标平台及租户匹配时加载对应应用配置。

核对真实依赖后再启动，只重载需要读取新配置的开发进程。Runtime、工作区和数据初始化仅在该应用确实需要时处理；新增空存储、复用旧存储与迁移已有定义是不同动作，不能用空列表冒充已有业务接通，也不能为了卡片显示自动迁移或清空数据。

### 5. 贡献应用目录与打开入口

应用 Host 插件向现有 `workforceApplications` 登记稳定键、名称、用途及打开入口，由 Cordis 生命周期注册和释放；核对 bundle patch、依赖和目标 profile。不要再造应用清单或加载器。

目录按当前主体配置与准入过滤，打开及业务访问再次鉴权。采用该应用已确认的承载方式；邮箱内嵌仅是邮箱合同。定义查看与维护通过独立应用进入，不能把管理页面、按钮或弹窗放进工作台输入框。

### 6. 验证用户路径及恢复

先做范围匹配的构建、类型与定向测试，再按 [装配验证技能](https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-verify-workforce-composition/SKILL.md) 验证目录、搜索、实际打开、统一登录、业务操作、拒绝、服务故障恢复及退出清理；裁剪后不得留下对应入口、请求或订阅。

分别报告入口接通、只读访问、管理保存和执行结果。只有查看权限时不伪称管理完成；浏览器未实际打开新窗口时不拿网关重定向代替弹窗证据。应用运行失败归应用处理，单个目录检查失败不应隐藏其他已确认可用应用。

### 7. 更新唯一事实来源

方法变化更新本技能；配置来源、操作入口和命令更新 Runbook；产品入口及代码事实分别更新产品契约和当前设计。只对需要跨会话恢复的未完成工作维护原 TASK_CONTROL/活动计划，不为一次成功接入保存聊天、探查日志或另建完成报告。

收口按当前 Workflow 执行；Git 结果与功能结果分开。具体应用 ID、端口、发布范围及独立 Runtime 实例不固化为本技能的通用默认值。

## 适用边界检查

- “像已接入邮箱一样接入新独立应用”：使用本技能，从现有 Runbook 和目标配置开始，沿七步补差异。
- “重复执行刚完成的接入”：先重读身份、客户端及配置，复用已有资源，不再创建一套身份或重置数据。
- “仅删除工作台输入框中的管理按钮”：按局部 Development 修改界面，不登记应用、不改 OAuth 或业务权限。
- “卡片已显示但保存被拒绝”：定位当前主体管理权限和后端合同；不得扩大发布范围、假造管理成功或自动授予执行权。
- 正式发布、安装应用包或部署目标环境：按对应已授权任务和专业技能处理，不把开发接入方法当部署授权。
