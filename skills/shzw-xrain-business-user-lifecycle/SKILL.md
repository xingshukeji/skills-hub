---
name: shzw-xrain-business-user-lifecycle
description: 在 XRain/Workforce 落地业务人员接入、实际使用、协作与职责变更的完整业务主线，连接固定身份、租户成员、应用准入、业务授权和持续维护。单独登录、403 或权限定位使用对应诊断能力。
metadata:
  author: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/tree/main/skills/shzw-xrain-business-user-lifecycle
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain, XRain Workforce
---

# 业务人员接入、使用与职责变更

让同一个人进入指定业务、完成实际工作，并在职责变化后继续拥有正确的工作范围。主线标识为 `BL-USER-01`。它适用于采用 XRain 身份、租户、应用与授权合同的业务；具体工作结果由业务所属项目定义，不能把“账号已建好”当作业务完成。

1. 从用户要办的业务开始：谁在什么租户做什么、处理哪些资料、与谁协作、怎样判断办成。读取项目已有主线及差异；已确认的部分直接复用，不重新穷举模型。
2. 阅读[完整主线](references/business-mainline.md)，定位当前环节和前后结果。只执行当前请求覆盖的环节；新建账号、存量改权、对外发送和退出不因主线存在而自动获得授权。
3. 按[平台操作与责任](references/xrain-operations.md)选择目标现有管理入口、API 或 CLI。执行前查当前合同和目标状态，保留稳定身份、现有业务数据及无关授权。
4. 沿原使用者的业务入口验证持久结果与必要拒绝。按[验证与复用](references/verification-and-reuse.md)区分业务已确认、实现支持和本次实测范围，归位可复用结果。

本目录包含主线、操作定位与验证办法，独立复制后可使用。若宿主已有认证、权限诊断、运行或业务开发技能，可在命中问题时调用；它们不替代主线结果，也不是本目录的安装前提。产品实例、凭据、客户数据和执行记录留在目标受管位置。
