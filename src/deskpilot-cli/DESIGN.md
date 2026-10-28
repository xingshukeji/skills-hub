# DeskPilot 迁入 Skills Hub 与跨平台 Skill 交付方案

Status: Proposed
Kind: Decision
Scope: skills-hub / deskpilot-cli / shzw-deskpilot-cli
Owner: skills-hub 维护者
Updated: 2026-10-28
Depends On:
- ../../AGENTS.md
- ../../tools/build.mjs
- ../../tests/installed.test.mjs
- ../../skills/shzw-xrain-cli/scripts/install-cli.mjs

本方案是 DeskPilot 新实现与迁移的唯一设计入口。当前只交付方案；下文的目录、命令和支持矩阵均为拟实施设计，不表示新 CLI、Skill 或三平台支持已经交付。本文由 skills-hub 维护，后续实施在此更新设计，不在 window10GUI 建立另一套新实现。

## 交付决定

| 用户结果 | 已核实的现状 | 本方案的改变 | 用户入口与责任 | 状态或数据影响 |
|---|---|---|---|---|
| 像 xrain-cli 一样由 Skills Hub 交付 | XRain 源码在 `src/xrain-cli/`，构建制品在完整 Skill 目录，独立复制测试不依赖源码仓 | 新源码放 `src/deskpilot-cli/`，完整交付目录放 `skills/shzw-deskpilot-cli/` | skills-hub 同时拥有源码、构建、使用知识和维护；宿主安装完整目录 | 不新增业务数据库 |
| 彻底移除 .NET | Windows 核心依赖 .NET 10、UIA、Win32、WinForms 和 Windows OCR | 已确定用 Python 重写核心，通过各系统原生接口执行；最终运行链路不调用旧 exe、CLR 或 .NET 自举程序 | CLI 提供统一命令与 JSON/NDJSON；Python 为用户已确认的实现语言 | 原会话引用本就短期有效，不迁移进程内 ID |
| Windows、macOS、Linux 使用同一 Skill | 现有实现只承诺 Windows 10 x64 | 一个入口按能力探测选择平台实现，浏览器与通用协议共用 | Agent 使用同一方法；平台后端负责真实系统差异 | 平台权限由系统持有；Chrome profile 和显式消息状态仍在用户侧 |
| 用户安装后可以独立使用 | 旧便携包和技能引用包外 `bin/win-agent.exe`；新 Hub 中尚无 DeskPilot | 完整 Skill 自带本项目源码、安装/构建脚本、固定依赖文件与模型；客户端从这些文件构建程序并注册命令 | 从安装后的 Skill 启动；安装脚本完成本地构建与用户级 PATH 接入，不调用包管理器 | 只新增构建缓存和安装归属记录；业务状态留在调用方目录 |
| 现有效果得到保留 | 已有桌面/Chrome、批处理、OCR、流程宿主、消息脚本与 dsh 插件 | 按公开能力和实际消费者迁移；应用专有逻辑保留在上层适配 | 核心、流程宿主、场景适配分别维护，均归 skills-hub | 先保持既有流程数据和消息状态格式；必要变化显式迁移 |
| 完成后归档当前项目 | window10GUI 仍是现有实现来源，本机旧入口仍存在 | 在完整 Skill 独立使用和保留消费者切换通过后，将旧仓库设为只读历史来源 | 用户以后从 skills-hub 获取与更新 | 不删除用户 profile、消息状态或已安装环境来完成归档 |

已确认的目标是 Python 实现、三平台、无 .NET、源码与用户交付均进入 skills-hub，以及迁移完成后归档旧项目。完整 Skill 包含用户端构建所需内容，客户端完成本地构建、初始化和 PATH 接入；客户端不使用包管理器。本次授权结果是修订方案，不包含实施、修改当前机器 PATH、替换用户安装或立即归档仓库。

## 对齐 xrain-cli 的具体做法

沿用 [Skills Hub 仓库入口](../../AGENTS.md) 的 `src/` 与 `skills/shzw-*` 分工。XRain 的 [构建入口](../../tools/build.mjs) 在维护端打包程序；[安装脚本](../../skills/shzw-xrain-cli/scripts/install-cli.mjs) 在客户端注册短命令，目录不在 PATH 时返回提示，目前不会自动构建程序或写入 PATH。[独立安装测试](../../tests/installed.test.mjs) 在无源码仓和 `node_modules` 的临时目录验证实际命令。

