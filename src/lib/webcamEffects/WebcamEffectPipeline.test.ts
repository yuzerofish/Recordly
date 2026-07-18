import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_EFFECT_SETTINGS } from "@/components/video-editor/types";
import type { SegmentationWorkerRequest, SegmentationWorkerResponse } from "./messages";
import { WebcamEffectPipeline } from "./WebcamEffectPipeline";

class FakeWorker {
	onmessage: ((event: MessageEvent<SegmentationWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: SegmentationWorkerRequest[] = [];
	terminated = false;
	autoInitialize = true;
	autoSegment = true;
	failSegments = false;

	postMessage(message: SegmentationWorkerRequest) {
		this.messages.push(message);
		if (message.type === "initialize" && this.autoInitialize) {
			queueMicrotask(() =>
				this.onmessage?.({ data: { type: "ready", delegate: "GPU" } } as MessageEvent),
			);
		}
		if (message.type === "segment") {
			if (!this.autoSegment) return;
			if (this.failSegments) {
				queueMicrotask(() =>
					this.onmessage?.({
						data: {
							type: "error",
							requestId: message.requestId,
							message: "segmentation failed",
						},
					} as MessageEvent),
				);
				return;
			}
			queueMicrotask(() => this.resolveSegment(message.requestId, message.timestampMs));
		}
	}

	resolveSegment(requestId: number, timestampMs: number) {
		this.onmessage?.({
			data: {
				type: "result",
				requestId,
				mask: {
					data: new Float32Array([1]),
					width: 1,
					height: 1,
					timestampMs,
				},
			},
		} as MessageEvent);
	}

	terminate() {
		this.terminated = true;
	}
}

function createHarness() {
	const worker = new FakeWorker();
	const output = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
	const compositor = {
		compose: vi.fn(() => output),
		getCanvas: vi.fn(() => output),
	};
	const bitmap = {
		width: 256,
		height: 256,
		close: vi.fn(),
	} as unknown as ImageBitmap;
	const createBitmap = vi.fn(async () => bitmap);
	const pipeline = new WebcamEffectPipeline({
		workerFactory: () => worker as unknown as Worker,
		createImageBitmap: createBitmap as unknown as typeof createImageBitmap,
		assetBaseUrl: "http://127.0.0.1/mediapipe/",
		compositor,
	});
	return { worker, compositor, createBitmap, pipeline, output };
}

const source = { width: 640, height: 360 } as unknown as CanvasImageSource;
const silhouette = { ...DEFAULT_WEBCAM_EFFECT_SETTINGS, type: "silhouette" as const };

describe("WebcamEffectPipeline", () => {
	it("does not initialize segmentation when the effect is disabled", async () => {
		const harness = createHarness();
		const result = await harness.pipeline.processFrame({
			source,
			timestampMs: 0,
			settings: DEFAULT_WEBCAM_EFFECT_SETTINGS,
			mode: "preview",
		});

		expect(result).toMatchObject({ source, processed: false, status: "idle" });
		expect(harness.worker.messages).toHaveLength(0);
		expect(harness.createBitmap).not.toHaveBeenCalled();
	});

	it("uses deterministic source timestamps and reuses an exact cached mask", async () => {
		const harness = createHarness();
		const first = await harness.pipeline.processFrame({
			source,
			timestampMs: 1250,
			settings: silhouette,
			mode: "export",
		});
		const second = await harness.pipeline.processFrame({
			source,
			timestampMs: 1250,
			settings: silhouette,
			mode: "export",
		});

		expect(first).toMatchObject({ processed: true, source: harness.output });
		expect(second).toMatchObject({ processed: true, source: harness.output });
		const segments = harness.worker.messages.filter((message) => message.type === "segment");
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({ timestampMs: 1250, discontinuity: false });
		expect(harness.compositor.compose).toHaveBeenCalledTimes(2);
	});

	it("marks backwards export timestamps as a discontinuity", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 2000,
			settings: silhouette,
			mode: "export",
		});
		await harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "export",
		});

