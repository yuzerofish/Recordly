import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type {
	SegmentationDelegate,
	SegmentationWorkerRequest,
	SegmentationWorkerResponse,
} from "./messages";

const scope = self as unknown as {
	onmessage: ((event: MessageEvent<SegmentationWorkerRequest>) => void) | null;
	postMessage(message: SegmentationWorkerResponse, transfer?: Transferable[]): void;
};

let segmenter: ImageSegmenter | null = null;
let assetBaseUrl = "";
let activeDelegate: SegmentationDelegate = "CPU";
let lastTimestampMs = -1;
let operationTail: Promise<void> = Promise.resolve();

function post(message: SegmentationWorkerResponse, transfer?: Transferable[]): void {
	scope.postMessage(message, transfer);
}

async function closeSegmenter(): Promise<void> {
	segmenter?.close();
	segmenter = null;
	lastTimestampMs = -1;
}

async function createSegmenter(delegate: SegmentationDelegate): Promise<ImageSegmenter> {
	const wasmBaseUrl = new URL("vision/wasm/", assetBaseUrl).href;
	const modelUrl = new URL("models/selfie_segmenter-float16-v1.tflite", assetBaseUrl).href;
	const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl, true);
	return ImageSegmenter.createFromOptions(vision, {
		baseOptions: { modelAssetPath: modelUrl, delegate },
		canvas: typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : undefined,
		runningMode: "VIDEO",
		outputConfidenceMasks: true,
		outputCategoryMask: false,
	});
}

async function initialize(preferredDelegate: SegmentationDelegate): Promise<void> {
	await closeSegmenter();
	try {
		segmenter = await createSegmenter(preferredDelegate);
		activeDelegate = preferredDelegate;
	} catch (gpuError) {
		if (preferredDelegate === "CPU") throw gpuError;
		segmenter = await createSegmenter("CPU");
		activeDelegate = "CPU";
	}
	post({ type: "ready", delegate: activeDelegate });
}

async function resetSegmenter(): Promise<void> {
	if (!assetBaseUrl) return;
	if (!segmenter) {
		segmenter = await createSegmenter(activeDelegate);
	} else {
		await segmenter.setOptions({ runningMode: "IMAGE" });
		await segmenter.setOptions({ runningMode: "VIDEO" });
	}
	lastTimestampMs = -1;
}

async function segmentFrame(
	requestId: number,
	frame: ImageBitmap,
	timestampMs: number,
	discontinuity: boolean,
): Promise<void> {
	try {
		if (!segmenter) {
			throw new Error("Person segmenter has not been initialized");
		}
		if (discontinuity || timestampMs <= lastTimestampMs) {
			await resetSegmenter();
		}
		if (!segmenter) {
			throw new Error("Person segmenter could not be reset");
		}

		const monotonicTimestampMs = Math.max(timestampMs, lastTimestampMs + 0.001);
		let resultMask: Float32Array | null = null;
		let resultWidth = frame.width;
		let resultHeight = frame.height;
		segmenter.segmentForVideo(frame, monotonicTimestampMs, (result) => {
			const personMask = result.confidenceMasks?.[0];
			if (!personMask) {
				resultMask = new Float32Array(resultWidth * resultHeight);
				return;
			}
			resultWidth = personMask.width;
			resultHeight = personMask.height;
			resultMask = new Float32Array(personMask.getAsFloat32Array());
			for (const mask of result.confidenceMasks ?? []) mask.close();
			result.categoryMask?.close();
		});
		lastTimestampMs = monotonicTimestampMs;
		const data = resultMask ?? new Float32Array(resultWidth * resultHeight);
		post(
			{
				type: "result",
				requestId,
				mask: { data, width: resultWidth, height: resultHeight, timestampMs },
			},
			[data.buffer],
		);
	} catch (error) {
		post({
			type: "error",
			requestId,
			message: error instanceof Error ? error.message : String(error),
		});
	} finally {
		frame.close();
	}
}

function enqueue(operation: () => Promise<void>): void {
	operationTail = operationTail.then(operation, operation);
}

scope.onmessage = (event) => {
	const message = event.data;
	if (message.type === "initialize") {
		assetBaseUrl = message.assetBaseUrl;
		enqueue(async () => {
			try {
				await initialize(message.preferredDelegate);
			} catch (error) {
				post({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
		return;
	}
	if (message.type === "segment") {
		enqueue(() =>
			segmentFrame(
				message.requestId,
				message.frame,
				message.timestampMs,
				message.discontinuity,
			),
		);
		return;
	}
	if (message.type === "reset") {
		enqueue(async () => {
			try {
				await resetSegmenter();
			} catch (error) {
				post({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
		return;
	}
	enqueue(closeSegmenter);
};
