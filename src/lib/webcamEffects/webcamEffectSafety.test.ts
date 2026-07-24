import { describe, expect, it } from "vitest";
import { getSafeWebcamFrameAction, getWebcamEffectLayerVisibility } from "./webcamEffectSafety";

describe("webcam effect fail-closed presentation", () => {
	it("never exposes the raw webcam while silhouette mode is loading or failed", () => {
		for (const status of ["loading", "ready", "fallback"] as const) {
			expect(
				getWebcamEffectLayerVisibility({
					effectType: "silhouette",
					status,
					hasSafeFrame: status === "ready",
				}),
			).toEqual({
				rawOpacity: 0,
				processedOpacity: 1,
			});
		}
	});

	it("uses the raw webcam only when the silhouette effect is disabled", () => {
		expect(
			getWebcamEffectLayerVisibility({
				effectType: "none",
				status: "idle",
				hasSafeFrame: false,
			}),
		).toEqual({
			rawOpacity: 1,
			processedOpacity: 0,
		});
	});

	it("preserves the previous safe frame during seek inference and worker fallback", () => {
		expect(
			getSafeWebcamFrameAction({
				hasSafeFrame: true,
				processed: false,
				discontinuity: true,
			}),
		).toBe("preserve");
		expect(
			getSafeWebcamFrameAction({
				hasSafeFrame: true,
				processed: false,
				discontinuity: false,
			}),
		).toBe("preserve");
	});

	it("uses a transparent safe placeholder before the first processed frame", () => {
		expect(
			getSafeWebcamFrameAction({
				hasSafeFrame: false,
				processed: false,
				discontinuity: true,
			}),
		).toBe("transparent");
		expect(
			getSafeWebcamFrameAction({
				hasSafeFrame: false,
				processed: true,
				discontinuity: false,
			}),
		).toBe("replace");
	});
});