DeskPilot 复用完整目录交付和客户端命令注册方式，并按本次明确要求增加客户端本地构建及自动接入用户级 PATH。维护端交付可构建源码与完整资源，客户端使用自身 Python 解释器完成构建和初始化。使用者无需克隆源码仓库、手动安装 Python 包或编写构建命令。

桌面接口和 OCR 仍涉及原生库。完整交付必须同时满足“本项目源码齐全”和“当前平台运行依赖齐全”；项目 Python 源码不能替代缺失的原生库。固定第三方代码、对应平台二进制、必要模型与许可随 Skill 提供，客户端不得临时通过包管理器补装或查询最新版本。

Skill 从默认分支获取，主动更新时替换完整目录。不建立独立 Skill 版本目录、发布标签或版本目录服务。依赖文件清单、Python ABI 和模型版本属于构建输入，不改变此分发规则。

## 语言与运行方式

采用 **Python 核心与 Python 客户端安装脚本**。首次入口只依赖受支持的 CPython 标准库；Python 可由用户客户端提供，也可使用机器已有的官方解释器。缺少适配解释器时说明前置条件，不通过包管理器安装 Python。支持的 Python 版本、平台与 CPU 架构须与随包原生文件一起核定。

Windows 通过 UIA/Win32 绑定操作控件；macOS 通过系统辅助功能及图形接口执行；Linux 对接 AT-SPI、D-Bus 和桌面协议。优先使用系统接口及标准库能够完成的调用；需要 PyObjC、UIA 绑定或 OCR 引擎等第三方实现时，先证明其固定文件可以随 Skill 分发并独立加载，再纳入交付。

客户端安装脚本从随包源码构建应用。纯 Python 部分使用标准库 `zipapp` 生成应用归档；原生扩展及其共享库按平台和 Python ABI 选择，并放在可实际加载的文件目录。原生扩展不能直接从 `.pyz` 内加载。第三方原生二进制由维护端准备并随包交付，不要求使用者编译这些库。

客户端不安装或调用 pip、uv、conda、npm、brew、apt，也不连接软件包索引。本地安装脚本只处理随包的确定文件，不实现依赖解析器、下载器或另一个包管理器。完整 Skill 已取得且系统前置条件满足后，本地构建、初始化、命令注册和桌面/OCR 操作均可离线完成；访问目标网站所需网络另行处理。

现有 Python 消息脚本保留经过验证的纯逻辑。现有 Node.js Flow 和 dsh 接入作为可选消费者迁移，调整为调用新的已构建入口；安装、构建与直接使用 Python 核心不依赖它们。语言选择已确定，不再保留改用 Node.js 核心的待选项。

核心不通过 `pythonnet`、PowerShell `Add-Type` 或旧 `win-agent.exe` 取得桌面能力。其他 Skills 的既有运行要求不属于本次移除范围，例如 XRain 应用包校验器的 .NET 依赖不由本方案变更。

## 源码与交付目录

下面是目标布局。只在对应能力实施时创建文件，不先提交空目录或不可运行的 Skill。

