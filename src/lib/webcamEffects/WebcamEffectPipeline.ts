import type { WebcamEffectSettings } from "@/components/video-editor/types";
import { getWebcamEffectAssetUrls } from "./assets";
import type { PersonMask, SegmentationWorkerRequest, SegmentationWorkerResponse } from "./messages";
import { SilhouetteCompositor } from "./silhouetteCompositor";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

export type WebcamEffectProcessMode = "preview" | "export";
export type WebcamEffectPipelineStatus = "idle" | "loading" | "ready" | "fallback";

export interface WebcamEffectProcessRequest {
	source: CanvasImageSource;
	timestampMs: number;
	settings: WebcamEffectSettings;
	mode: WebcamEffectProcessMode;
	discontinuity?: boolean;
}

export interface WebcamEffectProcessResult {
	source: CanvasImageSource;
	processed: boolean;
	status: WebcamEffectPipelineStatus;
	error?: string;
}

interface PendingRequest {
	resolve: (mask: PersonMask) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

export interface WebcamEffectPipelineOptions {
	workerFactory?: () => Worker;
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

export class WebcamEffectPipeline {
	private readonly workerFactory: () => Worker;
	private readonly bitmapFactory: typeof createImageBitmap;
	private readonly assetBaseUrl: string;
	private readonly inferenceWidth: number;
	private readonly inferenceHeight: number;
	private readonly requestTimeoutMs: number;
	private readonly compositor: Pick<SilhouetteCompositor, "compose" | "getCanvas">;
	private worker: Worker | null = null;
	private initializationPromise: Promise<void> | null = null;
	private initializationResolve: (() => void) | null = null;
	private initializationReject: ((error: Error) => void) | null = null;
	private initializationTimeoutId: ReturnType<typeof setTimeout> | null = null;
	private pending = new Map<number, PendingRequest>();
	private nextRequestId = 1;
	private previewInFlight: Promise<PersonMask> | null = null;
	private previewDiscontinuityTail: Promise<void> = Promise.resolve();
	private previewDiscontinuityPending = 0;
	private lastMask: PersonMask | null = null;
	private lastTimestampMs: number | null = null;
	private disposed = false;
	private status: WebcamEffectPipelineStatus = "idle";
	private error: string | undefined;

	constructor(options: WebcamEffectPipelineOptions = {}) {
		this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
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

	private post(message: SegmentationWorkerRequest, transfer: Transferable[] = []): void {
		if (!this.worker) throw new Error("Person segmentation worker is unavailable");
		this.worker.postMessage(message, transfer);
	}

	private handleWorkerMessage(message: SegmentationWorkerResponse): void {
		if (message.type === "ready") {
			if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
			this.initializationTimeoutId = null;
			this.status = "ready";
			this.error = undefined;
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
			this.status = "ready";
			this.error = undefined;
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

	private handleWorkerFailure(error: Error): void {
		if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
		this.initializationTimeoutId = null;
		this.status = "fallback";
		this.error = error.message;
		this.clearCachedMask();
		this.initializationReject?.(error);
		this.initializationResolve = null;
		this.initializationReject = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
	}

	private clearCachedMask(): void {
		this.lastMask = null;
		this.lastTimestampMs = null;
	}

	private startPreviewInference(
		source: CanvasImageSource,
		timestampMs: number,
		discontinuity: boolean,
	): Promise<PersonMask> {
		const inference = this.requestMask(source, timestampMs, discontinuity).finally(() => {
			if (this.previewInFlight === inference) this.previewInFlight = null;
		});
		this.previewInFlight = inference;
		return inference;
	}

	private requestDiscontinuousPreviewMask(
		source: CanvasImageSource,
		timestampMs: number,
	): Promise<PersonMask> {
		this.previewDiscontinuityPending++;
		const execute = async () => {
			const previousInference = this.previewInFlight;
			if (previousInference) {
				try {
					await previousInference;
				} catch {
					// The seek target below gets one fresh attempt to recover.
				}
			}
			this.clearCachedMask();
			const mask = await this.startPreviewInference(source, timestampMs, true);
			if (Math.abs(mask.timestampMs - timestampMs) >= 0.001) {
				throw new Error("Person segmentation returned a mask for the wrong timestamp");
			}
			this.lastMask = mask;
			this.lastTimestampMs = mask.timestampMs;
			return mask;
		};
		const queued = this.previewDiscontinuityTail.then(execute, execute);
		this.previewDiscontinuityTail = queued.then(
			() => undefined,
			() => undefined,
		);
		return queued.finally(() => {
			this.previewDiscontinuityPending = Math.max(0, this.previewDiscontinuityPending - 1);
		});
	}

	private async requestMask(
		source: CanvasImageSource,
		timestampMs: number,
		discontinuity: boolean,
	): Promise<PersonMask> {
		await this.ensureInitialized();
		const frame = await this.bitmapFactory(source as ImageBitmapSource, {
			resizeWidth: this.inferenceWidth,
			resizeHeight: this.inferenceHeight,
			resizeQuality: "medium",
		});
		const requestId = this.nextRequestId++;
		const promise = new Promise<PersonMask>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("Person segmentation timed out"));
			}, this.requestTimeoutMs);
			this.pending.set(requestId, { resolve, reject, timeoutId });
		});
		this.post({ type: "segment", requestId, frame, timestampMs, discontinuity }, [frame]);
		return promise;
	}

