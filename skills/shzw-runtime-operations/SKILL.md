---
name: shzw-runtime-operations
description: 启动、恢复或排查项目服务与 Workforce 运行问题，包括页面、智能体、工具、旧版本及登录或会话缓慢。结合前文和实际环境定位入口、版本与故障阶段；明确的登录、403 或人员授权问题走访问权限入口。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-runtime-operations/SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain Workforce, XRain Agent Runtime
---

# 运行排障

先读取当前目标项目的启动和运行入口，核对已运行实例、配置及源码或制品身份。Workforce 默认使用其根一键启动；all_in_one 默认服务由其入口决定。不得因技能安装位置、同名服务或默认端口选择另一个项目。

Workforce 当前默认路径是本机统一宿主连接共享测试平台、统一认证和模型服务。先从根启动配置确认实际应用与所装公共包；“还是旧效果”要检查消费包、前端构建与后端进程，再按 Runbook 选择刷新、重启或源码预览。不要因此重装应用包、初始化账号或重建 Runtime。连接检查只证明依赖可达，恢复结论仍来自原业务动作。

保留原场景和状态，逐步定位启动、认证、业务访问、执行、工具及消息交付中实际失败的阶段。健康接口和空会话成功不能代替原任务恢复。结果未知的写入先回读，停止无关重启。

仅通过已有受管命令处理归属明确的进程。恢复定义、会话和工作区的正常使用；暂停、改派或人工接管后不能复活旧执行权限。日志与采样脱敏，资源问题按当前窗口和实际负载表述。

首次报告前用原用户动作核对恢复及受影响失败分支，分别报告原因、操作、实际结果和缺口。部署效果查询不授权重新部署，账号或消息操作仍受原授权限制。

## 按需资料

- [操作目标项目根入口或服务别名](modes/services/GUIDE.md)
- [启动依赖、版本核对、原场景验收和慢链路](modes/workforce/GUIDE.md)
- [原任务、会话、工具、消息和执行生命周期故障](modes/agents/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。
