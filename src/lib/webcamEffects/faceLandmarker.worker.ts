import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { extractCartoonFaceGeometry } from "./cartoonFace";
import type {
	FaceLandmarkerWorkerRequest,
	FaceLandmarkerWorkerResponse,
	SegmentationDelegate,
} from "./messages";

const scope = self as unknown as {
	onmessage: ((event: MessageEvent<FaceLandmarkerWorkerRequest>) => void) | null;
	postMessage(message: FaceLandmarkerWorkerResponse, transfer?: Transferable[]): void;
};

let faceLandmarker: FaceLandmarker | null = null;
let assetBaseUrl = "";
let activeDelegate: SegmentationDelegate = "CPU";
let lastTimestampMs = -1;
let operationTail: Promise<void> = Promise.resolve();

function post(message: FaceLandmarkerWorkerResponse): void {
	scope.postMessage(message);
}

async function closeFaceLandmarker(): Promise<void> {
	faceLandmarker?.close();
	faceLandmarker = null;
	lastTimestampMs = -1;
}

async function createFaceLandmarker(delegate: SegmentationDelegate): Promise<FaceLandmarker> {
	const wasmBaseUrl = new URL("vision/wasm/", assetBaseUrl).href;
	const modelUrl = new URL("models/face_landmarker-float16-v1.task", assetBaseUrl).href;
	const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl, true);
	return FaceLandmarker.createFromOptions(vision, {
		baseOptions: { modelAssetPath: modelUrl, delegate },
		canvas: typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : undefined,
		runningMode: "VIDEO",
		numFaces: 1,
		minFaceDetectionConfidence: 0.5,
		minFacePresenceConfidence: 0.5,
		minTrackingConfidence: 0.5,
		outputFaceBlendshapes: false,
		outputFacialTransformationMatrixes: false,
	});
}

async function initialize(preferredDelegate: SegmentationDelegate): Promise<void> {
	await closeFaceLandmarker();
	try {
		faceLandmarker = await createFaceLandmarker(preferredDelegate);
		activeDelegate = preferredDelegate;
	} catch (preferredError) {
		if (preferredDelegate === "CPU") throw preferredError;
		faceLandmarker = await createFaceLandmarker("CPU");
		activeDelegate = "CPU";
	}
	post({ type: "ready", delegate: activeDelegate });
}

async function resetFaceLandmarker(): Promise<void> {
	if (!assetBaseUrl) return;
	if (!faceLandmarker) {
		faceLandmarker = await createFaceLandmarker(activeDelegate);
	} else {
		await faceLandmarker.setOptions({ runningMode: "IMAGE" });
		await faceLandmarker.setOptions({ runningMode: "VIDEO" });
	}
	lastTimestampMs = -1;
}

async function trackFrame(
	requestId: number,
	frame: ImageBitmap,
	timestampMs: number,
	discontinuity: boolean,
): Promise<void> {
	try {
		if (!faceLandmarker) throw new Error("Face landmarker has not been initialized");
		if (discontinuity || timestampMs <= lastTimestampMs) await resetFaceLandmarker();
		if (!faceLandmarker) throw new Error("Face landmarker could not be reset");

		const monotonicTimestampMs = Math.max(timestampMs, lastTimestampMs + 0.001);
		const result = faceLandmarker.detectForVideo(frame, monotonicTimestampMs);
		lastTimestampMs = monotonicTimestampMs;
		post({
			type: "result",
			requestId,
			face: extractCartoonFaceGeometry(result.faceLandmarks[0], timestampMs),
		});
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
	if (message.type === "track") {
		enqueue(() =>
			trackFrame(
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
				await resetFaceLandmarker();
			} catch (error) {
				post({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});
		return;
	}
	enqueue(closeFaceLandmarker);
};
