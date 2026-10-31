# XRain 与 AiInfra 的 .NET 诊断映射

先用[通用诊断方法](dotnet.md)固定原请求和实际运行对象。本参考提供使用知识，不固定服务位置、端口、凭据或部署命令。源码路径相对通过目标项目入口定位到的责任仓库根，不能从技能安装位置猜相邻目录。

## 先核对实际消费

本参考适用于 .NET 10、Npgsql 10、AiInfra 自有数据访问及工作单元；它不证明目标实例已消费同一实现。维护者从 all_in_one 的 `XRain/backend/Directory.Build.props`、`XRain/backend/Directory.Packages.props` 和 `LLM_backend_packages/Main/Directory.Packages.props` 核对声明，再比实际运行包。没有源码的消费者使用已交付契约、运行信息和现有监控。

XRain/AiInfra 同时存在 EF Core 和 Dapper。动态对象及常规关系数据访问通过自有 DbContext、Dapper 和 UoW 执行；EF Core 的迁移或模型路径不能代替该调用链。沿实际接口追到租户解析、权限检查、连接取得、SQL、事务和释放，只查原请求命中的路径。

## Npgsql 10 的连接与查询

Npgsql 10 调整了指标名称。先确认目标实际版本；`Npgsql` Meter 可经标准 `dotnet-counters` 采集，不要求先部署监控平台。旧版本使用其实际发布的指标，缺字段不能当零。

| 指标与维度 | 判断用途 |
|---|---|
| `db.client.connection.count`，`state=used/idle` | 按池观察使用与空闲连接，不能只看整个进程的总数 |
| `db.client.connection.max` | 对照该池实际上限；上限不是当前连接数 |
| `db.client.operation.duration`、`db.client.operation.npgsql.executing` | 对照 SQL 执行时长和在执行命令；SQL 快不能排除连接获取或事务持有等待 |
| `db.client.connection.pool.name` | 分别查看已命名的 Data、Locks 以及其他租户/用途池；不同池的空闲容量不能直接相加后视为可互用 |

在通用采集命令的 `--counters` 中增加 `Npgsql`。默认池标签可能包含连接字符串，采集文件仍放受控位置；只输出经检查的名称、数量和时长摘要，不复制完整标签。

AiInfra 的 `PostgreSqlPlatformConnectionPools` 按配置连接名创建 `AiInfra.Platform.<name>.Data` 与 `.Locks`。Data 与 Locks 共同使用配置预算，实际分配由配置及该包版本决定；不将源码默认值当成现场限额。`PostgreSqlPlatformDatabaseLock` 使用锁池，平台数据访问使用数据池；租户或其他直接连接可能走其他池，两个名称不能代表全服务连接总量。

按同一时间窗依次判断：

1. 将原请求的连接取得等待与对应池的 used、idle、max 对照。池满只证明该池饱和，不能单独证明连接泄漏。
2. 核对连接的持有者、事务范围、取消和 Dispose 路径。连接可能在等待业务、外部调用、数据库锁或提交结束，不一定正在执行 SQL。
3. 在已有权限内对照 PostgreSQL 的 `pg_stat_activity` 等待类型、事务年龄及 `pg_locks`/阻塞关系。数据库端会话数不等于客户端等待数；未取得连接的请求不会成为一条新的数据库会话。
4. 用栈、调用链和数据库等待区分池耗尽、长事务、advisory lock、慢 SQL 与同步阻塞。只读查询需按目标支持的版本、权限和输出限制执行，不导出 SQL 正文或连接凭据。

缩短事务、修释放、调连接预算和加重试是不同动作。未确认持有原因前，不以扩池或重试代替诊断；变更数据库限额和共享配置仍须有对应授权。

维护者需要核源码时，从 AiInfra 项目入口查 `PostgreSqlPlatformConnectionPools`、`PostgreSqlPlatformDatabaseLock`、PostgreSql `AbpDbContextBase`、Relational `RelationalDbContextBase` 和 `RelationalDmlContextBase`。追 `CreateConnection`、打开、事务和释放的实际消费者，不把类名中的 DbContext 自动理解为 EF Core。

## 工作单元与未知写入

AiInfra 已有 `AiInfra.Abp.Uow` Meter。命中事务或保存异常时，将其加入本轮采集；先确认实际包包含对应能力。

| 指标 | 能说明什么及其边界 |
|---|---|
| `aiinfra.uow.commit.failure.count` | 窗口内记录了提交失败；需结合原请求和业务回读判断结果 |
| `aiinfra.uow.partial_commit.count`、`aiinfra.uow.transactions.committed_before_failure` | 多个本地事务参与时，失败前已有提交；不能据此宣称全部回滚，也不产生跨库写入授权 |
| `aiinfra.uow.rollback.failure.count` | 回滚步骤本身失败；继续核对实际持久结果和原异常 |
| `aiinfra.uow.post_commit.retry.count`、`aiinfra.uow.post_commit.failure.count` | 提交后动作重试或失败；数据库写入可能已经完成，不能直接重放原写入 |

计数器和直方图是时间窗内的聚合信息。没有该事件、工具未订阅或采集开始太晚都可能导致看不到值；缺数据不证明提交成功，也不能仅按一个窗口中的计数为某个请求定责。

先关联原请求日志、工作单元异常和原业务记录，再判断是事务前失败、提交失败、提交后失败还是响应丢失。日志中的 TraceId、请求 ID 与 `Activity.TraceId` 可能使用不同来源，核对当前中间件实际映射。后台日志写库也可能产生独立连接，不把这些连接算作原业务事务。

维护者从 AiInfra 项目入口查 `UnitOfWork`、`UnitOfWorkDiagnostics` 和 `AiInfra.Abp.Ddd.AspnetCore` 的 `WebApplicationExtensions`；日志能力查 `AiInfra.Abp.Logging.Serilog`。公共包有缺陷时回到 AiInfra 及其消费者验证，业务编排问题留在 XRain 或对应应用，不在排障时另造一套 UoW、连接池或跟踪框架。

## 回到原业务动作

登录和查询慢要继续区分身份验证、租户/权限读取、业务查询及返回阶段。CPU、GC、Npgsql 和 UoW 指标只解释各自环节；健康接口或单条 SQL 通过不能代替原入口恢复。按原身份、数据规模、实际包及同口径窗口复验，保留慢组、失败和未知结果。

依据：[Npgsql 诊断](https://www.npgsql.org/doc/diagnostics/overview.html)、[Npgsql 10 指标](https://www.npgsql.org/doc/diagnostics/metrics.html)、[PostgreSQL 活动统计](https://www.postgresql.org/docs/current/monitoring-stats.html)与[锁视图](https://www.postgresql.org/docs/current/view-pg-locks.html)。实际字段和工具支持以目标版本为准。
