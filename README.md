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

插件没有第三方依赖，两种方式任选。

**方式一：本地目录安装（推荐）**

```bash
git clone https://github.com/Anranzero/dsh-chat-actions.git
```

然后在 DSH 里打开 **设置 → 插件 → 安装 bundle**，选择 clone 下来的目录。

或者手动接入 profile：

```bash
# 1. 链接到 profile
#    Windows: mklink /J "%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-chat-actions" "<clone 路径>"
#    macOS/Linux: ln -s "<clone 路径>" ~/.dsh/profiles/<profile>/node_modules/dsh-chat-actions

# 2. 在 profile 的 package.json 中：
#    dependencies 增加 "dsh-chat-actions": "link:<clone 路径>"
#    dsh.profile.bundles 增加 "dsh-chat-actions"
```

**方式二：作为 profile bundle**

`package.json` 已声明 `dsh.bundle.patch`，任何支持 bundle 的安装流程都能识别。

安装后重启 DSH（或等 HMR 重载）。

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

No third-party dependencies. Two options:

**Option 1 — install from a local directory (recommended)**

```bash
git clone https://github.com/Anranzero/dsh-chat-actions.git
```

Then in DSH open **Settings → Plugins → Install bundle** and pick the cloned directory.

Or wire it into a profile manually:

```bash
# 1. link into the profile
#    Windows: mklink /J "%USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-chat-actions" "<clone path>"
#    macOS/Linux: ln -s "<clone path>" ~/.dsh/profiles/<profile>/node_modules/dsh-chat-actions

# 2. in the profile package.json:
#    add "dsh-chat-actions": "link:<clone path>" to dependencies
#    add "dsh-chat-actions" to dsh.profile.bundles
```

**Option 2 — as a profile bundle**

`package.json` declares `dsh.bundle.patch`, so any bundle-aware install flow can pick it up.

Restart DSH (or let HMR reload) after installing.

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
