import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const BREAK_OVERLAY_ENABLED = true;
const BREAK_OVERLAY_MAX_SECONDS = 2 * 60 * 60;

function defaultState(): PomodoroState {
	return {
		runState: "idle",
		phase: "focus",
		focusMinutes: 25,
		breakMinutes: 3,
		longBreakMinutes: 3,
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

const BREAK_OVERLAY_JXA_SCRIPT = `
ObjC.import('Cocoa')

function fmt(seconds) {
	const safe = Math.max(0, seconds)
	const mm = String(Math.floor(safe / 60)).padStart(2, '0')
	const ss = String(Math.floor(safe % 60)).padStart(2, '0')
	return mm + ':' + ss
}

const env = $.NSProcessInfo.processInfo.environment
const envSeconds = env.objectForKey('PI_BREAK_OVERLAY_SECONDS')
const rawSeconds = envSeconds ? ObjC.unwrap(envSeconds) : '300'
const duration = Math.max(1, parseInt(rawSeconds, 10) || 300)

ObjC.registerSubclass({
	name: 'PomoOverlayWindow',
	superclass: 'NSWindow',
	methods: {
		'canBecomeKeyWindow': {
			types: ['B', []],
			implementation: function () {
				return true
			}
		},
		'canBecomeMainWindow': {
			types: ['B', []],
			implementation: function () {
				return true
			}
		}
	}
})

ObjC.registerSubclass({
	name: 'PomoEscapeView',
	superclass: 'NSView',
	methods: {
		'acceptsFirstResponder': {
			types: ['B', []],
			implementation: function () {
				return true
			}
		},
		'becomeFirstResponder': {
			types: ['B', []],
			implementation: function () {
				return true
			}
		},
		'cancelOperation:': {
			types: ['v', ['@']],
			implementation: function (_sender) {
				$.NSApplication.sharedApplication.terminate(null)
			}
		},
		'keyDown:': {
			types: ['v', ['@']],
			implementation: function (event) {
				try {
					const keyCode = typeof event.keyCode === 'function' ? Number(event.keyCode()) : Number(event.keyCode)
					if (keyCode === 53) {
						$.NSApplication.sharedApplication.terminate(null)
						return
					}
				} catch (_) {}
			}
		}
	}
})

const app = $.NSApplication.sharedApplication
app.setActivationPolicy($.NSApplicationActivationPolicyRegular)

const windows = []
const timerLabels = []
const responderViews = []
let remaining = duration

const screens = $.NSScreen.screens
const screenCount = screens.count

for (let i = 0; i < screenCount; i++) {
	const screen = screens.objectAtIndex(i)
	const frame = screen.frame
	const window = $.PomoOverlayWindow.alloc.initWithContentRectStyleMaskBackingDefer(
		frame,
		$.NSWindowStyleMaskBorderless,
		$.NSBackingStoreBuffered,
		false
	)

	window.setLevel($.NSScreenSaverWindowLevel)
	window.setOpaque(false)
	window.setBackgroundColor($.NSColor.colorWithCalibratedWhiteAlpha(0.0, 0.9))
	window.setIgnoresMouseEvents(false)
	window.setCollectionBehavior(
		$.NSWindowCollectionBehaviorCanJoinAllSpaces |
		$.NSWindowCollectionBehaviorFullScreenAuxiliary |
		$.NSWindowCollectionBehaviorStationary |
		$.NSWindowCollectionBehaviorIgnoresCycle
	)
	window.makeKeyAndOrderFront(null)
	window.orderFront(null)

	const content = window.contentView
	const width = frame.size.width
	const midY = frame.size.height / 2
	const autoMask = $.NSViewWidthSizable | $.NSViewMinYMargin | $.NSViewMaxYMargin

	const escapeView = $.PomoEscapeView.alloc.initWithFrame(content.bounds)
	escapeView.setAutoresizingMask($.NSViewWidthSizable | $.NSViewHeightSizable)
	content.addSubview(escapeView)
	responderViews.push(escapeView)

	const title = $.NSTextField.labelWithString('🍅 休息时间')
	title.setFont($.NSFont.systemFontOfSizeWeight(42, $.NSFontWeightBold))
	title.setTextColor($.NSColor.whiteColor)
	title.setAlignment($.NSTextAlignmentCenter)
	title.setFrame($.NSMakeRect(0, midY + 40, width, 56))
	title.setAutoresizingMask(autoMask)
	content.addSubview(title)

	const timerLabel = $.NSTextField.labelWithString('')
	timerLabel.setFont($.NSFont.monospacedDigitSystemFontOfSizeWeight(72, $.NSFontWeightSemibold))
	timerLabel.setTextColor($.NSColor.whiteColor)
	timerLabel.setAlignment($.NSTextAlignmentCenter)
	timerLabel.setFrame($.NSMakeRect(0, midY - 40, width, 88))
	timerLabel.setAutoresizingMask(autoMask)
	content.addSubview(timerLabel)
	timerLabels.push(timerLabel)

	const hint = $.NSTextField.labelWithString('请离开屏幕，活动颈肩和腰背（按 Esc 退出）')
	hint.setFont($.NSFont.systemFontOfSizeWeight(24, $.NSFontWeightRegular))
	hint.setTextColor($.NSColor.colorWithCalibratedWhiteAlpha(1.0, 0.9))
	hint.setAlignment($.NSTextAlignmentCenter)
	hint.setFrame($.NSMakeRect(0, midY - 100, width, 36))
	hint.setAutoresizingMask(autoMask)
	content.addSubview(hint)

	window.makeFirstResponder(escapeView)
	window.setInitialFirstResponder(escapeView)
	windows.push(window)
}

function updateLabels() {
	const text = fmt(remaining)
	for (let i = 0; i < timerLabels.length; i++) {
		timerLabels[i].setStringValue(text)
	}
}

function focusResponderViews() {
	for (let i = 0; i < windows.length; i++) {
		windows[i].makeKeyAndOrderFront(null)
		windows[i].makeFirstResponder(responderViews[i])
	}
}

updateLabels()
app.activateIgnoringOtherApps(true)
focusResponderViews()

$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.2, true, () => {
	focusResponderViews()
})

$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1.0, true, () => {
	remaining -= 1
	if (remaining <= 0) {
		app.terminate(null)
		return
	}
	updateLabels()
})

app.run
`;

const BREAK_OVERLAY_SCRIPT_NAME = "break-overlay.jxa.js";
const BREAK_OVERLAY_DIR_PREFIX = "pi-pomo-overlay-";
const BREAK_OVERLAY_MIN_SECONDS = 10;
const BREAK_OVERLAY_DEFAULT_SECONDS = 300;

const BREAK_OVERLAY_CONTEXT = {
	cachedPath: undefined as string | undefined,
};

function ensureBreakOverlayScriptPath(): string {
	const cached = BREAK_OVERLAY_CONTEXT.cachedPath;
	if (cached && existsSync(cached)) return cached;

	const dir = mkdtempSync(join(tmpdir(), BREAK_OVERLAY_DIR_PREFIX));
	const scriptPath = join(dir, BREAK_OVERLAY_SCRIPT_NAME);
	writeFileSync(scriptPath, BREAK_OVERLAY_JXA_SCRIPT, "utf8");
	BREAK_OVERLAY_CONTEXT.cachedPath = scriptPath;
	return scriptPath;
}

export default function pomodoroHealthExtension(pi: ExtensionAPI) {
	let state: PomodoroState = defaultState();
	let timer: NodeJS.Timeout | undefined;
	let overlayPid: number | undefined;

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

	function dismissBreakOverlay() {
		if (!overlayPid) return;
		try {
			process.kill(overlayPid, "SIGTERM");
		} catch {
			// ignore
		}
		overlayPid = undefined;
	}

	function showBreakOverlay(ctx: ExtensionContext, _phase: "break" | "longBreak", durationSeconds: number) {
		if (!BREAK_OVERLAY_ENABLED) return;
		if (process.platform !== "darwin") return;

		const timeoutSeconds = Math.max(BREAK_OVERLAY_MIN_SECONDS, Math.min(BREAK_OVERLAY_MAX_SECONDS, Math.floor(durationSeconds)));
		const scriptPath = ensureBreakOverlayScriptPath();

		dismissBreakOverlay();

		try {
			const child = spawn("osascript", ["-l", "JavaScript", scriptPath], {
				detached: true,
				stdio: "ignore",
				env: {
					...process.env,
					PI_BREAK_OVERLAY_SECONDS: String(timeoutSeconds || BREAK_OVERLAY_DEFAULT_SECONDS),
				},
			});
			overlayPid = child.pid;
			child.on("exit", () => {
				if (overlayPid === child.pid) {
					overlayPid = undefined;
				}
			});
			child.unref();
		} catch {
			notify(ctx, "⚠️ 休息提醒失败", "无法启动全屏休息蒙层，请检查 macOS 自动化权限", "warning");
		}
	}

	function transitionPhase(ctx: ExtensionContext) {
		let enteredBreak = false;

		if (state.phase === "focus") {
			state.completedFocusCount += 1;
			const isLongBreak = state.completedFocusCount % state.longBreakEvery === 0;
			state.phase = isLongBreak ? "longBreak" : "break";
			enteredBreak = true;
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

		if (enteredBreak) {
			showBreakOverlay(ctx, state.phase === "longBreak" ? "longBreak" : "break", duration);
		}
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
		dismissBreakOverlay();
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
		dismissBreakOverlay();
		hydrateFromSession(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearTimer();
		dismissBreakOverlay();
	});

	pi.registerCommand("pomo", {
		description: "Pomodoro: /pomo start [25/3] | pause | resume | stop | status | overlay",
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
					dismissBreakOverlay();
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
					dismissBreakOverlay();
					setStatus(ctx);
					notify(ctx, "🛑 已停止", "番茄钟已停止", "info");
					return;
				}
				case "overlay": {
					const previewPhase: "break" | "longBreak" = state.phase === "longBreak" ? "longBreak" : "break";
					const previewSeconds = 20;
					showBreakOverlay(ctx, previewPhase, previewSeconds);
					notify(ctx, "🧪 预览提醒", "已启动 20 秒测试蒙层", "info");
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
					notify(ctx, "⚠️ 用法", "/pomo start [25/3] | pause | resume | stop | status | overlay", "warning");
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
