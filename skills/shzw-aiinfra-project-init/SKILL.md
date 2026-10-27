---
name: shzw-aiinfra-project-init
description: Use when creating a new greenfield .NET backend with LLM_backend_packages / AiInfra.Abp.*. Trigger for choosing the simple-api or layered-api scaffold, running the AiInfra scaffold CLI, wiring PostgreSQL and modules, validating package references, or adding the minimal workspace start/verify entry. Use shzw-aiinfra-adoption for an existing codebase.
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-aiinfra-project-init/SKILL.md
---

# AiInfra Project Init

Resolve project entrypoints, source, documents and command working directories from the user's target project. Resolve this skill's `references/`, `scripts/` and `assets/` from its installed directory. Locate other responsible repositories through the target project's entrypoint; never infer the target from the skill installation path.

## Goal

Generate and verify a backend from the repository scaffold. Default to `layered-api` for a product service; use `simple-api` for a small demo, POC, or compact internal tool.

## Load

1. Read root `AGENTS.md`, `文档/TASK_CONTROL.md`, and the package project `AGENTS.md`.
2. Inspect `LLM_backend_packages/Main/scaffolding/src/AiInfra.ProjectScaffold.Cli/Program.cs` and the selected template README under `LLM_backend_packages/Main/scaffolding/templates/`.
3. Read `references/standard-layered-project.md` or `references/simple-single-project.md` only for the selected shape.

The CLI and templates are authoritative. If the requested shape is unsupported, register the scaffold gap instead of hand-writing a parallel architecture.

## Generate

Resolve template, company, project name, short name, output parent, and port. Omit `--aiinfra-version` unless the user explicitly needs an override.

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
- Add only the project entry and reusable start/verify runbook needed by future agents. Put only authorized unfinished work needing recovery in `文档/TASK_CONTROL.md`; do not seed unrequested active tasks.

Report the selected template, generated root, verification results, docs changed, and remaining task IDs.
