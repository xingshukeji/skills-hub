# Node.js 诊断

用于 Node.js 宿主、Runtime、流连接和后台工作。浏览器或 Electron renderer 是独立进程/执行环境；按实际进程分开采样，不能用 Node 堆代替整个客户端内存。

## 指标与口径

复用现有监控、诊断入口或获准的隔离复现。外部新启动的 `node` 进程只能读取自身指标，不能据它的 `process.memoryUsage()` 判断目标宿主。

| 观察 | 判断用途与限制 |
|---|---|
| `heapUsed`、`heapTotal` | V8 使用与分配的堆；按相同业务及自然回收阶段比较，不能代表全部进程内存 |
| `external`、`arrayBuffers` | 关注 Buffer、流及绑定到 JS 的原生对象；`arrayBuffers` 已包含在 `external`，不得再次相加 |
| RSS 与进程/容器限额 | 观察整体压力；堆稳定而 RSS 增长仍可能涉及原生分配、碎片或映射，需要继续定位 |
| 事件循环延迟、利用率、CPU | 区分主线程阻塞、CPU 工作与外部等待；用窗口差值和同窗业务延迟解释，不把利用率直接当 CPU 百分比 |
| 队列、连接、计时器、监听与任务数 | 与活跃业务及退出次数对照；`process.getActiveResourcesInfo()` 只提供使事件循环存活的资源类型，不能独自证明谁泄漏 |

Worker 场景中 RSS 属于整个进程，其他内存字段对应当前线程；不得把多个 Worker 的 RSS 相加。字段定义见 [process 官方文档](https://nodejs.org/api/process.html#processmemoryusage)。

使用 `monitorEventLoopDelay` 时记录采样分辨率、窗口与样本数；直方图值以纳秒计，展示毫秒须转换。每窗口按需要重置，结束时禁用采样器。事件循环利用率与延迟分别解释，不能因平均延迟低忽略尾部。[perf_hooks 官方文档](https://nodejs.org/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)持有版本与单位。

## 保留与释放实验

重复真实进入、订阅、读写、切换、关闭和重新进入。分别记录活跃资源与历史唯一键数量，核对缓存值过期后辅助索引是否仍增长、闭包或监听是否保留历史对象、Buffer 是否随流积压。

验证 SSE/WebSocket 或异步迭代器时，分别覆盖正常完成、用户取消、客户端断开和模块卸载。检查订阅取消、生产者停止、缓冲排空或按契约结束、旧连接关闭；新路由返回 404 不证明既有连接已结束。

降低消费速度时同时观察缓冲条数、字节、最老项年龄、生产速率和事件循环延迟。检查当前流或第三方订阅的真实背压契约；有 `async` 或使用原生流不等于已经有界。`unref()` 只影响进程退出等待，不能代替关闭资源。[Node 流背压说明](https://nodejs.org/en/learn/modules/backpressuring-in-streams)用于核对生产者与消费者配合。

## 深入采样与清理

CPU 瓶颈先使用目标运行方式已有的 CPU profile 或获准 Inspector 入口。堆增长需在可比较阶段检查快照中的保留路径与对象差异；不要靠增加堆上限证明修复。

堆快照会停止主线程工作，构建快照还可能使堆内存需求翻倍并导致进程退出。先核对影响与余量，必要时选择隔离副本；不能将它伪装成无影响的只读观察。详见[官方堆快照说明](https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot)。

结束时关闭本次 Inspector/采样会话、计时器和测试连接，恢复本次临时参数；检查业务与资源基线。原始快照可能包含凭据和业务数据，按项目证据规则存放和清理，不提交到 Git。
