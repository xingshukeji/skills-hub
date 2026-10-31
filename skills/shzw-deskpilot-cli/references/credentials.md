# 已授权的本机测试凭据

只在当前需要登录，且用户或项目生效政策已授权目标、账号及登录动作时读取。沿用已有授权，不重复询问同一事项。凭据失效按责任项目恢复，不另建账号。

从责任项目确定受管本地 JSON 文件及字段名。input.secret 只接收文件引用，不接收密码字符串；不把密码读入对话、普通输入请求、命令行、日志或截图。普通 ui.set_value、android.set_value、input.type、chrome.fill 的密码限制不因授权取消。

Windows 已实现原生密码及观察确认的非原生密码入口（含屏幕键盘）；本机 Android 模拟器另有设备绑定的密码控件通道。macOS/Linux 原生 `type_secret` 尚未实现，会在读取凭据或派发输入前返回 `UNSUPPORTED_PLATFORM`，不能回退到普通密码输入。`capabilities`、`schema(input.secret)` 和 `doctor` 的 `sensitive_input` 分别列出这些入口是否已实现；Android 仍须核对设备、焦点及输入命令前提。保持同一 DeskPilot 进程，专用输入不得放入 actions.batch。

## Windows 原生密码控件

先确认正确窗口、测试环境、空密码框及焦点，在输入前取得一张不含凭据的当前截图。目标窗口自身须在前台，同属弹窗切到前台也会停止。

```json
{"id":"secret","method":"input.secret","params":{
  "window_id":"当前窗口ID","screenshot_id":"输入前截图ID",
  "purpose":"authorized_local_test","confirmed":true,"target_kind":"native_password",
  "secret_ref":{"path":"受管JSON绝对路径","json_path":["字段名"]}
}}
```

系统须能确认焦点位于密码控件。不回读密码，verification: not_read 不证明输入或登录成功。输入后不要截取仍显示该字段的画面，通过后续不含凭据的应用状态核实登录。

输入前同一截图明确显示授权提交按钮时，可选传 submit_point: [x,y]，以截图内坐标点击一次。submit_dispatched 只表示派发，省略时不会提交。需要截图参数时查[截图专题](screen.md)。

## Android 密码控件

按 [Android 指南](android.md)确认设备和应用，点击密码框再 android.observe，选取已聚焦且标记为密码的节点：

```json
{"id":"secret","method":"input.secret","params":{
  "window_id":"当前窗口ID","observation_id":"聚焦后的观察ID","element_id":"当前密码节点ID",
  "target_kind":"android_password","expected_package":"观察到的应用包名",
  "purpose":"authorized_local_test","confirmed":true,
  "secret_ref":{"path":"受管JSON绝对路径","json_path":["字段名"]}
}}
```

当前限 128 个可打印 ASCII 字符。工具内部转换按键，不把明文放入请求、进程参数或结果，不读密码也不自动提交。重新观察并点击登录，从后续业务界面核实结果。

只有 Android 通道不能识别访客控件且确需屏幕键盘时，读[屏幕键盘回退](android-screen-keyboard.md)，不要为普通登录预先构造映射。

设备、焦点变化或结果未知时，停止本次输入并检查现场，不盲目重输。此入口控制工具自身的明文暴露，不能替目标应用、输入法或其他录屏软件保证保密。
