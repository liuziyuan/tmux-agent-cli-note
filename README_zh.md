# tmux-agent-cli-note

[English](README.md)

一个运行在 tmux 中的 vim 风格头脑风暴笔记工具。编写笔记后，可直接发送到同一 tmux 窗口中的 AI CLI（Claude Code、OpenCode、Codex 等）。

## 特性

- **Vim 风格模态编辑器** — NORMAL / INSERT / COMMAND 三种模式，按键习惯与 vim 一致
- **按目录管理笔记** — 每个工作目录下的 `.note/notes.json` 独立存储
- **多 AI CLI 支持** — 自动检测同窗口所有 AI CLI pane，多个时弹出选择器
- **中文友好** — 正确处理 CJK 字符的显示宽度和光标移动
- **零依赖** — 仅使用 Node.js 内置模块

## 环境要求

- tmux 3.0+
- Node.js 18+
- 必须在 tmux 会话中运行

## 安装

```bash
npm install -g tmux-agent-cli-note
```

## 使用方法

在 tmux pane 中运行：

```bash
note
```

### 模式说明

| 模式 | 说明 |
|------|------|
| NORMAL | 默认模式，用于导航和切换模式 |
| INSERT | 自由输入文本，按 `Esc` 返回 NORMAL |
| COMMAND | 输入 `:` 后进入命令模式，按 `Enter` 执行 |
| LIST | 浏览当前目录所有笔记 |
| SELECT | 选择发送目标 AI CLI（检测到多个时出现） |

### NORMAL 模式快捷键

| 按键 | 操作 |
|------|------|
| `i` | 进入 INSERT 模式 |
| `:` | 进入 COMMAND 模式 |
| `q` | 退出编辑器，返回列表 |
| `h` `j` `k` `l` | 左 / 下 / 上 / 右移动光标 |
| `x` | 删除光标处字符 |
| `dd` | 删除当前行 |
| `g` | 跳到顶部 |
| `G` | 跳到底部 |
| `A` | 在行尾追加，进入 INSERT |
| `o` | 在下方新建行，进入 INSERT |
| `O` | 在上方新建行，进入 INSERT |

### COMMAND 模式命令

| 命令 | 操作 |
|------|------|
| `:s` | 发送笔记内容到 AI CLI pane |
| `:q` | 退出编辑器 |
| `:w` | 保存笔记 |
| `:ls` | 返回笔记列表 |

### LIST 模式快捷键

| 按键 | 操作 |
|------|------|
| `j` / `k` | 上下移动选择 |
| `↵` | 打开选中笔记 |
| `n` | 新建笔记 |
| `d` | 删除选中笔记（需确认） |
| `q` | 退出 |

### 发送流程

1. NORMAL 模式下按 `:s`
2. 自动检测当前 tmux 窗口中的 AI CLI pane
3. **只有一个** — 直接发送
4. **有多个** — 弹出选择器，按数字选择，`Esc` 取消

内容会粘贴到 AI CLI 的输入框中，**不会自动提交**，你可以在 AI CLI 端检查编辑后再按 Enter。

## 数据存储

笔记按工作目录存储：

```
your-project/
└── .note/
    └── notes.json
```

示例：

```json
{
  "directory": "/path/to/your-project",
  "notes": [
    {
      "id": "a1b2c3",
      "content": "头脑风暴文本...",
      "createdAt": "2026-04-14T16:00:00Z",
      "updatedAt": "2026-04-14T16:05:00Z",
      "sentAt": "2026-04-14T16:10:00Z"
    }
  ]
}
```

## 许可证

MIT
