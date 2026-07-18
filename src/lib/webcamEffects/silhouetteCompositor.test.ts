import { describe, expect, it } from "vitest";
import type { WebcamEffectSettings } from "@/components/video-editor/types";
import { composeSilhouettePixels } from "./silhouetteCompositor";

const settings: WebcamEffectSettings = {
	type: "silhouette",
	silhouetteColor: "#050505",
	opacity: 1,
	feather: 0,
	background: "transparent",
};

describe("composeSilhouettePixels", () => {
	it("renders person pixels pure black and background pixels transparent", () => {
		const source = new Uint8ClampedArray([200, 120, 80, 255, 20, 40, 60, 255]);
		const result = composeSilhouettePixels(source, new Float32Array([1, 0]), settings);

		expect(Array.from(result)).toEqual([5, 5, 5, 255, 5, 5, 5, 0]);
	});

	it("keeps silhouette RGB stable while applying opacity to alpha", () => {
		const result = composeSilhouettePixels(
			new Uint8ClampedArray([255, 0, 0, 255]),
			new Float32Array([0.5]),
			{ ...settings, opacity: 0.5 },
		);

		expect(Array.from(result)).toEqual([5, 5, 5, 64]);
	});

	it("overlays the silhouette on an original background when requested", () => {
		const result = composeSilhouettePixels(
			new Uint8ClampedArray([205, 105, 55, 255]),
			new Float32Array([1]),
			{ ...settings, opacity: 0.5, background: "original" },
		);

		expect(Array.from(result)).toEqual([105, 55, 30, 255]);
	});

	it("rejects mismatched source and mask data", () => {
		expect(() =>
			composeSilhouettePixels(new Uint8ClampedArray(8), new Float32Array(1), settings),
		).toThrow(/do not match/);
	});
});
