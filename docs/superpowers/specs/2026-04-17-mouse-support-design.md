# Mouse Support for INSERT Mode

## Goal

Add mouse click support for cursor positioning in both NORMAL and INSERT modes, providing a nano-style editing experience alongside existing vim keybindings. Show mouse availability status in the status bar.

## Approach

Use ANSI mouse tracking protocol (`\x1b[?1002h` button event tracking) to receive mouse events directly. This works independently of tmux mouse mode, though tmux will forward events when its own mouse mode is on.

## Design

### 1. Mouse Event Parsing

**Protocol support:**
- X10 format: `\x1b[M<btn><col><row>` (3 bytes after `M`, each offset by 32)
- SGR format: `\x1b[<btn>;<col>;<row>M` (press) / `\x1b[<btn>;<col>;<row>m` (release)

Both formats are used by tmux and must be handled.

**Changes to `app.ts` `_parseKeys`:**
- Recognize `\x1b[M` prefix (X10) — read 3 more bytes for button/col/row
- Recognize `\x1b[<` prefix (SGR) — scan to `M` or `m` terminator
- Parse into structured `{ row, col, button }` object

**New method `app._parseMouseEvent(seq)`:**
- Input: raw escape sequence string
- Output: `{ row: number, col: number, button: number }` (0-based coordinates)
- X10: subtract 32 from each byte; button = byte & 3 (0=left, 1=middle, 2=right)
- SGR: parse semicolon-separated integers; button from first field

**New method `app._dispatchMouse(event)`:**
- Only handle left button press (button 0)
- Delegate to current view's `handleMouseClick(row, col)` if available

### 2. Screen Coordinate to Logical Position

**New method `editor.handleMouseClick(screenRow, screenCol)`:**
- Ignore clicks outside content area (row < contentStartRow or row >= contentStartRow + visibleLines)
- Convert screen row to logical line index, accounting for:
  - Scroll offset
  - Text wrapping (a logical line may span multiple screen rows)
- Convert screen col to string index: subtract prefix width (5 for line number area), use `colToIndex()`

**Internal helper `editor._screenToLogicalPos(screenRow, screenCol)`:**
- Build wrap map: for each logical line, calculate how many display rows it occupies
- Walk from scrollOffset, accumulating display rows until finding the logical line that contains the clicked display row
- Convert display column to string character index via `colToIndex()`

**Boundary handling:**
- Click above content area or below all lines → clamp to first/last line
- Click past line end → position at end of line
- Click on a wrapped continuation row → calculate correct character index within that segment

### 3. Mouse Tracking Lifecycle

**Changes to `screen.ts`:**
- New method `enableMouseTracking()`: write `\x1b[?1002h` (button event tracking)
- New method `disableMouseTracking()`: write `\x1b[?1000l` (reset)
- Call `enableMouseTracking()` at end of `init()`
- Call `disableMouseTracking()` in `destroy()`

### 4. Tmux Mouse State Detection

**New method `tux.isMouseEnabled()`:**
- Run `tmux show -gv mouse` and check if output is `on`
- Return `boolean`
- Called once at app startup, result cached in `app._tmuxMouseOn`

### 5. Status Bar Display

**Changes to `screen.ts` `drawStatusBar` / `editor.ts` render:**
- Accept optional `mouseState` parameter
- When `mouseState` is provided:
  - `true`: append `Mouse:${green}ON${reset}` to hint text
  - `false`: append `Mouse:${dim}OFF${reset}(${dim}tmux set mouse on${reset})`
- Display in both NORMAL and INSERT modes

### 6. App Integration

**Changes to `app.ts`:**
- Store `this._tmuxMouseOn` from `Tmux.isMouseEnabled()` in constructor
- In `_dispatchKey`, after parsing mouse events via `_parseKeys`, call `_dispatchMouse` instead of `_dispatchKey`
- Pass `this._tmuxMouseOn` to editor render calls

## Files Changed

| File | Changes |
|------|---------|
| `src/screen.ts` | Add `enableMouseTracking()`, `disableMouseTracking()`, update `drawStatusBar` for mouse hint |
| `src/editor.ts` | Add `handleMouseClick()`, `_screenToLogicalPos()`, update `render()` to pass mouse state |
| `src/app.ts` | Update `_parseKeys` for mouse sequences, add `_parseMouseEvent`, `_dispatchMouse`, cache tmux mouse state |
| `src/tux.ts` | Add `isMouseEnabled()` |

## Out of Scope

- Scroll wheel support
- Mouse drag/selection
- RIGHT/NORMAL mode vim operation enhancements (separate feature)
