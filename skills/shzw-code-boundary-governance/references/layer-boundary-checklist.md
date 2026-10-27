# Layer boundary checklist

## Ownership

| Layer | Owns | Must not own |
|---|---|---|
| Controller / endpoint | Routing, binding, auth guard, headers, status, Problem Details, UoW marker | Product workflow, direct DB, provider SQL, schema, permission graph |
| AppService | Product use case, DTO validation/mapping, permission intent | Provider SQL/dialect, connection/transaction mechanics, shared algorithms |
| Manager / domain service | Reusable operations and invariants | HTTP concepts and route-specific presentation |
| Repository / adapter | Persistence implementation and product-to-infra mapping | Public HTTP contract, product authorization policy, workflow coordination |
| Provider infrastructure | SQL/DDL, parameterization, provider clients, connection plumbing | Hidden product workspace/release semantics |
| `Application.Contracts` | Public DTOs and AppService interfaces | Internal ports, repositories, stores, DbContexts, query plans |

Dependencies point inward: HTTP to application contracts/application, application to domain/shared abstractions, infrastructure implementing inward ports, and provider-neutral projects never referencing provider implementations.

## DI

- Use the repository's normal module scanning for ordinary services.
- Hand-register external SDK adapters, provider selection, framework factories, feature switches, and test replacements only when needed.
- Constructor-require dependencies whose absence changes security, persistence, or runtime behavior.
- Keep module methods as composition roots, not duplicate service catalogs.

## Flags

- endpoint/controller injects a connection, DbContext, repository, or several low-level managers;
- AppService directly depends on a repository for a multi-step product/runtime workflow;
- one repository owns context, authorization, query planning, SQL, and execution;
- intermediate contracts pass final `WhereSql`, `JoinSql`, `OrderBySql`, or raw parameter dictionaries;
- product code quotes identifiers, builds dialect SQL, or opens a transaction beneath a claimed UoW;
- obsolete compatibility adapters remain after the consumer has migrated.

Schema/seed tools, database administration, isolated report runners, and explicitly provider-specific product features are valid only as narrow exceptions.

## Useful scans

```powershell
rg -n "Repository|Store|DbContext|Npgsql|SqlConnection|Dialect" <contracts-project>
rg -n "IAbpDbContext|NpgsqlConnection|BeginTransaction|Create Table|Alter Table|WhereSql|JoinSql|OrderBySql" <application-or-http-path>
rg -n "AddScoped|AddSingleton|AddTransient|ServiceDependency" <module-path>
```

Convert each match into an ownership decision; a text match alone is not a defect.
