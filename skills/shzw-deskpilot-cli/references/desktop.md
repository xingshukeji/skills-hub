# 桌面观察、输入与可见文字

从窗口列表开始，用标题、进程和当前内容核实对象。窗口句柄由会话管理，窗口关闭后重新打开会得到新的身份。UIA、AX、AT-SPI 暴露的信息依应用实现而异，空控件树不能证明页面没有内容。

## 窗口与页面身份

`windows.find` 用标题、进程名和 PID 缩小到唯一窗口，再保留本进程的 `window_id`。窗口标题不证明页面地址、租户或登录身份。Electron/WebContentsView 的文档可能藏在较深的原生容器下：观察只看到 `WebView` 容器时，可对同一窗口把 `depth` 提到 16 或按实际层级增加；默认深度是 8。`truncated` 表示节点数量达到 limit，不保证已遍历更深的子树。

Windows 已从当前页面观察到准确 `automation_id` 后，可用 `ui.find` 的 `search_scope: "subtree"` 搜索整个窗口控件子树，不必逐个读取无关控件的属性；复杂窗口通常更快，但仍取决于应用的辅助功能提供程序。该模式不接受 `depth`，`limit` 限制匹配该 ID 的节点数；`depth` 和 `parent` 为 null。查找结果需结合其他条件确认对象，批次中使用 `require_unique: true`；如返回截断或 `UI_AUTOMATION_INCOMPLETE`，增加上限或重新观察，不能取第一项继续。其他平台继续使用树搜索。

Windows 可用 `ui.find` 的 `control_type: "document"` 查看文档节点，区分壳容器和实际页面。Chromium 的实际页面常以 `automation_id: "RootWebArea"` 暴露；对观察得到的每个候选，用其 `element_id` 和 `observation_id` 调用 `ui.get`。当该节点支持 ValuePattern 时，`element.value` 是页面地址。核对实际返回的地址、节点位置/可见性和页面内容；不能把第一个文档节点或固定名字当作唯一当前页。未暴露地址时明确保留此项未知，可使用应用已有的地址/关于入口或已授权连接的 `chrome.targets`、`chrome.query`；不要据标题猜地址或给现有客户端另开调试入口。

登录完成要在同一窗口、同一实际页面重新观察业务导航及当前身份/租户；用户在另一浏览器登录不证明此嵌入页已登录。用户操作后旧引用需要重新定位。`observe`/`ui.find` 只返回控件结构，未返回 value 不代表字段为空；只有对当前非密码控件的 `ui.get` 得到 `value: ""` 才能说该次读取为空。仍看到登录页只能证明当时观察到该界面，不能直接归因为 UIA 陈旧。密码值始终交由用户处理。

## 控件与输入

优先使用可访问控件的名字、类型和 automation_id。只有控件树不足以定位时才使用当前可信截图和窗口内坐标。点击前核对窗口仍是同一个对象、观察仍有效；窗口位置和标题发生变化时重新观察。

`ui.set_value` 是控件语义赋值，`input.type` 是当前焦点输入。Windows 语义赋值只派发一次，在最多 750ms 内回读确认，等待受请求预算和取消控制；成功可返回 `verification`。若赋值模式在派发前不可用，且控件提供可编辑文本模式，工具会确认目标窗口、非密码控件与键盘焦点，选中后输入一次并回读；`verification.method` 为 `uia_text_keyboard`。`ui.get.element.value_source` 区分语义值与文本模式来源。这只证明控件回读匹配，不替代保存、提交或框架业务状态的验收。

文本模式回退遇到换行时，先返回 `TEXT_INPUT_STRATEGY_REQUIRED`，不选中或写入任何文字。确认当前控件处理换行的方式后，可在 `ui.set_value` 中显式设置 `newline_strategy`：`unicode` 发送字面换行，`enter` 或 `shift_enter` 使用对应按键。只有实际确认该按键在当前控件中插入换行时才选择它；聊天或表单中的 Enter 可能执行提交。无法确认时保留未执行状态，不猜测或尝试发送。

`VALUE_NOT_VERIFIED` 或其他 `outcome: unknown` 后，重新 `ui.find` 再 `ui.get`，核对值和应用反馈。目标值已存在则继续验证业务结果；仍不符也不能重放整批。语义赋值已经尝试或结果未知时，工具不会自动改用键盘重发。只有确认当前结果、仍需该输入且控件支持常规编辑时，才显式选择键盘输入：`ui.click` 后重新定位，用 Windows `ui.get.element.has_keyboard_focus` 确认焦点，再按任务需要选择/替换文字并 `input.type`，最后重新读取。按键和热键使用键名数组；`MOD`/`PRIMARY` 在 macOS 对应 Command，在 Windows/Linux 对应 Ctrl。工具不读取或写入密码控件。

## 截图与 OCR

`screen.capture` 返回图片绝对路径、尺寸、图片在屏幕上的原点、截图 ID 和 `trusted` 归属证据。截图原点可能位于窗口的可见边框内；使用 `screenshot_id` 操作时传图片内坐标，工具自动换算为窗口坐标。默认截图位于会话临时目录，close 后删除；需要交付图片时显式指定调用方输出路径。截图会包含目标窗口可见资料，存储和展示范围遵循当前任务。

