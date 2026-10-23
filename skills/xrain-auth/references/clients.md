# OIDC 接入修复

从本次授权请求和实际加载配置取得 authority、clientId、scope、完整 redirectUri 与应用类型。平台 CLI 的依据为 `GET /api/application/v1/cli-config`；网页、独立市场各读自身配置，不能混用 client/audience。client、scope 或回调被拒不说明用户密码有错。

在原中心管理员 /admin/clients 精确查询 clientId：
1. 已有时编辑缺项并保留其他在用设置；确实缺失且已获准接入时添加。
2. CLI 选“本机命令行工具”，公开客户端无密码；回调包含准确端口与末尾斜杠，不填网页退出/CORS。网页使用已登记公开入口，不能拿服务监听地址替代。
3. 业务 scope 及 audience 在 /admin/scopes 核对。openid/profile 是协议 scope，不创建同名业务 scope；不改其他消费者映射。
4. 保留原渠道设置；账号密码登录内置可用。保存回读后，从原应用发起全新授权验证回跳。CLI 后续管理请求明确 --auth session。

中心管理网页和原应用登录不依赖平台 CLI 客户端；两条链路分别验证。登记客户端为应用接入配置，不计作人员账号。修接入不要求重启共享服务；缺业务 scope/audience 契约时交付具体缺口。
