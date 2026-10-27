# Layered API template

Use `layered-api` for long-lived product services, public contracts, real-database verification, or work shared across teams.

## Shape

```text
<Namespace>/
  <Namespace>.slnx
  Directory.Packages.props
  src/
    <Namespace>.Domain.Shared/
    <Namespace>.Domain/
    <Namespace>.Application.Contracts/
    <Namespace>.Application/
    <Namespace>.Infrastructure.PostgreSql/
    <Namespace>.HttpApi/
    <Namespace>.HttpApi.Host/
    <Namespace>.DbMigrator/
  tests/
    <Namespace>.Domain.Tests/
    <Namespace>.Application.Contracts.Tests/
    <Namespace>.Infrastructure.PostgreSql.Tests/
    <Namespace>.ApiReportRunner/
```

Confirm the generated shape in the selected template rather than copying this outline blindly.

## Layer boundaries

- `Domain.Shared`: constants, errors, permission facade, shared domain contracts.
- `Domain`: product invariants without provider connections.
- `Application.Contracts`: public DTOs and application-service contracts only.
- `Application`: request-aware product orchestration and structured query/security inputs.
- `Infrastructure.PostgreSql`: context, repositories, schema/seed, and provider details.
- `HttpApi` / `HttpApi.Host`: protocol mapping, middleware, module composition, runtime config.
- `DbMigrator`: foundation then product migration/seed.
- `ApiReportRunner`: isolated PostgreSQL lifecycle and assertion-backed API evidence.

Keep provider dependencies out of neutral layers. Verify restore/build/test, runner guidance without a connection string, and a real PostgreSQL run when available.
