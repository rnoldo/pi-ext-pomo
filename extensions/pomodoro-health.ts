import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type Phase = "focus" | "break" | "longBreak";
type RunState = "idle" | "running" | "paused";

interface PomodoroState {
	runState: RunState;
	phase: Phase;
	phaseEndsAt?: number;
	remainingSeconds?: number;
	focusMinutes: number;
	breakMinutes: number;
	longBreakMinutes: number;
	longBreakEvery: number;
	completedFocusCount: number;
	lastEyeReminderAt?: number;
	lastPostureReminderAt?: number;
}

const STATE_ENTRY_TYPE = "pomodoro-health-state";
const STATUS_KEY = "pomodoro-health";

const EYE_REMINDER_MS = 20 * 60 * 1000;
const POSTURE_REMINDER_MS = 50 * 60 * 1000;
const TICK_MS = 1000;

function defaultState(): PomodoroState {
	return {
		runState: "idle",
		phase: "focus",
		focusMinutes: 25,
		breakMinutes: 5,
		longBreakMinutes: 15,
		longBreakEvery: 4,
		completedFocusCount: 0,
	};
}

function phaseDurationSeconds(state: PomodoroState): number {
	if (state.phase === "focus") return state.focusMinutes * 60;
	if (state.phase === "break") return state.breakMinutes * 60;
	return state.longBreakMinutes * 60;
}

function phaseLabel(phase: Phase): string {
	if (phase === "focus") return "专注";
	if (phase === "break") return "短休息";
	return "长休息";
}

function fmt(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const mm = Math.floor(safe / 60)
		.toString()
		.padStart(2, "0");
	const ss = Math.floor(safe % 60)
		.toString()
		.padStart(2, "0");
	return `${mm}:${ss}`;
}

