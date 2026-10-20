# dsh-chat-actions

[中文](#中文) | [English](#english)

---

## 中文

DeepSeek Harness（DSH）Web 客户端插件，给对话界面加四个实用操作：

| 功能 | 说明 |
|---|---|
| **引用选中内容** | 在对话里选中文字，浮出「添加到对话 / 在侧边栏提问」；引用以 DSH 原生 chip 插入输入框，编号卡片支持预览、编辑和删除，发送时由 codec 展开全文给模型 |
| **侧边栏提问** | 把选中内容带到右侧栏，首次发送时创建独立会话；使用宿主聊天界面持续提问，主对话不被打断 |
| **暂停后发送排队消息** | 对话停止后，排队中的消息仍可逐条发送（含图片/文件附件） |
| **编辑自己发的消息** | 悬停自己发送的消息，复制按钮右侧出现铅笔；点击后弹出编辑框，改完作为新消息发送 |

### 安装

插件零第三方依赖，一条命令即可。把 `<profile>` 换成你的 profile 名（默认 `desktop`）：

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

`install.ps1` 还支持 `-DshHome <path>`、`-Spec <spec>`，`install.sh` 支持用 `DSH_HOME` 环境变量指定。

### 版本要求

- 需要带 **bundle patch + client slot** 机制的 DSH 版本；本插件在 `dsh 0.2.1-rc.2` 上实测通过。
- 插件在旧版 Host 上也能正常用：热更新（改动即时推到已打开的页面）依赖 `clientModules` 服务，
  该服务缺失时自动跳过，界面功能不受影响。

### 使用

- **引用**：鼠标划选对话内容 → 点「添加到对话」；输入框上方的编号卡片可编辑或删除，保留全文、换行和代码缩进。
- **侧边栏提问**：划选 → 点「在侧边栏提问」→ 输入问题并发送；之后在独立侧聊中继续。再次划选提问会添加到侧聊草稿，不会自动发送。
- **编辑消息**：悬停你自己发的消息 → 点复制图标右侧的铅笔
- **排队发送**：让 Agent 跑起来时输入消息（进入排队）→ 停止对话 → 在输入框上方那条队列里点「发送 ↓」或行尾「↑」
- **排队图片**：排队行直接显示缩略图，点一下开全屏预览（点背景或按 Esc 关闭）

### 实现要点

| 功能 | 扩展点 |
|---|---|
| 选区浮条 | `conversation.input.dock` 插槽 + `position: fixed` 浮层，滚动/缩放时用 `Range` 重算位置（rAF 合并，隐藏时零开销） |
| 引用 chip | `ctx.inputTriggers.registerSource({ trigger: '@', codec })` + `conversation.input.for(scope).insertReference()` |
| 侧边栏 | `sessions.create/retain` + `SessionProvider` + 原生 `conversation.content`，关闭面板时释放引用 |
| 排队发送 | 接管宿主 `queue` 单元（不再并列第二条）：`useProjection('inbox')` + 哨兵唤醒宿主领取队首消息（保留附件） |
| 编辑消息 | 在宿主操作行内插入按钮（复用宿主 class 保证对齐）+ 内联编辑框 |

### 本地源码修复与验证

- 引用 codec 随 `inputTriggers` 服务就绪、替换和卸载注册/清理，不再只在启动时查一次。注册成功前不会插入无法发送的引用 chip；完整引用文本不降级为摘要。
- 排队栏复用输入框的最大宽度与两侧留白，居中对齐，不使用固定屏宽。
- `npm test` 运行服务生命周期、引用全文和排队栏布局约束的回归检查；布局约束检查不代替真实页面的视觉验证。
- 本地修复请从这个源码目录安装，保留工作副本；重新安装 GitHub 版本不会自动包含尚未提交到上游的本地改动。
- 参考 `dsh-quote-followup` 的原生引用插入方式、`dsh-prompt-history` 的独立会话持有与释放方式；未新增运行时依赖。
- 编辑已发送消息采用排队模式，失败会清理发送中的占位；主对话和侧聊的选择、编辑事件按各自聊天区域隔离。
- 暂停队列使用独立请求 ID 唤醒，订阅队列投影清理迟到标记，并防止重复点击；不删除再重建原排队消息，保留图片和文件。
- 回归检查覆盖引用编辑、会话隔离/释放、失败重试和队列唤醒；这些检查使用宿主接口替身，不代替桌面实测。

### 已知限制

- 排队消息按 FIFO 发送，暂停时只能发队首
- 会话日志是 append-only：编辑消息会作为**新消息**发送，不改写历史
- 编辑框不保留原消息的附件
- 含附件的排队消息不开放编辑，避免宿主的纯文本替换接口丢弃附件；仍可直接发送或删除。
- 侧聊从新会话开始，仅带入所选文字与问题，不自动复制主会话历史。
- 当前宿主没有单独的恢复队列接口，暂停发送仍需临时唤醒请求；实际桌面上的中断/延迟时序需要验收。

### 兼容性

- DSH Web 客户端（Electron 桌面版 / 浏览器版）
- 客户端只从平台模块表 `require('react')`，无第三方运行时依赖

### License

MIT

---

## English

A DeepSeek Harness (DSH) Web client plugin that adds four practical actions to the chat UI:

| Feature | Description |
|---|---|
| **Quote selection** | Select text and pick "Add to chat" / "Ask in sidebar". Native reference chips retain the full text; numbered preview cards support editing and removal |
| **Sidebar question** | Send the selection and a question to an independent session in the sidebar, then continue using the native chat UI without interrupting the main conversation |
| **Send queued messages while paused** | After the agent stops, queued messages can still be sent one by one, attachments included |
| **Edit your own sent messages** | Hover a message you sent; a pencil appears next to Copy. Click it to edit and resend as a new message |

### Install

No third-party dependencies, one command. Replace `<profile>` with your profile
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

`install.ps1` also accepts `-DshHome <path>` and `-Spec <spec>`; `install.sh`
honours the `DSH_HOME` environment variable.

### Requirements

- Needs a DSH build with the **bundle patch + client slot** mechanism; verified on
  `dsh 0.2.1-rc.2`.
- Older hosts still work: live reload (pushing edits into an already-open page)
  needs the `clientModules` service, and the plugin skips it when absent — every
  UI feature keeps working.

### Usage

- **Quote**: select conversation text → "Add to chat"
- **Ask**: select text → "Ask in sidebar"
- **Edit**: hover your own message → pencil next to the copy icon
- **Queue**: type while the agent runs (message is queued) → stop the agent → click "Send ↓" in the queue strip above the composer, or the "↑" at a row's end
- **Queued images**: rows show thumbnails; click one for a full-size preview (click the backdrop or press Escape to close)

### Known limitations

- Queued messages send in FIFO order; only the head can be sent while paused
- The session log is append-only: editing sends a **new** message and never rewrites history
- The editor does not carry over the original message's attachments
- Queued messages with attachments cannot be edited because the host's text-only edit API would drop attachments; sending and removal remain available
- Side chats start fresh with the selection and question, without copying the main transcript
- Paused queue recovery still uses a temporary wake request because this host has no dedicated resume endpoint; desktop timing remains to be verified

### License

MIT
