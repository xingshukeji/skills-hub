# XRain 应用安装包

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/authoring"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

本模式和所需资源随完整 skill 交付，不依赖原仓库、历史对话、其他 skill 或固定本机路径。命令中的 `<mode-directory>` 指本文件所在目录的绝对路径，`<project>` 指用户当前项目。运行打包工具需 .NET 10 SDK，无第三方包、数据库或联网构建依赖。在 `<mode-directory>/scripts` 目录执行命令，并为输入输出使用绝对路径，避免当前项目的 global.json 影响 SDK 选择。缺 SDK 时说明依赖，不修改项目 SDK 配置。

## 源码、构建与制品归属

完整 JSON 源码、项目构建入口、构建凭据和正式制品属于产生该应用的项目；本 skill 只拥有 application/v1 编写规则和共用离线工具。构建在应用项目的任务中完成，输入和输出都必须落到该项目选定的位置，不能把 skill 目录、个人技能安装目录或线上 XRain 当成应用源码或制品仓库。XRain 的统一构建端点临时接收源码并返回 `.appkg`，不保存源码或构建记录；发布和安装记录不承担源码及制品保管。

项目已有 `package:build` 薄封装时，优先从项目根调用；它应把完整源码发送给获授权的 XRain 服务端构建端点，并保存返回的原始包和元信息，不得复制 ZIP、digest、kind 或引用校验实现。`package:check` 可继续调用本地离线 validate。没有 API 构建能力时保留 source 和离线检查结果，不调用已退役的独立本地 build 命令。一个项目包含多个应用时按 packageId 显式选择，不能递归扫描目录猜测本次输入。

应用项目用 Git 保存可编辑 JSON 和组装清单。开发构建可使用未提交输入，但必须如实标记；正式交付构建必须固定全部输入的提交，并保存服务返回的原始 source SHA-256、package digest、文件 SHA-256、构建版本与构建程序集摘要。开发输出可以位于已忽略的 `.artifacts/`，正式原包必须连同完整输入快照及上述元信息保存到该项目已有的受管制品或发布入口。没有可取回的正式保存位置时只报告本地候选，不宣称版本已经长期保管。

## 模式与边界

用户仅要求生成包：使用目标支持的服务端构建并做离线检查，不自动发布或安装。用户明确要求安装：构建后转入 operations 的[安装公共合同](../operations/references/operations.md)，按交付来源确定目标、身份和授权后才产生远端写入。不要从“包已生成”“测试通过”或 skill 的能力描述推断生产安装授权。

本 skill 的包知识自包含，但环境地址、认证身份、租户、账户等是运行参数，不能凭空生成。先使用该项目已有的非秘密环境配置和安全登录会话；只有缺少必要目标或身份时才询问。不要求用户提供 Host/tenant 数据库连接；全部安装通过 XRain API。本地源码编写、稳定 ID 分配与离线工具自测无需服务或凭据；生成实际 `.appkg` 需要支持构建端点的 XRain 服务和有构建权限的登录会话。

