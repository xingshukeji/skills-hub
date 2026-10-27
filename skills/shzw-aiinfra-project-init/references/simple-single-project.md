# Simple API template

Choose `simple-api` only when one project can honestly own host, endpoints, product logic, PostgreSQL adapter, schema/seed, security facade, and tests. Graduate to `layered-api` when contracts are shared, the API is long-lived, provider boundaries grow, or teams need independent tests.

## Shape

```text
<Namespace>/
  <Namespace>.slnx
  Directory.Packages.props
  src/<Namespace>/
    Program.cs
    <ShortName>Module.cs
    Application/
    Domain/
    Infrastructure/PostgreSql/
    Schema/
    Security/
  tests/<Namespace>.Tests/
```

Confirm the generated shape in the selected template rather than copying this outline blindly.

## Boundaries

- Keep host and HTTP mapping in `Program.cs`; keep module composition in the module class.
- Keep product orchestration in `Application` and product rules in `Domain`.
- Isolate provider connections, schema, seed, and SQL inside the PostgreSQL boundary or a test runner.
- Convert product filters to structured AiInfra query inputs and use the shared permission/ABAC services.
- Run foundation migration/seed before product migration/seed.
- Add optional Storage, RAG, ChatHub, or provider packages only when consumed.

Verify request-context failure, permission naming, ABAC denial, module wiring, schema/seed order, and the sample use case.
