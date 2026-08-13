export const MEDIAPIPE_SELFIE_MODEL_PATH = "mediapipe/models/selfie_segmenter-float16-v1.tflite";
export const MEDIAPIPE_FACE_LANDMARKER_MODEL_PATH =
	"mediapipe/models/face_landmarker-float16-v1.task";
export const MEDIAPIPE_VISION_WASM_PATH = "mediapipe/vision/wasm/";
export const MONKEY_SCENE_PATH = "webcam-effects/monkey-selfie-scene.png";

export interface WebcamEffectAssetUrls {
	assetBaseUrl: string;
	modelUrl: string;
	faceLandmarkerModelUrl: string;
	wasmUrl: string;
	monkeySceneUrl: string;
}

export function getWebcamEffectAssetUrls(baseUrl?: string): WebcamEffectAssetUrls {
	const resolvedBaseUrl =
		baseUrl ?? (typeof document !== "undefined" ? document.baseURI : "http://127.0.0.1/");
	const assetBaseUrl = new URL("mediapipe/", resolvedBaseUrl).href;

	return {
		assetBaseUrl,
		modelUrl: new URL(MEDIAPIPE_SELFIE_MODEL_PATH, resolvedBaseUrl).href,
		faceLandmarkerModelUrl: new URL(MEDIAPIPE_FACE_LANDMARKER_MODEL_PATH, resolvedBaseUrl).href,
		wasmUrl: new URL(MEDIAPIPE_VISION_WASM_PATH, resolvedBaseUrl).href,
		monkeySceneUrl: new URL(MONKEY_SCENE_PATH, resolvedBaseUrl).href,
	};
}