需要同时查看控件和画面时，可在 `observe` 中传 `include_screenshot: true`，在一个响应中取得树和截图；它们依次读取，页面变化时不是同一瞬间的原子快照。只需要其中一种信息时，不必同时读取两者。

Windows 优先核对前台身份和遮挡后读取屏幕对应区域。遇到外部窗口覆盖时，若系统和目标允许，可通过 Windows Graphics Capture 读取已核对的目标窗口帧，并返回 `capture_layer: windows_graphics_capture`、`capture_scope: target_window_only`、实际覆盖者和单独的所属窗口列表。该帧不包含独立弹窗或覆盖窗口；需要这些界面时先重新定位相应窗口并观察。引用此截图点击或滚动时，工具核对实际命中位置和该位置上方的窗口边界；未显示在帧里的覆盖层（包括鼠标可穿透的覆盖层）或独立弹窗会阻止操作。系统截图保护、窗口身份或几何无法确认时停止。macOS 按系统窗口 ID 截图并把 Retina 像素规范到窗口坐标，其真实桌面行为尚待验证；X11 仅在目标前台、完整可见且无遮挡时读取该窗口图像。截图失败或不可归属时不会返回可信图像。

Tiny OCR 完全离线，使用随包 ONNX Runtime、检测、方向和识别模型。返回 `recognition.text`、`blocks`、边界与置信度。它可以遗漏、分行或误认文字；菜单目标、聊天身份等关键字段用当前视觉或应用控件交叉核对。词框不可用时保留明确来源与空结果。

已从当前截图或控件观察确定目标区域时，给 `screen.read_text` 提供截图内 `region`，可减少需要识别的像素；位置不明时先观察全图。OCR 返回的位置仍是整张截图坐标，须配合同一张当前截图使用，实际耗时取决于内容和设备。

Windows 的覆盖诊断返回最多 8 个覆盖窗口的进程、PID、标题、类名和位置，`overlapping_windows` 是总数，`blockers_truncated` 表示是否还有未列项。它们是诊断信息，不是可直接操作的会话引用。目标窗口专属帧可以在覆盖仍存在时用于识别该目标自身，但不能据此声称覆盖已消失，也不能忽略其对实际操作的影响。窗口边界覆盖全屏不证明肉眼可见全屏提示，也不证明该工具仍在执行任务。用户报告界面已变化或提示不存在时，先重新读取当前窗口状态。

切换 GUI 工具执行操作时，先通过原工具的正常结束入口释放控制。旧 CUA 的 `CodexComputerUseCursorOverlay` 可能有光标层和取消提示两层；重置脚本环境、关闭 DeskPilot 自己的提示，均不证明它们已退出。涉及原工具的安全/取消提示时由用户或原工具的受支持生命周期处理，不杀进程、不强关提示、不做白名单。结束后用新的 `windows.list` 核对状态，再重新观察；目标专属截图本身不表示原工具已经结束。`show_overlay: false` 只控制本 DeskPilot 会话。

`messages.observe` 仅对调用方指定区域分出候选。`identity_region` 和 `content_region` 是截图内 `{x,y,width,height}`；`expected_identity` 可为字符串或数组，`identity_match` 为 all/any。左右位置只产生 `role_hint`，不能证明发送者身份。它不创建聊天数据库、草稿审批或自动回复。

## 停止与恢复

用户回到聊天回复后，前台可能已切回聊天窗口。Windows 操作先请求系统激活；未取得前台时，再对已确认目标的窗口根调用标准 UI Automation `SetFocus`，并核对真实前台。它不发送假按键、不连接其他进程的输入线程。`windows.activate` 的 `window.activation` 记录采用的方法、系统返回值及切换前后窗口，只证明当次检查，不保证下一次请求仍在前台，更不证明截图没有遮挡。后续操作会再次检查。仍失败时，`WINDOW_ACTIVATION_FAILED.details` 提供目标、实际前台及焦点恢复尝试；先据此区分目标变化、竞争工具或系统限制，再决定是否需要用户切回，不能不断重试同一失败。

缺少系统库或权限先修复对应前置条件；`STALE_OBSERVATION` 要重新观察；`WINDOW_CAPTURE_UNTRUSTED` 要先解决遮挡、离屏或身份变化。不要用 `allow_unobserved` 绕过普通操作的观察步骤。

在同一流发送 `interaction.cancel`，等待原请求的最终响应。已派发输入不会自动撤销。`interaction.end` 关闭活动提示并尝试恢复原前台；`close` 释放会话、OCR、辅助窗口与连接。Linux X11 的目标边框、状态面板和动作位置提示使用透明输入区域，不抢焦点或截获点击；截图时隐藏自身提示并在完成后恢复。状态面板使用简短英文操作说明；以 doctor 的活动提示状态为准。

`restored_original_window: false` 只说明没有确认恢复原前台，可能没有保存的窗口、窗口已关闭或系统拒绝；它不说明其他 GUI 工具已结束，也不证明目标页面或登录状态发生了变化。
