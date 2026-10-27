# 操作系统诊断

把实际进程、容器限额和宿主背景负载分别识别。按资源检查利用率、饱和/等待和错误；先定位哪类资源影响当前业务，再选择深入采样，不直接从“机器慢”跳到参数调优。

## 资源与判定

| 资源 | 使用量 | 等待或饱和 | 错误及判断限制 |
|---|---|---|---|
| CPU | 进程、各核、容器配额下的 CPU | 运行队列、节流时间、调度延迟或 CPU pressure | 总平均低仍可能单核或配额饱和；load average 不等于 CPU 使用率 |
| 内存 | RSS、可用内存、容器当前量与上限 | 回收、换页、memory pressure | OOM、分配失败；缓存占用不等于压力，虚拟地址空间不等于物理占用 |
| 线程与连接 | 线程、套接字、数据库池占用及配置上限 | 锁等待、连接获取时间、排队量 | 连接超时、拒绝和泄漏；服务器 CPU 低不能排除池耗尽 |
| 文件句柄 | 目标进程打开的文件/句柄与限额 | 逼近限额及逐轮未释放 | 打开失败、资源耗尽；与本次生命周期对应，不能只看瞬时总数 |
| 磁盘与 inode | 容量、inode、IOPS、字节速率 | I/O 队列、延迟、io pressure | 空间耗尽、只读、I/O 错误；设备忙碌百分比不能单独证明 NVMe 容量已满 |
| 网络 | 收发、连接数与实际带宽 | 排队、连接建立等待、重传 | 丢包、连接重置及上游错误；与请求时间窗和依赖相互核对 |

预算使用实例实际限额与当前业务需求，不套用统一“CPU 小于某百分比”或“队列小于某条数”。部署观察和测试结果要注明共享背景负载；背景不同的窗口不能直接归因为本次改动。

## Linux 与容器

优先复用已有监控和 `pidstat`、`vmstat`、`iostat`、`mpstat`、`sar` 等已装工具。按症状选择有间隔、有结束时间的采样；区分首个自启动以来的平均值和后续窗口数据。核对工具版本、单位和内核支持，不要求安装整套工具。

容器中同时读实际生效的内存/CPU 配额、使用量、节流、OOM 与压力；cgroup v1/v2 的文件和含义不同。对累计事件取窗口增量，避免把历史 OOM 当本次事件。宿主空闲不能覆盖容器限额，容器总量也不等于单个应用的 RSS。接口见[内核 cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)。

PSI 用于观察 CPU、内存和 I/O 资源竞争造成的停顿。区分主机与 cgroup 范围、`some`/`full`、滚动窗口和累计停顿；指标不存在时标明未测，不能记零。含义以[内核 PSI 文档](https://docs.kernel.org/accounting/psi.html)为准。

仅在已有指标不能解释症状且当前授权允许时使用有界 `perf`/eBPF 等采样。固定 PID 或 CPU 范围、频率、持续时间和输出预算；缺权限或符号时保留缺口，不默认放宽内核限制或提升容器权限。

## Windows

使用现有性能监视器、进程计数器或项目获准的 ETW/WPR/PerfView 入口。用 PID 与启动时间区分同名进程；并列观察 Working Set、Private Bytes、CPU、线程/句柄、磁盘等待与可用内存。工作集、私有提交量及 .NET/V8 堆口径不同，不直接相减后命名为泄漏。Windows 没有 Linux inode 或 PSI 的相同接口，不填造对应数值。

深入采样前核对工具、权限与影响。有关工具选择见 [Microsoft 性能诊断工具](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/)；具体采样入口由目标 Runbook 固定。

## 停止、恢复与来源

达到采样时限、输出预算或负载影响界限时停止本次采样器。核对临时文件占用、残留采样进程、业务可用及本次临时设置恢复。仅诊断时不改 sysctl、磁盘策略、配额或实例数量；调参属于另有授权的目标操作。

方法参考 [Brendan Gregg 的 USE 方法](https://www.brendangregg.com/usemethod.html)和 [Linux 性能 skill](https://github.com/peterbamuhigire/linux-skills/blob/main/14-performance-and-kernel/linux-perf-profiling/SKILL.md)。这里只吸收资源分类与有界采样，不采用外部示例的固定阈值或自动安装、调参流程。
