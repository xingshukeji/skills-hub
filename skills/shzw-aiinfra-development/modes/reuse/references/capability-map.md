# AiInfra capability map

Read this reference before adding shared infrastructure inside an application. Confirm names and signatures in the installed package public API; platform maintainers may trace its source and tests. A name here does not prove that the target package version exports it.

## Shared owners

| Concern | Current AiInfra surface |
|---|---|
| Module and DI | `LLMModule`, `DependsOnAttribute`, `ServiceDependencyAttribute`, module scanning |
| Request context | `OnapiSession`, claims/header/tenant resolution, middleware |
| Unit of work | `UnitOfWorkManager`, MVC/Minimal API filters, provider savepoints and UoW state restoration; see [transaction semantics](transaction-and-failure-semantics.md) |
| Data access | `IPlatformDbContext`, `ITenantDbContext`, `AddAbpPlatformAndTenantDbContexts<TPlatform, TTenant>`, repositories, data filters, tenant connection resolver |
| IDs and base fields | `IdGenerator`, `IdPrefixRegistry`, base entities, `StandardFieldNames` |
| Foundation data | PostgreSQL platform, metadata and tenant migration/seed APIs; select the consumer's data model before choosing which foundations it needs |
| Query | `FilterItem`, `QueryContext`, relational query builders, lookup/upward expansion, provider dialects |
| Runtime records | runtime record managers, schema/CRUD/query/concurrency behavior |
| Object metadata | `IObjectMetadataManager`, `ObjectMetadataDefinition`, `BizObject`, `BizField`, `BizListView` |
| Security | permission managers, `ISecurityQueryBuilder`, `IAbacPolicyEvaluator`, sharing and record-team facts |
| Audit and triggers | trigger manager, audit records, access-decision audit sink, logging |
| Dynamic code execution | `AiInfra.Abp.Http.Orchestration`, function bridges and source/definition validation; see [dynamic execution](dynamic-execution.md) |
| Providers | PostgreSQL, Storage, RAG, ChatHub, file-security providers; verify the target version's exported support |

Platform maintainers classify foundation, product and dynamic-object tables using their project document `文档/项目/项目_LLM_backend_packages/技术设计/DOC-0003-AiInfra表建设职责与落库规范.md`. Public consumers use the delivered table/API contract and keep application facts separate; private document access is not an adoption prerequisite.

## App-side duplicates to block

- raw provider connections or local transaction infrastructure in business paths;
- local query AST, field-path/join, sort/page/search, record-scope, or parameter compilers;
- local ID and permission-name systems or duplicate foundation tables;
- local authorization fixtures treated as production security;
- duplicate object metadata/runtime storage used by query or security;
- direct SDK wrappers that bypass an existing provider abstraction.

Schema migrators, seeders, isolated test runners, database administration tools, and explicitly product-specific provider features may be valid exceptions. Keep each exception narrow and documented at its owning source.

## Minimal API and ID checks

- Mark write endpoints or route groups with the supported UoW filter; disable UoW only for explicit exceptions.
- Treat a path as partially migrated if repositories still own raw connections or transactions.
- Generate IDs only with prefixes registered in `IdPrefixRegistry`; do not truncate, pad, hash, or silently rewrite unknown prefixes.
