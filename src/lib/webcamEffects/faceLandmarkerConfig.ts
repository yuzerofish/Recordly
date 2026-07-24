import type { FaceLandmarkerOptions } from "@mediapipe/tasks-vision";
import type { SegmentationDelegate } from "./messages";

interface CreateFaceLandmarkerOptionsInput {
	modelAssetPath: string;
	delegate: SegmentationDelegate;
	canvas?: OffscreenCanvas;
}

export function createFaceLandmarkerOptions({
	modelAssetPath,
	delegate,
	canvas,
}: CreateFaceLandmarkerOptionsInput): FaceLandmarkerOptions {
	return {
		baseOptions: { modelAssetPath, delegate },
		...(canvas ? { canvas } : {}),
		runningMode: "VIDEO",
		numFaces: 1,
		minFaceDetectionConfidence: 0.5,
		minFacePresenceConfidence: 0.5,
		minTrackingConfidence: 0.5,
		outputFaceBlendshapes: true,
		outputFacialTransformationMatrixes: false,
	};
}