```text
skills-hub/
  src/
    xrain-cli/                         现有 CLI，保持其独立职责
    deskpilot-cli/                     新实现的唯一维护源
      DESIGN.md                       本方案
      pyproject.toml                  Python 源码元数据与维护端配置
      dependencies.json               固定依赖来源、文件、摘要、许可和平台/ABI
      distribution/                   安装、构建、启动与移除脚本维护源
      deskpilot/
        protocol/                     argv、NDJSON、错误和能力诊断
        session/                      会话、观察引用、批处理与取消
        browser/                      CDP、Chrome 启动和目标绑定
        desktop/                      Windows、macOS、Linux 实现
        ocr/                          离线识别与几何定位
      adapters/
        messaging/                    现有消息处理与状态脚本
        wechat_windows/               已有 Windows 微信专用逻辑
      integrations/
        flow/                         迁入的 Node.js 流程宿主
        dsh/                          迁入的薄插件与定向测试
      tests/                          契约、平台与本地 fixture
  skills/
    shzw-xrain-cli/                    现有完整交付目录
    shzw-deskpilot-cli/                新的完整交付目录
      SKILL.md                        唯一任务发现入口
      agents/openai.yaml              宿主展示信息
      scripts/
        install.py                    客户端构建、初始化、命令与 PATH 注册
        build.py                      仅用标准库构建本项目程序
        run.py                        用已登记解释器启动本地构建结果
        uninstall.py                  移除本工具拥有的命令与 PATH 片段
        source/                       从维护源生成的完整 Python 程序与适配源码
        flow/                         随包的可选 Node.js 流程宿主
        dependencies.json             固定交付清单，不在客户端解析或下载依赖
        THIRD_PARTY_NOTICES.txt
      vendor/                         完整第三方代码、平台原生库及其许可
      assets/                         已选定且许可允许分发的离线模型及样例
      references/
        installation.md                依赖、权限、诊断和恢复
        commands.md                    公共调用与结果语义
        browser.md                    页面连接、操作和恢复
        desktop.md                    控件、输入、截图及平台差异
        flows.md                      批次与可选纯数据流程
        messaging.md                  消息状态、采集和回复核验
        testing.md                    明确测试请求时的用法
        wechat-windows.md             仅 Windows 微信的已有适配
  tools/build-deskpilot.mjs            维护端汇集源码、脚本与固定资源
  tests/deskpilot-installed.test.mjs   独立复制与宿主启动验证
```

`src/deskpilot-cli/` 中的产品实现、测试和协议是维护源。维护端从这里生成 Skill 的安装脚本和源码副本，不手工维护第二份实现。客户端只使用已安装 Skill 中的 `scripts/source/`、`vendor/` 与 `assets/` 完成本地构建。Skill 使用说明、参考、UI 元数据与必要资源在自己的完整目录维护。dsh 插件仍是按需宿主接入，不成为默认 Skill 的安装依赖。

所有 Skill 自有资源链接和执行资源都能在完整目录内解析。安装后的程序不得定位 skills-hub 的 `src/`、相邻的 window10GUI 或维护者的固定磁盘路径。交付目录不包含用户机器上的构建缓存、安装记录、日志、截图、Chrome profile 或聊天内容。客户端在用户可写位置构建，Skill 自身可以只读；运行产物与安装记录不写回 Git。

`dependencies.json` 只声明本次完整交付实际包含的文件、来源、许可、平台、架构、Python ABI 和摘要。第三方依赖链也必须完整随包，不依靠开发机器已安装的 Python 包。没有匹配原生文件或许可不允许随包交付时，该组合不得标为可用；不能以自动安装依赖作为隐藏兜底。

目前 skills-hub 没有 `文档/WORKSPACE_STRUCTURE.md`。本方案以 `Kind: Decision` 放在目标源码旁，由根 AGENTS 和 README 明确路由；不为这一个方案复制旧仓库的文档控制面。未来需要恢复的实施任务按仓库入口登记到 Workforce，本次方案不创建实施活动或候选项。

## 用户如何使用

使用者取得 `skills/shzw-deskpilot-cli/` 的完整目录后，由宿主发现 `$shzw-deskpilot-cli`。发现描述应覆盖桌面与浏览器 GUI 目标，不要求用户先说“CLI”，也不把固定微信场景作为普通网页请求的默认流程。

首次使用由客户端调用 Skill 自带的 `install.py`，完成本机环境识别、本地构建、无桌面副作用的启动检查、命令注册和用户级 PATH 接入。系统辅助功能、屏幕访问等权限按平台实际要求由用户授予。构建或启动失败时保留原可用安装，不发送桌面业务请求，也不通过重放业务请求恢复。

以下为拟交付命令，当前尚不可执行。`<skill目录>` 由宿主提供的安装路径或 `resourceBase.path` 解析：

```text
python "<skill目录>/scripts/install.py" --json
deskpilot --help
deskpilot doctor --format json
deskpilot exec --stdin --format ndjson
```

