# dsh-chat-actions

[中文](#中文) | [English](#english)

---

## 中文

DeepSeek Harness（DSH）Web 客户端插件，给对话界面补充以下实用功能：

| 功能 | 说明 |
|---|---|
| **引用选中内容** | 在对话里选中文字，浮出「添加到对话 / 在侧边栏提问」；引用以 DSH 原生 chip 插入输入框，数量入口打开浮层预览，可回到原消息重新圈选或删除，发送时由 codec 展开全文给模型 |
| **侧边栏提问** | 参考 dsh-side-chat 的只读流式讨论；冻结所选消息所在已完成轮次的上下文，继承原模型，支持停止和引用回主输入框，不创建 Session |
| **暂停后发送排队消息** | 对话停止后，排队中的消息仍可逐条发送（含图片/文件附件） |
| **编辑自己发的消息** | 悬停自己发送的消息，复制按钮右侧出现铅笔；改完从这条消息之前继续，原消息及其后的回复离开当前会话 |
| **记住模型推理等级** | 按服务商和模型保存选择成功的档位；A、B 来回切换时恢复各自的等级，目标模型不再支持的等级自动交回宿主默认处理 |

### 插件设置

在 **插件 → 对话快捷操作** 详情页可直接切换 **记住模型推理等级**，默认开启。开关及记忆保存在当前浏览器或桌面客户端；关闭后保留记忆，并恢复宿主原来的模型选择行为，不影响引用、侧聊、编辑或排队消息。

通过宿主共享的模型目录接入，不修改 DSH 或滑条插件文件；原生菜单和滑条使用同一选择入口。自动检查覆盖 A→B→A、持久化、不同服务商隔离、失败不保存、不支持的档位以及关闭/重新开启；这些检查使用宿主接口替身，不代替桌面实测。首次更新后重启 DSH，以便重新读取客户端模块声明。

### 安装

安装时会解析与 DSH 匹配的宿主 SDK 依赖。把 `<profile>` 换成你的 profile 名（默认 `desktop`）：

```bash
# Windows PowerShell
.\install.ps1 -Profile desktop

# macOS / Linux
./install.sh desktop
```

脚本做三件事：`git` 源装进 profile 的 `node_modules`、把 `dsh-chat-actions` 写进
`dsh.profile.bundles`（真正决定是否加载的那一层）、最后用 `dsh --dump-config` 校验。
看到 `OK: the profile loads dsh-chat-actions.` 就装好了，重启 DSH 生效。

不想先 clone 也行，DSH 自带的插件命令同样一条命令：

```bash
dsh plugin --profile desktop add github:Anranzero/dsh-chat-actions
```

只想链接当前工作副本（改代码即时生效，适合开发）：

```bash
.\install.ps1 -FromClone      # Windows
./install.sh --from-clone     # macOS / Linux
```

克隆安装会先在工作副本安装宿主 SDK 依赖，再把该目录链接进 profile。手动使用 `link:` 安装时，也需先在插件目录运行 `npm install --ignore-scripts`；仅在 profile 安装依赖不会让外部链接目录自动找到这些包。

`install.ps1` 还支持 `-DshHome <path>`、`-Spec <spec>`，`install.sh` 支持用 `DSH_HOME` 环境变量指定。

### 版本要求

- 需要带 **bundle patch + client slot** 机制的 DSH 版本；本插件在 `dsh 0.2.1-rc.2` 上实测通过。
- 只读侧聊需要宿主的 `llm`、`sessions`、`sessionQuery` 和 Typert Remote 接口；缺少接口时会报错，不创建替代 Session。
- 客户端热更新依赖可选的 `clientModules`；本次新增宿主端服务和协议导出，更新后须重启 DSH 才能加载。

### 使用

- **引用**：鼠标划选对话内容 → 点「添加到对话」；点击输入框区域的「几条引用」打开浮层预览。点「重新选择原文」定位来源消息，重新圈选后保存，或取消保留旧引用；也可删除引用。引用不提供自由改写文本框，发送时保留所选全文、换行和代码缩进。
- **侧边栏提问**：在已完成的回复中划选 → 点「在侧边栏提问」→ 输入问题并发送；侧栏流式显示回答和可折叠思考内容。「停止生成」保留已收到的文字；「添加到对话」把讨论作为引用放回主输入框，尚不发送，重复添加会更新同一引用。再次划选会添加到侧聊草稿；「新侧聊」清理当前讨论后重新读取上下文。
- **编辑消息**：悬停你自己发的消息 → 点复制图标右侧的铅笔 → 改完发送，当前会话从这条消息之前继续
- **排队发送**：让 Agent 跑起来时输入消息（进入排队）→ 停止对话 → 在输入框上方那条队列里点「发送 ↓」或行尾「↑」
- **排队图片**：排队行直接显示缩略图，点一下开全屏预览（点背景或按 Esc 关闭）

### 实现要点

| 功能 | 扩展点 |
|---|---|
| 选区浮条 | `conversation.input.dock` 插槽 + `position: fixed` 浮层，滚动/缩放时用 `Range` 重算位置（rAF 合并，隐藏时零开销） |
| 引用 chip | `ctx.inputTriggers.registerSource({ trigger: '@', codec })` + `conversation.input.for(scope).insertReference()` |
| 侧边栏 | 插件 Typert Remote + `llm.prepareCall`；只读 Session 快照、无工具流式调用、临时内存历史；停止、关页、断开连接和插件卸载时取消请求 |
| 排队发送 | 接管宿主 `queue` 单元（不再并列第二条）：`useProjection('inbox')` + 哨兵唤醒宿主领取队首消息（保留附件） |
| 编辑消息 | 在宿主操作行内插入按钮（复用宿主 class 保证对齐）+ 内联编辑框；发送时用行的 `data-chat-flow-key` 在会话日志里定位原消息，`sessions.fork({ atSeq: seq - 1 })` 切开后用 `uiWorkspace.openSession` 打开子会话，再把新文字排队发送到子会话 |

### 本地源码修复与验证

- 侧聊已移除 `SessionProvider` 和原生 Agent 会话路径；前端直接消费插件自己的流式协议，避开 `conversation-renderer-unavailable`。问题被宿主接收后才清空对应草稿；断线保留部分回答，接收前重试沿用请求 ID。
- `side-chat/service.js` 与生成的严格协议复用 [AHGGG/dsh-side-chat](https://github.com/AHGGG/dsh-side-chat/tree/8d463ea7410bcb0b4e76a2d11d5b848d04fc0086) 的 MIT 实现，保留授权声明；只调整插件命名空间、运行时注入和现有引用入口，不修改 DSH 本体。
- 引用 codec 随 `inputTriggers` 服务就绪、替换和卸载注册/清理，不再只在启动时查一次。注册成功前不会插入无法发送的引用 chip；完整引用文本不降级为摘要。
- 排队栏复用输入框的最大宽度与两侧留白，居中对齐，不使用固定屏宽。
- `npm test` 运行服务生命周期、引用全文和排队栏布局约束的回归检查；布局约束检查不代替真实页面的视觉验证。
- 宿主入口检查直接导入 `index.js`，并在真实 Cordis 容器中检查侧聊服务的注册与卸载，覆盖缺少宿主 SDK 依赖导致整个插件无法启用的问题；不发送模型请求。
- 本地修复请从这个源码目录安装，保留工作副本；重新安装 GitHub 版本不会自动包含尚未提交到上游的本地改动。
- 引用入口沿用 `dsh-quote-followup` 的原生引用插入方式；侧聊复用前述只读实现，宿主 SDK 依赖由包管理器安装。
- 编辑已发送消息采用排队模式，失败会清理发送中的占位；只读侧聊不提供原生 Agent 消息编辑入口。
- 暂停队列使用独立请求 ID 唤醒，订阅队列投影清理迟到标记，并防止重复点击；不删除再重建原排队消息，保留图片和文件。
- 回归检查覆盖引用来源定位、跨会话保护、侧聊上下文边界、流式停止/释放、失败重试和队列唤醒；另以宿主自带 SDK 核对流式格式与服务注册。这些检查不代替桌面实测。

### 已知限制

- 排队消息按 FIFO 发送，暂停时只能发队首
- 会话日志是 append-only，宿主不提供原地改写：编辑消息时用 `atSeq: seq - 1` fork 出子会话（切点在这条消息之前），把新文字先发进子会话，成功后切到子会话并**归档**原会话，所以列表里仍只有一条对话、名字不变，原消息及其后的回复不再出现；旧版本在归档里，可恢复
- 编辑后跟随原消息的回复也会一起离开当前视图（与宿主的分支行为一致）
- 会话第一条消息无法“切在它之前”（没有更早的事件可用），此时编辑会明确报错并保留原消息，不会追加一条重复的可见消息
- 若宿主缺少归档接口（旧版本），编辑仍会成功，但列表里会暂时多出一条原会话
- 编辑框不保留原消息的附件
- 含附件的排队消息不开放编辑，避免宿主的纯文本替换接口丢弃附件；仍可直接发送或删除。
- 侧聊是临时只读讨论，不运行工具或编辑文件；上下文只读到所选消息所在轮次结束，不自动跟随后续主聊。原消息的思考过程与附件字节不传给侧聊，超限会明确拒绝而不静默截断。
- 侧聊历史只在内存中保留；关闭、新侧聊、重启或空闲过期后清理。需要保留的内容请先「添加到对话」；草稿忙碌时插入失败会提示重试。
- 当前宿主没有单独的恢复队列接口，暂停发送仍需临时唤醒请求；实际桌面上的中断/延迟时序需要验收。
- 重新圈选需要原消息已加载到当前聊天区域。旧引用没有来源标记时，仅在原文唯一匹配时允许定位；来源未加载、已变化或存在歧义时提示重新添加，原引用不被覆盖。

### 兼容性

- DSH Web 客户端（Electron 桌面版 / 浏览器版）
- 客户端从平台模块表使用 React 和 DSH Markdown 组件，无需另装运行时依赖。

### License

MIT

---

## English

### Optional settings

Open **Plugins → Chat Quick Actions** to toggle **Remember model reasoning effort** directly on the detail page (enabled by default). Successful effort choices are saved per provider/model in this client and restored when returning to that model. Disabling retains saved choices and restores DSH's selection behavior; quoting, side chat, editing and queue actions remain available. Unsupported remembered levels fall back to the host. Restart DSH after the first update so it rereads the client module declaration. Automated checks use host-interface substitutes; desktop UI verification remains separate.

A DeepSeek Harness (DSH) Web client plugin that adds four practical actions to the chat UI:

| Feature | Description |
|---|---|
| **Quote selection** | Select text and pick "Add to chat" / "Ask in sidebar". Native reference chips retain the full text. A quote-count button opens read-only previews with source reselection and removal; reselection is restricted to the original message |
| **Sidebar question** | Read-only streaming discussion with a frozen parent turn, inherited model, stop, and add-to-composer controls; creates no Session |
| **Send queued messages while paused** | After the agent stops, queued messages can still be sent one by one, attachments included |
| **Edit your own sent messages** | Hover a message you sent; a pencil appears next to Copy. Edit and send, and the current session continues from before that message |

### Install

Installation resolves the host SDK peers matching DSH. Replace `<profile>` with your profile
name (defaults to `desktop`):

```bash
# Windows PowerShell
.\install.ps1 -Profile desktop

# macOS / Linux
./install.sh desktop
```

The script does three things: installs the GitHub source into the profile's
`node_modules`, writes `dsh-chat-actions` into `dsh.profile.bundles` (the layer
that actually decides what loads), and verifies with `dsh --dump-config`. Seeing
`OK: the profile loads dsh-chat-actions.` means it worked; restart DSH to load it.

No clone needed — DSH's own plugin command is also one line:

```bash
dsh plugin --profile desktop add github:Anranzero/dsh-chat-actions
```

To link your working copy instead (edits take effect immediately, good for
development):

```bash
.\install.ps1 -FromClone      # Windows
./install.sh --from-clone     # macOS / Linux
```

Clone installation installs the host SDK peers in the working copy before linking it into the profile. For a manual `link:` installation, run `npm install --ignore-scripts` in the plugin directory first; profile dependencies are not automatically visible from an external linked directory.

`install.ps1` also accepts `-DshHome <path>` and `-Spec <spec>`; `install.sh`
honours the `DSH_HOME` environment variable.

### Requirements

- Needs a DSH build with the **bundle patch + client slot** mechanism; verified on
  `dsh 0.2.1-rc.2`.
- Side Chat requires Host LLM, Session query and Typert Remote APIs. Client hot reload is optional; restart DSH after this update to load the new Host service and protocol.

### Usage

- **Quote**: select conversation text → "Add to chat"
- **Ask**: select a completed reply → "Ask in sidebar" → send. Stop preserves partial replies. "Add to chat" inserts or updates a reference in the parent composer without sending. Close or "New discussion" disposes the temporary discussion.
- **Edit**: hover your own message → pencil next to the copy icon
- **Queue**: type while the agent runs (message is queued) → stop the agent → click "Send ↓" in the queue strip above the composer, or the "↑" at a row's end
- **Queued images**: rows show thumbnails; click one for a full-size preview (click the backdrop or press Escape to close)

### Known limitations

- Queued messages send in FIFO order; only the head can be sent while paused
- The session log is append-only and the host offers no in-place rewrite: editing forks a child session at `atSeq: seq - 1`, sends the new text into it first, then switches to it and **archives** the pre-edit session, so the list still shows one conversation under the same name and the message plus its later replies are gone. The previous version stays recoverable in the archive
- Replies that followed the edited message leave the current view with it (same as the host's own branch behaviour)
- The first message of a session cannot be cut away (no earlier event exists); editing it reports a clear error and keeps the message instead of appending a duplicate
- Without a host archive API (older builds) the edit still works, but the list shows the pre-edit session as an extra entry
- The editor does not carry over the original message's attachments
- Queued messages with attachments cannot be edited because the host's text-only edit API would drop attachments; sending and removal remain available
- Side chats freeze context through the selected completed turn; later parent messages, parent reasoning and attachment bytes are excluded. They have no tools and remain in memory only. Oversized context is rejected explicitly.
- Paused queue recovery still uses a temporary wake request because this host has no dedicated resume endpoint; desktop timing remains to be verified

### License

MIT

Read-only Side Chat reuses [AHGGG/dsh-side-chat](https://github.com/AHGGG/dsh-side-chat/tree/8d463ea7410bcb0b4e76a2d11d5b848d04fc0086) under MIT; upstream and bundled Zod notices are in `side-chat/`.
