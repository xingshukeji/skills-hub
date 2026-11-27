---
name: shzw-deskpilot-cli
description: 使用 DeskPilot 操作本机桌面、Android 模拟器或 Chrome，支持控件、截图与离线 OCR。首次使用从团队 Nexus 下载当前平台运行时，首次需要 OCR 时下载固定模型。
---

# DeskPilot

复用已经可用的 DeskPilot。使用本发行入口时，从当前技能目录执行 `python -I -B deskpilot.py --prepare`。使用 64 位标准 CPython 3.13。Agent 从作业环境读取团队的 Nexus Raw 仓库根地址 `DESKPILOT_NEXUS_ROOT` 和只读凭据文件 `NEXUS_NETRC`。根地址以 `/repository/versioned-releases` 结尾。凭据文件可沿用当前用户的 netrc。首次下载后，同一修订离线可用。

团队工作站可一次登记 `DeskPilot/nexus.json`，字段 `root` 为 HTTPS 仓库根地址，`netrc` 为受限只读凭据文件路径。Windows 从 LocalAppData 读取，其他系统从 XDG_CONFIG_HOME 或 ~/.config 读取。作业环境变量优先。Windows 使用配齐 Visual C++ 运行库的 CPython 3.13。

准备结果返回当前运行时目录。先读其中的 `SKILL.md`，再按任务读 `references/desktop.md`、`references/android.md` 或 `references/browser.md`。运行 `python -I -B deskpilot.py doctor` 检查所需能力，再用 `python -I -B deskpilot.py exec --stdin --format ndjson`。脚本本身即当前技能的 CLI 入口。

需要读取图像文字时，先执行 `python -I -B deskpilot.py --ocr --prepare`，随后用 `python -I -B deskpilot.py --ocr exec --stdin --format ndjson`。同一 OCR 会话持续使用该进程。下载内容按 SHA-256 和长度核验，推理在本机完成。
