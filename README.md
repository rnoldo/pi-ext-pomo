# pi-ext-pomo

Pomodoro + wellness reminders (eyes, posture) extension for [pi coding agent](https://github.com/badlogic/pi).

<details>
<summary>中文说明（点击展开）</summary>

用于 [pi coding agent](https://github.com/badlogic/pi) 的番茄钟 + 健康提醒扩展（眼睛、颈椎、腰椎）。

</details>

## Features

- Pomodoro timer with automatic focus/break switching
- Eye reminder (default: every 20 minutes)
- Posture reminder (default: every 50 minutes)
- Footer countdown status
- Persistent session state (restores after restart)

<details>
<summary>中文说明（点击展开）</summary>

- 番茄钟：专注 / 休息自动切换
- 眼睛提醒：默认每 20 分钟
- 姿势提醒：默认每 50 分钟
- Footer 倒计时状态栏
- 会话状态持久化（重启后可恢复）

</details>

## Install

### Install from GitHub (recommended)

```bash
pi install https://github.com/rnoldo/pi-ext-pomo
```

> For project-local install (writes to `.pi/settings.json`), use `-l`:
>
> ```bash
> pi install -l https://github.com/rnoldo/pi-ext-pomo
> ```

<details>
<summary>中文说明（点击展开）</summary>

### 从 GitHub 安装（推荐）

```bash
pi install https://github.com/rnoldo/pi-ext-pomo
```

> 如果需要项目级安装（写入 `.pi/settings.json`），可使用 `-l`：
>
> ```bash
> pi install -l https://github.com/rnoldo/pi-ext-pomo
> ```

</details>

## Usage

Run these commands in pi:

- `/pomo start` (default 25/5)
- `/pomo start 30/5`
- `/pomo pause`
- `/pomo resume`
- `/pomo stop`
- `/pomo status`
- `/eye` trigger eye reminder now
- `/posture` trigger posture reminder now

<details>
<summary>中文说明（点击展开）</summary>

在 pi 里输入：

- `/pomo start`（默认 25/5）
- `/pomo start 30/5`
- `/pomo pause`
- `/pomo resume`
- `/pomo stop`
- `/pomo status`
- `/eye` 立即眼睛提醒
- `/posture` 立即姿势提醒

</details>

## Notes

If you previously placed similar functionality in `~/.pi/agent/extensions/`, remove it to avoid command conflicts.

<details>
<summary>中文说明（点击展开）</summary>

如果你之前把同名功能放在 `~/.pi/agent/extensions/`，请删除，避免命令冲突。

</details>
