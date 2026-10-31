# Workforce 运行维护

复用当前入口和环境，只读对应参考：

- 启动、连接、端口失败：[启动](references/startup.md)。
- 部署后效果不对：[部署核对](references/release.md)。
- 完整使用验收、原问题复测：[验收](references/acceptance.md)。
- 页面、登录、会话慢：[测量](references/measurement.md)。
- 实例内存、连接、队列增长或退出未释放：[实例采样](references/stability.md)。
- 共享平台等 .NET 服务的 CPU、GC、线程池或数据库等待：[.NET 诊断](../services/references/dotnet.md)；命中 XRain/AiInfra 时读[数据访问映射](../services/references/xrain-dotnet.md)。

开发使用项目当前登记入口；部署环境从实际实例核对，不能套用开发命令。健康检查后仍须验证原用户操作。已定位到认证、业务权限或任务执行时转对应排障，停止无关重启。

修复限于已有授权与核实归属的进程；保留定义、会话、工作区及业务数据。报告入口、原因、动作和实际验证范围。

本模式目录参考与脚本按需读取；Workforce 使用 `resourceBase.path + "/modes/workforce"`，工具权限仍以当前会话为准。
