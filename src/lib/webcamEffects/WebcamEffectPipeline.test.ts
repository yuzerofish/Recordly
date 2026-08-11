import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WEBCAM_EFFECT_SETTINGS } from "@/components/video-editor/types";
import type {
	CartoonFaceGeometry,
	FaceLandmarkerWorkerRequest,
	FaceLandmarkerWorkerResponse,
	SegmentationWorkerRequest,
	SegmentationWorkerResponse,
} from "./messages";
import { WebcamEffectPipeline } from "./WebcamEffectPipeline";

class FakeWorker {
	onmessage: ((event: MessageEvent<SegmentationWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: SegmentationWorkerRequest[] = [];
	terminated = false;
	autoInitialize = true;
	autoSegment = true;
	failSegments = false;
	maskData = new Float32Array([1]);
	maskWidth = 1;
	maskHeight = 1;

	postMessage(message: SegmentationWorkerRequest) {
		this.messages.push(message);
		if (message.type === "initialize" && this.autoInitialize) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: { type: "ready", delegate: "GPU" },
				} as MessageEvent),
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

	resolveSegment(
		requestId: number,
		timestampMs: number,
		data = this.maskData,
		width = this.maskWidth,
		height = this.maskHeight,
	) {
		this.onmessage?.({
			data: {
				type: "result",
				requestId,
				mask: {
					data: new Float32Array(data),
					width,
					height,
					timestampMs,
				},
			},
		} as MessageEvent);
	}

	terminate() {
		this.terminated = true;
	}
}

class FakeFaceWorker {
	onmessage: ((event: MessageEvent<FaceLandmarkerWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly messages: FaceLandmarkerWorkerRequest[] = [];
	terminated = false;
	autoInitialize = true;
	failInitialization = false;
	autoTrack = true;
	crashOnTrack = false;
	failTracks = false;
	face: CartoonFaceGeometry | null = null;

	postMessage(message: FaceLandmarkerWorkerRequest) {
		this.messages.push(message);
		if (message.type === "initialize" && this.autoInitialize) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: this.failInitialization
						? { type: "error", message: "face model unavailable" }
						: { type: "ready", delegate: "GPU" },
				} as MessageEvent),
			);
		}
		if (message.type === "track") {
			if (!this.autoTrack) return;
			if (this.crashOnTrack) {
				this.onmessage?.({
					data: { type: "error", message: "face worker crashed" },
				} as MessageEvent);
				return;
			}
			if (this.failTracks) {
				queueMicrotask(() =>
					this.onmessage?.({
						data: {
							type: "error",
							requestId: message.requestId,
							message: "face inference failed",
						},
					} as MessageEvent),
				);
				return;
			}
			queueMicrotask(() => this.resolveTrack(message.requestId, message.timestampMs));
		}
	}

	resolveTrack(requestId: number, timestampMs: number) {
		this.onmessage?.({
			data: {
				type: "result",
				requestId,
				face: this.face ? { ...this.face, timestampMs } : null,
			},
		} as MessageEvent);
	}

	terminate() {
		this.terminated = true;
	}
}

function createHarness() {
	const worker = new FakeWorker();
	const faceWorker = new FakeFaceWorker();
	const output = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
	const compositor = {
		compose: vi.fn(() => output),
		getCanvas: vi.fn(() => output),
	};
	const makeBitmap = () =>
		({
			width: 256,
			height: 256,
			close: vi.fn(),
		}) as unknown as ImageBitmap;
	const bitmap = makeBitmap();
	const bitmaps: ImageBitmap[] = [];
	const createBitmap = vi.fn(async () => {
		const next = bitmaps.length === 0 ? bitmap : makeBitmap();
		bitmaps.push(next);
		return next;
	});
	const pipeline = new WebcamEffectPipeline({
		workerFactory: () => worker as unknown as Worker,
		faceWorkerFactory: () => faceWorker as unknown as Worker,
		createImageBitmap: createBitmap as unknown as typeof createImageBitmap,
		assetBaseUrl: "http://127.0.0.1/mediapipe/",
		compositor,
	});
	return { worker, faceWorker, compositor, createBitmap, pipeline, output, bitmap, bitmaps };
}

