import { describe, expect, it, vi } from "vitest";
import { createWebcamEffectFrameLoop, type WebcamEffectFrameVideo } from "./webcamEffectFrameLoop";

type PresentedFrameCallback = (now: DOMHighResTimeStamp, metadata: { mediaTime?: number }) => void;

class MockWebcamVideo implements WebcamEffectFrameVideo {
	paused = true;
	ended = false;
	ignoreCancellation = false;
	private nextFrameId = 1;
	private readonly frameCallbacks = new Map<number, PresentedFrameCallback>();
	private readonly listeners = new Map<"play" | "pause", Set<() => void>>();

	readonly requestVideoFrameCallback = vi.fn((callback: PresentedFrameCallback) => {
		const handle = this.nextFrameId++;
		this.frameCallbacks.set(handle, callback);
		return handle;
	});

	readonly cancelVideoFrameCallback = vi.fn((handle: number) => {
		if (!this.ignoreCancellation) this.frameCallbacks.delete(handle);
	});

	addEventListener(type: "play" | "pause", listener: () => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: "play" | "pause", listener: () => void) {
		this.listeners.get(type)?.delete(listener);
	}

	dispatch(type: "play" | "pause") {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}

	present(mediaTime: number) {
		const next = this.frameCallbacks.entries().next().value as
			| [number, PresentedFrameCallback]
			| undefined;
		if (!next) return;
		const [handle, callback] = next;
		this.frameCallbacks.delete(handle);
		callback(0, { mediaTime });
	}

	get pendingFrameCount() {
		return this.frameCallbacks.size;
	}
}

async function flushAsyncWork() {
	await Promise.resolve();
	await Promise.resolve();
}

const requestAnimationFrameStub = (_callback: FrameRequestCallback) => 1;
const cancelAnimationFrameStub = (_handle: number) => undefined;

