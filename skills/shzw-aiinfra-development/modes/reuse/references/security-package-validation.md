# Security, package, and validation gates

Read this before changing an AiInfra public API, provider contract, DTO, schema, permission model, or security/query abstraction.

## Change gate

Establish all of the following before editing:

- the installed public capability and evidence; maintainers also inspect its source/tests;
- why structured filters, query context, ABAC/grant facts, object projection, or a thin adapter cannot express the need;
- whether the value is shared infrastructure or product semantics;
- affected consumers, packages, migrations, tests, and docs;
- the fail-closed behavior when the capability is absent or misconfigured.

Investigate missing facts and stop only the dependent change while continuing independent work. Task persistence follows the target entrypoint. Do not use `object`, generic dictionaries, scope bags, or product-specific shared fields as shortcuts; supported dynamic field-value contracts are not untyped scope bags.

## Security

- Use the current permission helper/managers and RBAC + ABAC model.
- Keep logical object/API names distinct from physical table names.
- Use security-aware repositories or adapters that call the security query/evaluator contracts; ordinary repositories are not authorization.
- Denials must leave no forbidden write and must use the shared access-decision audit path when supported.
- Keep product workspace/release dimensions out of shared permission contracts unless an approved model owns them.

## Package-consumer loop

1. Identify affected direct and transitive consumers, the version source and the candidate's actual input changes. A candidate built from mixed Local source proves that input, not an independent release.
2. Maintainers use the current package Runbook, `文档/项目/项目_LLM_backend_packages/运行/RUN-0003-AiInfra测试分层与验证.md`. Prefer its existing `Test-ReleaseCandidate.ps1 -Mode Targeted` entry with explicit projects and filters rather than a parallel hand-written restore pipeline.
3. Use the target's isolated build outputs, temporary candidate feed and package cache. Restore `AiInfra.Abp.*` only from that exact feed; third-party sources follow the target Runbook. Do not clear the user's global cache or change normal consumer project references.
4. Verify package identities/content, consumer `project.assets.json` versions and `.nupkg.metadata` sources. Build and run the affected tests through `PackageReference`; require actual execution, not a zero-match or skipped result. Public consumers without the private runner use the delivered packages and equivalent isolated source checks.
5. For already-published API changes, assess old binary compatibility and an ordered migration as required. Recompiling current consumers alone does not prove old binaries work. If all consumers are enumerable and the contract was never published, migrate them directly rather than adding an indefinite compatibility facade.
6. Where the user result depends on a running consumer, verify its actual loaded package/version or content and the original action. HTTP/frontend consumers verify their affected public behavior; they are not NuGet consumers. Keep evidence and temporary state out of tracked files and clean only resources owned by this task.

Run the selected platform/metadata/tenant foundation migrations and seed before the dependent product initialization. Confirm the consumer's metadata-driven, consumer-owned or hybrid model; package availability alone does not require every consumer to create metadata tables. Product tables may hold product facts but must not duplicate foundations or introduce replay/summary infrastructure without a current approved decision.

Report actual package/consumer evidence and concrete missing conditions. Recoverable work uses the target entrypoint's existing rules, not a second review or task ledger.