示例中的 `python` 表示客户端已识别的受支持解释器，实际启动记录其绝对路径。安装脚本返回构建结果、短命令绝对路径、PATH 登记结果和当前进程是否能解析该命令。当前宿主尚未继承新 PATH 时，直接使用返回的绝对路径，或执行 `python "<skill目录>/scripts/run.py" doctor --format json`；不能要求每轮任务重装工具。

### 客户端构建与 PATH 行为

1. 从安装脚本自身路径解析完整 Skill，核对 Python 版本、平台、架构及随包文件。安装器自身仅使用标准库，不能先导入尚未就绪的桌面/OCR 库。
2. 在当前用户可写目录，从随包源码生成应用归档并准备当前平台的原生文件与模型路径。执行无桌面副作用的协议启动检查，成功后才注册新入口；失败时保留旧构建和错误信息。
3. 在当前用户命令目录生成 `deskpilot.cmd`（Windows）或 `deskpilot`（macOS/Linux）。启动脚本使用已核实的解释器与运行目录，不依赖调用时的工作目录。
4. 将命令目录加入用户级 PATH，保留原有项并去重。Windows 使用用户环境注册表与系统通知；macOS/Linux 更新已识别、受支持 shell 的用户配置，以带归属标记的片段管理。不得覆盖其他配置或写入系统级 PATH。
5. 返回明确结果。持久 PATH 写入成功不等于已运行的父进程或终端已获得新环境；客户端可立即用绝对路径调用，新终端或重新启动的客户端应能直接执行 `deskpilot`。

安装记录只保存 Skill 来源目录、解释器、构建输入摘要、运行目录、命令入口及 PATH 片段归属。重复安装复用未变化的构建，不重复添加 PATH；源文件更新后重新构建并更新本工具拥有的入口。已有无关同名命令不得覆盖，安装器须返回冲突位置和可用的直接调用路径。

`uninstall.py` 只删除本工具拥有的命令、安装记录和所加 PATH 片段；若同一命令目录仍被其他工具使用，则保留该目录的 PATH 项。用户 Chrome profile、消息状态和其他应用配置不属于卸载对象。PATH 写入失败与构建失败分别报告，不能因为程序可由绝对路径运行就宣称 PATH 已配置。

Agent 默认保持一个进程会话，执行“观察 → 已知动作与检查组成短批次 → 读取结果 → 根据新状态继续”。首次任务不要求先生成完整流程文件。用户确实需要重复操作时，才使用随包交付的可选 Flow 宿主和纯 JSON 场景。

安装文档分别说明桌面通用能力与具体应用适配。Windows 微信的控件和群聊回复规则不会因 CLI 支持 macOS、Linux 就自动适用于另两端。语音转写继续接受应用原生能力或已配置的 ASR 适配；没有转写来源时保留明确的不可用结果。

## 保留的行为与平台实现

### 通用协议和执行

保留现有 JSON/NDJSON 请求和响应的关键语义，包括 `id`/`request_id` 配对、session、观察与截图引用、`actions.batch`/`workflow.run`、等待预算和并发取消。旧方法名可先保持，内部实现与平台专有字段分开。新增能力诊断必须能够区分“不支持”“缺少依赖”“缺少权限”“桌面不可交互”，不能统一返回成功或空结果。

元素、窗口和坐标引用继续绑定当前观察。过期引用、窗口身份变化与截图归属无法确认时拒绝执行。批次不是事务，已发出的动作不回滚；`BATCH_OUTCOME_UNKNOWN` 后先观察已发生效果。应用鉴权和高影响动作仍遵循调用方的明确授权，不用控件文字猜测授权。

CLI 不新增模型规划、后台调度服务、MCP Server 或业务数据库。桌面提示、操作轨迹、取消和前台恢复属于现有用户体验，需要逐项迁移；系统无法提供同等行为时返回明确能力状态，不隐瞒为完全对齐。

### 浏览器与桌面

继续使用 CDP 处理 Chrome 页面导航、查询、填值、点击与等待。浏览器路径、profile 位置、窗口激活和 target 与系统窗口的绑定转为平台适配，不能只移植 WebSocket 代码就宣称浏览器迁移完成。保留已连接 target、精确 endpoint 失败处理、浏览器与 helper 独立生命周期，以及结果回读。

