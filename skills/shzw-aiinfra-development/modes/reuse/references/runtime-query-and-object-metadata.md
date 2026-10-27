# Runtime query and object metadata

Use this reference for dynamic query, lookup/upward paths, record scope, runtime records, or object metadata.

## Query ownership

AiInfra owns expression lowering, relationship expansion, provider SQL, parameters, paging/sort/search, and record-scope predicates. Confirm the current contracts in source; common entry types include `RelationalRuntimeQueryBuilder`, `RelationalRuntimeQueryRequest`, `RelationalRuntimeQueryPlan`, `RelationalQueryField`, `RelationalQueryJoin`, `RelationalQueryPredicate`, `RelationalQueryParameter`, and `IRelationalRuntimeQueryDialect`.

Application flow:

1. HTTP maps actor, tenant, workspace, request, and response.
2. Application code converts product filters and facts into structured query inputs.
3. The repository supplies the field map and invokes the AiInfra query/runtime manager.
4. Provider infrastructure emits final SQL and parameters.

Keep workspace, release, environment, status, and published/current state as explicit filters, predicates, ABAC facts, grants, or adapter inputs. Do not hide them in an untyped context bag.

Remove app-local equivalents of field-path parsers, join builders, `BuildOrderBySql`, `BuildRecordScopeSql`, `ToParameterValue`, parameter dictionaries, or final SQL assembly. A missing provider-neutral feature is an upstream gap.

## Runtime record update conditions

Use the current `RuntimeRecordUpdateRequest(Object, RecordId, Values)` and optional `ExpectedValues`. Omitted, null or empty conditions mean a direct update; a supplied field with a null value means compare with null. Supplied direct business fields are combined with AND in the same database UPDATE, including guard fields that are not themselves changed. Preserve required business guards such as status, assignee and assignment version; do not replace them with an audit timestamp.

Ordinary runtime-record updates no longer accept `ExpectedUpdatedAt`, its four-argument constructor, or `updatedAt` in the old-value map. Keep audit output separate from update conditions. Read exact old field values from the authorized source; never reconstruct signed/serialized content, compare masks, or fetch a new baseline after a conflict and silently retry. Field comparisons require the field's existing read/original-read permissions. No-condition writes retain their existing authorization.

Before removing a public condition input, identify and migrate its actual HTTP, SDK, package, frontend and adjacent-repository consumers. Verify old input is rejected before a write, optional and null conditions, and preserved business guards. A target lacking this contract needs a coordinated consumer/provider upgrade; do not silently discard conditions or restore a retired time input. XRain owns its DTO/error and consumer details in the data-mapping design linked below.

## Object ownership

`IObjectMetadataManager` and the current metadata DTOs own facts consumed by query, security, ABAC, audit, and runtime records. The app owns its product lifecycle and maps the current product state into metadata definitions.

- Preserve stable object, field, view, table, schema, and key-prefix identities on replay.
- Use the real physical schema in the metadata definition.
- Make destructive cleanup explicit; product policy still owns release or rollback decisions.
- Let AiInfra own metadata cache invalidation and provider DDL.

Block parallel metadata tables, app-local metadata caches, permission creation outside the metadata/permission managers, and app-local dynamic-object prefix rules.

For XRain, current data-mapping and schema rules are in `文档/项目/项目_XRain/技术设计/DOC-0024-XRain发布态到AiInfra对象投影映射规范.md` and `文档/项目/项目_XRain/技术设计/DOC-0025-XRain对象分层与Schema收敛规范.md`.
