# Skills Hub

独立 skill 位于 `skills/<name>/`。安装和主动更新取默认分支；不设 skill 版本目录或 release，已安装副本不会自动更新。

## Skills

<!-- skills:start -->
| Skill | 用途 |
| --- | --- |
| [cicd](skills/cicd/SKILL.md) | 查询、触发已有 Jenkins 流水线并跟踪构建、发布或部署；不编写流水线。 |
| [workforce-agent-troubleshoot](skills/workforce-agent-troubleshoot/SKILL.md) | 排查 Workforce 智能体不回复、不跟进、工具失败、重复消息、会话混淆和接管后迟到写入。 |
| [workforce-business-development](skills/workforce-business-development/SKILL.md) | 基于 XRain 与 Workforce 开发企业非标业务，复用平台能力和原系统 API，完成建模、授权、业务逻辑、自动化、页面与智能体工具。 |
| [workforce-runtime](skills/workforce-runtime/SKILL.md) | 启动、恢复和验收 Workforce 环境，核对部署效果，定位慢页面与慢会话。 |
| [xrain-access-diagnosis](skills/xrain-access-diagnosis/SKILL.md) | 排查 XRain 登录后的 403、应用准入、角色与数据范围、执行身份和机器人权限；支持授权修复与撤权复测。 |
| [xrain-app-operations](skills/xrain-app-operations/SKILL.md) | 处理 XRain 已发布应用的租户安装、升级、冲突、中断恢复、组件恢复和卸载；不构建服务镜像。 |
| [xrain-auth](skills/xrain-auth/SKILL.md) | 通过 XRain 认证中心网页准备或恢复固定身份、激活登录、修复 OIDC 接入，并验证原应用登录。 |
| [xrain-cli](skills/xrain-cli/SKILL.md) | 用自带 CLI 连接 XRain 平台或应用市场，操作平台用户、权限、数据及应用包；认证中心账号由 xrain-auth 处理。 |
<!-- skills:end -->

每次只加载与当前任务相关的入口和参考。Workforce 从加载结果的 `resourceBase.path` 读取资源；skill 不增加员工工具权限。验收与测量已合入 workforce-runtime，旧安装中的 workforce-verify/workforce-performance 可在更新时移除。

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
