---
name: query-state
description: 只读查询现有本地服务状态。
---

# 查询状态

按目标项目 Runbook 查询现有服务状态。具体请求配置在 references/endpoint.json；使用 node scripts/query.mjs <状态文件> 读取给定的本地响应模型。查询只输出实际返回，失败不能推导重启、部署或重试写入授权。
