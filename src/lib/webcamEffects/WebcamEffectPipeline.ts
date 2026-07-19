import type { WebcamEffectSettings } from "@/components/video-editor/types";
import { getWebcamEffectAssetUrls } from "./assets";
import { type CartoonFacePresentation, CartoonFaceTracker } from "./cartoonFace";
import type {
	CartoonFaceGeometry,
	FaceLandmarkerWorkerRequest,
	FaceLandmarkerWorkerResponse,
	PersonMask,
	SegmentationWorkerRequest,
	SegmentationWorkerResponse,
	WebcamEffectInference,
} from "./messages";
import { PersonMaskTracker } from "./personMask";
import { SilhouetteCompositor } from "./silhouetteCompositor";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type OwnedPreviewFrame = ImageBitmap | VideoFrame;

export type WebcamEffectProcessMode = "preview" | "export";
export type WebcamEffectPipelineStatus = "idle" | "loading" | "ready" | "fallback";

export interface WebcamEffectProcessRequest {
	source: CanvasImageSource;
	timestampMs: number;
	settings: WebcamEffectSettings;
	mode: WebcamEffectProcessMode;
	discontinuity?: boolean;
	realtime?: boolean;
}

export interface WebcamEffectProcessResult {
	source: CanvasImageSource;
	processed: boolean;
	status: WebcamEffectPipelineStatus;
	error?: string;
}