本协议对应 `application/v1`，依据包读取器、DTO、资源与操作契约整理。目标是否提供服务端构建端点，须以目标实际部署版本为准。离线校验、Host 导入成功、租户安装成功是三个不同结果；不得用其中一个代替另一个。目标不支持所用资源或返回恢复错误时，停止本次构建或安装，按[资源归属](../../SKILL.md#修复先判断资源归属)定位责任方并接续已授权修复；不补数据库或规避准入。

业务对象的关联由字段元数据表达：先核对现有目标和使用者权限，再确认目标能否通过包安装预检。不要因字段目标位于另一应用就推断平台缺少关联能力或要求新增关系表、独立依赖声明；包读取、目标租户有效元数据解析及安装限制分别核实。允许包外 Lookup 通过离线结构检查时，目标仍未得到验证，不代表可以安装。

## 生成

1. 阅读 [包编写契约](references/authoring.md) 和 [23-kind 字段目录](references/kinds.json)。将当前项目需求转换成允许的 XRain 资源，不把源码目录、node_modules、镜像、DLL、SQL 或任意文件塞进包。
2. 在应用项目自行选择的源码目录维护 `source.json`：`packageId,namespace,label,versionId,version,records` 六键；每条记录为 `id,kind,values`。从最小需要的 kind 组合开始，不必为 23 类都造记录。可以从 [示例](assets/source.json) 开始，替换其稳定身份和命名空间；示例 ID 不是供不同应用共用的身份。同一应用的记录增多后可以按业务职责分片，但必须由项目显式清单无损合成唯一完整 source；构建工具始终消费完整六键输入，分片不是新的包协议。
3. 用工具分配稳定 ID，保存到源文件；同一应用跨项目和跨环境使用相同 packageId/recordId，新发布版本使用新 versionId。ID 生成键不能含租户或环境。对象 keyPrefix 的全局唯一性仍需目标导入/preflight 确认；冲突不能自动重新分配既有身份。
4. 审查秘密和身份：包含请求头、URL、脚本、嵌套 JSON、模板、种子，不仅检查顶层字段。凭据只以已定义模板占位符引用；用户和角色的授权使用系统标准管理；必要账户、凭据与首次 Owner 在独立目标配置中提供，不进入 source.json 或 .appkg。共享规则日常编辑不走安装绑定。
5. 目标提供统一构建端点时，使用获授权的 tenant 登录会话发送完整源码；不要由项目或 skill 再实现 ZIP/digest/kind 校验。新包需要 `platform.application.package.submit`；已有租户包需要同发布租户的原创建者，或具有该包的 `platform.application.package.{packageId}.maintain` 权限。Host-scope sysadmin 可构建。review、安装和全局应用管理资格本身不允许构建。端点只构建并返回二进制，不保存包，不自动 submit、import、publish 或 install。

```http
POST /api/application/v1/packages:build
Content-Type: application/json
Authorization: Bearer <获授权的登录会话>
```

body 是 `source.json` 的原始 JSON 字节，不是 `{ source: ... }` 包装。请求不超过 32 MiB。成功返回 `application/octet-stream` `.appkg`，`Cache-Control: no-store`，并带下列元信息：

| Header | 含义 |
|---|---|
| `X-Appkg-Package-Id`、`X-Appkg-Version-Id`、`X-Appkg-Version` | 源码声明的不可变应用与版本身份 |
| `X-Appkg-Source-Sha256` | 完整原始 JSON 请求体的 SHA-256 |
| `X-Appkg-Package-Digest` | 服务器读取器核对的规范包摘要 |
| `X-Appkg-File-Sha256` | 返回 `.appkg` 二进制文件的 SHA-256 |
| `X-Appkg-Builder-Version` | XRain.Application 程序集信息版本 |
| `X-Appkg-Builder-Digest` | 实际构建程序集字节的 SHA-256 |
| `X-Appkg-Record-Count` | 服务器读取器回读的记录数 |

保存这些元信息后，若用户明确授权向目标平台发布，按目标项目的发布入口将原始 `.appkg` 上传到 `/api/application/v1/packages:publish`；这会发布到平台目录，不能从仅构建或提交的授权推断发布授权。已有版本按目标契约携带当前发布版本的并发条件；结果未知时先查询原目标状态，不盲目重试。旧 `packages:submit` 已退役。独立应用市场使用其自身发布入口。构建、发布和安装结果分别核对。部署的 CORS 响应策略需暴露 `X-Appkg-*` 及 `Content-Disposition`，否则浏览器不能读取对应响应头。

错误为 JSON `{type,title,status,errorCode,message,sourcePosition?}`。源码诊断提供时，`lineNumber` 从 1 开始、`bytePositionInLine` 从 0 开始（0 是有效位置）；`jsonPath` 限于安全的固定结构路径。错误文本不回显源码值、脚本或任意属性名。常见状态码为 400（源码或包协议错误）、413（超过请求体大小限制）、415（不是 `application/json`）、401/403（会话或构建权限不足）。

没有可用服务端构建端点时，不把旧 skill 生成器作为线上 XRain 的独立构建器。可以继续用本地工具分配稳定 ID、离线 validate、self-test 或互操作检查；本地离线检查不产出服务器构建制品，也不证明服务器准入。输出文件必须在项目内保存且不得覆盖已审批制品。

```text
dotnet run --project <mode-directory>/scripts/Appkg.csproj -- id apg "publisher|application"
dotnet run --project <mode-directory>/scripts/Appkg.csproj -- id apv "publisher|application|1.0.0"
dotnet run --project <mode-directory>/scripts/Appkg.csproj -- id 004 "publisher|application|object|item"
dotnet run --project <mode-directory>/scripts/Appkg.csproj -- validate <project>/application-1.0.0.appkg
dotnet run --project <mode-directory>/scripts/Appkg.csproj -- self-test
```

字段协议使用唯一业务 `type` 和稀疏 `presentation`；不再接受 `fieldType/uiType/uiLength`。旧版源码可用 `convert-field-types <旧source.json> <新source.json> <新versionId> <新version>` 离线生成新版本源码，再将完整源码发送给服务端构建端点。转换要求新版本号及新版本 ID，不修改旧源码或 ZIP；未知、存储冲突或非空旧 uiLength 会指出字段并阻断，须人工核对，不能猜测映射。此工具能力不代表目标服务已升级；导入前核对目标协议。

工具不执行安装，不把包内脚本作为本地代码运行。它检查容器、摘要、23-kind 顶层白名单/类型、ID、直接引用、基本身份规则、自定义权限声明与标准权限引用；不替代服务端脚本编译、嵌套 DTO 业务校验、权限、唯一性、反向依赖、真实数据/DDL 和供应商检查。包外 Lookup 只检查引用形状，并在 `unresolvedLookupTargets` 列出字段和目标 ID，结果为 `offline-valid-with-unresolved-lookup`；这既不是无效字段的定论，也不是安装许可。其他引用仍按本工具较严格的包内闭包检查。复杂资源必须按编写契约审查并通过目标 preflight；不能宣称离线校验覆盖全部语义。

## 安装、升级与交付

安装与恢复统一按 operations 的[安装公共合同](../operations/references/operations.md)执行。开发、测试、生产使用同一不可变 .appkg；只更换目标配置、合法认证会话和 tenantBindings。不重新打包写入环境值。

安装消费已交付的确定原包或目标目录中的明确版本。作者按上文保管完整输入、构建元信息与原包；安装者按实际交付渠道核对来源、packageId、versionId 和摘要，持有本地原包时再核对文件 SHA-256。市场消费不以取得作者源码或构建环境为前提。必要的身份、来源或完整性信息缺失时先向责任方核实，不在安装任务中重建或替换制品。导入回执与租户 operation/installation 是线上实际状态，线下版本记录不能代替它们。

升级前比较前一份已发布 source/manifest：recordId、kind、名称、API Name、父归属等身份不可变；编排版本源码不可原地改。若没有旧制品，先取已批准的发布资料；不要猜测并重发同版本。移除种子不等于删业务数据，卸载不等于物理回滚。

交付分别报告：包路径、packageId/versionId/SemVer、包内 digest、文件 SHA-256、离线检查；实际安装时再报告目标、tenantId、operationId、终态与安装指针。省略秘密。仅 GET operation 为 Succeeded 且 GET installation 的 tenant/package/version/revision 一致时，才报告该租户安装成功。未实际访问目标就明确写“未安装”，不得承诺已具备生产可用性。

## 本 skill 的维护

凡变更会影响包作者应生成什么、离线工具接受什么、目标导入/安装接受什么，在同一任务核对读取器、字段目录、生成器和 install/resolve 绑定，按需更新编写及安装参考、脚本、示例和回归用例。更新技能源及本任务实际使用的完整消费副本，按文件内容核对；个人安装仅在用户明确授权后更新，不是团队工作的前置条件。纯内部重构且上述可观察合同不变时无需修改 skill。

安装完成与可用性分开报告：安装指针一致只证明该版本已提交。支持管理查询的新目标可先调用只读 preview，安装后读取当前组件、安装配置和操作历史，再显式运行当前身份对象读取检查。检查必须带 tenant、version、revision、actor 和时间；管理员结果不代表普通成员业务流程通过，未检查的写入、Trigger、外部服务和成员流程明确保持未验证。具体路由与旧目标边界见[安装公共合同](../operations/references/operations.md)。

协议变化时分别验证合法与非法样例、离线 self-test 和对应服务器读取器互操作；不能只更新文案，未能执行的证据如实保留。目标运行版本可能早于或晚于仓库源码，须确认其协议能力，不能仅凭本机副本支持 `unique` 或 `refPermissionName` 就向任意目标生成这些字段，也不能把隔离候选误报成已合入或已部署。

维护者有服务器程序集时，可运行 `dotnet run --project <mode-directory>/scripts/Appkg.csproj -- interop <file.appkg> <XRain.Application.dll>`，程序集应来自 Host 构建/发布输出且同目录包含其依赖；单独 Application 项目的输出可能缺少依赖。该命令只调用读取器，不访问服务器或安装；这是可选维护测试，不是普通生成/安装的仓库依赖。所有依赖文件通过本模式目录相对路径访问。移动本模式目录后重建工具即可，不复制 bin/obj。
