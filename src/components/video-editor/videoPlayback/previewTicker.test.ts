import { describe, expect, it, vi } from "vitest";
import {
	type PreviewTicker,
	renderPausedPreviewFrame,
	syncPreviewTickerState,
} from "./previewTicker";

function createTicker(started = false): PreviewTicker {
	return {
		started,
		start: vi.fn(function (this: PreviewTicker) {
			this.started = true;
		}),
		stop: vi.fn(function (this: PreviewTicker) {
			this.started = false;
		}),
		update: vi.fn(),
	};
}

describe("syncPreviewTickerState", () => {
	it("runs continuously only during active playback", () => {
		const ticker = createTicker();

		expect(
			syncPreviewTickerState(ticker, {
				isPlaying: true,
				suspendRendering: false,
			}),
		).toBe("running");
		expect(ticker.start).toHaveBeenCalledTimes(1);
		expect(ticker.started).toBe(true);
	});

	it("stops the continuous ticker when playback is paused", () => {
		const ticker = createTicker(true);

		expect(
			syncPreviewTickerState(ticker, {
				isPlaying: false,
				suspendRendering: false,
			}),
		).toBe("paused");
		expect(ticker.stop).toHaveBeenCalledTimes(1);
		expect(ticker.started).toBe(false);
	});

	it("keeps rendering stopped while the preview is suspended", () => {
		const ticker = createTicker(true);

		expect(
			syncPreviewTickerState(ticker, {
				isPlaying: true,
				suspendRendering: true,
			}),
		).toBe("suspended");
		expect(ticker.stop).toHaveBeenCalledTimes(1);
	});
});

describe("renderPausedPreviewFrame", () => {
	it("updates one frame while paused so editor changes remain visible", () => {
		const ticker = createTicker();

		expect(
			renderPausedPreviewFrame(ticker, { isPlaying: false, suspendRendering: false }, 123),
		).toBe(true);
		expect(ticker.update).toHaveBeenCalledWith(123);
	});

	it("does not add manual frames during playback or suspension", () => {
		const ticker = createTicker();

		expect(
			renderPausedPreviewFrame(ticker, { isPlaying: true, suspendRendering: false }, 123),
		).toBe(false);
		expect(
			renderPausedPreviewFrame(ticker, { isPlaying: false, suspendRendering: true }, 456),
		).toBe(false);
		expect(ticker.update).not.toHaveBeenCalled();
	});
});