建议的首批验证基线如下。操作系统最低版本、CPU 架构、Python ABI 和固定依赖文件需要在实施前通过独立加载与真实设备核定；本表是建议范围，不是已验证兼容声明。

| 平台 | 建议验证基线 | 执行路线 | 必须单独确认的行为 |
|---|---|---|---|
| Windows | 现有 Windows 10 build 19041+ x64，并覆盖 Windows 11 x64 | Python UIA/Win32 绑定；原生键鼠、截图和窗口管理 | 中文输入、DPI、多屏、瞬态弹层、管理员窗口边界、提示与前台恢复 |
| macOS | macOS 14+，Apple Silicon 与 Intel 各有实际证据 | PyObjC 对接辅助功能、Quartz、AppKit 与截屏接口 | 辅助功能/屏幕权限、坐标缩放、应用控件可见性、合成输入与提示 |
| Linux | Ubuntu 24.04 x64 的 GNOME，分别覆盖 X11 与 Wayland | AT-SPI；X11 输入/截图；Wayland 使用桌面提供的 Portal 等接口 | 控件读取、屏幕与窗口归属、输入授权、窗口激活差异和桌面后端可用性 |

不能用 X11 结果代表 Wayland，也不能把 Ubuntu 一种桌面环境的结果外推为所有 Linux 发行版。未验证组合显示为未验证；缺少真实桌面证据时，该平台不能计入“完成后三平台可用”的归档条件。锁屏、服务会话和安全桌面不在原产品能力内，也不因迁移变成承诺。

### OCR、消息与用户状态

使用可在目标平台交付的离线引擎和固定模型，维护模型来源、版本与许可。先以现有 Tiny 模型行为、文字几何和身份匹配测试比较效果；模型替换必须有相同输入的结果证据，不能仅凭引擎可以启动认定对齐。`Windows.Media.Ocr` 的辅助词框属于平台实现，其他平台没有经过验证的词框时保持空结果及明确来源状态。

保留消息采集的身份核对、连续页面去重、来源指纹、回复目标绑定、已发送记录和结果不明时不重发规则。消息持久化继续由调用方显式指定状态路径，默认不保存聊天历史。用户内容不进入 Skill、源码、构建输出或测试 fixture。

复用已有 Chrome profile 和消息状态时，先核对位置、结构与对应用户。保留现有状态格式优先；若必要格式变化影响已安装使用者，先定义读取、备份和迁移行为，禁止清空状态后冒充兼容。跨平台不自动搬运浏览器认证目录，也不自动授予操作系统权限。

## 旧资产如何迁移

| 当前来源（window10GUI） | skills-hub 中的归属 | 迁移要求 |
|---|---|---|
| `src/WindowsAgent.Cli/Program.cs`、`AutomationEngine.cs` | `src/deskpilot-cli/deskpilot/protocol/`、`session/` | 用 Python 重写，保留公开结果和错误语义 |
| `NativeMethods.cs`、Activity/Overlay | `deskpilot/desktop/` | 按三平台实现与测试，移除 WinForms/.NET 运行依赖 |
| `ChromeCdp.cs` | `deskpilot/browser/` 与平台桌面实现 | 保留页面行为，拆出 Chrome 查找、profile 与系统窗口绑定 |
| `DesktopTextRecognition.cs`、`OfflineTextRecognition.cs` | `deskpilot/ocr/` 与 Skill 模型资源 | 保留离线、几何和身份语义，完成模型及许可核验 |
| `src/DeskPilot.Flow/` | `src/deskpilot-cli/integrations/flow/` | 保留纯数据流程与主动 handoff；启动参数支持新 CLI，不再假定单个 exe 路径 |
| `deskpilot-core`、`browser`、`flow-evolution`、`testing` | 新 Skill 的主入口与按需参考 | 合并发现入口，迁移全部相关参考；测试规则只在明确测试请求时启用 |
| `deskpilot-messaging` 的 Python 脚本、测试和状态约定 | `src/deskpilot-cli/adapters/messaging/` 与交付副本 | 复用现有纯逻辑，改为可注入的新进程命令；保持显式持久化与发送授权 |
| `deskpilot-wechat-assistant` 的脚本、测试与参考 | `adapters/wechat_windows/` 和 Windows 专题 | 保留实际依赖的辅助资源；不把 Windows 控件逻辑宣称为三平台微信适配 |
| `dsh-plugin/` | `integrations/dsh/` | 保留有消费者的工具接口；支持新启动命令，移除对便携 exe、自举和旧 ZIP 清单的依赖 |
| 测试 fixture 与必要产品/使用说明 | 新源码测试与完整 Skill 参考 | 迁移真实能力和使用知识；固定租户、账号和站点样例改为本地合成 fixture 或留在其业务所有者 |
| 原生启动器、.NET 安装脚本、便携 ZIP/OSS 发布链 | 完成切换后退出新产品 | 新默认交付走完整 Skill；不继续维护依赖旧仓库的隐藏下载路径 |

