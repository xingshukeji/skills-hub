# AiInfra Project Init

本模式的参考、脚本和资源位于加载结果的 resourceBase.path + "/modes/initialize"。命令工作目录与项目事实由当前责任项目入口确定；相对资源链接按本模式目录解析。

## Goal

Generate and verify a backend from the repository scaffold. Default to `layered-api` for a product service; use `simple-api` for a small demo, POC, or compact internal tool.

## Load

先核对目标已交付的脚手架 CLI 或已获准源码入口。下列源码路径是当前维护者定位；不要求其他使用者按技能安装位置取得同名相邻仓库。没有可用脚手架时，报告具体交付缺口，不从模板名称猜测或另造公共框架。

1. 读取目标项目入口和当前任务；维护脚手架时再读取其责任项目入口。新工作是否登记由当前已采用的任务规则决定。
2. 普通消费者读取已交付 CLI 的 help、模板清单及对应 README。维护脚手架本身时，才读取 `LLM_backend_packages/Main/scaffolding/src/AiInfra.ProjectScaffold.Cli/Program.cs` 和 `LLM_backend_packages/Main/scaffolding/templates/`；这些路径不是公开消费的必需条件。
3. Read `references/standard-layered-project.md` or `references/simple-single-project.md` only for the selected shape.

The CLI and templates are authoritative. If the requested shape is unsupported, register the scaffold gap instead of hand-writing a parallel architecture.

## Generate

Resolve template, company, project name, short name, output parent, and port. Omit `--aiinfra-version` unless the user explicitly needs an override.

下面是维护者从源码运行脚手架的路径；使用已交付 CLI 时按其真实入口运行相同的 doctor、模板查询、validate 和 new，不猜测安装包或命令名。

```powershell
Set-Location <WORKSPACE_ROOT>/LLM_backend_packages/Main
$cli = './scaffolding/src/AiInfra.ProjectScaffold.Cli/AiInfra.ProjectScaffold.Cli.csproj'
dotnet build $cli
dotnet run --no-build --project $cli -- doctor
dotnet run --no-build --project $cli -- list-templates
dotnet run --no-build --project $cli -- validate --template <TEMPLATE> --company <COMPANY> --name <PROJECT> --short <SHORT> --output <OUTPUT> --port <PORT>
dotnet run --no-build --project $cli -- new --template <TEMPLATE> --company <COMPANY> --name <PROJECT> --short <SHORT> --output <OUTPUT> --port <PORT>
```

Use `--force` only for an intentional replacement and `--zip` only when an archive is requested.

## Verify

From the generated root, run restore, build without restore, and tests without build. For `layered-api`, also run the report runner without a connection string to verify operator guidance, then against PostgreSQL when available.

## Boundaries and closeout

- Keep generated projects on `PackageReference`; do not point them at package source projects.
- Fix feed/version resolution at its source instead of hand-editing generated versions.
- Keep product dimensions in filters, facts, predicates, or adapters rather than shared scope bags.
- Add only the project entry and reusable start/verify runbook needed by future agents. 在已采用 Workforce 统一入口的项目中，只在 Workforce 的 `文档/TASK_CONTROL.md` 登记需要恢复的已授权未完成工作；其他项目沿其既有规则。不为新项目自动填充活动任务。

Report the selected template, generated root, verification results, docs changed, and remaining task IDs.
