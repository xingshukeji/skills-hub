# 员工与会话配置

/agent-catalog 是可发现项，/agents 是本人可用项（前缀 /api/workbench）；检查租户员工关系、定义 enabled 与订阅。已要求订阅/取消时，原页面对应 POST/DELETE /agents/{id}/subscription。

按 source、runtimeKey、agentId、用户与租户核对原会话。同名不代表相同上下文。workspace/preset 不可变时，按宿主要求用新会话应用配置，保留旧历史；不要删除旧会话伪装刷新成功。

原会话 /sessions/{id}/models、/model 使用本实例模型目录。区分认证、配额、限流与连接问题，不假定各 provider 参数相同。

skill 被发现 → 内容加载 → 本会话有工具 schema → 调用获准成功是不同阶段。nativeTools 可为空，仅开放业务工具；缺工具不能自行放开权限。定义/工具变化按宿主装配机制生效，不手改 Runtime 状态。

已有授权下验证原身份/定义、实际模型请求、必要工具与业务回读；只读排查可用已有历史，不为取证另发外部消息。
