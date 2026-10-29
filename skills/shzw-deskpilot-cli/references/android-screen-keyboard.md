# Android 屏幕键盘回退

仅在 [Android 控件通道](android.md)不可用、当前可信画面能确认目标和屏幕键盘，且任务仍需输入时使用。不能绕过设备身份、焦点或遮挡错误。普通字段先用合成内容验证行为和实际回读；布局随设备和输入法变化。

专用凭据输入另需满足[测试凭据授权](credentials.md)。宿主不能识别访客密码控件时，只有画面明确显示密码框及焦点，才用 target_kind: observed_opaque_password、observed_password_focus: true 和输入前 screenshot_id。这是调用方视觉确认，不是系统对访客控件的证明。

input.secret 可接收 keyboard: {character_set, keys}。ascii_alphanumeric 映射须覆盖 62 个英文字母和数字，ascii_printable 须覆盖全部 95 个可打印 ASCII 字符。每个字符对应 1–6 个截图内 [x,y] 点，输入该字符后恢复基础键盘状态。先用合成内容验证完整映射，不能用真实密码决定映射或逐字记录点击。

若已确认宿主键盘可直接输入，opaque 入口可不传 keyboard；派发不证明字段已收到文字。输入前同一截图明确显示授权提交按钮时可传 submit_point，避免输入后截取密码框。仍使用受管 JSON secret_ref、purpose: authorized_local_test、confirmed: true，不传密码字符串，不放入批次。

窗口移动、失去前台或结果未知时停止检查。通过不含凭据的业务界面确认登录，不盲目重放。
