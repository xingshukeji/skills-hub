# 苏宏助为 · Skills Hub

苏州苏宏助为智能科技有限公司面向 AI、企业开发者和合作伙伴提供的官方技能与 CLI。配合 XRain、XRain Workforce 的产品说明、开发文档和示例，支持业务二开、AI 定制与系统集成。[联系我们](https://xingshukeji.github.io/xrainTrain/contact)。

[产品与技术](https://xingshukeji.github.io/xrainTrain/products/) · [官方开发文档](https://xingshukeji.github.io/xrainTrain/developers/) · [SDK](https://xingshukeji.github.io/xrainTrain/developers/sdk) · [人员学习](https://xingshukeji.github.io/xrainTrain/learn) · [AI 开发指南](https://xingshukeji.github.io/xrainTrain/ai/) · [本仓 AI 文本入口](https://raw.githubusercontent.com/xingshukeji/skills-hub/main/llms.txt)

第一次使用，可把[统一文本索引](https://xingshukeji.github.io/xrainTrain/llms.txt)与具体业务需求交给 AI；支持 Skill 的工具从下表选取完整技能目录。课程解释怎样使用，技能指导怎样完成任务，正式参数查原专题、公开类型与当前环境。

独立 skill 位于 `skills/<name>/`。安装和主动更新取默认分支；不设 skill 版本目录或 release，已安装副本不会自动更新。

## 产品、SDK 与技能的关系

XRain 是业务应用平台，支持新业务建模，也支持对管理完善的已有系统使用业务编排转接接口，无需新增业务数据模型。XRain Workforce 是人与 AI 协作产品，接入这些业务操作和已有企业服务。

SDK 是供代码使用的开发包，Skill 是供 AI 执行的任务方法，CLI 是终端工具。SDK 按项目制品渠道取得，不能从本仓公开推断 SDK 已在公共 npm 发布。具体取得方式与版本见[官方 SDK 文档](https://xingshukeji.github.io/xrainTrain/developers/sdk)。

本仓是下列技能、配套参考和 CLI 的唯一编写源。每项技能在元数据中保留维护公司、来源 URL、文档入口和关联产品，完整复制后仍可辨认出处；平台与 SDK 的实现、类型和版本由所属产品维护。本仓的产品专题是公开使用参考，不复制维护平台源码。

## Skills

<!-- skills:start -->
| Skill | 用途 |
| --- | --- |
| [cicd](skills/cicd/SKILL.md) | 查询、触发已有 Jenkins 流水线并跟踪构建、发布或部署；不编写流水线。 |
| [workforce-agent-troubleshoot](skills/workforce-agent-troubleshoot/SKILL.md) | 排查 Workforce 智能体不回复、不跟进、工具失败、重复消息、会话混淆和接管后迟到写入。 |
| [workforce-business-development](skills/workforce-business-development/SKILL.md) | 基于 XRain 与 Workforce 落地企业业务，按现状选择免建模的接口编排、新业务建模或混合接入，再完成所需授权、逻辑、页面与智能体工具。 |
| [workforce-runtime](skills/workforce-runtime/SKILL.md) | 启动、恢复和验收 Workforce 环境，核对部署效果，定位慢页面、慢登录、慢会话及实例资源增长。 |
| [xrain-access-diagnosis](skills/xrain-access-diagnosis/SKILL.md) | 排查 XRain 登录后的 403、应用准入、角色与数据范围、执行身份和机器人权限；支持授权修复与撤权复测。 |
| [xrain-app-operations](skills/xrain-app-operations/SKILL.md) | 处理 XRain 已发布应用的租户安装、升级、冲突、中断恢复、组件恢复和卸载；不构建服务镜像。 |
| [xrain-auth](skills/xrain-auth/SKILL.md) | 通过 XRain 认证中心网页准备或恢复固定身份、激活登录、修复 OIDC 接入，并验证原应用登录。 |
| [xrain-business-user-lifecycle](skills/xrain-business-user-lifecycle/SKILL.md) | 在 XRain/Workforce 落地业务人员接入、实际使用、协作与职责变更的完整业务主线，连接固定身份、租户成员、应用准入、业务授权和持续维护。单独登录、403 或权限定位使用对应诊断能力。 |
| [xrain-cli](skills/xrain-cli/SKILL.md) | 用自带 CLI 连接 XRain 平台或应用市场，操作平台用户、权限、数据及应用包；认证中心账号由 xrain-auth 处理。 |
<!-- skills:end -->

每次只加载与当前任务相关的入口和参考。Workforce 从加载结果的 `resourceBase.path` 读取资源；skill 不增加员工工具权限。验收与测量已合入 workforce-runtime，旧安装中的 workforce-verify/workforce-performance 可在更新时移除。

业务落地先找所属项目已确认的完整主线与差异。`xrain-business-user-lifecycle` 承载人员从接入到实际工作、协作和职责变更的通用主线；`workforce-business-development` 沿业务结果组织实现，其余专业能力按当前环节调用。具体业务的长主线及非通用决策仍由所属项目保存，单独诊断可直接进入对应技能。

## 安装与使用

将所需 skill 整个目录复制到宿主 skills 目录，或通过安装器使用 `xingshukeji/skills-hub` 的 `skills/<name>` 路径。各目录独立可用，不依赖其他仓库。

```text
node "<安装目录>/xrain-cli/scripts/xrain-cli.mjs" --help
```

附带脚本需要 Node.js 22.12+，推荐 24；依赖已打包，使用端无需 npm install 或 .NET。当前 Workforce 开发宿主自身要求 Node.js 24；Windows CLI 会话保护仍使用系统 PowerShell。

## 维护与验证

源码在 src/xrain-cli，生成制品与第三方声明在 skills/xrain-cli/scripts，不手工修改生成文件。

```text
npm ci
npm run build
npm run index
npm run check
```

index 生成上方目录；check 核对制品、独立目录、链接及模拟服务测试。validate -- --skill <name> 可单查一个入口，CI 仍查全部。

可选 `npm run verify:workforce -- --provider <真实加载器路径>` 检查独立复制后的加载，这是维护检查，不是 skill 使用依赖。离线场景及历史结果见 [能力复核](evals/workforce/CAPABILITY-AUDIT.md) 和 [首轮报告](evals/workforce/REPORT.md)；实验工具位于 tools/evaluate-skills.mjs、tools/capability-lab.mjs，运行材料放忽略目录 .local-validation。

真实服务检查 `npm run verify:live -- --help` 仅供明确授权的本机验证，必须先按目标生效账号规则核对配置与固定身份。脚本的历史回环默认值和旧验收不代表当前开发或部署架构；普通 check 不访问真实账号或租户。
