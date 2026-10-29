# 按当前错误恢复

只读命中条目。先看 outcome：not_dispatched 表示未派发，unknown 表示可能生效。恢复后重新取得观察引用。

| 当前返回或现象 | 下一步 |
|---|---|
| STALE_OBSERVATION | 重新确认窗口并观察，不继续用旧 ID |
| ELEMENT_NOT_FOUND | 核对范围和页面，必要时 wait.element；深层 Electron 文档见[桌面](desktop.md) |
| ELEMENT_NOT_UNIQUE、UI_AUTOMATION_INCOMPLETE 或 truncated | 缩小条件或调整上限；不能取首项，也不能断言不存在 |
| TEXT_INPUT_STRATEGY_REQUIRED | 尚未输入，核对换行行为后选策略，见[桌面](desktop.md) |
| VALUE_NOT_VERIFIED、BATCH_OUTCOME_UNKNOWN 或 outcome: unknown | 读下方“输入未确认或结果未知” |
| BATCH_STEP_FAILED | 看已完成步骤和 cause_code，批次没有回滚语义 |
| WINDOW_ACTIVATION_FAILED | 读下方“前台与焦点” |
| WINDOW_CAPTURE_UNTRUSTED、POINT_OCCLUDED 或覆盖诊断 | 读下方“遮挡与不可信截图” |
| doctor 缺系统库/权限，或 WAYLAND_PORTAL_REQUIRED | 按[安装与平台](install.md)核对前提 |
| 浏览器目标、跳转、隐藏或断连错误 | 查[浏览器](browser.md)对应现象 |

## 输入未确认或结果未知

重新查找并读取非密码字段和应用反馈。目标值已存在就继续验证业务结果，未匹配也不能重放整批。Windows 赋值已尝试或结果未知时不自动键盘重发。

只有明确当前效果、业务仍需输入且字段支持常规编辑时，才显式选择替代方式：ui.click → 重新查找 → ui.get.element.has_keyboard_focus 确认焦点 → 按任务替换文字 → 回读。Android 先重新 android.observe 核对设备、控件和焦点。密码不回读，以后续业务状态确认。

## 前台与焦点

用户回复聊天后前台可能改变。Windows 先请求系统激活，失败时工具对已确认窗口根使用标准 UIA SetFocus，再核对真实前台；不发送假按键或连接其他进程输入线程。

windows.activate 的 window.activation 记录方法、系统返回值和前后窗口，只证明当次检查。失败时据 details 区分目标变化、竞争工具和系统限制，不重复同一失败。确实无法自动恢复时才请用户切回。

## 遮挡与不可信截图

重新读取窗口状态，核对离屏、几何、身份、独立弹窗和覆盖者。Windows 诊断最多列 8 个覆盖窗口；overlapping_windows 为总数，blockers_truncated 表示未列完。诊断对象不是会话引用。全屏边界记录不证明肉眼可见全屏提示，专属截图也不证明覆盖消失。

Android 树中重叠可能来自无关可操作节点，树不证明堆叠前后。结合当前可信画面和应用状态确认可达目标，不能凭错误猜坐标或绕过宿主保护。

切换 GUI 工具时，通过原工具正常结束入口释放控制。旧 CUA 的 CodexComputerUseCursorOverlay 可能有光标层和取消提示两层；重置脚本或关闭 DeskPilot 提示不等于它们退出。由用户或原工具受支持的生命周期处理安全/取消提示，不杀进程、不强关、不加白名单。随后重新 windows.list；show_overlay: false 只控制 DeskPilot 自己。

不要用 allow_unobserved 绕过普通操作的观察要求。

## 取消与清理

同一流发送 interaction.cancel，等待原请求最终响应；已派发动作不会撤销。interaction.end 结束提示并尝试恢复前台，close 释放引用、OCR、辅助窗口和连接。Linux X11 提示不抢焦点或截获点击，截图时隐藏自身提示，状态以 doctor 为准。

restored_original_window: false 可能表示未保存窗口、窗口关闭或系统拒绝；不证明其他工具结束，也不证明页面或登录状态变化。
