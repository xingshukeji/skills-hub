---
name: cicd
description: 查询、触发已有 Jenkins 流水线并跟踪构建、发布或部署；不编写流水线。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/tree/main/skills/cicd
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain 项目交付
---

# Jenkins 流水线

查现状只查询；执行请求沿用已确定的项目、操作和环境。

1. 从目标登记找到 Jenkins，查询真实作业和参数；按[调用与参数](references/jenkins.md)使用项目入口或自带脚本。
2. 按所需阶段触发一次，保存新回执；源码获取与构建由 Jenkins 完成。缺少目标能力时交付缺口，不改 Job 或本地上传源码替代。
3. 沿同一 queue/build 跟踪终态，读取 `status/result`。提交未知先查原记录，不能用“最新构建”或重新触发代替。
4. 报作业链接、来源提交、制品和实际部署结果；构建成功不等于业务可用。

脚本从本 skill 目录（Workforce 的 `resourceBase.path`）运行，需要命令工具和 Node.js 22.12+；凭据仅经现有秘密入口注入。
