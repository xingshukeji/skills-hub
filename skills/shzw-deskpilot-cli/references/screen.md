# 截图与 OCR

需要交付图片、控件不足以定位，或要读取画面文字时使用。已有控件足够时，无需每步同时读树和截图。

## 截图与坐标

screen.capture 传 window_id，返回图片绝对路径、尺寸、屏幕原点、screenshot_id 与 trusted 归属证据。可选绝对 path 保存交付图片，父目录须已存在；默认临时图片在 close 后删除。图片可能含窗口可见资料，按任务限制存储和展示。

同时需要树和图时，observe 设 include_screenshot: true。两者依次读取，不是原子快照。

用 screenshot_id 调用 input.click / input.scroll 时传图片内 x、y，工具自动换算；用 observation_id 时传窗口内坐标。图片原点可能在边框内，不能混用屏幕坐标。scroll 的 amount 中 120 为一格，可设 horizontal。核对图可信、目标归属和实际效果。

## 平台画面范围

| 平台 | 截图和操作边界 |
|---|---|
| Windows | 优先核对前台及遮挡后读取屏幕区域。外部覆盖时可尝试 Windows Graphics Capture，返回 capture_layer: windows_graphics_capture、capture_scope: target_window_only、覆盖者及单独的所属窗口列表。该帧不含独立弹窗或外来覆盖，需这些界面时重新定位。引用专属帧点击或滚动仍核对实际命中和上方窗口，鼠标可穿透覆盖也可能阻止操作。 |
| macOS | 按系统窗口 ID 取专属帧，尺寸规范为窗口坐标，不含独立弹窗和外来覆盖。点击/滚动前检查目标位置，外来可见窗口覆盖时拒绝派发。其他缩放和多屏须另行确认。 |
| Linux X11 | 只在目标前台、完整可见且无遮挡时读取；无法归属时不返回可信图像。Wayland 原生截图尚不可用。 |

系统保护、身份或几何不能确认时停止对应操作。专属帧成功不代表覆盖消失，不可信截图或遮挡按[故障恢复](recovery.md#遮挡与不可信截图)处理。

## 读取文字

screen.read_text 可传当前 screenshot_id，或窗口条件重新捕获。已知区域用图片内 region: {x,y,width,height} 限定，未知时先观察全图。文字块坐标始终相对整张截图，配合同一张当前图使用。

Tiny OCR 完全离线，返回 recognition.text、blocks、边界与置信度。可能遗漏、误认或分行，菜单目标和聊天身份等关键字段结合视觉或控件核对。include_words 不保证每个平台有词框，空结果保留明确来源。模型随完整 Skill 提供，当前能力见 doctor。

messages.observe 只在指定 identity_region、content_region 中提取候选，区域是截图内 {x,y,width,height}。expected_identity 可为字符串或数组，identity_match 为 all/any。左右位置仅产生 role_hint，不能证明发送者身份；不创建聊天状态、审批或自动回复。
