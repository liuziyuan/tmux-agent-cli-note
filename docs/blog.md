# 告别复制粘贴：在 tmux 里用 Vim 的方式给 AI 写需求

你是不是经常这样工作——在编辑器里写好一段需求描述，然后手动复制，切到终端，粘贴给 Claude Code / OpenCode / Codex，再按回车？

一个窗口写，一个窗口跑，来回切换，效率全碎。

**tmux-agent-cli-note** 就是来终结这个流程的。

## 它是什么

一个运行在 tmux 里的 Vim 风格笔记工具。核心能力只有一个：

**写完笔记，一条命令直接发送到同窗口的 AI CLI。**

不用切 pane，不用复制粘贴，不用离开键盘。

## 安装

一行搞定：

```bash
npm install -g tmux-agent-cli-note
```

前提条件：
- tmux 3.0+
- Node.js 18+
- 你得在 tmux 会话里使用它

## 5 分钟上手

### 1. 启动

在 tmux 的任意 pane 里运行：

```bash
note
```

进入笔记列表界面。第一次使用时列表为空。

### 2. 新建笔记

按 `n` 创建一条新笔记，自动进入编辑器。

### 3. 写内容

默认是 NORMAL 模式（和 Vim 一样）：

- 按 `i` 进入 INSERT 模式，开始输入文本
- 按 `Esc` 回到 NORMAL 模式
- 用 `h j k l` 移动光标
- 按 `:w` 保存

如果你会用 Vim，这些操作零学习成本。如果你不会 Vim，记住 `i`（输入）和 `Esc`（退出输入）就够了。

### 4. 发送给 AI

最关键的一步——在 NORMAL 模式下输入：

```
:s
```

工具会自动扫描当前 tmux 窗口里的所有 AI CLI pane（Claude Code、OpenCode、Codex 都能识别）：

- **只找到一个 AI** → 直接发送，内容粘贴进 AI 的输入框
- **找到多个 AI** → 弹出选择器，按数字选一个

注意：内容只是粘贴到输入框，**不会自动提交**。你可以检查一遍，确认没问题再按 Enter。

### 5. 管理笔记

在列表界面（LIST 模式）：

| 按键 | 操作 |
|------|------|
| `j` / `k` | 上下选择 |
| `Enter` | 打开笔记 |
| `n` | 新建 |
| `d` | 删除（需确认） |
| `q` | 退出 |

笔记按目录存储，每个项目独立的 `.note/notes.json`，不会串。

## 典型工作流

```
tmux 窗口布局：
┌──────────────┬──────────────┐
│              │              │
│  Claude Code │              │
│              │              │
├──────────────┤    note      │
│              │   (笔记)     │
│  OpenCode    │              │
│              │              │
└──────────────┴──────────────┘
```

1. 左边跑 AI CLI，右边开 `note`
2. 在 note 里写好需求、思路、prompt
3. `:s` 一键发送
4. 反复迭代，所有笔记自动保存

## 几个细节

- **中文完全没问题**——CJK 字符的宽度和光标都做了正确处理
- **零依赖**——只用 Node.js 内置模块，装完就能跑
- **支持多个 AI CLI**——同时开着 Claude Code 和 OpenCode 也不慌

---

如果你是在 tmux 里跑 AI CLI 的重度用户，试试 `npm install -g tmux-agent-cli-note`，让笔记和 AI 之间少一次复制粘贴。

---

**GitHub**: [github.com/liuziyuan/tmux-agent-cli-note](https://github.com/liuziyuan/tmux-agent-cli-note)

觉得有用？欢迎 Star ⭐
