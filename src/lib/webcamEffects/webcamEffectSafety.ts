import type { WebcamEffectType } from "@/components/video-editor/types";
import type { WebcamEffectPipelineStatus } from "./WebcamEffectPipeline";

export function getWebcamEffectLayerVisibility({
	effectType,
}: {
	effectType: WebcamEffectType;
	status: WebcamEffectPipelineStatus;
	hasSafeFrame: boolean;
}): { rawOpacity: 0 | 1; processedOpacity: 0 | 1 } {
	if (effectType === "silhouette" || effectType === "monkey") {
		return { rawOpacity: 0, processedOpacity: 1 };
	}
	return { rawOpacity: 1, processedOpacity: 0 };
}

export function getSafeWebcamFrameAction({
	hasSafeFrame,
	processed,
}: {
	hasSafeFrame: boolean;
	processed: boolean;
	discontinuity: boolean;
}): "replace" | "preserve" | "transparent" {
	if (processed) return "replace";
	return hasSafeFrame ? "preserve" : "transparent";
}
