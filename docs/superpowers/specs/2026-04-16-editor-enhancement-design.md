# 编辑器功能增强设计

## 定位

这是一个 **笔记工具**，不是通用文本编辑器。编辑能力以"写 prompt 够用"为边界，拒绝功能膨胀。所有功能选取基于以下原则：

- 实现代价低、用户价值高的优先
- 终端兼容性差的降级或不做
- 不拦截终端信号键（Ctrl+C/Z）
- 不引入与项目极简哲学矛盾的复杂度

---

## 当前已有能力

### NORMAL 模式
`h`/`l`/`j`/`k` 移动，`G` 文件末，`g` 文件首，`x` 删字符，`dd` 删行，`i` 进入 INSERT，`A` 行末进入 INSERT，`o`/`O` 新建行，`q` 退出，`:` 命令模式

### INSERT 模式
字符输入（含 CJK），Backspace（含跨行合并），Enter 分行，`←→↑↓` 方向键，Esc 回 NORMAL

### 已知缺陷
- **视觉行导航错误**：长行自动换行后显示为多行，但 `↑`/`↓`（INSERT）和 `j`/`k`（NORMAL）按逻辑行移动，无法在同一逻辑行的视觉行之间移动光标

---

## Phase 1：基础完善

低成本、高价值。修复已知缺陷，补齐最基本的 vim 操作。

### 1.1 修复：视觉行导航

**问题**：`_moveUp`/`_moveDown` 直接操作 `cursor.row`（逻辑行索引），忽略了 `_wrapLine` 产生的视觉行。

**预期行为**：
- INSERT 模式 `↑`/`↓`：按视觉行移动
- NORMAL 模式 `j`/`k`：按视觉行移动
- 光标列位置应映射到目标视觉行的对应显示列（非字符索引）

**实现要点**：
- 新增 `_moveUpVisual` / `_moveDownVisual` 方法
- 给定当前 `cursor.row` 和 `cursor.col`，先用 `_wrapLine` 计算当前逻辑行被拆成几段视觉行，以及光标落在哪一段
- 上移时：如果光标不在第一段视觉行，则在同一逻辑行内回退 `maxWidth` 个显示列的字符量；如果已在第一段，移到上一逻辑行的最后一段视觉行
- 下移同理
- CJK 宽字符需要用 `displayWidth` 计算，不能直接用字符索引

**影响文件**：`src/editor.ts`（`_moveUp`、`_moveDown`、`_handleNormal`、`_handleInsert`）

### 1.2 NORMAL 模式：`0` 行首 / `$` 行末

| 按键 | 行为 |
|------|------|
| `0` | `cursor.col = 0` |
| `$` | `cursor.col = line.length`（NORMAL 下为 `line.length - 1`，空行为 0） |

**实现**：在 `_handleNormal` 的 switch 中加两个 case，各 3-4 行代码。

### 1.3 NORMAL 模式：`D` 删除到行末

| 按键 | 行为 |
|------|------|
| `D` | 删除从 `cursor.col` 到行末的所有字符 |

**实现**：`this.lines[this.cursor.row] = line.slice(0, this.cursor.col)`，1 个 case 分支。

### 1.4 INSERT 模式：Delete 键

| 按键 | 行为 |
|------|------|
| `Delete` | 删除光标处字符；若在行末则合并下一行 |

**实现**：Delete 键在终端中发送 `\x1b[3~`。在 `_handleInsert` 中识别这个序列，复用 `_deleteCharUnderCursor`。需同步在 `_parseKeys` 中处理这个 4 字节序列。

### 1.5 INSERT 模式：Tab 键

| 按键 | 行为 |
|------|------|
| `Tab` | 插入 2 个空格 |

**实现**：在 `_handleInsert` 中捕获 `\t`，调用两次 `_insertChar(' ')` 或直接拼接。

### Phase 1 小结

| 项目 | 改动量 | 风险 |
|------|--------|------|
| 视觉行导航修复 | ~60 行 | 中（CJK 宽字符边界） |
| `0`/`$` | ~8 行 | 低 |
| `D` | ~5 行 | 低 |
| Delete 键 | ~10 行 | 低 |
| Tab 键 | ~5 行 | 低 |

---

## Phase 2：核心增强

中等成本，对笔记编辑有实质提升。

### 2.1 NORMAL 模式：`yy`/`p` 行复制粘贴

**设计**：Editor 类内部维护一个 `_clipboard: string[]` 字段（行数组），不新建文件。

| 按键 | 行为 |
|------|------|
| `yy` | 复制当前行到内部剪贴板（类似 `dd` 用 `pendingYank` 标记处理双击） |
| `p` | 在当前行下方插入剪贴板内容 |

**实现要点**：
- `_clipboard` 作为 Editor 实例属性
- `yy` 用与 `dd` 相同的 pending 模式（`pendingYank` flag）
- `p` 调用 `this.lines.splice(this.cursor.row + 1, 0, ...this._clipboard)` 并移动光标

### 2.2 NORMAL 模式：`w`/`b` 单词跳转

**设计**：简化版单词定义——连续的字母数字为一个词，连续的非空白标点为一个词，空白是分隔符。CJK 每个字符独立成词。

| 按键 | 行为 |
|------|------|
| `w` | 跳到下一个单词开头 |
| `b` | 跳到前一个单词开头 |

