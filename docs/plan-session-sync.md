# Plan: Sync Claude Code Session ID to Notes

## Context

Note TUI发送消息到Claude Code pane后，只能记录`sentAt`时间戳，无法关联Claude Code session。用户希望在note list上展示session关联状态，实现note ↔ Claude Code session的双向追踪。

**核心思路**：用tmux pane user options作为IPC通道。Claude Code SessionStart hook设置`@agent-session-id`，note app发送时读取并存储到note上。

## Changes

### 1. `src/types.ts` — Note接口 + Config扩展

Note新增字段：
```typescript
sentToPane: string | null;  // 发送目标tmux pane ID（如"%5"）
sessionId: string | null;   // Claude Code session ID
```

NotePreview同样新增`sentToPane`和`sessionId`。

Config接口新增：
```typescript
hooks: {
  bound: boolean;  // 是否已绑定Claude Code hooks
}
```

### 2. `src/store.ts` — 存储层

- `createNote()`: 默认 `sentToPane: null, sessionId: null`
- `markSent(id, paneId, sessionId)`: 签名扩展，写入三个字段
- 新增 `linkSession(id, sessionId)`: 仅更新sessionId
- `listNotes()`: 映射新字段
- `load()`: 向后兼容迁移（缺字段默认null）

### 3. `src/config.ts` — 扩展配置

- `DEFAULT_CONFIG`增加 `hooks: { bound: false }`
- `loadConfig()`解析`hooks.bound`字段
- 新增 `saveConfig(config)`: 写回`~/.note-config.json`
- 新增 `isHooksBound()`: 读取绑定状态
- 新增 `setHooksBound(value)`: 更新绑定状态并持久化

### 4. `src/tux.ts` — 新增session读取

```typescript
static getSessionId(paneId: string): string | null {
  try {
    const result = execSync(
      `tmux show-option -pqt ${paneId} @agent-session-id`,
      { encoding: 'utf-8' }
    ).trim();
    return result || null;
  } catch { return null; }
}
```

### 5. `src/app.ts` — 发送流程 + hooks绑定交互 + 延迟关联

**发送时hooks绑定检查**（在`_handleSend`或`_doSend`前）：
1. 检查`Config.isHooksBound()`
2. 若`false`，进入CONFIRM状态提示：
   - `"Enable Claude Code hooks for session tracking? (y/n)"`
3. 用户按`y`：执行`_installHooks()`，设置`Config.setHooksBound(true)`，显示`"Hooks enabled"`
4. 用户按`n`：设置`Config.setHooksBound(false)`（明确拒绝，下次不再提示）
5. 继续正常发送流程

**`_doSend()`改动**（L428-449）：
```typescript
const sessionId = Tmux.getSessionId(paneId);
this.store.markSent(editor.noteId, paneId, sessionId);
```

**新增`_tryLinkSessions()`**：
- 遍历`sentToPane`非空但`sessionId`为null的notes
- 调用`Tmux.getSessionId(sentToPane)`尝试读取
- 在`_showList()`中调用

**新增`_installHooks()`**：
- 定位`hooks/set-agent-session-id.sh`脚本路径
- 读取`~/.claude/settings.json`
- 在`hooks.SessionStart`中添加hook条目（检查去重）
- 写回settings.json

**App实例持有hooks绑定状态**：从config加载，传递给各视图的drawStatusBar

### 6. `src/list-view.ts` — 显示session状态

L155 sent indicator颜色区分：
- 未发送: `  `
- 已发送无session: `✓` 绿色
- 已发送有session: `✓` 青色

### 7. `src/screen.ts` — 状态栏新增hooks状态

`drawStatusBar`签名扩展：`drawStatusBar(mode, hint?, mouseOn?, hooksBound?)`

hooksLabel追加在mouseLabel旁：
- 已绑定: `Hooks:ON` 绿色
- 未绑定: `Hooks:OFF` dim

所有调用`drawStatusBar`处传递hooksBound参数。

### 8. `hooks/set-agent-session-id.sh` — 新建hook脚本

仅处理SessionStart：
- 读stdin JSON获取session_id
- 过滤subagent（`agent_type`存在则跳过）
- 设置`tmux set-option -pt $TMUX_PANE @agent-session-id <id>`

**不处理SessionEnd** — session ID持久保留，不清除。

### 9. `bin/note.ts` — setup-hooks命令

新增`note setup-hooks`子命令：
- 执行安装逻辑（同`_installHooks()`）
- 设置`Config.setHooksBound(true)`
- 输出安装结果
- 纯CLI操作后exit，不启动tmux App

## Implementation Order

1. types.ts — Note/Config字段
2. config.ts — hooks配置读写
3. store.ts — markSent签名、linkSession、迁移
4. tux.ts — getSessionId方法
5. hooks/set-agent-session-id.sh — hook脚本
6. screen.ts — drawStatusBar签名+hooks状态显示
7. app.ts — _doSend传参、hooks绑定交互、_tryLinkSessions、_installHooks
8. list-view.ts — 颜色区分
9. bin/note.ts — setup-hooks命令

## Verification

1. 启动Claude Code → 手动设置`@agent-session-id` → 验证`Tmux.getSessionId()`能读取
2. 首次发送 → 验证hooks绑定提示出现 → 按y → 验证`~/.claude/settings.json`中已添加hook → 验证状态栏显示`Hooks:ON`
3. 按n拒绝 → 验证状态栏显示`Hooks:OFF` → 验证下次发送不再提示
4. 发送note到Claude Code pane → 检查notes.json中`sentToPane`和`sessionId`已填充
5. 发送到无session的pane → `sentToPane`有值，`sessionId`为null → 启动Claude Code → 回到list → 验证延迟关联生效（青色✓）
6. `note setup-hooks` → 验证hook安装 + config更新 + 状态栏显示
7. 旧notes.json → 验证向后兼容
8. `npm run build` + `npm run typecheck` 通过

## Critical Files

- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/types.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/config.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/store.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/tux.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/app.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/list-view.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/src/screen.ts`
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/hooks/set-agent-session-id.sh` (new)
- `/Users/liuziyuan/work/home/tmux-agent-cli-note/bin/note.ts`
