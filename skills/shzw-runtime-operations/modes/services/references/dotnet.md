# .NET 服务诊断

从原业务请求定位服务端原因。启动、健康和依赖可达只证明对应事实；运行时指标、调用栈、数据库等待和业务结果需要相互印证。XRain/AiInfra 的数据访问差异见[项目映射](xrain-dotnet.md)，判断示例见[诊断案例](dotnet-cases.md)。

## 固定对象与采集条件

1. 从目标项目入口和 Runbook 解析当前服务。记录实际包或制品、PID、启动时间、运行时版本、架构、OS、容器及 CPU/内存限额。把本机 Node.js 宿主、共享 .NET 平台、认证和数据库分别识别。
2. 固定原动作、请求时间、已有请求关联 ID、完成量、错误和慢样本。确定本次观察时长、输出预算和停止条件；优先使用已有监控和日志，不为诊断自行压测共享服务。
3. 核对现有工具的版本和帮助。现代 .NET 优先使用已有的 `dotnet-counters`、`dotnet-stack`、`dotnet-trace`；缺工具时沿 Runbook 准备受管工具或使用既有观测，不默认安装 SDK、重启目标或改容器权限。

容器内外 PID 可能不同。核对目标 PID 命名空间、诊断端点、执行身份及端点访问条件；Linux 还需核对诊断 socket 所在的临时目录及挂载。诊断被禁用或端点不可达时先解释限制，不能通过关闭隔离或新增公网诊断口绕过。

## 按症状取得证据

| 症状 | 先观察 | 下一项有效检查 | 不能据此直接下结论 |
|---|---|---|---|
| CPU 高、吞吐下降 | 同窗进程 CPU、实际 CPU 配额/节流、完成量、分配和 GC 暂停 | 在症状窗口采短跟踪，区分业务热点、GC、序列化和原生调用；检查符号及丢事件 | CPU 高不等于需要扩容；仅按进程 CPU 百分比不能排除容器节流 |
| 请求慢、CPU 不高 | 请求耗时/在途数、线程池排队/线程增长、锁竞争、数据库池和依赖等待 | 取等待栈，关联连接取得、持有、SQL 执行及事务结束；对照数据库等待 | 低 CPU 不证明资源充足；队列为零也不能单独排除线程池饥饿 |
| 内存增长、GC 频繁 | 分配量、各代回收、回收后堆/碎片、GC 提交内存、工作集和容器内存 | 在可比业务阶段查增长类型、保留字节、根路径及非托管资源 | 分配量、GC 提交量、存活对象和 RSS 不能互换；内存短时下降不证明修复 |
| 超时、异常或保存结果未知 | 原请求日志、错误码、依赖结果、事务与提交后动作、实际业务回读 | 区分未执行、提交失败、已提交后失败和响应丢失；使用原关联查询 | 异常次数不等于请求失败数；HTTP 500 或连接中断不证明已回滚 |
| 取消或离开后资源保留 | 活跃任务、连接、订阅、计时器、缓存和辅助集合 | 追创建者、持有者、取消/Dispose 及超时释放；在自然释放窗口复验 | 强制 GC、清缓存或重启不能作为自然释放证据 |

线程池饥饿的证据通常包括线程增长、完成速率不足以及阻塞栈。将 `.Wait()`、`.Result`、同步 I/O 和锁等待与原请求对应；不能仅看到某个阻塞帧就归因所有慢请求。持续 CPU 热点使用采样栈，瞬时等待使用对应窗口的栈或等待事件。

## .NET 10 与 ASP.NET Core 指标

以下是当前现代 .NET 的选择示例。先核对目标实际版本和已发布 Meter；旧 EventCounter 的名称及单位可能不同，不把旧字段名静默替换成零。核对工具输出是累计量、窗口增量还是速率，已经换算的速率不再差分。没有出现某项指标，应区分未启用、未触发、采集窗口缺失和版本不支持。

| Meter / 指标示例 | 解释与用途 |
|---|---|
| `System.Runtime`：`dotnet.process.cpu.time`、`dotnet.process.memory.working_set` | CPU 时间是累计量，按窗口增量和实际 CPU 配额解释；工作集包含堆外内存。运行时启动时识别的 CPU 数量不代替当前容器配额 |
| `dotnet.thread_pool.queue.length`、`dotnet.thread_pool.thread.count`、`dotnet.thread_pool.work_item.count` | 联合观察排队、线程变化和完成速率；累计工作项需要窗口差值 |
| `dotnet.monitor.lock_contentions` | 托管 Monitor 竞争，不覆盖所有异步锁、数据库锁或连接等待 |
| `dotnet.gc.heap.total_allocated`、`dotnet.gc.pause.time` | 按窗口计算分配和暂停；分配多不等于保留多 |
| `dotnet.gc.last_collection.heap.size`、`dotnet.gc.last_collection.heap.fragmentation.size`、`dotnet.gc.last_collection.memory.committed_size` | 按代及回收时刻解释；最近回收值不表示当前时刻刚发生 GC |
| `Microsoft.AspNetCore.Hosting`：`http.server.request.duration`、`http.server.active_requests` | 请求耗时通常以秒记录，按实际路由、结果和时间窗分组；不把所有路由混成一个平均值 |
| `Microsoft.AspNetCore.Server.Kestrel`：`kestrel.active_connections` | 用于 HTTP 连接观察；连接数不等于人数、请求数或数据库连接数 |

