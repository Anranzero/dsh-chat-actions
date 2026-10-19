# dsh-chat-actions

[中文](#中文) | [English](#english)

---

## 中文

DeepSeek Harness（DSH）Web 客户端插件，给对话界面加四个实用操作：

| 功能 | 说明 |
|---|---|
| **引用选中内容** | 在对话里选中文字，浮出「添加到对话 / 在侧边栏提问」；引用以 DSH 原生 chip 插入输入框，只显示摘要，发送时由 codec 展开全文给模型 |
| **侧边栏提问** | 把选中内容带到右侧栏的提问面板，输入问题后直接发送到当前会话 |
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

- **引用**：鼠标划选对话内容 → 点「添加到对话」
- **侧边栏提问**：划选 → 点「在侧边栏提问」
- **编辑消息**：悬停你自己发的消息 → 点复制图标右侧的铅笔
- **排队发送**：让 Agent 跑起来时输入消息（进入排队）→ 停止对话 → 在输入框上方的排队条点「发送」

### 实现要点

| 功能 | 扩展点 |
|---|---|
| 选区浮条 | `conversation.input.dock` 插槽 + `position: fixed` 浮层，滚动/缩放时用 `Range` 重算位置（rAF 合并，隐藏时零开销） |
| 引用 chip | `ctx.inputTriggers.registerSource({ trigger: '@', codec })` + `conversation.input.for(scope).insertReference()` |
| 侧边栏 | `sidebarRightTabs.register()` + `sidebar.right.pane.tab` 插槽 |
| 排队发送 | `conversation.input.dock` + `useProjection('inbox')`；用一次性哨兵唤醒 Host 领取队首消息 |
| 编辑消息 | 在宿主操作行内插入按钮（复用宿主 class 保证对齐）+ 内联编辑框 |

### 已知限制

- 排队消息按 FIFO 发送，暂停时只能发队首
- 会话日志是 append-only：编辑消息会作为**新消息**发送，不改写历史
- 编辑框不保留原消息的附件
- 侧边栏提问发送到当前会话，不是独立会话

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
| **Quote selection** | Select text in the conversation and pick "Add to chat" / "Ask in sidebar". The quote becomes a native DSH reference chip: the composer shows a short excerpt, and a codec expands the full text for the model on send |
| **Sidebar question** | Carry the selection into a right-sidebar panel, type a question, and send it to the current session |
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
- **Queue**: type while the agent runs (message is queued) → stop the agent → click "Send" on the queue bar above the composer

### Known limitations

- Queued messages send in FIFO order; only the head can be sent while paused
- The session log is append-only: editing sends a **new** message and never rewrites history
- The editor does not carry over the original message's attachments
- Sidebar questions are sent to the current session, not an isolated one

### License

MIT
