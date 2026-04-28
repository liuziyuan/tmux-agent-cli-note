# 鼠标滑词选择 + 复制粘贴

## Context

项目定位是 vim-like brainstorm note TUI，面向 tmux + AI CLI 用户。当前鼠标支持仅限单击定位光标（`\x1b[?1002h` 协议），拖拽和释放事件被显式忽略。用户要求在 P0 级别添加：**鼠标开启时，滑词选择文本 + 复制粘贴**。

当前已有基础设施：
- `\x1b[?1002h` 协议本身支持 drag/release 事件
- SGR 解析器 (`_parseSgrMouse`) 已能识别 `M`(press) vs `m`(release)
- `bg.reverse` / `bg.unreverse` ANSI 反色代码已在 `screen.ts` 中定义
- `_screenToLogicalPos()` 已能正确转换屏幕坐标到逻辑位置（含 CJK/折行处理）

## 实现步骤

### Step 1: 扩展鼠标事件类型（`src/types.ts`）

在 types.ts 中添加鼠标事件类型定义：

```ts
export interface MouseEvent {
  row: number;      // 1-based screen row
  col: number;      // 1-based screen col
  type: 'press' | 'drag' | 'release';
}
```

### Step 2: 解析 drag/release 事件（`src/app.ts`）

修改 `_parseX10Mouse` 和 `_parseSgrMouse`：
- X10: 检测 button bit 5（值 32）表示 drag，button 3 + 无 motion bit 表示 release
- SGR: `M` 终止符 + button & 32 = drag；`m` 终止符 = release
- 三个事件类型都要传递给 Editor，不再过滤

修改 `_dispatchMouse` 传递完整事件类型给 `Editor.handleMouseEvent()`。

### Step 3: 添加选择状态到 Editor（`src/editor.ts`）

新增属性：
```ts
private _selection: { startRow: number; startCol: number; endRow: number; endCol: number } | null = null;
private _yankRegister: string = '';  // 内部寄存器，存 yank 的文本
```

新增 `handleMouseEvent(event: MouseEvent)` 方法：
- **press**: 记录起点，清除旧选择，移动光标到点击位置
- **drag**: 更新终点，重绘显示选区高亮
- **release**: 如果有选区（start ≠ end），提取文本到 `_yankRegister`

选区提取方法 `_extractSelection()`：
- 遍历 `_selection.startRow` 到 `_selection.endRow`
- 按列范围截取每行文本
- 用 `\n` 拼接多行

### Step 4: 渲染选区高亮（`src/editor.ts`）

修改 `_renderContent()`：
- 遍历每个 wrap segment 时，检查该位置是否落在 `_selection` 范围内
- 对选中的字符用 `ANSI.bg.reverse` + `ANSI.bg.unreverse` 包裹渲染
- 需要将逻辑选区的 {row, col} 转换到显示行/列，再匹配 wrap segment

### Step 5: 添加 NORMAL 模式粘贴键（`src/editor.ts`）

在 `_handleNormal()` 中添加：
- `p` — 在光标后粘贴 `_yankRegister`
- `P` — 在光标前粘贴 `_yankRegister`
- `y` / `yy` — 将当前行（或选区内容）yank 到寄存器（键盘方式也可以复制）

### Step 6: 同步到 tmux 剪贴板

选区文本在 release 时同时写入 tmux buffer：
```ts
import { execSync } from 'child_process';
execSync(`tmux set-buffer -- "${text.replace(/"/g, '\\"')}"`);
```

这样用户在 tmux 其他 pane 中可以用 `prefix + ]` 粘贴。

## 关键文件

| 文件 | 改动 |
|------|------|
| `src/types.ts` | 添加 `MouseEvent` 接口 |
| `src/app.ts` | 修改 `_parseX10Mouse`、`_parseSgrMouse`、`_dispatchMouse` |
| `src/editor.ts` | 添加选择状态、`handleMouseEvent()`、选区渲染、`p`/`P`/`y` 键绑定 |

## 验证方式

1. `npm run dev` 启动
2. 开启 tmux 鼠标模式（`set -g mouse on`）
3. 在 INSERT 模式输入多行文本
4. 回到 NORMAL 模式，用鼠标拖拽选中文本 → 确认反色高亮
5. 释放鼠标后按 `p` → 确认文本粘贴到光标后
6. `prefix + ]` → 确认选中文本也在 tmux 剪贴板中
7. 按 `yy` → 确认整行被 yank，`p` 可粘贴
8. 测试 CJK 文本的拖拽选择是否正确