已知代码消费者包括 Flow、dsh 插件和消息/微信脚本。本机 `D:\win-agent\bin\win-agent.exe` 存在，但文件存在不能证明哪些当前宿主仍在调用它。切换前核实实际启用的宿主与安装配置，记录需要更新的完整目录和启动命令；不批量修改未知 profile，也不推断其他安装已经迁移。

## 构建、检查与完成条件

维护端沿用 skills-hub 的 `npm run build`、`build:check`、`index` 和 `check` 入口。新增分支汇集本项目源码、标准库安装/构建脚本、固定第三方文件、模型与许可，不改变 XRain 的既有打包结果。这些维护命令不进入用户客户端安装流程。

客户端构建由 Skill 自带 `build.py` 和 CPython 标准库执行，不使用打包前端、依赖解析或在线安装。维护端检查源码副本与输入清单一致，并在独立目录实际执行客户端安装脚本。随包文件过期、缺文件、引用逃逸、缺少传递依赖或依赖旧仓库时检查失败。

现有 CI 已覆盖 Ubuntu、Windows、macOS 的 Node 检查。实施时为新核心补 Python 契约与独立安装验证；普通 CI 通过不证明屏幕权限、原生控件和交互桌面可用。真实平台检查属于交付该迁移所需的 Development 验证，本方案不自动建立另一项 SystemTest 或部署任务。

| 验收项 | 必要证据 | 当前状态 |
|---|---|---|
| 独立目录可构建与使用 | 把完整 Skill 复制到含空格的临时目录，从另一个工作目录执行安装、本地构建、help、doctor、NDJSON 和本地表单；不提供两个源码仓；同时覆盖只读 Skill 与用户可写构建目录 | 未实施 |
| 无客户端包管理器 | 在仅具备受支持 Python 和系统前置条件、无第三方 Python 安装且无法调用包管理器的环境中，断开软件包下载网络后完成首次构建和操作；核查没有包管理器子进程或隐藏联网补装 | 未实施 |
| PATH 与安装生命周期 | 三平台用户级 PATH 正确接入，新终端可解析短命令；当前客户端使用绝对路径立即调用；重复安装不重复写入，路径含空格可用，冲突不覆盖，更新失败保留旧结果，卸载只回收本工具内容 | 未实施 |
| 无 .NET 依赖 | 新进程树、依赖和构建均不需要 .NET；验证机缺少 .NET 时实际完成目标操作；没有自动回退旧 exe | 未实施 |
| 原有关键语义保留 | 请求配对、超时/取消、旧引用拒绝、批次部分成功/结果不明、截图与 OCR 身份核对的定向测试 | 未实施 |
| 三平台操作成立 | 在上述核定矩阵的真实交互桌面完成网页表单、原生控件、中文输入、截图/OCR、取消和清理；记录具体未支持项 | 未实施 |
| 上层能力可继续使用 | 保留 Flow 的结果与 handoff；消息状态和 Windows 微信辅助脚本的定向验证；实际保留的 dsh 入口启动新核心 | 未实施 |
| Skill 的发现与执行有效 | 从普通自然语言任务选中正确入口，按实际观察完成操作；区分结构检查、作者走查与真实 Agent 执行证据 | 未实施 |
| 可持续维护 | 本地构建可重现，完整目录更新不删除用户状态；随包依赖缺失、ABI 不匹配、权限拒绝、PATH 写入失败和未知动作结果分别报告并可恢复 | 未实施 |
| 旧仓库可以归档 | 所有保留消费者已迁移，用户说明与运行资源不再依赖旧仓，历史来源和恢复入口明确 | 未实施 |

