---
name: shzw-xrain-access
description: 处理 XRain/Workforce 的统一登录、固定账号恢复、403、应用准入、业务角色和数据范围，以及人员接入、协作与职责变化。按原用户和业务动作定位责任，保留已有身份与无关授权。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-access/SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain Auth, XRain, XRain Workforce
---

# 人员接入与访问权限

先确定谁在什么租户、哪个应用执行什么动作，再沿认证中心身份、平台用户、租户成员、应用准入、业务权限和数据范围定位。403 可以是正确拒绝，同名也不能证明身份关联。

按目标固定账号规则查重和复用；凭据缺失走原身份恢复。通过既有认证网页、管理入口或受管 API 操作，维护 MFA、反伪造和当前主体边界。新增身份、改权、对外发送和职责交接只处理已有授权覆盖的影响。

读取配置与角色集合后再合并修改，并发冲突后重读。首次验证使用原用户完成实际业务、持久结果及相关允许和禁止动作；管理员能访问不能证明普通成员可用。撤权后核对既有连接与迟到结果；开通账号不能代替完整业务完成。

## 按需资料

- [中心身份、激活、凭据、OIDC 客户端和原应用登录](modes/authentication/GUIDE.md)
- [租户成员、应用准入、业务权限与执行身份](modes/authorization/GUIDE.md)
- [人员接入、实际使用、协作和职责变化的完整主线](modes/people/GUIDE.md)

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。