		const segments = harness.worker.messages.filter((message) => message.type === "segment");
		expect(segments[1]).toMatchObject({ timestampMs: 1000, discontinuity: true });
	});

	it("waits for a fresh preview mask after a paused seek discontinuity", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "preview",
		});
		harness.worker.autoSegment = false;

		let settled = false;
		const seekRender = harness.pipeline
			.processFrame({
				source,
				timestampMs: 5000,
				settings: silhouette,
				mode: "preview",
				discontinuity: true,
			})
			.finally(() => {
				settled = true;
			});
		await vi.waitFor(() => {
			const segments = harness.worker.messages.filter(
				(message) => message.type === "segment",
			);
			expect(segments).toHaveLength(2);
			expect(segments[1]).toMatchObject({ timestampMs: 5000, discontinuity: true });
		});

		expect(settled).toBe(false);
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
		const seekRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 5000,
		);
		if (!seekRequest || seekRequest.type !== "segment") {
			throw new Error("Expected a segmentation request for the seek target");
		}
		harness.worker.resolveSegment(seekRequest.requestId, 5000);

		await expect(seekRender).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(harness.compositor.compose).toHaveBeenCalledTimes(2);
		expect(harness.compositor.compose.mock.calls[1]?.[1]).toMatchObject({
			timestampMs: 5000,
		});
	});

	it("serializes rapid seeks so each processed frame uses its own mask", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		const firstSource = {
			width: 640,
			height: 360,
			id: "first-seek",
		} as unknown as CanvasImageSource;
		const finalSource = {
			width: 640,
			height: 360,
			id: "final-seek",
		} as unknown as CanvasImageSource;

		const firstSeek = harness.pipeline.processFrame({
			source: firstSource,
			timestampMs: 2000,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});
		const finalSeek = harness.pipeline.processFrame({
			source: finalSource,
			timestampMs: 8000,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});

		await vi.waitFor(() => {
			const segments = harness.worker.messages.filter(
				(message) => message.type === "segment",
			);
			expect(segments).toHaveLength(1);
			expect(segments[0]).toMatchObject({ timestampMs: 2000, discontinuity: true });
		});
		const firstRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 2000,
		);
		if (!firstRequest || firstRequest.type !== "segment") {
			throw new Error("Expected the first seek request");
		}
		harness.worker.resolveSegment(firstRequest.requestId, 2000);

		await vi.waitFor(() => {
			const segments = harness.worker.messages.filter(
				(message) => message.type === "segment",
			);
			expect(segments).toHaveLength(2);
			expect(segments[1]).toMatchObject({ timestampMs: 8000, discontinuity: true });
		});
		const finalRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 8000,
		);
		if (!finalRequest || finalRequest.type !== "segment") {
			throw new Error("Expected the final seek request");
		}
		harness.worker.resolveSegment(finalRequest.requestId, 8000);

		await expect(firstSeek).resolves.toMatchObject({ processed: true, status: "ready" });
		await expect(finalSeek).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(harness.compositor.compose.mock.calls[0]?.[0]).toBe(firstSource);
		expect(harness.compositor.compose.mock.calls[0]?.[1]).toMatchObject({ timestampMs: 2000 });
		expect(harness.compositor.compose.mock.calls[1]?.[0]).toBe(finalSource);
		expect(harness.compositor.compose.mock.calls[1]?.[1]).toMatchObject({ timestampMs: 8000 });
	});

	it("returns the raw frame instead of reusing a stale mask after inference fails", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "export",
		});
		harness.worker.failSegments = true;

		const failed = await harness.pipeline.processFrame({
			source,
			timestampMs: 2000,
			settings: silhouette,
			mode: "export",
		});

		expect(failed).toMatchObject({
			source,
			processed: false,
			status: "fallback",
			error: "segmentation failed",
		});
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
	});

	it("settles an initialization request when disposed before the worker is ready", async () => {
		const harness = createHarness();
		harness.worker.autoInitialize = false;
		const pending = harness.pipeline.processFrame({
			source,
			timestampMs: 0,
			settings: silhouette,
			mode: "export",
		});
		await vi.waitFor(() => {
			expect(harness.worker.messages[0]).toMatchObject({ type: "initialize" });
		});

		harness.pipeline.dispose();

		await expect(pending).resolves.toMatchObject({
			source,
			processed: false,
			status: "fallback",
			error: "Webcam effect pipeline was disposed",
		});
		expect(harness.worker.terminated).toBe(true);
	});

	it("terminates the worker and rejects further work after disposal", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 0,
			settings: silhouette,
			mode: "export",
		});
		harness.pipeline.dispose();

		expect(harness.worker.terminated).toBe(true);
		expect(
			await harness.pipeline.processFrame({
				source,
				timestampMs: 1,
				settings: silhouette,
				mode: "export",
			}),
		).toMatchObject({ processed: false, status: "fallback" });
	});
});