const source = { width: 640, height: 360 } as unknown as CanvasImageSource;
const silhouette = { ...DEFAULT_WEBCAM_EFFECT_SETTINGS, type: "silhouette" as const };
const monkey = { ...DEFAULT_WEBCAM_EFFECT_SETTINGS, type: "monkey" as const };
const faceGeometry: CartoonFaceGeometry = {
	timestampMs: 0,
	imageLeftEye: {
		outer: { x: 0.3, y: 0.35 },
		inner: { x: 0.4, y: 0.35 },
		upper: { x: 0.35, y: 0.33 },
		lower: { x: 0.35, y: 0.37 },
		iris: { x: 0.35, y: 0.35 },
	},
	imageRightEye: {
		outer: { x: 0.7, y: 0.35 },
		inner: { x: 0.6, y: 0.35 },
		upper: { x: 0.65, y: 0.33 },
		lower: { x: 0.65, y: 0.37 },
		iris: { x: 0.65, y: 0.35 },
	},
	mouth: {
		left: { x: 0.42, y: 0.55 },
		right: { x: 0.58, y: 0.55 },
		upper: { x: 0.5, y: 0.53 },
		lower: { x: 0.5, y: 0.57 },
	},
	face: {
		left: { x: 0.25, y: 0.45 },
		right: { x: 0.75, y: 0.45 },
		top: { x: 0.5, y: 0.15 },
		bottom: { x: 0.5, y: 0.75 },
	},
};

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
		expect(harness.faceWorker.messages).toHaveLength(0);
		expect(harness.createBitmap).not.toHaveBeenCalled();
	});

	it("runs the monkey effect from face tracking without person segmentation", async () => {
		const harness = createHarness();
		harness.faceWorker.face = faceGeometry;

		const result = await harness.pipeline.processFrame({
			source,
			timestampMs: 120,
			settings: monkey,
			mode: "export",
		});

		expect(result).toMatchObject({ processed: true, source: harness.output });
		expect(harness.worker.messages).toHaveLength(0);
		expect(harness.createBitmap).toHaveBeenCalledTimes(1);
		expect(harness.faceWorker.messages.some((message) => message.type === "track")).toBe(true);
		expect(harness.compositor.compose).toHaveBeenCalledWith(
			source,
			expect.objectContaining({ width: 1, height: 1, timestampMs: 120 }),
			monkey,
			expect.objectContaining({ opacity: 1 }),
		);
	});

	it("adds the cartoon face only while black silhouette mode is active", async () => {
		const harness = createHarness();
		harness.faceWorker.face = faceGeometry;
		await harness.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: DEFAULT_WEBCAM_EFFECT_SETTINGS,
			mode: "preview",
		});
		expect(harness.compositor.compose).not.toHaveBeenCalled();

		await harness.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: silhouette,
			mode: "export",
		});
		expect(harness.compositor.compose).toHaveBeenCalledWith(
			source,
			expect.objectContaining({ timestampMs: 100 }),
			silhouette,
			expect.objectContaining({
				opacity: 1,
				geometry: expect.objectContaining({ timestampMs: 100 }),
			}),
		);
	});

	it("rejects export when required face tracking cannot initialize", async () => {
		const harness = createHarness();
		harness.faceWorker.failInitialization = true;

		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 100,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow("Black silhouette export failed: face model unavailable");
		expect(harness.compositor.compose).not.toHaveBeenCalled();
		expect(harness.worker.terminated).toBe(true);
		expect(harness.faceWorker.terminated).toBe(true);
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

	it("uses identical person-loss hold and fade frames in preview and export", async () => {
		const preview = createHarness();
		const exporter = createHarness();
		const timestamps = [0, 100, 225, 301];

		for (const timestampMs of timestamps) {
			const hasPerson = timestampMs === 0;
			preview.worker.maskData = new Float32Array([hasPerson ? 1 : 0]);
			exporter.worker.maskData = new Float32Array([hasPerson ? 1 : 0]);
			preview.faceWorker.face = hasPerson ? faceGeometry : null;
			exporter.faceWorker.face = hasPerson ? faceGeometry : null;
			await preview.pipeline.processFrame({
				source,
				timestampMs,
				settings: silhouette,
				mode: "preview",
			});
			await exporter.pipeline.processFrame({
				source,
				timestampMs,
				settings: silhouette,
				mode: "export",
			});
		}

		const previewMasks = preview.compositor.compose.mock.calls.map((call) => call[1]);
		const exportMasks = exporter.compositor.compose.mock.calls.map((call) => call[1]);
		expect(previewMasks.map((mask) => Array.from(mask.data))).toEqual(
			exportMasks.map((mask) => Array.from(mask.data)),
		);
		expect(previewMasks.map((mask) => mask.timestampMs)).toEqual(timestamps);
		expect(previewMasks[1]?.data[0]).toBe(1);
		expect(previewMasks[2]?.data[0]).toBeCloseTo(0.5, 6);
		expect(previewMasks[3]?.data[0]).toBe(0);
		expect(preview.compositor.compose.mock.calls.map((call) => call[3])).toEqual(
			exporter.compositor.compose.mock.calls.map((call) => call[3]),
		);
		expect(preview.compositor.compose.mock.calls[3]?.[3]).toBeNull();
	});

	it("clears a held person immediately across an explicit discontinuity", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 0,
			settings: silhouette,
			mode: "export",
		});
		harness.worker.maskData = new Float32Array([0]);

		await harness.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: silhouette,
			mode: "export",
			discontinuity: true,
		});

		expect(harness.compositor.compose.mock.calls[1]?.[1].data[0]).toBe(0);
	});

	it("freezes one media frame before cloning it for both local inference workers", async () => {
		const harness = createHarness();

		await harness.pipeline.processFrame({
			source,
			timestampMs: 250,
			settings: silhouette,
			mode: "export",
		});

		expect(harness.createBitmap).toHaveBeenCalledTimes(2);
		expect(harness.createBitmap.mock.calls[0]?.[0]).toBe(source);
		expect(harness.createBitmap.mock.calls[1]?.[0]).toBe(
			await harness.createBitmap.mock.results[0]?.value,
		);
	});

	it("preserves a 16:9 source aspect ratio in the local inference bitmap", async () => {
		const harness = createHarness();

		await harness.pipeline.processFrame({
			source,
			timestampMs: 250,
			settings: silhouette,
			mode: "export",
		});

		expect(harness.createBitmap.mock.calls[0]).toEqual([
			source,
			{
				resizeWidth: 256,
				resizeHeight: 144,
				resizeQuality: "medium",
			},
		]);
	});

	it("freezes a full preview frame before waiting for model initialization", async () => {
		const harness = createHarness();
		harness.worker.autoInitialize = false;
		harness.faceWorker.autoInitialize = false;
		const snapshot = {
			width: 640,
			height: 360,
			close: vi.fn(),
		} as unknown as ImageBitmap;
		let resolveSnapshot: (frame: ImageBitmap) => void = () => undefined;
		harness.createBitmap.mockImplementationOnce(
			() =>
				new Promise<ImageBitmap>((resolve) => {
					resolveSnapshot = resolve;
				}),
		);

		const pending = harness.pipeline.processFrame({
			source,
			timestampMs: 275,
			settings: silhouette,
			mode: "preview",
		});
		await vi.waitFor(() => expect(harness.createBitmap).toHaveBeenCalledTimes(1));
		expect(harness.createBitmap.mock.calls[0]?.[0]).toBe(source);
		expect(harness.worker.messages).toHaveLength(0);
		expect(harness.faceWorker.messages).toHaveLength(0);
		resolveSnapshot(snapshot);

		await vi.waitFor(() => {
			expect(harness.worker.messages[0]).toMatchObject({ type: "initialize" });
			expect(harness.faceWorker.messages[0]).toMatchObject({ type: "initialize" });
		});
		harness.worker.onmessage?.({
			data: { type: "ready", delegate: "GPU" },
		} as MessageEvent<SegmentationWorkerResponse>);
		harness.faceWorker.onmessage?.({
			data: { type: "ready", delegate: "GPU" },
		} as MessageEvent<FaceLandmarkerWorkerResponse>);

		await expect(pending).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(harness.compositor.compose.mock.calls[0]?.[0]).toBe(snapshot);
		expect(snapshot.close).toHaveBeenCalledTimes(1);
	});

	it("rejects export when the frozen frame cannot be cloned", async () => {
		const harness = createHarness();
		harness.createBitmap
			.mockResolvedValueOnce(harness.bitmap)
			.mockRejectedValueOnce(new Error("clone failed"));

		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 300,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow(
			"Black silhouette export failed: Could not clone the frozen frame for face tracking: clone failed",
		);
		expect(harness.bitmap.close).toHaveBeenCalledTimes(1);
		expect(harness.compositor.compose).not.toHaveBeenCalled();
	});

	it("rejects export after a fatal face worker crash", async () => {
		const harness = createHarness();
		harness.faceWorker.crashOnTrack = true;

		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 350,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow("Black silhouette export failed: face worker crashed");
		expect(harness.faceWorker.terminated).toBe(true);
		expect(harness.compositor.compose).not.toHaveBeenCalled();
	});

	it("rejects export on a request-scoped face inference error", async () => {
		const harness = createHarness();
		harness.faceWorker.failTracks = true;

		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 375,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow("Black silhouette export failed: face inference failed");
		expect(harness.compositor.compose).not.toHaveBeenCalled();
	});

	it("keeps single-flight backpressure until both paired inference requests settle", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		harness.faceWorker.failTracks = true;

		let settled = false;
		const pending = harness.pipeline
			.processFrame({
				source,
				timestampMs: 390,
				settings: silhouette,
				mode: "preview",
				realtime: true,
			})
			.finally(() => {
				settled = true;
			});
		await vi.waitFor(() => {
			expect(harness.faceWorker.messages.some((message) => message.type === "track")).toBe(
				true,
			);
		});
		expect(settled).toBe(false);
		expect(harness.pipeline.getStatus().status).not.toBe("ready");
		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 423,
				settings: silhouette,
				mode: "preview",
				realtime: true,
			}),
		).resolves.toMatchObject({
			source: harness.output,
			processed: true,
			status: "loading",
		});
		expect(
			harness.worker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(1);
		const segment = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 390,
		);
		if (!segment || segment.type !== "segment") throw new Error("Expected paired mask request");
		harness.worker.resolveSegment(segment.requestId, 390);
		await expect(pending).resolves.toMatchObject({
			source: harness.output,
			processed: true,
			status: "fallback",
			error: "face inference failed",
		});
		expect(harness.pipeline.getStatus()).toEqual({
			status: "fallback",
			error: "face inference failed",
		});
	});

	it("does not let a late face result revive a fatal segmentation fallback", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		harness.faceWorker.autoTrack = false;

		const pending = harness.pipeline.processFrame({
			source,
			timestampMs: 410,
			settings: silhouette,
			mode: "export",
		});
		await vi.waitFor(() => {
			expect(harness.worker.messages.some((message) => message.type === "segment")).toBe(
				true,
			);
			expect(harness.faceWorker.messages.some((message) => message.type === "track")).toBe(
				true,
			);
		});
		const segment = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 410,
		);
		const track = harness.faceWorker.messages.find(
			(message) => message.type === "track" && message.timestampMs === 410,
		);
		if (!segment || segment.type !== "segment" || !track || track.type !== "track") {
			throw new Error("Expected paired inference requests");
		}
		harness.worker.resolveSegment(segment.requestId, 410);
		harness.worker.onmessage?.({
			data: { type: "error", message: "segmentation worker crashed" },
		} as MessageEvent<SegmentationWorkerResponse>);
		harness.faceWorker.resolveTrack(track.requestId, 410);

		await expect(pending).rejects.toThrow(
			"Black silhouette export failed: segmentation worker crashed",
		);
		expect(harness.worker.terminated).toBe(true);
		expect(harness.faceWorker.terminated).toBe(true);
		expect(harness.pipeline.getStatus()).toEqual({
			status: "fallback",
			error: "segmentation worker crashed",
		});
		expect(harness.compositor.compose).not.toHaveBeenCalled();
	});

	it("refreshes both inferences for an explicit discontinuity at the same timestamp", async () => {
		const harness = createHarness();
		harness.faceWorker.face = faceGeometry;

		await harness.pipeline.processFrame({
			source,
			timestampMs: 500,
			settings: silhouette,
			mode: "export",
		});
		harness.faceWorker.face = null;
		await harness.pipeline.processFrame({
			source,
			timestampMs: 500,
			settings: silhouette,
			mode: "export",
			discontinuity: true,
		});

		expect(
			harness.worker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(2);
		expect(
			harness.faceWorker.messages.filter((message) => message.type === "track"),
		).toHaveLength(2);
		expect(harness.compositor.compose.mock.calls[1]?.[3]).toBeNull();
	});

	it("uses the same face geometry for paused preview and export at a matching timestamp", async () => {
		const preview = createHarness();
		const exporter = createHarness();
		preview.faceWorker.face = faceGeometry;
		exporter.faceWorker.face = faceGeometry;

		await preview.pipeline.processFrame({
			source,
			timestampMs: 750,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});
		await exporter.pipeline.processFrame({
			source,
			timestampMs: 750,
			settings: silhouette,
			mode: "export",
		});

		expect(preview.compositor.compose.mock.calls[0]?.[3]).toEqual(
			exporter.compositor.compose.mock.calls[0]?.[3],
		);
		expect(preview.compositor.compose.mock.calls[0]?.[3]).toMatchObject({
			opacity: 1,
			geometry: { timestampMs: 750 },
		});
	});

	it("waits for the current playing preview timestamp instead of composing a cached face", async () => {
		const preview = createHarness();
		const exporter = createHarness();
		preview.faceWorker.face = faceGeometry;

		await preview.pipeline.processFrame({
			source,
			timestampMs: 0,
			settings: silhouette,
			mode: "preview",
		});

		const movedFace = {
			...faceGeometry,
			imageLeftEye: {
				...faceGeometry.imageLeftEye,
				outer: { x: 0.4, y: faceGeometry.imageLeftEye.outer.y },
			},
		} satisfies CartoonFaceGeometry;
		preview.faceWorker.face = movedFace;
		exporter.faceWorker.face = movedFace;

		await preview.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: silhouette,
			mode: "preview",
		});
		await exporter.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: silhouette,
			mode: "export",
		});

		expect(preview.compositor.compose.mock.calls[1]?.[3]).toEqual(
			exporter.compositor.compose.mock.calls[0]?.[3],
		);
		expect(preview.compositor.compose.mock.calls[1]?.[3]).toMatchObject({
			geometry: { imageLeftEye: { outer: { x: 0.4 } }, timestampMs: 100 },
		});
	});

	it("drops overlapping playing preview requests instead of queueing stale frames", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;

		const first = harness.pipeline.processFrame({
			source,
			timestampMs: 100,
			settings: silhouette,
			mode: "preview",
			realtime: true,
		});
		await vi.waitFor(() => {
			expect(
				harness.worker.messages.filter((message) => message.type === "segment"),
			).toHaveLength(1);
		});
		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 133,
				settings: silhouette,
				mode: "preview",
				realtime: true,
			}),
		).resolves.toMatchObject({ processed: true, status: "loading" });
		expect(
			harness.worker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(1);

		const firstSegment = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 100,
		);
		if (!firstSegment || firstSegment.type !== "segment") {
			throw new Error("Expected the active preview request");
		}
		harness.worker.resolveSegment(firstSegment.requestId, 100);
		await expect(first).resolves.toMatchObject({ processed: true, status: "ready" });

		harness.worker.autoSegment = true;
		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 166,
				settings: silhouette,
				mode: "preview",
				realtime: true,
			}),
		).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(
			harness.worker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(2);
	});

	it("coalesces paused setting updates and renders the latest settings", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		const firstSettings = { ...silhouette, opacity: 0.2 };
		const middleSettings = { ...silhouette, opacity: 0.6 };
		const finalSettings = { ...silhouette, opacity: 0.9 };

		const first = harness.pipeline.processFrame({
			source,
			timestampMs: 200,
			settings: firstSettings,
			mode: "preview",
		});
		await vi.waitFor(() => {
			expect(
				harness.worker.messages.filter((message) => message.type === "segment"),
			).toHaveLength(1);
		});
		const middle = harness.pipeline.processFrame({
			source,
			timestampMs: 200,
			settings: middleSettings,
			mode: "preview",
		});
		const final = harness.pipeline.processFrame({
			source,
			timestampMs: 200,
			settings: finalSettings,
			mode: "preview",
		});
		const segment = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 200,
		);
		if (!segment || segment.type !== "segment") throw new Error("Expected active preview");
		harness.worker.resolveSegment(segment.requestId, 200);

		await expect(first).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(middle).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(final).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(
			harness.worker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(1);
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
		expect(harness.compositor.compose.mock.calls[0]?.[2]).toEqual(finalSettings);
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

	it("coalesces rapid seeks so only the active and latest targets are inferred", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		const firstSource = {
			width: 640,
			height: 360,
			id: "first-seek",
		} as unknown as CanvasImageSource;
		const middleSource = {
			width: 640,
			height: 360,
			id: "middle-seek",
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
		const middleSeek = harness.pipeline.processFrame({
			source: middleSource,
			timestampMs: 5000,
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
			expect(segments[0]).toMatchObject({ timestampMs: 8000, discontinuity: true });
		});
		const finalRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 8000,
		);
		if (!finalRequest || finalRequest.type !== "segment") {
			throw new Error("Expected the final seek request");
		}
		harness.worker.resolveSegment(finalRequest.requestId, 8000);

		await expect(firstSeek).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(middleSeek).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(finalSeek).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(harness.createBitmap.mock.calls[0]?.[0]).toBe(firstSource);
		expect(harness.createBitmap.mock.calls[1]?.[0]).toBe(middleSource);
		expect(harness.createBitmap.mock.calls[2]?.[0]).toBe(finalSource);
		expect(harness.compositor.compose.mock.calls[0]?.[0]).toBe(
			await harness.createBitmap.mock.results[2]?.value,
		);
		expect(harness.compositor.compose.mock.calls[0]?.[1]).toMatchObject({ timestampMs: 8000 });
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
		expect(harness.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
		expect(harness.bitmaps[1]?.close).toHaveBeenCalledTimes(1);
		expect(harness.bitmaps[2]?.close).toHaveBeenCalledTimes(1);
		expect(
			harness.worker.messages.filter(
				(message) => message.type === "segment" && message.timestampMs === 5000,
			),
		).toHaveLength(0);
		expect(
			harness.worker.messages.filter(
				(message) => message.type === "segment" && message.timestampMs === 2000,
			),
		).toHaveLength(0);
	});

	it("lets a seek supersede older normal previews that are active or waiting", async () => {
		const harness = createHarness();
		harness.worker.autoSegment = false;
		harness.faceWorker.face = faceGeometry;

		const active = harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "preview",
		});
		await vi.waitFor(() => {
			expect(
				harness.worker.messages.filter((message) => message.type === "segment"),
			).toHaveLength(1);
		});
		harness.faceWorker.face = null;
		const waiting = harness.pipeline.processFrame({
			source,
			timestampMs: 1500,
			settings: { ...silhouette, opacity: 0.25 },
			mode: "preview",
		});
		const seek = harness.pipeline.processFrame({
			source,
			timestampMs: 5000,
			settings: { ...silhouette, opacity: 0.9 },
			mode: "preview",
			discontinuity: true,
		});

		const activeRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 1000,
		);
		if (!activeRequest || activeRequest.type !== "segment") {
			throw new Error("Expected the active normal preview request");
		}
		harness.worker.resolveSegment(activeRequest.requestId, 1000, new Float32Array([1]));
		await vi.waitFor(() => {
			const segments = harness.worker.messages.filter(
				(message) => message.type === "segment",
			);
			expect(segments).toHaveLength(2);
			expect(segments[1]).toMatchObject({ timestampMs: 5000, discontinuity: true });
		});
		const seekRequest = harness.worker.messages.find(
			(message) => message.type === "segment" && message.timestampMs === 5000,
		);
		if (!seekRequest || seekRequest.type !== "segment") {
			throw new Error("Expected the latest seek request");
		}
		harness.worker.resolveSegment(seekRequest.requestId, 5000, new Float32Array([0]));

		await expect(active).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(waiting).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(seek).resolves.toMatchObject({ processed: true, status: "ready" });
		expect(
			harness.worker.messages.filter(
				(message) => message.type === "segment" && message.timestampMs === 1500,
			),
		).toHaveLength(0);
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
		expect(harness.compositor.compose.mock.calls[0]?.[1]).toMatchObject({ timestampMs: 5000 });
		expect(harness.compositor.compose.mock.calls[0]?.[1].data[0]).toBe(0);
		expect(harness.compositor.compose.mock.calls[0]?.[3]).toBeNull();
		expect(harness.compositor.compose.mock.calls[0]?.[2]).toMatchObject({ opacity: 0.9 });
	});

	it("chooses the latest seek by call order when frame snapshots resolve out of order", async () => {
		const harness = createHarness();
		const makeOwnedFrame = () =>
			({ width: 640, height: 360, close: vi.fn() }) as unknown as ImageBitmap;
		const firstFrame = makeOwnedFrame();
		const middleFrame = makeOwnedFrame();
		const finalFrame = makeOwnedFrame();
		let resolveFirst: (frame: ImageBitmap) => void = () => undefined;
		let resolveMiddle: (frame: ImageBitmap) => void = () => undefined;
		let resolveFinal: (frame: ImageBitmap) => void = () => undefined;
		harness.createBitmap
			.mockImplementationOnce(
				() =>
					new Promise<ImageBitmap>((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<ImageBitmap>((resolve) => {
						resolveMiddle = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<ImageBitmap>((resolve) => {
						resolveFinal = resolve;
					}),
			);

		const first = harness.pipeline.processFrame({
			source,
			timestampMs: 2000,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});
		const middle = harness.pipeline.processFrame({
			source,
			timestampMs: 5000,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});
		const final = harness.pipeline.processFrame({
			source,
			timestampMs: 8000,
			settings: silhouette,
			mode: "preview",
			discontinuity: true,
		});
		expect(harness.createBitmap).toHaveBeenCalledTimes(3);

		resolveFinal(finalFrame);
		await expect(final).resolves.toMatchObject({ processed: true, status: "ready" });
		resolveMiddle(middleFrame);
		resolveFirst(firstFrame);
		await expect(middle).resolves.toMatchObject({ processed: true, status: "loading" });
		await expect(first).resolves.toMatchObject({ processed: true, status: "loading" });

		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
		expect(harness.compositor.compose.mock.calls[0]?.[0]).toBe(finalFrame);
		expect(harness.compositor.compose.mock.calls[0]?.[1]).toMatchObject({ timestampMs: 8000 });
		expect(firstFrame.close).toHaveBeenCalledTimes(1);
		expect(middleFrame.close).toHaveBeenCalledTimes(1);
		expect(finalFrame.close).toHaveBeenCalledTimes(1);
	});

	it("rejects export instead of reusing a stale mask or raw frame after inference fails", async () => {
		const harness = createHarness();
		await harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "export",
		});
		harness.worker.failSegments = true;

		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 2000,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow("Black silhouette export failed: segmentation failed");
		expect(harness.compositor.compose).toHaveBeenCalledTimes(1);
	});

	it("keeps preview fail-closed on the safe compositor canvas when required workers fail", async () => {
		const harness = createHarness();
		harness.faceWorker.failTracks = true;

		const result = await harness.pipeline.processFrame({
			source,
			timestampMs: 1000,
			settings: silhouette,
			mode: "preview",
		});

		expect(result).toMatchObject({
			source: harness.output,
			processed: true,
			status: "fallback",
		});
		expect(result.source).not.toBe(source);
		expect(harness.compositor.compose).not.toHaveBeenCalled();
	});

	it("rebuilds both required workers once and retries the same media frame", async () => {
		const firstWorker = new FakeWorker();
		const recoveredWorker = new FakeWorker();
		firstWorker.failSegments = true;
		const firstFaceWorker = new FakeFaceWorker();
		const recoveredFaceWorker = new FakeFaceWorker();
		const workerFactory = vi
			.fn<() => Worker>()
			.mockReturnValueOnce(firstWorker as unknown as Worker)
			.mockReturnValueOnce(recoveredWorker as unknown as Worker);
		const faceWorkerFactory = vi
			.fn<() => Worker>()
			.mockReturnValueOnce(firstFaceWorker as unknown as Worker)
			.mockReturnValueOnce(recoveredFaceWorker as unknown as Worker);
		const output = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
		const compositor = {
			compose: vi.fn(() => output),
			getCanvas: vi.fn(() => output),
		};
		const createBitmap = vi.fn(async () => {
			return {
				width: 256,
				height: 144,
				close: vi.fn(),
			} as unknown as ImageBitmap;
		});
		const pipeline = new WebcamEffectPipeline({
			workerFactory,
			faceWorkerFactory,
			createImageBitmap: createBitmap as unknown as typeof createImageBitmap,
			assetBaseUrl: "http://127.0.0.1/mediapipe/",
			compositor,
		});

		await expect(
			pipeline.processFrame({
				source,
				timestampMs: 1200,
				settings: silhouette,
				mode: "export",
			}),
		).resolves.toMatchObject({ processed: true, source: output, status: "ready" });
		expect(workerFactory).toHaveBeenCalledTimes(2);
		expect(faceWorkerFactory).toHaveBeenCalledTimes(2);
		expect(firstWorker.terminated).toBe(true);
		expect(firstFaceWorker.terminated).toBe(true);
		expect(
			recoveredWorker.messages.filter((message) => message.type === "segment"),
		).toHaveLength(1);
		expect(
			recoveredFaceWorker.messages.filter((message) => message.type === "track"),
		).toHaveLength(1);
	});

	it("bounds worker rebuilding to one attempt while persistent failure remains fail-closed", async () => {
		const workers = [new FakeWorker(), new FakeWorker()];
		const faceWorkers = [new FakeFaceWorker(), new FakeFaceWorker()];
		for (const worker of workers) worker.failSegments = true;
		const workerFactory = vi.fn(() => workers.shift() as unknown as Worker);
		const faceWorkerFactory = vi.fn(() => faceWorkers.shift() as unknown as Worker);
		const output = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
		const pipeline = new WebcamEffectPipeline({
			workerFactory,
			faceWorkerFactory,
			createImageBitmap: vi.fn(async () => {
				return { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
			}) as unknown as typeof createImageBitmap,
			assetBaseUrl: "http://127.0.0.1/mediapipe/",
			compositor: {
				compose: vi.fn(() => output),
				getCanvas: vi.fn(() => output),
			},
		});

		const first = await pipeline.processFrame({
			source,
			timestampMs: 1400,
			settings: silhouette,
			mode: "preview",
		});
		const second = await pipeline.processFrame({
			source,
			timestampMs: 1433,
			settings: silhouette,
			mode: "preview",
		});

		expect(first).toMatchObject({ processed: true, source: output, status: "fallback" });
		expect(second).toMatchObject({ processed: true, source: output, status: "fallback" });
		expect(workerFactory).toHaveBeenCalledTimes(2);
		expect(faceWorkerFactory).toHaveBeenCalledTimes(2);
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

		await expect(pending).rejects.toThrow(
			"Black silhouette export failed: Webcam effect pipeline was disposed",
		);
		expect(harness.worker.terminated).toBe(true);
		expect(harness.faceWorker.terminated).toBe(true);
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
		expect(harness.faceWorker.terminated).toBe(true);
		await expect(
			harness.pipeline.processFrame({
				source,
				timestampMs: 1,
				settings: silhouette,
				mode: "export",
			}),
		).rejects.toThrow("Black silhouette export failed: webcam effect pipeline is disposed");
	});
});