describe("createWebcamEffectFrameLoop", () => {
	it("attaches when the conditional webcam video mounts after the loop starts", async () => {
		const video = new MockWebcamVideo();
		let mountedVideo: MockWebcamVideo | null = null;
		const renderFrame = vi.fn(async (_presentedTimestampMs?: number) => undefined);
		const loop = createWebcamEffectFrameLoop({
			getVideo: () => mountedVideo,
			renderFrame,
			requestAnimationFrame: requestAnimationFrameStub,
			cancelAnimationFrame: cancelAnimationFrameStub,
		});

		loop.start();
		await flushAsyncWork();
		expect(renderFrame).not.toHaveBeenCalled();

		mountedVideo = video;
		loop.refresh();
		await flushAsyncWork();

		expect(renderFrame).toHaveBeenCalledTimes(1);
		expect(video.pendingFrameCount).toBe(1);

		mountedVideo = null;
		loop.refresh();
		expect(video.pendingFrameCount).toBe(0);
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledTimes(1);
	});

	it("ignores a late callback from a replaced webcam video", async () => {
		const firstVideo = new MockWebcamVideo();
		firstVideo.ignoreCancellation = true;
		const secondVideo = new MockWebcamVideo();
		let mountedVideo: MockWebcamVideo | null = firstVideo;
		const renderFrame = vi.fn(async (_presentedTimestampMs?: number) => undefined);
		const loop = createWebcamEffectFrameLoop({
			getVideo: () => mountedVideo,
			renderFrame,
			requestAnimationFrame: requestAnimationFrameStub,
			cancelAnimationFrame: cancelAnimationFrameStub,
		});

		loop.start();
		await flushAsyncWork();
		expect(firstVideo.pendingFrameCount).toBe(1);

		mountedVideo = secondVideo;
		loop.refresh();
		await flushAsyncWork();
		expect(secondVideo.pendingFrameCount).toBe(1);
		expect(renderFrame).toHaveBeenCalledTimes(2);

		firstVideo.present(2);
		await flushAsyncWork();
		expect(renderFrame).toHaveBeenCalledTimes(2);

		secondVideo.present(2.5);
		await flushAsyncWork();
		expect(renderFrame).toHaveBeenLastCalledWith(2500);
		expect(secondVideo.pendingFrameCount).toBe(1);
	});

	it("keeps a presented-frame callback armed while initially paused", async () => {
		const video = new MockWebcamVideo();
		const renderFrame = vi.fn(async (_presentedTimestampMs?: number) => undefined);
		const loop = createWebcamEffectFrameLoop({
			getVideo: () => video,
			renderFrame,
			requestAnimationFrame: requestAnimationFrameStub,
			cancelAnimationFrame: cancelAnimationFrameStub,
		});

		loop.start();
		await flushAsyncWork();

		expect(renderFrame).toHaveBeenCalledTimes(1);
		expect(renderFrame).toHaveBeenLastCalledWith(undefined);
		expect(video.pendingFrameCount).toBe(1);

		// Chromium may not deliver a separate play event after media synchronization.
		// A pending rVFC must still wake when the next frame is presented.
		video.paused = false;
		video.present(1.25);
		await flushAsyncWork();

		expect(renderFrame).toHaveBeenLastCalledWith(1250);
		expect(video.pendingFrameCount).toBe(1);
	});

	it("keeps one rVFC across pause and resume without duplicate callbacks", async () => {
		const video = new MockWebcamVideo();
		video.paused = false;
		const renderFrame = vi.fn(async (_presentedTimestampMs?: number) => undefined);
		const loop = createWebcamEffectFrameLoop({
			getVideo: () => video,
			renderFrame,
			requestAnimationFrame: requestAnimationFrameStub,
			cancelAnimationFrame: cancelAnimationFrameStub,
		});

		loop.start();
		await flushAsyncWork();
		expect(video.pendingFrameCount).toBe(1);

		video.dispatch("play");
		video.dispatch("play");
		expect(video.pendingFrameCount).toBe(1);

		video.paused = true;
		video.dispatch("pause");
		expect(video.pendingFrameCount).toBe(1);
		expect(video.cancelVideoFrameCallback).not.toHaveBeenCalled();

		video.paused = false;
		video.dispatch("play");
		expect(video.pendingFrameCount).toBe(1);

		video.present(2.5);
		await flushAsyncWork();
		expect(renderFrame).toHaveBeenLastCalledWith(2500);
	});

	it("stops the RAF fallback while paused and restarts it on play", async () => {
		const video = new MockWebcamVideo();
		video.requestVideoFrameCallback = undefined as never;
		video.cancelVideoFrameCallback = undefined as never;
		const animationCallbacks = new Map<number, FrameRequestCallback>();
		let nextAnimationId = 1;
		const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
			const handle = nextAnimationId++;
			animationCallbacks.set(handle, callback);
			return handle;
		});
		const cancelAnimationFrame = vi.fn((handle: number) => {
			animationCallbacks.delete(handle);
		});
		const renderFrame = vi.fn(async (_presentedTimestampMs?: number) => undefined);
		const loop = createWebcamEffectFrameLoop({
			getVideo: () => video,
			renderFrame,
			requestAnimationFrame,
			cancelAnimationFrame,
		});

		loop.start();
		await flushAsyncWork();
		expect(requestAnimationFrame).not.toHaveBeenCalled();

		video.paused = false;
		video.dispatch("play");
		expect(animationCallbacks.size).toBe(1);

		const [handle, callback] = animationCallbacks.entries().next().value as [
			number,
			FrameRequestCallback,
		];
		animationCallbacks.delete(handle);
		callback(0);
		await flushAsyncWork();
		expect(renderFrame).toHaveBeenCalledTimes(2);
		expect(animationCallbacks.size).toBe(1);

		video.paused = true;
		video.dispatch("pause");
		expect(animationCallbacks.size).toBe(0);
		expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
	});
});
