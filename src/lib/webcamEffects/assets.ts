export const MEDIAPIPE_SELFIE_MODEL_PATH = "mediapipe/models/selfie_segmenter-float16-v1.tflite";
export const MEDIAPIPE_VISION_WASM_PATH = "mediapipe/vision/wasm/";

export interface WebcamEffectAssetUrls {
	assetBaseUrl: string;
	modelUrl: string;
	wasmUrl: string;
}

export function getWebcamEffectAssetUrls(baseUrl?: string): WebcamEffectAssetUrls {
	const resolvedBaseUrl =
		baseUrl ?? (typeof document !== "undefined" ? document.baseURI : "http://127.0.0.1/");
	const assetBaseUrl = new URL("mediapipe/", resolvedBaseUrl).href;

	return {
		assetBaseUrl,
		modelUrl: new URL(MEDIAPIPE_SELFIE_MODEL_PATH, resolvedBaseUrl).href,
		wasmUrl: new URL(MEDIAPIPE_VISION_WASM_PATH, resolvedBaseUrl).href,
	};
}