export default function pomodoroHealthExtension(pi: ExtensionAPI) {
	let state: PomodoroState = defaultState();
	let timer: NodeJS.Timeout | undefined;

	function clearTimer() {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	}

	function persistState() {
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
	}

	function setStatus(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;

		if (state.runState === "idle") {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "🍅 idle（/pomo start）"));
			return;
		}

		let leftSeconds = state.remainingSeconds ?? 0;
		if (state.runState === "running" && state.phaseEndsAt) {
			leftSeconds = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
		}

		const icon = state.runState === "paused" ? "⏸" : "🍅";
		const label = phaseLabel(state.phase);
		const text = `${icon} ${label} ${fmt(leftSeconds)}  #${state.completedFocusCount}`;
		ctx.ui.setStatus(STATUS_KEY, theme.fg("accent", text));
	}

	function notify(ctx: ExtensionContext, title: string, message: string, level: "info" | "warning" = "info") {
		if (!ctx.hasUI) return;
		ctx.ui.notify(`${title}：${message}`, level);
	}

	function transitionPhase(ctx: ExtensionContext) {
		if (state.phase === "focus") {
			state.completedFocusCount += 1;
			const isLongBreak = state.completedFocusCount % state.longBreakEvery === 0;
			state.phase = isLongBreak ? "longBreak" : "break";
			notify(ctx, "⏰ 番茄结束", "起来活动肩颈和腰背，离屏休息一下", "warning");
		} else {
			state.phase = "focus";
			notify(ctx, "✅ 休息结束", "回到专注，记得坐姿放松", "info");
		}

		const duration = phaseDurationSeconds(state);
		state.phaseEndsAt = Date.now() + duration * 1000;
		state.remainingSeconds = duration;
		persistState();
		setStatus(ctx);
	}

	function runHealthReminders(ctx: ExtensionContext) {
		const now = Date.now();
		if (!state.lastEyeReminderAt || now - state.lastEyeReminderAt >= EYE_REMINDER_MS) {
			state.lastEyeReminderAt = now;
			notify(ctx, "👀 眼睛休息", "看向 20 英尺外 20 秒，顺便多眨眼", "info");
			persistState();
		}
		if (!state.lastPostureReminderAt || now - state.lastPostureReminderAt >= POSTURE_REMINDER_MS) {
			state.lastPostureReminderAt = now;
			notify(ctx, "🧍 姿势提醒", "站起来 1-2 分钟，转转颈肩和髋部", "warning");
			persistState();
		}
	}

	function tick(ctx: ExtensionContext) {
		if (state.runState !== "running") {
			setStatus(ctx);
			return;
		}

		runHealthReminders(ctx);

		if (state.phaseEndsAt) {
			const left = Math.ceil((state.phaseEndsAt - Date.now()) / 1000);
			state.remainingSeconds = Math.max(0, left);
			if (left <= 0) {
				transitionPhase(ctx);
			}
		}

		setStatus(ctx);
	}

	function ensureRunningTimer(ctx: ExtensionContext) {
		clearTimer();
		timer = setInterval(() => tick(ctx), TICK_MS);
	}

	function hydrateFromSession(ctx: ExtensionContext) {
		const entries = ctx.sessionManager.getEntries();
		const latest = [...entries]
			.reverse()
			.find((entry: any) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE);
		if (latest?.data) {
			state = { ...defaultState(), ...latest.data };
		}

		if (state.runState === "running") {
			if (!state.phaseEndsAt && typeof state.remainingSeconds === "number") {
				state.phaseEndsAt = Date.now() + state.remainingSeconds * 1000;
			}
			ensureRunningTimer(ctx);
		}

		setStatus(ctx);
	}

	function startCommand(ctx: ExtensionCommandContext, maybeDurations?: string) {
		const next = defaultState();
		if (maybeDurations) {
			const match = maybeDurations.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
			if (match) {
				next.focusMinutes = Number.parseInt(match[1], 10);
				next.breakMinutes = Number.parseInt(match[2], 10);
			}
		}
		state = next;
		state.runState = "running";
		state.phase = "focus";
		state.remainingSeconds = state.focusMinutes * 60;
		state.phaseEndsAt = Date.now() + state.remainingSeconds * 1000;
		state.lastEyeReminderAt = Date.now();
		state.lastPostureReminderAt = Date.now();
		persistState();
		ensureRunningTimer(ctx);
		setStatus(ctx);
		notify(ctx, "🍅 开始专注", `本轮 ${state.focusMinutes} 分钟`, "info");
	}

	pi.on("session_start", async (_event, ctx) => {
		hydrateFromSession(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		clearTimer();
		hydrateFromSession(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
	});

	pi.registerCommand("pomo", {
		description: "Pomodoro: /pomo start [25/5] | pause | resume | stop | status",
		handler: async (args, ctx) => {
			const raw = (args ?? "").trim();
			const [action, ...rest] = raw.split(/\s+/).filter(Boolean);
			const tail = rest.join(" ");

			switch (action) {
				case "start": {
					startCommand(ctx, tail || undefined);
					return;
				}
				case "pause": {
					if (state.runState !== "running") {
						notify(ctx, "ℹ️ 提示", "当前不在运行中", "info");
						return;
					}
					state.runState = "paused";
					if (state.phaseEndsAt) {
						state.remainingSeconds = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
					}
					state.phaseEndsAt = undefined;
					persistState();
					setStatus(ctx);
					notify(ctx, "⏸ 已暂停", "番茄钟已暂停", "info");
					return;
				}
				case "resume": {
					if (state.runState !== "paused") {
						notify(ctx, "ℹ️ 提示", "当前不是暂停状态", "info");
						return;
					}
					state.runState = "running";
					const seconds = state.remainingSeconds ?? phaseDurationSeconds(state);
					state.phaseEndsAt = Date.now() + seconds * 1000;
					persistState();
					ensureRunningTimer(ctx);
					setStatus(ctx);
					notify(ctx, "▶️ 已继续", "番茄钟继续运行", "info");
					return;
				}
				case "stop": {
					clearTimer();
					state.runState = "idle";
					state.phaseEndsAt = undefined;
					state.remainingSeconds = undefined;
					persistState();
					setStatus(ctx);
					notify(ctx, "🛑 已停止", "番茄钟已停止", "info");
					return;
				}
				case "status":
				case undefined: {
					setStatus(ctx);
					const left =
						state.runState === "running" && state.phaseEndsAt
							? Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000))
							: (state.remainingSeconds ?? 0);
					notify(
						ctx,
						"📊 当前状态",
						`状态: ${state.runState} | 阶段: ${phaseLabel(state.phase)} | 剩余: ${fmt(left)} | 已完成专注: ${state.completedFocusCount}`,
						"info",
					);
					return;
				}
				default: {
					notify(ctx, "⚠️ 用法", "/pomo start [25/5] | pause | resume | stop | status", "warning");
				}
			}
		},
	});

	pi.registerCommand("eye", {
		description: "Trigger eye-rest reminder now",
		handler: async (_args, ctx) => {
			state.lastEyeReminderAt = Date.now();
			persistState();
			notify(ctx, "👀 眼睛休息", "看向远处 20 秒，放松睫状肌", "info");
		},
	});

	pi.registerCommand("posture", {
		description: "Trigger posture reminder now",
		handler: async (_args, ctx) => {
			state.lastPostureReminderAt = Date.now();
			persistState();
			notify(ctx, "🧍 颈腰放松", "站起来走走，做 1 分钟拉伸", "warning");
		},
	});
}
