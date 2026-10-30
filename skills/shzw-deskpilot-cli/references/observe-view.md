# 按需查看同一次观察

需要经常筛选桌面或 Android 观察时，运行完整 Skill 的 [observe-view.py](../tools/observe-view.py)，传安装返回的 DeskPilot 绝对命令路径。它保持一个底层进程，使用相同 NDJSON 请求；模型直接收到筛选结果，不必每次另起命令读取原始文件。任务要求保留回执时，可加 `--record` 和新的本机文件路径；该文件不会覆盖已有文件，内容包含完整请求与响应，应按任务的数据要求保存。

回执每行记录时间和 `kind`；`request`、`response` 的 `body.raw` 是实际发送或接收的 JSON 原行，`inspect` 只记录本地筛选条件。非 UTF-8 或无效 JSON 响应以 `invalid_response` 的 `raw_base64` 留证，不作为成功结果。

```text
python "<技能目录>/tools/observe-view.py" --command "<已安装 DeskPilot 的绝对路径>"
```

启动后先返回 `{"transport":"ready"}`；随后每行一个 JSON。请求加 `view` 时，`terms` 在名称、文字、描述和控件标识中不区分大小写匹配；`flags` 可选 `scrollable`、`focused`、`has_keyboard_focus`、`editable`、`clickable`，匹配为 true 的属性，两者取并集。省略 `view` 返回完整响应。`transport_error` 是包装层错误，不代表底层操作成功。

```json
{"request":{"id":"obs","method":"android.observe","params":{"window_id":"当前窗口ID"}},"view":{"terms":["Search","Save"],"flags":["scrollable"],"max_items":40}}
{"inspect":{"terms":["Retry"],"flags":["focused"]}}
```

`inspect` 只重新筛选最后一次完整观察，不再调用 DeskPilot；发送新请求后缓存失效。它不能保证外部窗口未变化，动作仍使用工具的新鲜度和遮挡检查。筛选项保留原始属性、引用及 `_source_index`；`parent` 仍指完整原始数组。`_view` 给出源节点数、匹配数、显示数及输出是否截断；原有 `count` 和 `truncated` 原样保留。源树或视图被截断时不能断言唯一或不存在。错误、outcome 和批次各步状态保留，其中的观察节点也按视图筛选；回执写入失败会明确报告并阻止后续普通请求，但取消和关闭仍可发送。
