import { describe, expect, it, vi } from "vitest";
import type { WebcamEffectSettings } from "@/components/video-editor/types";
import type { CartoonFacePresentation } from "./cartoonFace";
import type { CartoonFaceGeometry } from "./messages";
import { composeSilhouettePixels, SilhouetteCompositor } from "./silhouetteCompositor";

const settings: WebcamEffectSettings = {
	type: "silhouette",
	silhouetteColor: "#050505",
	opacity: 1,
	feather: 0,
	background: "transparent",
};

function makeFace(isFading: boolean): CartoonFacePresentation {
	const geometry: CartoonFaceGeometry = {
		timestampMs: 0,
		imageLeftEye: {
			outer: { x: 0.3, y: 0.35 },
			inner: { x: 0.4, y: 0.35 },
			upper: { x: 0.35, y: 0.33 },
			lower: { x: 0.35, y: 0.37 },
		},
		imageRightEye: {
			outer: { x: 0.7, y: 0.35 },
			inner: { x: 0.6, y: 0.35 },
			upper: { x: 0.65, y: 0.33 },
			lower: { x: 0.65, y: 0.37 },
		},
		mouth: {
			left: { x: 0.42, y: 0.55 },
			right: { x: 0.58, y: 0.55 },
			upper: { x: 0.5, y: 0.53 },
			lower: { x: 0.5, y: 0.57 },
		},
		face: {
			left: { x: 0.25, y: 0.45 },
			right: { x: 0.75, y: 0.45 },
			top: { x: 0.5, y: 0.15 },
			bottom: { x: 0.5, y: 0.75 },
		},
	};
	return {
		geometry,
		opacity: isFading ? 0.5 : 1,
		unmaskedOpacity: isFading ? 0.25 : 1,
		isFading,
	};
}

function createFakeContext() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		clearRect: vi.fn(),
		createImageData: vi.fn((width: number, height: number) => ({
			data: new Uint8ClampedArray(width * height * 4),
		})),
		putImageData: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		beginPath: vi.fn(),
		closePath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		quadraticCurveTo: vi.fn(),
		ellipse: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		clip: vi.fn(),
		filter: "none",
		globalAlpha: 1,
		globalCompositeOperation: "source-over",
		fillStyle: "#000000",
		strokeStyle: "#000000",
		lineWidth: 1,
	};
}

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

describe("SilhouetteCompositor cartoon face loss", () => {
	it("clips a detected face to the person but lets deterministic artwork finish its fade", () => {
		const contexts = Array.from({ length: 4 }, createFakeContext);
		let canvasIndex = 0;
		const compositor = new SilhouetteCompositor({
			createCanvas: () => {
				const context = contexts[canvasIndex++];
				return {
					width: 1,
					height: 1,
					getContext: () => context,
				} as unknown as HTMLCanvasElement;
			},
		});
		const source = { width: 640, height: 360 } as unknown as CanvasImageSource;
		const mask = { width: 1, height: 1, data: new Float32Array([0]), timestampMs: 0 };
		const faceContext = contexts[3]!;

		compositor.compose(source, mask, settings, makeFace(false));
		expect(faceContext.drawImage).toHaveBeenCalledTimes(1);

		faceContext.drawImage.mockClear();
		compositor.compose(source, mask, settings, makeFace(true));
		expect(faceContext.drawImage).not.toHaveBeenCalled();
		expect(faceContext.globalAlpha).toBe(0.25);

		faceContext.drawImage.mockClear();
		compositor.compose(
			source,
			{ ...mask, data: new Float32Array([1]) },
			{ ...settings, opacity: 0.4 },
			makeFace(true),
		);
		expect(faceContext.drawImage).toHaveBeenCalledTimes(1);
		expect(faceContext.globalAlpha).toBeCloseTo(0.2);
	});

	it("hides the cartoon face when the silhouette strength is zero", () => {
		const contexts = Array.from({ length: 4 }, createFakeContext);
		let canvasIndex = 0;
		const compositor = new SilhouetteCompositor({
			createCanvas: () => {
				const context = contexts[canvasIndex++];
				return {
					width: 1,
					height: 1,
					getContext: () => context,
				} as unknown as HTMLCanvasElement;
			},
		});
		const faceContext = contexts[3]!;

		compositor.compose(
			{ width: 640, height: 360 } as unknown as CanvasImageSource,
			{ width: 1, height: 1, data: new Float32Array([1]), timestampMs: 0 },
			{ ...settings, opacity: 0 },
			makeFace(false),
		);

		expect(faceContext.ellipse).not.toHaveBeenCalled();
		expect(faceContext.fill).not.toHaveBeenCalled();
	});
});
