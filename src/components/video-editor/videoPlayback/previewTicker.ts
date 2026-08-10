export interface PreviewTicker {
	started: boolean;
	start(): void;
	stop(): void;
	update(currentTime?: number): void;
}

export interface PreviewTickerState {
	isPlaying: boolean;
	suspendRendering: boolean;
}

export function syncPreviewTickerState(
	ticker: PreviewTicker,
	{ isPlaying, suspendRendering }: PreviewTickerState,
): "running" | "paused" | "suspended" {
	if (isPlaying && !suspendRendering) {
		if (!ticker.started) {
			ticker.start();
		}
		return "running";
	}

	if (ticker.started) {
		ticker.stop();
	}
	return suspendRendering ? "suspended" : "paused";
}

export function renderPausedPreviewFrame(
	ticker: PreviewTicker,
	state: PreviewTickerState,
	currentTime: number,
): boolean {
	if (state.isPlaying || state.suspendRendering) {
		return false;
	}

	ticker.update(currentTime);
	return true;
}
