# pi-ext-pomo

Pomodoro + 健康提醒扩展（眼睛、颈椎、腰椎）for [pi coding agent](https://github.com/badlogic/pi).

## Features

- 番茄钟：专注 / 休息 自动切换
- 眼睛提醒：默认每 20 分钟
- 姿势提醒：默认每 50 分钟
- Footer 倒计时状态栏
- 会话状态持久化（重启后可恢复）

## Install

### 从 GitHub 安装（推荐分享）

```bash
pi install https://github.com/rnoldo/pi-ext-pomo
```

### 本地路径安装（你自己开发时）

```bash
pi install /Users/bruce.y/pi-ext-pomo
```

> 项目级安装（写入 `.pi/settings.json`）可用 `-l`：
>
> ```bash
> pi install -l /Users/bruce.y/pi-ext-pomo
> ```

## Usage

在 pi 里输入：

- `/pomo start`  (默认 25/5)
- `/pomo start 30/5`
- `/pomo pause`
- `/pomo resume`
- `/pomo stop`
- `/pomo status`
- `/eye` 立即眼睛提醒
- `/posture` 立即姿势提醒

## Notes

如果你之前把同名功能放在 `~/.pi/agent/extensions/`，请删除，避免命令冲突。
