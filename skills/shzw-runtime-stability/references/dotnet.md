# .NET 诊断

用于 .NET 进程的内存、GC、等待和资源生命周期。先核对运行时、架构、OS、容器命名空间、诊断端点与工具版本；工具存在不证明已连接正确进程。不要为采样默认安装 SDK、重启实例或放宽容器权限。

## 选择证据

| 问题 | 先观察 | 仍无法解释时 |
|---|---|---|
| 内存持续增长 | `dotnet-counters` 或既有监控中的分配、各代 GC、最近回收堆大小与碎片、GC 已提交内存、暂停；并列进程与容器内存 | 在相同业务阶段比较堆样本中的对象数量、保留字节与根路径；同时查非托管资源及映射 |
| CPU 高或 GC 频繁 | 同窗吞吐、CPU、分配速率与 GC 暂停 | 对症状窗口做有界 `dotnet-trace`；按 OS 和实际工具能力选择 PerfView 或原生采样 |
| 请求慢且 CPU 不高 | 线程池排队、线程数、锁竞争、数据库连接池占用/等待与依赖时长 | 对齐慢请求调用链和等待栈，区分锁、池耗尽、I/O 与同步阻塞；不盲目加线程或扩池 |
| 取消、卸载后保留 | 活跃任务、作用域、定时器、订阅、流连接、缓存值及辅助键/锁数量 | 查创建者、保留者和 Dispose/取消路径；失效值减少但辅助容器增长仍需追踪 |

`System.Runtime` 的 EventCounter 与新版本 Meter 名称和单位可能不同。使用当前工具帮助及[内置指标](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/built-in-metrics-runtime)核对语义；记录原名、单位、瞬时量或累计量。累计 GC 次数、分配字节和 CPU 时间需换算窗口增量。最近一次回收值不代表本采样时刻刚发生回收。

## 内存判定

比较相同预热、工作量和回收阶段。GC 已提交内存包含现有堆及准备供后续分配使用的空间，不能当作存活对象大小；进程内存还包含非托管分配、栈、代码与映射。大堆、缓存预热、池保留或碎片需要按容量与生命周期解释，不能仅凭 RSS 上升判定托管泄漏。

针对增长类型沿根路径找到仍持有对象的缓存、静态集合、订阅或任务。把类型数量与真实活跃实体数对齐，再验证业务退出或失效后的释放。只降低分配量的微基准不足以证明长期保留问题已修复。[官方内存排查](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-memory-leak)提供从指标到堆与根路径的定位方法。

## 采样影响与结束

先用低开销、定时长的指标窗口；跟踪限于实际症状、目标进程和所需事件。需要环形缓冲时，让停止触发对应故障出现，避免等恢复后故障片段已被覆盖。核对丢事件、符号缺失和采样额外开销。

`dotnet-gcdump` 会触发完整 GC；它会改变自然回收现场。转储与堆遍历可能暂停进程并增加内存或磁盘压力。只有当前授权和资源条件允许时才采集；把该窗口与自然观察分开。[gcdump 官方说明](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump)持有实际限制。

结束采集后，确认采样器已退出、诊断会话已断开、输出大小受控，业务仍可用。按项目证据规则保留必要样本，清理本次临时文件；不通过重启或强制 GC 将失败样本变成通过样本。

## 方法来源

- [.NET 官方诊断 skill](https://github.com/dotnet/skills/blob/main/plugins/dotnet-diag/skills/dotnet-trace-collect/SKILL.md)：参考环境识别、工具选择与症状窗口采样，不继承其其他技能依赖或提权操作。
- [Performance-Skill](https://github.com/wieslawsoltes/Performance-Skill/blob/main/SKILL.md)：参考生命周期分段、内存口径和可比实验，不把完整性能工程范围设为每次任务要求。
- [dotnet-counters](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters)：核对当前命令、连接方式和计数器能力。实际操作以目标版本帮助和项目 Runbook 为准。
