# AiInfra / XRain boundaries

Use this reference only for XRain or another application consuming `AiInfra.Abp.*`. Prefer newer current specs and source when they conflict with this summary.

## Sources

- `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0001-AiInfra基础设施能力与应用接入指南.md`
- `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0002-AiInfra基础职责边界与下游禁建清单.md`
- `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0003-AiInfra表建设职责与落库规范.md`
- `文档/项目/项目_XRain/技术设计/DOC-0022-AiInfra基础设施消费准则.md`
- `文档/项目/项目_XRain/技术设计/DOC-0024-XRain发布态到AiInfra对象投影映射规范.md`
- `文档/项目/项目_XRain/技术设计/DOC-0025-XRain对象分层与Schema收敛规范.md`

## Owner split

AiInfra owns module/DI, request and tenant context, UoW, data access, provider dialects, structured query, runtime records, object projection, RBAC/ABAC, record scope, audit/logging, foundation migration/seed, and generic providers.

The app owns product DTO/HTTP behavior, product state and lifecycle, product schema/seed after the foundation, use-case orchestration, UI, and thin mapping adapters. XRain also owns its explicitly PostgreSQL-only dblink product boundary.

## XRain gates

- `Application.Contracts` exposes public DTO/AppService contracts only.
- Runtime record and object-design paths delegate to the current AiInfra managers; they do not restore local DDL, CRUD/query SQL, dialects, field-path parsing, parameter maps, metadata repositories, or record-scope SQL.
- XRain does not create parallel identity/permission/tenant foundations or a second metadata truth source.
- HTTP security endpoints delegate workflows to AppServices.
- Test-fixture direct writes remain inside the isolated report runner.
- Product workspace/release/environment values enter shared services only as structured filters, facts, grants, predicates, or adapter inputs.

When a shared capability is absent, register an upstream AiInfra task; do not hide it in the product repository.
