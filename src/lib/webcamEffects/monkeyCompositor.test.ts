import { describe, expect, it, vi } from "vitest";
import type { WebcamEffectSettings } from "@/components/video-editor/types";
import type { CartoonFacePresentation } from "./cartoonFace";
import { MonkeyCompositor } from "./monkeyCompositor";

const settings: WebcamEffectSettings = {
	type: "monkey",
	silhouetteColor: "#000000",
	opacity: 1,
	feather: 6,
	background: "transparent",
};

function context() {
	return {
		save: vi.fn(),
		restore: vi.fn(),
		clearRect: vi.fn(),
		drawImage: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn(),
		rotate: vi.fn(),
		beginPath: vi.fn(),
		closePath: vi.fn(),
		moveTo: vi.fn(),
		bezierCurveTo: vi.fn(),
		fill: vi.fn(),
		fillRect: vi.fn(),
		filter: "none",
		fillStyle: "#000000",
		shadowColor: "transparent",
		shadowBlur: 0,
		globalAlpha: 1,
		globalCompositeOperation: "source-over",
	};
}

function face(): CartoonFacePresentation {
	return {
		opacity: 1,
		unmaskedOpacity: 1,
		isFading: false,
		geometry: {
			timestampMs: 100,
			expression: {
				eyeBlinkLeft: 0.2,
				eyeBlinkRight: 0.1,
				mouthSmileLeft: 0.8,
				mouthSmileRight: 0.7,
				jawOpen: 0.6,
			},
			imageLeftEye: {
				outer: { x: 0.25, y: 0.35 },
				inner: { x: 0.4, y: 0.35 },
				upper: { x: 0.325, y: 0.32 },
				lower: { x: 0.325, y: 0.38 },
			},
			imageRightEye: {
				outer: { x: 0.75, y: 0.35 },
				inner: { x: 0.6, y: 0.35 },
				upper: { x: 0.675, y: 0.32 },
				lower: { x: 0.675, y: 0.38 },
			},
			mouth: {
				left: { x: 0.42, y: 0.6 },
				right: { x: 0.58, y: 0.6 },
				upper: { x: 0.5, y: 0.56 },
				lower: { x: 0.5, y: 0.66 },
			},
			face: {
				left: { x: 0.2, y: 0.45 },
				right: { x: 0.8, y: 0.45 },
				top: { x: 0.5, y: 0.12 },
				bottom: { x: 0.5, y: 0.82 },
			},
		},
	};
}

describe("MonkeyCompositor", () => {
	it("renders a fixed safe scene without copying the camera when no face is present", async () => {
		const contexts = [context(), context(), context()];
		let index = 0;
		const scene = { width: 1600, height: 900 } as CanvasImageSource;
		const source = { width: 640, height: 360 } as CanvasImageSource;
		const compositor = new MonkeyCompositor({
			createCanvas: () =>
				({
					width: 1,
					height: 1,
					getContext: () => contexts[index++],
				}) as unknown as HTMLCanvasElement,
			loadScene: async () => scene,
		});

		await compositor.prepare();
		compositor.compose(source, settings, null);

		expect(contexts[0]?.drawImage).toHaveBeenCalledWith(scene, 0, 0, 640, 360);
		expect(contexts[1]?.drawImage).not.toHaveBeenCalled();
	});

	it("applies tiled lens warping to three face regions and preflips the static scene", async () => {
		const contexts = [context(), context(), context()];
		let index = 0;
		const scene = { width: 1600, height: 900 } as CanvasImageSource;
		const source = { width: 640, height: 360 } as CanvasImageSource;
		const compositor = new MonkeyCompositor({
			createCanvas: () =>
				({
					width: 1,
					height: 1,
					getContext: () => contexts[index++],
				}) as unknown as HTMLCanvasElement,
			loadScene: async () => scene,
		});

		await compositor.prepare();
		compositor.compose(source, settings, face(), true);

		expect(contexts[0]?.scale).toHaveBeenCalledWith(-1, 1);
		expect(
			contexts[1]?.drawImage.mock.calls.filter(([drawn]) => drawn === source),
		).toHaveLength(16 * 12 * 3);
		expect(contexts[1]?.fillStyle).toBe("#e34d70");
		expect(contexts[2]?.bezierCurveTo).toHaveBeenCalledTimes(6);
	});
});