调用链与日志沿当前服务已有的关联方式取证。检查 `Activity` 的 TraceId 与应用日志中的请求 ID 是否实际传递和对应，不因同名就认定同一条链。已有 Meter 不证明安装了 OpenTelemetry exporter，更不证明已有完整跨服务跟踪；先消费现有能力。

## 有界采集示例

下列为标准工具的用法示例。将 PID、输出位置和时长替换为本次核实值，并通过目标允许的执行入口运行；服务启动、远端连接和参数恢复仍由项目 Runbook 持有。示例中的 30 秒用于说明参数，不是稳定性或容量验收期限。

```text
dotnet-counters collect --process-id <PID> --counters System.Runtime,Microsoft.AspNetCore.Hosting,Microsoft.AspNetCore.Server.Kestrel --format json --duration 00:00:30 --output <受控目录>/counters.json
dotnet-stack report --process-id <PID>
dotnet-trace list-profiles
dotnet-trace collect --process-id <PID> --profile dotnet-sampled-thread-time --duration 00:00:30 --output <受控目录>/threads.nettrace
```

先按症状选择一项，不能把这些命令作为每次必跑清单。数据库问题按[项目映射](xrain-dotnet.md)增加 `Npgsql` 或 `AiInfra.Abp.Uow`；Meter 名称精确匹配。栈输出重定向到受控文件，避免将原始栈、路径或业务上下文直接贴到聊天。

先用 `list-profiles` 确认当前工具支持的配置。新版工具的 `dotnet-sampled-thread-time` 用采样栈估计线程的墙钟时间，栈占比不能直接当作 CPU 占比；需要与实际 CPU 指标对应。`cpu-sampling` 在部分新版工具中仅供 `collect-linux` 使用，不能照搬旧版本的 `collect --profile cpu-sampling`。旧工具按其实际支持项选择并记录差异。

CPU 采样不能代替等待分析。需要等待、异常或分配事件时，从当前工具支持的 profile/provider 选择，记录实际配置和时长。Windows 的 PerfView/ETW 与 Linux 的原生采集仅在确需对应证据且已有授权时选择；`collect-linux` 还涉及内核和 root 条件及可能的全机范围，不因工具推荐就默认扩权或采集全机。

GC 转储、堆转储与堆遍历按现有授权及余量决定。`dotnet-gcdump` 会触发完整 GC；强制 GC 会改变现场。需要对象根分析时再选可用的 dump/SOS 等工具，不能把指标增长直接改称泄漏。保留匹配的运行时、模块和符号信息；工具输出存在不代表内容可分析。

## 回核与结束

将每个原因写成“本轮观察 → 支持与反证 → 栈/调用链/保留关系 → 对原动作的解释 → 待确认项”。指标是采集窗口内的聚合证据，不是请求级历史；采集前发生的计数事件可能无法补回。

原始诊断文件可能包含连接串、路径、SQL、身份或业务内容。先检查标签和内容，只导出必要的脱敏摘要。到时限或预算后停止采集，确认诊断会话及采样进程已退出、输出大小受控、原业务仍可用。原状态和数据保留；恢复或调参仍沿原授权。

修复后保持实际包、负载、身份、数据量和采集口径可比较。复验原请求、相关失败分支及资源释放。未取到栈、数据库等待或足够样本时，明确剩余假设，不把采集成功等同于根因确定。

## 官方方法与示例

- [.NET 官方诊断技能](https://github.com/dotnet/skills/blob/main/plugins/dotnet-diag/skills/dotnet-trace-collect/SKILL.md)：参考环境与工具选择，保留本项目授权及采集范围；该技能主要指导采集，不代替根因分析。
- [线程池饥饿诊断](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-threadpool-starvation)与[DiagnosticScenarios](https://learn.microsoft.com/en-us/samples/dotnet/samples/diagnostic-scenarios/)：在获准的隔离环境学习指标、阻塞栈和故障的对应，不在共享实例触发故障样例。
- [运行时指标](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/built-in-metrics-runtime)、[ASP.NET Core 指标](https://learn.microsoft.com/en-us/aspnet/core/metrics/built-in?view=aspnetcore-10.0)：核对目标版本的名称、单位和标签。
- [dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters)、[dotnet-stack](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-stack)、[dotnet-trace](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace)：核对命令及采集限制。
