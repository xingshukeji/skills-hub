# 文件、投递与个人邮箱

先选择原服务器与租户并核对身份。文件服务要求具有 FileInvoke 资格的服务端 API Token；浏览器会话不代替该资格。管理和个人邮箱命令使用允许该动作的用户会话，通常显式加 `--auth session`。请求和查询分别通过 `--request-json`、`--query-json` 文件或 stdin 传递。

## 文件和存储

```text
file upload <本地文件> --uploader-id <已有上传器ID>
file show <fileId>
file preview <fileId>
file download <fileId> --out <新文件>
file preview-asset <fileId> <assetId> --out <新文件>
storage account list
storage account create --request-json <账户.json>
storage account rename <id> --request-json <名称.json>
storage account credentials <id> --request-json <凭据.json>
storage account check <id>
storage account default <id>
```

上传原始字节，最多 512 MiB，可用 --name 指定文件名。读取始终通过原文件授权；下载校验长度和内容类型，支持空文件，不覆盖已有文件；失败清理本次临时文件。服务没有文件摘要合同，CLI 不把长度校验写成摘要验证。上传回执丢失不自动重传。

S3 创建字段为 name、serviceUrl、signingRegion、forcePathStyle、bucketName、rootPrefix、accessKeyId、secretAccessKey；名称修改为 name，凭据修改为 accessKeyId、secretAccessKey。秘密只经 stdin 或私有文件输入。storage account 支持 Host 或租户，实际权限由原服务校验；连接检查不等于设为默认。

## 邮件、飞书和短信

| 命令组 | 动作与输入 |
|---|---|
| `email account` | list、set、check；set 带 id、name、label、emailAddress、displayName、smtpHost、smtpPort、smtpSecurity、userName、password、enabled。check 带账户 id。 |
| `feishu account` | get、set、check；set 为 appId、credentialVariableId、enabled，复用已有秘密变量。 |
| `email template`、`feishu template` | list、show、create、update、preview、send-test；单项带模板 id；create/update/preview/send-test 带请求文件。 |
| `email message`、`feishu message` | list/show；show 带原消息 id，list 用 query-json 筛选。 |
| `feishu user` | list、binding get/set；binding 带 user-id，set 带平台绑定请求。 |
| `sms` | account list/set、template list/bind、send-test、records；Host 目标用原 tenantId 查询，租户凭据不能跨租户。 |

邮件模板字段为 id、accountId、name、label、helpText、inputModelJson、toRules、ccRules、bccRules、replyToRule、subjectTemplate、textBodyTemplate、htmlBodyTemplate、isActive。飞书模板使用 id、name、label、inputModelJson、messageType、contentTemplate、isActive。update 提交实际变化。邮件 preview/send-test 为 `{"data":{},"whatId":"<可选业务ID>","idempotencyKey":"<可选稳定键>"}`；飞书 preview 为 `{"data":{}}`，send-test 为 `{"recipient":{"kind":"<服务支持类型>","userId":"<明确收件人>"},"data":{}}`，群收件人使用 chatId。

短信账户写入 name、credentialVariableId、enabled；模板绑定使用 accountId、localTemplateKey、providerTemplateCode、signName、remark；send-test 使用 accountId、localTemplateKey、recipient。账户检查和模板预览不会发出测试消息；send-test 必须有用户明确要求和收件目标。查看原发送记录判断队列、成功或失败；未知结果不重发。

## 本人邮箱

```text
mail providers
mail account list
mail account set --request-json <邮箱.json>
mail account check <id>
mail folders <id>
mail search <id> --request-json <检索.json>
mail read <id> --request-json <原引用.json>
mail draft <id> --request-json <草稿.json>
mail account clear-credentials <id> --query-json <清理范围.json>
mail account delete <id>
```

邮箱保存字段为 id、label、emailAddress、displayName、providerType、receiveUserName、receivePassword、sendUserName、sendPassword、enabled；先从 providers 确认可用服务。search 为 folder、text、limit、cursor；分页保留原 nextCursor。read 为 `{"reference":<原搜索结果reference>}`，保留 accountId、mailbox、folder、uidValidity、uid，引用过期不猜新 UID。draft 为 to、subject、textBody，可带 cc、bcc、source；保存草稿不发送。clear-credentials 的 action 由服务决定，省略为 all。个人邮箱不接受 Host、智能体或服务 API Token。
