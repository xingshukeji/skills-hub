---
name: shzw-xrain-app-package
description: 编写、离线校验和构建 XRain .appkg，或安装、升级、恢复和卸载已交付应用包。用于“做一个应用包”“安装这个包”“升级卡住了”“恢复隐藏组件”。按源码编写、服务端构建或现有 operation 选择分支；安装现有包直接消费原制品。服务镜像部署进入交付入口。
metadata:
  maintainer: 苏州苏宏助为智能科技有限公司
  source: https://github.com/xingshukeji/skills-hub/blob/main/skills/shzw-xrain-app-package/SKILL.md
  documentation: https://xingshukeji.github.io/xrainTrain/developers/skills
  products: XRain
---

# XRain 应用包

先识别用户要生成制品还是操作已交付应用。有原 operation 就读取原记录和当前安装接续，结果未知不重复提交。市场发布、平台导入、租户安装和原用户可用分别验证。

编写与离线校验分支的工具要求 .NET 10 SDK；安装、预检与恢复不需要该工具，也不要求平台私有源码。Node.js 脚本单独要求 22.12+。服务端制品通过目标支持的统一构建端点生成，本地验证不冒充服务器准入。

保留稳定 ID、原包摘要、request/operation/revision 及业务数据。更换版本、覆盖定制、扩大权限或删除数据只能在已授权影响内执行。按原管理入口读取终态和安装指针，首次交付再核对选定组件和原用户业务动作；未配置和未授权与安装失败分别判断。

产品协议变化时，在实际责任项目验证读取器和消费者，同步本技能相关目录与离线工具。包编写、安装和服务部署的授权不互相代替。

## 按需资料

| 当前需要 | 按需方法 |
|---|---|
| 编写源码、协议校验及调用目标统一构建端点 | [编写源码、协议校验及调用目标统一构建端点](modes/authoring/GUIDE.md) |
| 消费已发布制品，预检、安装、升级与恢复 | [消费已发布制品，预检、安装、升级与恢复](modes/operations/GUIDE.md) |

按需读取命中资料。项目源码、命令和收口遵循目标项目入口；技能自身资源相对本目录解析。
