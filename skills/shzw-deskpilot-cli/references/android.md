# 本机 Android 模拟器操作

直接操作模拟器里的应用，不用宿主 UIA 猜访客控件。保留一个 `exec --stdin --format ndjson` 进程，每行一个 JSON，请求与响应按 id 配对。

## 确认窗口和设备

1. windows.find 用已知标题、进程或 PID 确认唯一的本机 Android Emulator 窗口，取得 window_id。
2. android.observe 传该 window_id，读取访客控件和设备身份。工具核对窗口进程、模拟器端口及 AVD；从该模拟器 SDK、SDK 环境变量或 PATH 找本机 ADB，也可显式传绝对 adb_path。
3. 结合控件和应用包确认目标，保留本次 observation_id 与 element_id；动作后重新观察再取得引用。

工具不安装 ADB、不重启或修改设备，也不连接任意远程设备。密码节点及子节点不返回文字；parent 是当前数组的父节点下标。可用 limit 限定节点数，truncated: true 不能证明目标不存在。

```json
{"id":"observe","method":"android.observe","params":{"window_id":"已确认窗口ID"}}
```

## 点击和普通字段输入

从当前观察选取明确控件，传 window_id、observation_id、element_id 调用 android.click。点击只确认派发，随后重新观察核对界面或焦点。

编辑非密码字段：先点击聚焦 → 重新观察 → 对已聚焦字段 android.set_value → 核对回读及应用状态。

```json
{"id":"write","method":"android.set_value","params":{"window_id":"当前窗口ID","observation_id":"聚焦后的观察ID","element_id":"当前字段ID","value":"example"}}
```

当前最多支持 **128 个可打印 ASCII 字符，不支持中文**；不支持的文字在派发前拒绝，不自动换输入法。赋值会替换并回读，保存仍须从应用核实。密码另读[测试凭据](credentials.md#android-密码控件)。

普通 input.type / input.key 使用宿主键盘，部分设备的 hw.keyboard=no 使事件无法进入字段。Android 通道无需修改或重启实例。ADB 不可用时可评估当前可信画面和屏幕键盘；确需回退才读[屏幕键盘](android-screen-keyboard.md)。

## 触屏滚动

从当前 android.observe 选择 scrollable: true 的节点，调用 android.swipe，提供相同的三个引用参数及设备坐标 start: {x,y}、end: {x,y}。两点均须在该节点内，可选 duration_ms 为 100–3000。

按当前页面选没有按钮等控件的起止点。派发后重新观察，以内容或位置变化确认滚动；别混淆内层列表和外层页面。

## 对结果负责

点击保守拒绝辅助树中其他无关可操作节点与目标中心重叠；滑动对两端作相同检查。辅助树不能证明前后层次，也不覆盖未暴露的遮挡。拒绝时查[遮挡恢复](recovery.md#遮挡与不可信截图)，不直接改坐标绕过。

窗口、设备、控件或焦点变化时重新观察。部分输入、超时或 outcome: unknown 后先核对效果，不能重放整批。需截图再读[截图专题](screen.md)；宿主坐标操作仍受 Windows 遮挡保护。
