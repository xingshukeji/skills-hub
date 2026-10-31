# 独立应用市场

先用 `auth login --exchange <市场origin> --profile <市场>` 取得独立市场会话。下面命令均追加同一 `--exchange <市场origin> --profile <市场> --json`，不使用平台 Token、租户或 Host 作用域。

```text
app list
app status --package <packageId>
market show <packageId>
market versions <packageId>
market manifest <packageId> --version-id <versionId>
market components <packageId> --version-id <versionId>
market download <packageId> --version-id <versionId> --out <新文件.appkg>
market rename <packageId> --label <新显示名>
market publication <packageId> --version-id <明确版本ID> --expected-published-version <原上架版本ID或null>
market unpublish <packageId> --expected-published-version <原上架版本ID>
```

packageId、versionId 使用服务的精确 ID。manifest/components 可加 `--out <新JSON文件>`。download 核对清单身份、版本、元数据与响应头中的文件摘要及包摘要；内容不一致不保存，不覆盖已有文件。原包不解压到本地目录。市场决定所有者的历史下载资格，普通发布目录只允许当前上架版本；服务因下架或撤权拒绝下载时，CLI 保留该拒绝。

rename 只改市场显示名，不改原包。publication 只切换现有不可变版本；原上架值为 null 时显式传字面量 `null`。版本冲突后不能自动刷新比较值并覆盖别人修改。unpublish 下架原包，不删除版本、不卸载租户中的安装。

维护要求原所有者资格，CLI 不换身份。写入回执丢失先用原市场会话查 app status；不自动发布或重放。向平台导入继续使用平台的 `app import` 和已配置来源，不能将市场登录会话用于平台安装。