interface PendingSegmentationRequest {
	resolve: (mask: PersonMask) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingFaceRequest {
	resolve: (face: CartoonFaceGeometry | null) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

interface PreparedDiscontinuousInference {
	inference: WebcamEffectInference;
	face: CartoonFacePresentation | null;
}

interface DiscontinuousPreviewRequest {
	source: CanvasImageSource;
	timestampMs: number;
	sequence: number;
	superseded: boolean;
	resolve: (value: PreparedDiscontinuousInference | null) => void;
	reject: (error: unknown) => void;
}

export interface WebcamEffectPipelineOptions {
	workerFactory?: () => Worker;
	faceWorkerFactory?: () => Worker;
	createImageBitmap?: typeof createImageBitmap;
	assetBaseUrl?: string;
	inferenceWidth?: number;
	inferenceHeight?: number;
	requestTimeoutMs?: number;
	compositor?: Pick<SilhouetteCompositor, "compose" | "getCanvas">;
}

function defaultWorkerFactory(): Worker {
	return new Worker(new URL("./personSegmentation.worker.ts", import.meta.url), {
		type: "module",
		name: "recordly-person-segmentation",
	});
}

function defaultFaceWorkerFactory(): Worker {
	return new Worker(new URL("./faceLandmarker.worker.ts", import.meta.url), {
		type: "module",
		name: "recordly-face-landmarker",
	});
}

function capturePresentedVideoFrame(
	source: CanvasImageSource,
	timestampMs: number,
): VideoFrame | null {
	if (
		typeof VideoFrame === "undefined" ||
		typeof HTMLVideoElement === "undefined" ||
		!(source instanceof HTMLVideoElement)
	) {
		return null;
	}
	try {
		return new VideoFrame(source, { timestamp: Math.max(0, Math.round(timestampMs * 1_000)) });
	} catch {
		return null;
	}
}

export class WebcamEffectPipeline {
	private readonly workerFactory: () => Worker;
	private readonly faceWorkerFactory: () => Worker;
	private readonly bitmapFactory: typeof createImageBitmap;
	private readonly assetBaseUrl: string;
	private readonly inferenceWidth: number;
	private readonly inferenceHeight: number;
	private readonly requestTimeoutMs: number;
	private readonly compositor: Pick<SilhouetteCompositor, "compose" | "getCanvas">;
	private worker: Worker | null = null;
	private faceWorker: Worker | null = null;
	private initializationPromise: Promise<void> | null = null;
	private initializationResolve: (() => void) | null = null;
	private initializationReject: ((error: Error) => void) | null = null;
	private initializationTimeoutId: ReturnType<typeof setTimeout> | null = null;
	private faceInitializationPromise: Promise<void> | null = null;
	private faceInitializationResolve: (() => void) | null = null;
	private faceInitializationReject: ((error: Error) => void) | null = null;
	private faceInitializationTimeoutId: ReturnType<typeof setTimeout> | null = null;
	private faceAvailable: boolean | null = null;
	private pending = new Map<number, PendingSegmentationRequest>();
	private facePending = new Map<number, PendingFaceRequest>();
	private nextRequestId = 1;
	private nextFaceRequestId = 1;
	private previewInFlight: Promise<WebcamEffectInference> | null = null;
	private previewFrameInFlight: Promise<void> | null = null;
	private activeDiscontinuousPreview: DiscontinuousPreviewRequest | null = null;
	private latestDiscontinuousPreview: DiscontinuousPreviewRequest | null = null;
	private previewDiscontinuityPending = 0;
	private nextPreviewDiscontinuitySequence = 1;
	private latestPreviewDiscontinuitySequence = 0;
	private previewInferenceEpoch = 0;
	private previewDiscontinuityCaptures = new Set<number>();
	private previewDiscontinuityIdleWaiters = new Set<() => void>();
	private normalPreviewGeneration = 0;
	private lastInference: WebcamEffectInference | null = null;
	private lastFacePresentation: CartoonFacePresentation | null = null;
	private readonly faceTracker = new CartoonFaceTracker();
	private readonly maskTracker = new PersonMaskTracker();
	private lastTimestampMs: number | null = null;
	private disposed = false;
	private status: WebcamEffectPipelineStatus = "idle";
	private error: string | undefined;

	constructor(options: WebcamEffectPipelineOptions = {}) {
		this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
		this.faceWorkerFactory = options.faceWorkerFactory ?? defaultFaceWorkerFactory;
		this.bitmapFactory =
			options.createImageBitmap ?? globalThis.createImageBitmap?.bind(globalThis);
		this.assetBaseUrl = options.assetBaseUrl ?? getWebcamEffectAssetUrls().assetBaseUrl;
		this.inferenceWidth = Math.max(64, Math.round(options.inferenceWidth ?? 256));
		this.inferenceHeight = Math.max(64, Math.round(options.inferenceHeight ?? 256));
		this.requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? 30_000);
		this.compositor = options.compositor ?? new SilhouetteCompositor();
	}

	private async ensureInitialized(): Promise<void> {
		if (this.disposed) throw new Error("Webcam effect pipeline is disposed");
		if (this.status === "ready" && this.worker) return;
		if (this.initializationPromise) return this.initializationPromise;
		if (typeof this.bitmapFactory !== "function") {
			throw new Error("createImageBitmap is unavailable");
		}

		this.status = "loading";
		this.worker = this.workerFactory();
		this.worker.onmessage = (event: MessageEvent<SegmentationWorkerResponse>) => {
			this.handleWorkerMessage(event.data);
		};
		this.worker.onerror = (event) => {
			this.handleWorkerFailure(
				new Error(event.message || "Person segmentation worker failed"),
			);
		};
		this.initializationPromise = new Promise<void>((resolve, reject) => {
			this.initializationResolve = resolve;
			this.initializationReject = reject;
		});
		this.initializationTimeoutId = setTimeout(() => {
			this.handleWorkerFailure(new Error("Person segmentation initialization timed out"));
		}, this.requestTimeoutMs);
		this.post({
			type: "initialize",
			assetBaseUrl: this.assetBaseUrl,
			preferredDelegate: "GPU",
		});
		return this.initializationPromise;
	}

	private async ensureFaceInitialized(): Promise<boolean> {
		if (this.disposed) return false;
		if (this.faceAvailable && this.faceWorker) return true;
		if (this.faceAvailable === false) return false;
		if (!this.faceInitializationPromise) {
			this.faceWorker = this.faceWorkerFactory();
			this.faceWorker.onmessage = (event: MessageEvent<FaceLandmarkerWorkerResponse>) => {
				this.handleFaceWorkerMessage(event.data);
			};
			this.faceWorker.onerror = (event) => {
				this.handleFaceWorkerFailure(
					new Error(event.message || "Face landmark worker failed"),
				);
			};
			this.faceInitializationPromise = new Promise<void>((resolve, reject) => {
				this.faceInitializationResolve = resolve;
				this.faceInitializationReject = reject;
			});
			this.faceInitializationTimeoutId = setTimeout(() => {
				this.handleFaceWorkerFailure(new Error("Face landmark initialization timed out"));
			}, this.requestTimeoutMs);
			this.postFace({
				type: "initialize",
				assetBaseUrl: this.assetBaseUrl,
				preferredDelegate: "GPU",
			});
		}
		try {
			await this.faceInitializationPromise;
			return true;
		} catch {
			return false;
		}
	}

	private post(message: SegmentationWorkerRequest, transfer: Transferable[] = []): void {
		if (!this.worker) throw new Error("Person segmentation worker is unavailable");
		this.worker.postMessage(message, transfer);
	}

	private postFace(message: FaceLandmarkerWorkerRequest, transfer: Transferable[] = []): void {
		if (!this.faceWorker) throw new Error("Face landmark worker is unavailable");
		this.faceWorker.postMessage(message, transfer);
	}

	private handleWorkerMessage(message: SegmentationWorkerResponse): void {
		if (message.type === "ready") {
			if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
			this.initializationTimeoutId = null;
			this.initializationResolve?.();
			this.initializationResolve = null;
			this.initializationReject = null;
			return;
		}

		if (message.type === "result") {
			const request = this.pending.get(message.requestId);
			if (!request) return;
			clearTimeout(request.timeoutId);
			this.pending.delete(message.requestId);
			request.resolve(message.mask);
			return;
		}

		const error = new Error(message.message);
		if (message.requestId !== undefined) {
			const request = this.pending.get(message.requestId);
			if (request) {
				clearTimeout(request.timeoutId);
				this.pending.delete(message.requestId);
				request.reject(error);
			}
			return;
		}
		this.handleWorkerFailure(error);
	}

	private handleFaceWorkerMessage(message: FaceLandmarkerWorkerResponse): void {
		if (message.type === "ready") {
			if (this.faceInitializationTimeoutId) clearTimeout(this.faceInitializationTimeoutId);
			this.faceInitializationTimeoutId = null;
			this.faceAvailable = true;
			this.faceInitializationResolve?.();
			this.faceInitializationResolve = null;
			this.faceInitializationReject = null;
			return;
		}
		if (message.type === "result") {
			const request = this.facePending.get(message.requestId);
			if (!request) return;
			clearTimeout(request.timeoutId);
			this.facePending.delete(message.requestId);
			request.resolve(message.face);
			return;
		}

		const error = new Error(message.message);
		if (message.requestId !== undefined) {
			const request = this.facePending.get(message.requestId);
			if (request) {
				clearTimeout(request.timeoutId);
				this.facePending.delete(message.requestId);
				request.reject(error);
			}
			return;
		}
		this.handleFaceWorkerFailure(error);
	}

	private handleFaceWorkerFailure(error: Error): void {
		this.handleRequiredWorkerFailure(error);
	}

	private handleWorkerFailure(error: Error): void {
		this.handleRequiredWorkerFailure(error);
	}

	private handleRequiredWorkerFailure(error: Error): void {
		if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
		this.initializationTimeoutId = null;
		if (this.faceInitializationTimeoutId) clearTimeout(this.faceInitializationTimeoutId);
		this.faceInitializationTimeoutId = null;
		this.faceAvailable = false;
		this.status = "fallback";
		this.error = error.message;
		this.clearCachedInference();
		this.initializationReject?.(error);
		this.initializationResolve = null;
		this.initializationReject = null;
		this.faceInitializationReject?.(error);
		this.faceInitializationResolve = null;
		this.faceInitializationReject = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.pending.clear();
		for (const request of this.facePending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.facePending.clear();
		this.worker?.terminate();
		this.worker = null;
		this.faceWorker?.terminate();
		this.faceWorker = null;
	}

	private clearCachedInference(): void {
		this.lastInference = null;
		this.lastFacePresentation = null;
		this.faceTracker.reset();
		this.maskTracker.reset();
		this.lastTimestampMs = null;
	}

	private acceptInference(
		inference: WebcamEffectInference,
		discontinuity = false,
	): WebcamEffectInference {
		const acceptedInference = {
			...inference,
			mask: this.maskTracker.update(inference.mask, discontinuity),
		};
		this.lastInference = acceptedInference;
		this.lastTimestampMs = acceptedInference.mask.timestampMs;
		this.lastFacePresentation = this.faceTracker.update(
			inference.face,
			acceptedInference.mask.timestampMs,
			discontinuity,
		);
		return acceptedInference;
	}

	private startPreviewInference(
		source: CanvasImageSource,
		timestampMs: number,
		discontinuity: boolean,
	): Promise<WebcamEffectInference> {
		const inference = this.requestInference(source, timestampMs, discontinuity).finally(() => {
			if (this.previewInFlight === inference) this.previewInFlight = null;
		});
		this.previewInFlight = inference;
		return inference;
	}

	private hasDiscontinuousPreviewWork(): boolean {
		return this.previewDiscontinuityPending > 0 || this.previewDiscontinuityCaptures.size > 0;
	}

	private notifyDiscontinuousPreviewIdle(): void {
		if (this.hasDiscontinuousPreviewWork()) return;
		for (const resolve of this.previewDiscontinuityIdleWaiters) resolve();
		this.previewDiscontinuityIdleWaiters.clear();
	}

	private waitForDiscontinuousPreviewIdle(): Promise<void> {
		if (!this.hasDiscontinuousPreviewWork()) return Promise.resolve();
		return new Promise((resolve) => this.previewDiscontinuityIdleWaiters.add(resolve));
	}

	private async acquireNormalPreviewTurn(realtime: boolean): Promise<number | null> {
		if (realtime && (this.previewFrameInFlight || this.hasDiscontinuousPreviewWork())) {
			return null;
		}
		const generation = ++this.normalPreviewGeneration;
		while (this.previewFrameInFlight || this.hasDiscontinuousPreviewWork()) {
			const activeFrame = this.previewFrameInFlight;
			if (activeFrame) {
				try {
					await activeFrame;
				} catch {
					// A newer paused request still gets a fresh attempt.
				}
			}
			await this.waitForDiscontinuousPreviewIdle();
			if (generation !== this.normalPreviewGeneration) return null;
		}
		return generation === this.normalPreviewGeneration ? generation : null;
	}

	private requestDiscontinuousPreviewInference(
		source: CanvasImageSource,
		timestampMs: number,
		sequence: number,
	): Promise<PreparedDiscontinuousInference | null> {
		if (sequence !== this.latestPreviewDiscontinuitySequence) return Promise.resolve(null);
		return new Promise((resolve, reject) => {
			const request: DiscontinuousPreviewRequest = {
				source,
				timestampMs,
				sequence,
				superseded: false,
				resolve,
				reject,
			};
			if (!this.activeDiscontinuousPreview) {
				this.activeDiscontinuousPreview = request;
				this.previewDiscontinuityPending = 1;
				void this.runDiscontinuousPreview(request);
				return;
			}

			if (this.activeDiscontinuousPreview.sequence < sequence) {
				this.activeDiscontinuousPreview.superseded = true;
			}
			if (this.latestDiscontinuousPreview) {
				if (this.latestDiscontinuousPreview.sequence >= sequence) {
					resolve(null);
					return;
				}
				this.latestDiscontinuousPreview.resolve(null);
			}
			this.latestDiscontinuousPreview = request;
			this.previewDiscontinuityPending = 2;
		});
	}

	private async runDiscontinuousPreview(request: DiscontinuousPreviewRequest): Promise<void> {
		try {
			const previousFrame = this.previewFrameInFlight;
			if (previousFrame) {
				try {
					await previousFrame;
				} catch {
					// The seek target below gets one fresh attempt to recover.
				}
			}
			if (
				request.superseded ||
				request.sequence !== this.latestPreviewDiscontinuitySequence
			) {
				request.resolve(null);
				return;
			}
			this.clearCachedInference();
			const inference = await this.startPreviewInference(
				request.source,
				request.timestampMs,
				true,
			);
			if (
				request.superseded ||
				request.sequence !== this.latestPreviewDiscontinuitySequence
			) {
				request.resolve(null);
				return;
			}
			if (Math.abs(inference.mask.timestampMs - request.timestampMs) >= 0.001) {
				throw new Error("Person segmentation returned a mask for the wrong timestamp");
			}
			const acceptedInference = this.acceptInference(inference, true);
			request.resolve({ inference: acceptedInference, face: this.lastFacePresentation });
		} catch (error) {
			if (
				request.superseded ||
				request.sequence !== this.latestPreviewDiscontinuitySequence
			) {
				request.resolve(null);
			} else request.reject(error);
		} finally {
			if (this.activeDiscontinuousPreview === request) {
				const next = this.latestDiscontinuousPreview;
				this.latestDiscontinuousPreview = null;
				this.activeDiscontinuousPreview = next;
				this.previewDiscontinuityPending = next ? 1 : 0;
				if (next) void this.runDiscontinuousPreview(next);
				else this.notifyDiscontinuousPreviewIdle();
			}
		}
	}

	private async requestInference(
		source: CanvasImageSource,
		timestampMs: number,
		discontinuity: boolean,
	): Promise<WebcamEffectInference> {
		const [, faceAvailable] = await Promise.all([
			this.ensureInitialized(),
			this.ensureFaceInitialized(),
		]);
		if (!faceAvailable) {
			throw new Error(this.error ?? "Face landmark tracking is unavailable");
		}
		const bitmapOptions = {
			resizeWidth: this.inferenceWidth,
			resizeHeight: this.inferenceHeight,
			resizeQuality: "medium",
		} as const;
		const frame = await this.bitmapFactory(source as ImageBitmapSource, bitmapOptions);
		let faceFrame: ImageBitmap | null = null;
		if (faceAvailable) {
			try {
				// Clone the already frozen inference frame rather than sampling a live
				// HTMLVideoElement twice across two awaits. Both workers therefore see
				// pixels from the exact same media frame and timestamp.
				faceFrame = await this.bitmapFactory(frame);
			} catch (error) {
				frame.close();
				throw new Error(
					`Could not clone the frozen frame for face tracking: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}
		if (this.disposed || !this.worker || !this.faceWorker) {
			frame.close();
			faceFrame?.close();
			throw new Error(
				this.disposed
					? "Webcam effect pipeline was disposed before inference started"
					: (this.error ?? "A required webcam effect worker became unavailable"),
			);
		}
		const requestId = this.nextRequestId++;
		const maskPromise = new Promise<PersonMask>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("Person segmentation timed out"));
			}, this.requestTimeoutMs);
			this.pending.set(requestId, { resolve, reject, timeoutId });
		});
		this.post({ type: "segment", requestId, frame, timestampMs, discontinuity }, [frame]);

		let facePromise: Promise<CartoonFaceGeometry | null> = Promise.resolve(null);
		if (faceFrame && this.faceWorker) {
			const faceRequestId = this.nextFaceRequestId++;
			facePromise = new Promise<CartoonFaceGeometry | null>((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					this.facePending.delete(faceRequestId);
					reject(new Error("Face landmark detection timed out"));
				}, this.requestTimeoutMs);
				this.facePending.set(faceRequestId, { resolve, reject, timeoutId });
			});
			this.postFace(
				{
					type: "track",
					requestId: faceRequestId,
					frame: faceFrame,
					timestampMs,
					discontinuity,
				},
				[faceFrame],
			);
		}

		const [maskResult, faceResult] = await Promise.allSettled([maskPromise, facePromise]);
		if (maskResult.status === "rejected") throw maskResult.reason;
		if (faceResult.status === "rejected") throw faceResult.reason;
		if (
			this.status === "fallback" ||
			!this.worker ||
			this.faceAvailable === false ||
			!this.faceWorker
		) {
			throw new Error(
				this.error ?? "A required webcam effect worker failed during inference",
			);
		}
		this.status = "ready";
		this.error = undefined;
		return { mask: maskResult.value, face: faceResult.value };
	}

	async processFrame(request: WebcamEffectProcessRequest): Promise<WebcamEffectProcessResult> {
		if (request.settings.type !== "silhouette") {
			return { source: request.source, processed: false, status: this.status };
		}
		if (this.disposed) {
			if (request.mode === "export") {
				throw new Error(
					"Black silhouette export failed: webcam effect pipeline is disposed",
				);
			}
			return {
				source: request.source,
				processed: false,
				status: "fallback",
				error: "Webcam effect pipeline is disposed",
			};
		}

		const initialMovedBackward =
			this.lastTimestampMs !== null && request.timestampMs < this.lastTimestampMs - 0.001;
		let discontinuity = Boolean(request.discontinuity || initialMovedBackward);
		const previewInferenceEpoch = this.previewInferenceEpoch;
		let normalPreviewGeneration: number | null = null;
		if (request.mode === "preview" && !discontinuity) {
			normalPreviewGeneration = await this.acquireNormalPreviewTurn(
				Boolean(request.realtime),
			);
			if (normalPreviewGeneration === null) {
				return { source: request.source, processed: false, status: "loading" };
			}
			if (normalPreviewGeneration !== this.normalPreviewGeneration) {
				return { source: request.source, processed: false, status: "loading" };
			}
			if (
				this.lastTimestampMs !== null &&
				request.timestampMs < this.lastTimestampMs - 0.001
			) {
				discontinuity = true;
			}
		}
		const sameTimestamp =
			this.lastTimestampMs !== null &&
			Math.abs(request.timestampMs - this.lastTimestampMs) < 0.001;
		let discontinuitySequence: number | null = null;
		if (request.mode === "preview" && discontinuity) {
			// A seek supersedes every normal paused render that entered before it,
			// including one still waiting for the previous frame to finish.
			this.normalPreviewGeneration += 1;
			this.previewInferenceEpoch += 1;
			this.clearCachedInference();
			normalPreviewGeneration = null;
			discontinuitySequence = this.nextPreviewDiscontinuitySequence++;
			this.latestPreviewDiscontinuitySequence = discontinuitySequence;
			this.previewDiscontinuityCaptures.add(discontinuitySequence);
		}
		let releasePreviewFrame: () => void = () => undefined;
		let ownedPreviewFrame: OwnedPreviewFrame | null = null;
		let renderSource = request.source;
		let previewFramePromise: Promise<void> | null = null;
		if (request.mode === "preview" && !discontinuity) {
			previewFramePromise = new Promise<void>((resolve) => {
				releasePreviewFrame = resolve;
			});
			this.previewFrameInFlight = previewFramePromise;
		}

		try {
			if (request.mode === "preview") {
				// Freeze the full-resolution compositing source before any model
				// initialization await. The timestamp, both inferences and final pixels
				// therefore refer to one immutable media frame.
				ownedPreviewFrame = capturePresentedVideoFrame(request.source, request.timestampMs);
				if (!ownedPreviewFrame) {
					if (typeof this.bitmapFactory !== "function") {
						throw new Error("createImageBitmap is unavailable");
					}
					ownedPreviewFrame = await this.bitmapFactory(
						request.source as ImageBitmapSource,
					);
				}
				renderSource = ownedPreviewFrame;
				if (
					discontinuitySequence !== null &&
					discontinuitySequence !== this.latestPreviewDiscontinuitySequence
				) {
					return { source: request.source, processed: false, status: "loading" };
				}
			}
			let renderInference: WebcamEffectInference | null = null;
			let renderFace: CartoonFacePresentation | null | undefined;
			if (!sameTimestamp || discontinuity) {
				if (request.mode === "preview") {
					if (discontinuity) {
						if (discontinuitySequence === null) {
							throw new Error("Missing preview discontinuity sequence");
						}
						const prepared = await this.requestDiscontinuousPreviewInference(
							renderSource,
							request.timestampMs,
							discontinuitySequence,
						);
						if (!prepared) {
							return { source: request.source, processed: false, status: "loading" };
						}
						renderInference = prepared.inference;
						renderFace = prepared.face;
					} else {
						const freshInference = await this.startPreviewInference(
							renderSource,
							request.timestampMs,
							false,
						);
						if (previewInferenceEpoch !== this.previewInferenceEpoch) {
							return { source: request.source, processed: false, status: "loading" };
						}
						this.acceptInference(freshInference);
					}
				} else {
					this.acceptInference(
						await this.requestInference(
							request.source,
							request.timestampMs,
							discontinuity,
						),
						discontinuity,
					);
				}
			}

			const inference = renderInference ?? this.lastInference;
			if (!inference) {
				return { source: request.source, processed: false, status: "loading" };
			}
			if (inference.mask.timestampMs === request.timestampMs) {
				this.lastTimestampMs = request.timestampMs;
			}
			if (
				normalPreviewGeneration !== null &&
				normalPreviewGeneration !== this.normalPreviewGeneration
			) {
				return { source: request.source, processed: false, status: "loading" };
			}
			const canvas = this.compositor.compose(
				renderSource,
				inference.mask,
				request.settings,
				renderFace === undefined ? this.lastFacePresentation : renderFace,
			);
			return { source: canvas as CanvasImageSource, processed: true, status: this.status };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.status = "fallback";
			this.error = message;
			this.clearCachedInference();
			if (request.mode === "export") {
				throw new Error(`Black silhouette export failed: ${message}`);
			}
			return {
				source: request.source,
				processed: false,
				status: "fallback",
				error: message,
			};
		} finally {
			if (discontinuitySequence !== null) {
				this.previewDiscontinuityCaptures.delete(discontinuitySequence);
				this.notifyDiscontinuousPreviewIdle();
			}
			ownedPreviewFrame?.close();
			releasePreviewFrame();
			if (previewFramePromise && this.previewFrameInFlight === previewFramePromise) {
				this.previewFrameInFlight = null;
			}
		}
	}

	reset(): void {
		this.clearCachedInference();
		if (this.worker && this.status === "ready") this.post({ type: "reset" });
		if (this.faceWorker && this.faceAvailable) this.postFace({ type: "reset" });
	}

	getStatus(): { status: WebcamEffectPipelineStatus; error?: string } {
		return { status: this.status, error: this.error };
	}

	getCanvas(): RenderCanvas {
		return this.compositor.getCanvas();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.latestDiscontinuousPreview?.reject(new Error("Webcam effect pipeline was disposed"));
		this.latestDiscontinuousPreview = null;
		this.previewDiscontinuityPending = this.activeDiscontinuousPreview ? 1 : 0;
		try {
			if (this.worker) this.post({ type: "dispose" });
		} catch {
			// Worker may already have failed.
		}
		try {
			if (this.faceWorker) this.postFace({ type: "dispose" });
		} catch {
			// Face worker may already have failed.
		}
		this.worker?.terminate();
		this.worker = null;
		this.faceWorker?.terminate();
		this.faceWorker = null;
		if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
		this.initializationTimeoutId = null;
		if (this.faceInitializationTimeoutId) clearTimeout(this.faceInitializationTimeoutId);
		this.faceInitializationTimeoutId = null;
		const error = new Error("Webcam effect pipeline was disposed");
		this.status = "fallback";
		this.error = error.message;
		this.clearCachedInference();
		this.initializationReject?.(error);
		this.initializationResolve = null;
		this.initializationReject = null;
		this.faceInitializationReject?.(error);
		this.faceInitializationResolve = null;
		this.faceInitializationReject = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.pending.clear();
		for (const request of this.facePending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.facePending.clear();
		this.previewInFlight = null;
	}
}
