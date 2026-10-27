# Security, package, and validation gates

Read this before changing an AiInfra public API, provider contract, DTO, schema, permission model, or security/query abstraction.

## Change gate

Establish all of the following before editing:

- the inspected current capability and its source/tests;
- why structured filters, query context, ABAC/grant facts, object projection, or a thin adapter cannot express the need;
- whether the value is shared infrastructure or product semantics;
- affected consumers, packages, migrations, tests, and docs;
- the fail-closed behavior when the capability is absent or misconfigured.

If any answer is unknown, investigate or register a blocking task. Do not use `object`, generic dictionaries, scope bags, or product-specific shared fields as shortcuts.

## Security

- Use the current permission helper/managers and RBAC + ABAC model.
- Keep logical object/API names distinct from physical table names.
- Use security-aware repositories or adapters that call the security query/evaluator contracts; ordinary repositories are not authorization.
- Denials must leave no forbidden write and must use the shared access-decision audit path when supported.
- Keep product workspace/release dimensions out of shared permission contracts unless an approved model owns them.

## Package-consumer loop

1. Identify consumers and the repository's current version source.
2. Build/test the package solution using `文档/项目/项目_LLM_backend_packages/运行/RUN-0003-AiInfra测试分层与验证.md`.
3. Publish the changed packages to a temporary local feed.
4. Restore each consumer with a temporary NuGet configuration and normal sources.
5. Build and test consumers from `PackageReference`, not source-project references.
6. Remove temporary configuration and keep secrets out of tracked files.

Run foundation migration and seed before product migration and seed. Product tables may hold product facts but must not duplicate Authen/Biz foundations or introduce replay/summary infrastructure without a current approved decision.

Record only unfinished migration or upstream work in `文档/TASK_CONTROL.md`; do not create review or task-sediment documents solely to restate the change.