**实现**：~30 行。扫描当前行字符分类（word/punct/space/cjk），跳到下一个分类边界。不跨行（笔记场景下行间跳转用 `j`/`k`）。

### 2.3 NORMAL 模式：`J` 合并行

| 按键 | 行为 |
|------|------|
| `J` | 将下一行内容追加到当前行末，中间加一个空格，删除下一行 |

**实现**：~8 行。

### 2.4 INSERT 模式：Home/End

| 按键 | 转义序列 | 行为 |
|------|---------|------|
| `Home` | `\x1b[H` 或 `\x1b[1~` | `cursor.col = 0` |
| `End` | `\x1b[F` 或 `\x1b[4~` | `cursor.col = line.length` |

**实现要点**：
- 需要在 `_parseKeys` 中扩展对这些序列的识别
- Home 有两种常见序列：`\x1b[H`（xterm）和 `\x1b[1~`（vt）；End 同理 `\x1b[F` / `\x1b[4~`
- 注意 `\x1b[H` 与 ANSI 的 cursor home 重叠——但 `_parseKeys` 在 raw mode 下收到的是按键序列，不会与输出混淆

### 2.5 Bracketed Paste Mode 支持

**问题**：用户从系统剪贴板粘贴多行文本时，终端逐字符发送，每个 `\r` 都会触发 `_splitLine`，导致粘贴行为异常。

**设计**：
- 启动时发送 `\x1b[?2004h` 开启 bracketed paste
- 退出时发送 `\x1b[?2004l` 关闭
- 在 `_parseKeys` 中识别 `\x1b[200~` (paste start) 和 `\x1b[201~` (paste end)
- 两个标记之间的内容作为整块文本插入，`\r` 或 `\n` 转为换行
- 粘贴时如果在 NORMAL 模式，不切换模式，直接插入内容（行为类似 vim 的 `p`，NORMAL 下也可以粘贴）

**影响文件**：`src/editor.ts`（新增 `_handlePaste` 方法），`src/app.ts`（`_parseKeys` 扩展），`src/screen.ts`（init/destroy 中开关 bracketed paste）

### 2.6 撤销/重做

**设计**：状态快照方式，Editor 内部维护，不新建文件。

```typescript
// 新增到 Editor 类
private _undoStack: { lines: string[]; cursor: Cursor }[] = [];
private _redoStack: { lines: string[]; cursor: Cursor }[] = [];
private static readonly MAX_UNDO = 50;
```

**快照时机**：
- 从 INSERT 切回 NORMAL 时（`Esc`）
- NORMAL 模式下执行修改操作前（`dd`、`D`、`x`、`p`、`J`）

| 按键 | 模式 | 行为 |
|------|------|------|
| `u` | NORMAL | 恢复到上一个快照 |
| `Ctrl+r` | NORMAL | 前进到下一个快照（从 redo 栈） |

**实现要点**：
- `_saveSnapshot()`：深拷贝 `lines` 和 `cursor`，push 到 `_undoStack`，清空 `_redoStack`
- `_undo()`：当前状态 push 到 `_redoStack`，从 `_undoStack` pop 恢复
- 限制 `_undoStack` 最大长度 50
- `Ctrl+r` 在终端中的序列是 `\x12`，在 `_handleNormal` 中捕获

### Phase 2 小结

| 项目 | 改动量 | 风险 |
|------|--------|------|
| `yy`/`p` | ~25 行 | 低 |
| `w`/`b` | ~30 行 | 低 |
| `J` | ~8 行 | 低 |
| Home/End | ~15 行 | 低（注意序列兼容） |
| Bracketed paste | ~40 行 | 中（序列解析） |
| 撤销/重做 | ~50 行 | 中（快照时机） |

---

## 明确不做的功能

以下功能经评估，不适合本项目的定位：

| 功能 | 理由 |
|------|------|
| 可视模式 `v`/`V` | 实现复杂度极高（选区渲染+操作），`yy`/`dd`/`p` 已覆盖笔记场景 |
| 鼠标支持 | tmux 环境下兼容性差，目标用户习惯键盘操作 |
| `Ctrl+C`/`Ctrl+V`/`Ctrl+X` | 与终端信号冲突（SIGINT/SIGTSTP），拦截会破坏用户预期 |
| `Ctrl+Z` 撤销 | 与终端 SIGTSTP 冲突，NORMAL 模式下 `u` 已覆盖 |
| Shift+方向键选择 | 终端兼容性参差不齐，依赖可视模式基础设施 |
| 宏录制 `q`/`@` | `q` 已用于退出，笔记场景不需要宏 |
| 正则搜索/替换 | 过度设计，笔记通常很短 |
| 自动补全/括号匹配 | 这是代码编辑器功能，不是笔记工具功能 |
| `.` 重复操作 | 实现需要完整的操作语义记录系统 |
| `gU`/`gu` 大小写转换 | 笔记场景几乎不需要 |

---

## 技术约束

- **不新建模块文件**：所有功能内聚到 Editor 类中。唯一例外是如果撤销/重做逻辑超过 100 行可以提取
- **零运行时依赖**：保持不变
- **CJK 感知**：所有涉及列计算的功能必须使用 `displayWidth` / `isWide`
- **终端序列处理**：新增的按键识别统一在 `_parseKeys` 中处理，遵循现有的 CSI 解析模式
