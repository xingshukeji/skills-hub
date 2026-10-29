# 安装与平台

完整 Skill 的 `scripts/`、`vendor/`、`assets/` 必须一起复制。支持的解释器为 **64 位、标准 GIL ABI 的 CPython 3.13**，其他 Python 版本或自由线程构建不能加载这组原生文件。解释器由客户端或用户准备；安装脚本不安装 Python，不使用 pip、uv、conda、npm、brew 或 apt，也不下载缺少的资源。

从宿主提供的 Skill 目录运行：

```text
python "<实际 Skill 目录>/scripts/install.py" --json
```

读取 `data.command_path`，随后以该绝对路径运行 `--help`、`doctor --format json` 和 `exec --stdin --format ndjson`。在 Windows 中解释器可能名为 `python`，macOS/Linux 可能为 `python3.13`；先确认实际解释器版本。无需源码仓、Node.js 或 .NET。

安装器验证随包文件，生成 `.pyz` 和当前平台资源，完成不操作应用的启动检查，再注册命令。Skill 目录可以只读；派生文件默认放在 Windows 的用户 LocalAppData/DeskPilot/runtime，其他平台放在 `~/.local/share/deskpilot/runtime`。短命令默认在 `~/.local/bin`，可用 `--state-dir` 和 `--bin-dir` 指定用户可写位置。

Windows 用户 PATH 通过用户环境设置写入；bash、zsh、fish 通过带归属标记的用户配置片段写入。已有父进程通常不会立即获得新 PATH，直接使用返回的绝对路径。新终端应能运行 `deskpilot --help`。

重复安装复用相同输入；更新时替换完整 Skill，再执行同一安装入口。构建或资源检查失败时原命令保持可用。无关同名命令不覆盖；冲突结果包含位置。`PATH_REGISTRATION_FAILED` 说明程序已经构建并注册，应使用返回路径并修复对应 shell 或环境问题。

已经运行的 `exec --stdin --format ndjson` 不会随安装自动切换构建。更新完成后，在旧流发送 `close` 并关闭 stdin，再从新返回的 `data.command_path` 启动新流。所有窗口、元素、观察和截图 ID 都要重新取得；旧流返回的成功或失败不能用于判断新构建。安装回执的 `data.application` 中包含该次构建摘要，可据此确认当前入口。

```text
python "<实际 Skill 目录>/scripts/install.py" --uninstall --json
```

卸载只清理安装记录中属于本工具的命令与构建；共用命令目录仍有文件时保留 PATH。Chrome profile、业务资料和聊天状态不属于卸载范围。配置片段被人工改动时保留文件并返回错误。

## 当前能力范围

| 组合 | 随包文件 | 桌面实现及证据 |
|---|---|---|
| Windows x64 | CPython 3.13、comtypes、Pillow、ONNX Runtime、Tiny 模型、Windows Capture 原生组件 | Win32/UIA；Windows 10 build 19045 合成窗口及 Chrome 已验证，含中文、截图和 OCR。外部遮挡时可尝试系统窗口帧，是否可用以实际捕获结果为准。Windows 11 尚未验证 |
| macOS arm64 / x64 | CPython 3.13、Pillow、ONNX Runtime、Tiny 模型 | AX/Quartz/AppKit 实现；需要辅助功能、输入和屏幕录制权限，尚缺真实 macOS 桌面验证 |
| Linux x64，X11 | CPython 3.13、Pillow、ONNX Runtime、Tiny 模型 | Ubuntu 22.04 的 GNOME Flashback/Metacity/Xvfb 图形会话已验证独立只读 Skill、GTK 控件、中文、可信截图/OCR、Chrome 表单、活动提示、遮挡拒绝、取消与清理。其他桌面未验证 |
| Linux Wayland | 可运行通用协议与 Chrome/CDP | Portal 桌面会话尚未实现；桌面输入与截图返回 `WAYLAND_PORTAL_REQUIRED`，不能按 X11 使用 |

Linux 的 AT-SPI、D-Bus、X11/XTest 属于系统前置条件；活动提示另需 libXext 和 X11 Shape 1.1 输入区域，工具不自动安装这些系统组件。doctor 分别报告桌面、输入、截图和提示能力的缺项。macOS 建议 14+；Linux 原生文件需 glibc 2.27+，实际系统库与桌面组合仍以 doctor 和实测为准。其他 CPU、Python ABI 组合不能靠重命名原生文件启用。

Chrome 浏览器由机器已有安装提供；CDP 能力独立于原生桌面后端。模型和第三方文件来源、版本、许可及 SHA-256 在 [vendor/manifest.json](../vendor/manifest.json) 中。平台文件齐全不代表真实桌面验证已经通过。