	async processFrame(request: WebcamEffectProcessRequest): Promise<WebcamEffectProcessResult> {
		if (request.settings.type !== "silhouette") {
			return { source: request.source, processed: false, status: this.status };
		}
		if (this.disposed) {
			return {
				source: request.source,
				processed: false,
				status: "fallback",
				error: "Webcam effect pipeline is disposed",
			};
		}

		const sameTimestamp =
			this.lastTimestampMs !== null &&
			Math.abs(request.timestampMs - this.lastTimestampMs) < 0.001;
		const movedBackward =
			this.lastTimestampMs !== null && request.timestampMs < this.lastTimestampMs - 0.001;
		const discontinuity = Boolean(request.discontinuity || movedBackward);
		if (request.mode === "preview" && !discontinuity && this.previewDiscontinuityPending > 0) {
			return { source: request.source, processed: false, status: "loading" };
		}

		try {
			if (!sameTimestamp) {
				if (request.mode === "preview") {
					if (discontinuity) {
						this.lastMask = await this.requestDiscontinuousPreviewMask(
							request.source,
							request.timestampMs,
						);
					} else {
						const inference =
							this.previewInFlight ??
							this.startPreviewInference(request.source, request.timestampMs, false);
						if (!this.lastMask) {
							this.lastMask = await inference;
						} else {
							void inference
								.then((mask) => {
									this.lastMask = mask;
									this.lastTimestampMs = mask.timestampMs;
								})
								.catch((error) => {
									this.status = "fallback";
									this.error =
										error instanceof Error ? error.message : String(error);
									this.clearCachedMask();
								});
						}
					}
				} else {
					this.lastMask = await this.requestMask(
						request.source,
						request.timestampMs,
						discontinuity,
					);
				}
			}

			if (!this.lastMask) {
				return { source: request.source, processed: false, status: "loading" };
			}
			if (this.lastMask.timestampMs === request.timestampMs) {
				this.lastTimestampMs = request.timestampMs;
			}
			const canvas = this.compositor.compose(request.source, this.lastMask, request.settings);
			return { source: canvas as CanvasImageSource, processed: true, status: this.status };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.status = "fallback";
			this.error = message;
			this.clearCachedMask();
			return {
				source: request.source,
				processed: false,
				status: "fallback",
				error: message,
			};
		}
	}

	reset(): void {
		this.clearCachedMask();
		if (this.worker && this.status === "ready") this.post({ type: "reset" });
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
		try {
			if (this.worker) this.post({ type: "dispose" });
		} catch {
			// Worker may already have failed.
		}
		this.worker?.terminate();
		this.worker = null;
		if (this.initializationTimeoutId) clearTimeout(this.initializationTimeoutId);
		this.initializationTimeoutId = null;
		const error = new Error("Webcam effect pipeline was disposed");
		this.status = "fallback";
		this.error = error.message;
		this.clearCachedMask();
		this.initializationReject?.(error);
		this.initializationResolve = null;
		this.initializationReject = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timeoutId);
			request.reject(error);
		}
		this.pending.clear();
		this.previewInFlight = null;
	}
}
