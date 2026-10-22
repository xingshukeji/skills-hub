# Skills Hub

一个仓库集中维护多个可独立安装的 skill。每个 skill 位于 `skills/<name>/`，文档、脚本及运行所需资源都包含在自己的目录中。

不设 skill 版本号、版本目录或 release 流程。安装和主动更新时取默认分支的最新内容；已经安装的副本不会在运行时自动更新。需要追溯旧实现时使用 Git 历史。

## Skills

<!-- skills:start -->
| Skill | 用途 |
| --- | --- |
| [cicd](skills/cicd/SKILL.md) | 按用户指定的项目、操作和环境触发已有 Jenkins 流水线，查询可用作业与参数，跟踪构建、发布和部署结果。源码获取及 CI/CD 执行由 Jenkins 负责；目标不清楚时询问需要触发什么。 |
| [xrain-cli](skills/xrain-cli/SKILL.md) | 使用内置 Node.js CLI 连接 XRain，快速创建或复用固定测试账号，处理统一认证建号、激活和登录验证，管理用户角色与权限集、runtime 实体数据及应用包。用于 XRain CLI、快速登录验证、测试账号准备、租户连接、权限验证、数据操作、应用开发和独立应用市场操作；不用于部署 XRain 服务或绕过权限。 |
<!-- skills:end -->

## 使用第一个 skill

仓库中的 XRain CLI 已打包，可直接运行。使用端只需 Node.js 22.12+，推荐 Node.js 24 LTS：

```powershell
node ./skills/xrain-cli/scripts/xrain-cli.mjs --help
node ./skills/xrain-cli/scripts/xrain-cli.mjs profile show
```

将整个 `skills/xrain-cli` 目录复制到所用 agent 的 skills 目录即可使用，保留 `SKILL.md`、`agents/`、`references/` 和 `scripts/`。运行不需要 `npm install`、全局 CLI、其他代码仓库或 .NET SDK。Windows 会话加密使用系统自带的 Windows PowerShell。

推送到 GitHub 默认分支后，也可通过支持 Agent Skills 的安装器按仓库路径安装：仓库为 `xingshukeji/skills-hub`，skill 路径为 `skills/xrain-cli`。安装完成后从已安装目录运行其中的脚本；更新时由安装器替换该 skill 目录。

认证、连接参数、HTTP 超时与本地状态目录见 [配置与认证](skills/xrain-cli/references/configuration.md)，数据、权限、应用发布示例见 [命令参考](skills/xrain-cli/references/commands.md)。

## 目录

```text
skills/
  xrain-cli/
    SKILL.md
    agents/openai.yaml
    references/
    scripts/
      xrain-cli.mjs                 # 随 skill 交付的可运行制品
      THIRD_PARTY_NOTICES.txt
src/xrain-cli/                      # Node.js 维护源码
tests/                             # 本地模拟 API / OIDC、独立安装验证
tools/                             # 构建、索引与结构检查
.github/workflows/validate.yml
AGENTS.md
package.json
package-lock.json
```

## 维护

维护源码、构建脚本、校验器和测试均使用 Node.js。仅维护者安装开发依赖：

```text
npm ci
npm run build
npm run index
npm run check
```

`build` 把 CLI 和 JOSE 签名校验依赖打包到 skill 的脚本中，同时生成第三方许可说明。`build:check` 校验提交的制品与源码一致，不修改文件。`validate` 检查 frontmatter、UI 配置、内部链接、独立目录和 README 索引。新增 skill 后运行 `npm run index`。

多个 skill 正在并行维护时，可用 `npm run validate -- --skill xrain-cli` 单独核对该 skill 及其目录条目。默认 CI 仍校验完整目录。`agents/openai.yaml` 和其中的 policy 为可选元数据；填写时检查其格式。

`npm test` 使用临时配置和本地模拟服务，覆盖普通 API 路由、凭据处理、OIDC、租户会话、包校验和发布冲突信息，并将 skill 单独复制到临时目录运行，验证不依赖仓库源码或 `node_modules`。测试不访问真实租户、不授予真实权限、不发布真实应用。CI 在 Windows、Linux、macOS 和支持的 Node 版本上运行相同检查。

原 XRain CLI 行为迁移到 Node.js。兼容原有 API 与主要参数，并收紧无效参数、ZIP 完整性、输出覆盖和凭据输出处理；新增 `XRAIN_HOME` / `XRAIN_SESSION_DIR` 用于隔离状态。`security tokens show` 为只读操作。CLI 不包含 XRain 服务端，也不执行本地 .NET 构建。

## 本机开发环境验收

真实服务验证通过 `npm run verify:live -- <phase>` 显式执行，不纳入普通测试和 CI。先运行 `login`，在浏览器完成当前开发环境提供的登录；再依次执行 `security`、`prepare-data`、`basic`、`data`、`app`、`market-login`、`market`、`credentials`、`end`、`login-auto` 和 `report`。`login-auto` 验证默认浏览器启动；其他登录阶段提供手动打开的链接。各阶段串行执行，`report` 会检查所有必要能力是否有通过记录，缺项或失败均非零退出。

默认连接 XRain `http://127.0.0.1:5410`、独立市场 `http://localhost:5380`，租户为 `tenant-xrain-demo`。本脚本只接受 loopback 目标；`XRAIN_LIVE_SERVER`、`XRAIN_LIVE_EXCHANGE` 和 `XRAIN_LIVE_DIRECTORY` 可覆盖本机地址及验证目录。它使用本机已有的 admin/guest 测试 token；不会把 token 写入报告。

验证通过交付的 `skills/xrain-cli/scripts/xrain-cli.mjs` 执行命令，直接 API 仅准备合成账号、角色、权限集及独立业务对象。状态、合成账号凭据、源码、应用包和脱敏报告保存在 Git 忽略的 `.local-validation/current/`。CRUD 用例会删除自己创建的记录；测试账号、对象与已发布验证应用保留，权限变更完成授予与撤销闭环。

已在当前本机开发服务完成 77 项检查，包含平台和独立市场的真实 OIDC 登录、两版包构建发布、数据增删改查、全部权限关系操作，以及退出、租户绑定与 API Token 准入限制。普通自动化测试当前为 64 项通过。当前服务的管理接口需要浏览器会话，API Token 仅用于开放的数据接口；示例业务对象需以目标元数据目录为准。