同一来源和版本的有效证据可以复用；改动影响了哪条路径，就补验证哪条路径。测试数量、编译成功和文档校验不替代用户实际安装后的操作结果。依赖文件、许可、目标设备或原生能力存在阻断时，先完成独立部分，并明确保留缺口。

## 实施顺序与归档条件

1. 在 skills-hub 固定公开协议、能力对齐清单和随包依赖文件，建立 Python 核心及完整 Skill。先证明客户端仅凭受支持 Python 和随包文件，能完成本地构建、命令注册与 PATH 接入；同一批次验证三平台/ABI 对应文件能独立加载。
2. 迁移通用协议与 Chrome 行为，完成 Windows 原有能力、OCR、提示和取消的对齐。继续迁入消息脚本、Flow 与 dsh 适配；不把 Windows 单平台完成当作总体完成。
3. 实现并验证 macOS 与 Linux 的平台后端。分别处理 X11、Wayland 和系统权限；证据不足的组合不标成支持。
4. 在真实消费者中验证完整 Skill，补齐平台安装、PATH 接入、更新/卸载、恢复、模型许可和用户说明。按实际受影响安装更新完整目录，由客户端本地重建并更新其命令入口，验证更新后仍能完成原有任务。
5. 达到前述归档条件后，在旧仓库入口注明新维护地址与使用入口，保留 Git 历史与历史来源标识，再归档旧仓库。源仓与本地便携目录的用户数据不随归档删除。

归档条件是迁移实施与消费验证完成，不是本方案完成。当前任务不会设置 GitHub 归档状态、归档聊天、删除 checkout、覆盖 `D:\win-agent`、发布包或修改用户宿主配置。

Python、客户端不使用包管理器、完整源码与依赖随 Skill 交付、客户端本地构建及 PATH 接入均已确认。三平台版本表仍是首批建议基线；具体 Python ABI、原生文件可分发性、模型许可/体积和真实 macOS/Linux 桌面证据需要在实施时核定。这些缺口不能通过 Windows 模拟测试、仅复制 Python 源码或恢复在线安装依赖来代替。

## 依据

- Skills Hub 本地核验基线：`3eca5196e0241c8d9416c1c5995aa515828a092b`。实际入口、构建与独立消费测试见本文链接；[CI 配置](../../.github/workflows/validate.yml) 已有三个系统的 Node 检查。
- 旧实现基线：[window10GUI / 9221d6c9270a8cf66f2fd5a2ffb84280d2f9dc72](https://github.com/chengzhang0528/window10GUI/tree/9221d6c9270a8cf66f2fd5a2ffb84280d2f9dc72)。本次查阅了产品契约、当前设计、C# 源码、Flow、dsh 插件及桌面消息相关完整资源目录。该链接是历史依据，不是用户运行依赖。
- [pywinauto](https://github.com/pywinauto/pywinauto) 提供 Windows Win32/UIA 接入；[PyObjC 框架绑定](https://pyobjc.readthedocs.io/en/latest/notes/framework-wrappers.html)提供 macOS 系统框架访问；[AT-SPI](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/index.html)提供 Linux 辅助功能接口。现成接口存在不代表本项目已经适配。
- [XDG RemoteDesktop Portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)定义会话、用户授予的输入设备与屏幕协作接口。Wayland 支持需按实际桌面后端核验。
- Python 标准库 [zipapp](https://docs.python.org/3/library/zipapp.html)支持从本地 Python 目录创建可执行归档；原生扩展必须放在文件系统中，并匹配目标架构。[ctypes](https://docs.python.org/3/library/ctypes.html)提供系统共享库调用，[winreg](https://docs.python.org/3/library/winreg.html)提供 Windows 注册表访问。上述机制支持所提本地构建与接入路线，具体依赖文件组合和三平台安装行为尚未实现或验证。
