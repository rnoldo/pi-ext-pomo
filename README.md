# pi-ext-pomo

Pomodoro + wellness reminders (eyes, posture) extension for [pi coding agent](https://github.com/badlogic/pi).

中文文档: [README.zh-CN.md](./README.zh-CN.md)

## Features

- Pomodoro timer with automatic focus/break switching
- Eye reminder (default: every 20 minutes)
- Posture reminder (default: every 50 minutes)
- Footer countdown status
- Persistent session state (restores after restart)

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

## Notes

If you previously placed similar functionality in `~/.pi/agent/extensions/`, remove it to avoid command conflicts.
