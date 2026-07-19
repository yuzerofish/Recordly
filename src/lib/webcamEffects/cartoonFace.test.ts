import { describe, expect, it, vi } from "vitest";
import {
	CARTOON_FACE_LOSS_FADE_MS,
	CARTOON_FACE_LOSS_HOLD_MS,
	CartoonFaceTracker,
	createCartoonFaceLayout,
	drawCartoonFace,
	extractCartoonFaceGeometry,
} from "./cartoonFace";
import type { CartoonFaceGeometry } from "./messages";

function makeGeometry(overrides: Partial<CartoonFaceGeometry> = {}): CartoonFaceGeometry {
	return {
		timestampMs: 0,
		imageLeftEye: {
			outer: { x: 0.3, y: 0.35 },
			inner: { x: 0.4, y: 0.35 },
			upper: { x: 0.35, y: 0.33 },
			lower: { x: 0.35, y: 0.37 },
			iris: { x: 0.36, y: 0.35 },
		},
		imageRightEye: {
			outer: { x: 0.7, y: 0.35 },
			inner: { x: 0.6, y: 0.35 },
			upper: { x: 0.65, y: 0.33 },
			lower: { x: 0.65, y: 0.37 },
			iris: { x: 0.64, y: 0.35 },
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
		...overrides,
	};
}

function makeLandmarks(): Array<{ x: number; y: number }> {
	const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
	const geometry = makeGeometry();
	const assignments = new Map<number, { x: number; y: number }>([
		[33, geometry.imageLeftEye.outer],
		[133, geometry.imageLeftEye.inner],
		[159, geometry.imageLeftEye.upper],
		[145, geometry.imageLeftEye.lower],
		[468, geometry.imageLeftEye.iris!],
		[263, geometry.imageRightEye.outer],
		[362, geometry.imageRightEye.inner],
		[386, geometry.imageRightEye.upper],
		[374, geometry.imageRightEye.lower],
		[473, geometry.imageRightEye.iris!],
		[61, geometry.mouth.left],
		[291, geometry.mouth.right],
		[13, geometry.mouth.upper],
		[14, geometry.mouth.lower],
		[234, geometry.face.left],
		[454, geometry.face.right],
		[10, geometry.face.top],
		[152, geometry.face.bottom],
	]);
	for (const [index, value] of assignments) landmarks[index] = value;
	return landmarks;
}

function translateGeometry(
	geometry: CartoonFaceGeometry,
	timestampMs: number,
	deltaX: number,
	deltaY = 0,
): CartoonFaceGeometry {
	const translate = (value: { x: number; y: number }) => ({
		x: value.x + deltaX,
		y: value.y + deltaY,
	});
	const translateEye = (eye: CartoonFaceGeometry["imageLeftEye"]) => ({
		outer: translate(eye.outer),
		inner: translate(eye.inner),
		upper: translate(eye.upper),
		lower: translate(eye.lower),
		...(eye.iris ? { iris: translate(eye.iris) } : {}),
	});
	return {
		timestampMs,
		imageLeftEye: translateEye(geometry.imageLeftEye),
		imageRightEye: translateEye(geometry.imageRightEye),
		mouth: {
			left: translate(geometry.mouth.left),
			right: translate(geometry.mouth.right),
			upper: translate(geometry.mouth.upper),
			lower: translate(geometry.mouth.lower),
		},
		face: {
			left: translate(geometry.face.left),
			right: translate(geometry.face.right),
			top: translate(geometry.face.top),
			bottom: translate(geometry.face.bottom),
		},
	};
}

describe("cartoon face geometry", () => {
	it("extracts only the production landmarks from MediaPipe output", () => {
		const geometry = extractCartoonFaceGeometry(makeLandmarks(), 1250);

		expect(geometry).toMatchObject({
			timestampMs: 1250,
			imageLeftEye: { iris: { x: 0.36, y: 0.35 } },
			imageRightEye: { iris: { x: 0.64, y: 0.35 } },
			mouth: { left: { x: 0.42, y: 0.55 }, right: { x: 0.58, y: 0.55 } },
		});
	});

	it("rejects incomplete or invalid detections", () => {
		const incomplete = makeLandmarks().slice(0, 100);
		const invalid = makeLandmarks();
		invalid[33] = { x: Number.NaN, y: 0.4 };

		expect(extractCartoonFaceGeometry(incomplete, 0)).toBeNull();
		expect(extractCartoonFaceGeometry(invalid, 0)).toBeNull();
	});

	it("uses source pixel aspect ratio when calculating head roll", () => {
		const geometry = makeGeometry({
			imageLeftEye: {
				outer: { x: 0.28, y: 0.38 },
				inner: { x: 0.32, y: 0.42 },
				upper: { x: 0.3, y: 0.38 },
				lower: { x: 0.3, y: 0.42 },
			},
			imageRightEye: {
				outer: { x: 0.72, y: 0.48 },
				inner: { x: 0.68, y: 0.52 },
				upper: { x: 0.7, y: 0.48 },
				lower: { x: 0.7, y: 0.52 },
			},
		});
		const layout = createCartoonFaceLayout(
			{ geometry, opacity: 1, unmaskedOpacity: 1, isFading: false },
			1600,
			900,
		);

		expect(layout?.rollRadians).toBeCloseTo(Math.atan2(90, 640), 6);
	});

	it("scales the same source-normalized face without changing its angle", () => {
		const presentation = {
			geometry: makeGeometry(),
			opacity: 1,
			unmaskedOpacity: 1,
			isFading: false,
		};
		const small = createCartoonFaceLayout(presentation, 640, 360)!;
		const large = createCartoonFaceLayout(presentation, 1280, 720)!;

		expect(large.originX).toBeCloseTo(small.originX * 2, 6);
		expect(large.originY).toBeCloseTo(small.originY * 2, 6);
		expect(large.imageLeftEye.radiusX).toBeCloseTo(small.imageLeftEye.radiusX * 2, 6);
		expect(large.mouth.width).toBeCloseTo(small.mouth.width * 2, 6);
		expect(large.rollRadians).toBeCloseTo(small.rollRadians, 6);
	});

	it("maps source coordinates through asymmetric crop and one final mirror", () => {
		const geometry = makeGeometry({
			imageLeftEye: {
				outer: { x: 0.18, y: 0.35 },
				inner: { x: 0.28, y: 0.35 },
				upper: { x: 0.23, y: 0.33 },
				lower: { x: 0.23, y: 0.37 },
			},
			imageRightEye: {
				outer: { x: 0.58, y: 0.35 },
				inner: { x: 0.48, y: 0.35 },
				upper: { x: 0.53, y: 0.33 },
				lower: { x: 0.53, y: 0.37 },
			},
		});
		const layout = createCartoonFaceLayout(
			{ geometry, opacity: 1, unmaskedOpacity: 1, isFading: false },
			640,
			360,
		)!;
		const crop = { x: 160, y: 36, width: 320, height: 288 };
		const target = { width: 200, height: 180 };
		const croppedX = ((layout.originX - crop.x) / crop.width) * target.width;
		const croppedY = ((layout.originY - crop.y) / crop.height) * target.height;
		const mirroredX = target.width - croppedX;

		expect(croppedX).toBeCloseTo(52, 6);
		expect(croppedY).toBeCloseTo(56.25, 6);
		expect(mirroredX).toBeCloseTo(148, 6);
		expect(target.width - mirroredX).toBeCloseTo(croppedX, 6);
	});
});

describe("CartoonFaceTracker", () => {
	it("smoothly fades a lost face and then removes every feature", () => {
		const tracker = new CartoonFaceTracker();
		const geometry = makeGeometry();

		expect(tracker.update(geometry, 0)).toMatchObject({
			opacity: 1,
			unmaskedOpacity: 1,
			isFading: false,
		});
		expect(tracker.update(null, CARTOON_FACE_LOSS_HOLD_MS / 2)).toMatchObject({
			opacity: 1,
			unmaskedOpacity: 1 - CARTOON_FACE_LOSS_HOLD_MS / 2 / CARTOON_FACE_LOSS_FADE_MS,
			isFading: true,
		});
		expect(tracker.update(null, CARTOON_FACE_LOSS_HOLD_MS)).toMatchObject({ opacity: 1 });
		expect(
			tracker.update(null, CARTOON_FACE_LOSS_HOLD_MS + CARTOON_FACE_LOSS_FADE_MS / 2),
		).toMatchObject({
			opacity: 0.5,
			unmaskedOpacity: 0,
		});
		expect(
			tracker.update(null, CARTOON_FACE_LOSS_HOLD_MS + CARTOON_FACE_LOSS_FADE_MS + 1),
		).toBeNull();
	});

	it("predicts bounded short position changes while face detection is intermittent", () => {
		const tracker = new CartoonFaceTracker();
		const first = makeGeometry({ timestampMs: 0 });
		const shifted = makeGeometry({
			timestampMs: 100,
			imageLeftEye: {
				...first.imageLeftEye,
				outer: { x: first.imageLeftEye.outer.x + 0.05, y: first.imageLeftEye.outer.y },
				inner: { x: first.imageLeftEye.inner.x + 0.05, y: first.imageLeftEye.inner.y },
				upper: { x: first.imageLeftEye.upper.x + 0.05, y: first.imageLeftEye.upper.y },
				lower: { x: first.imageLeftEye.lower.x + 0.05, y: first.imageLeftEye.lower.y },
			},
			imageRightEye: {
				...first.imageRightEye,
				outer: { x: first.imageRightEye.outer.x + 0.05, y: first.imageRightEye.outer.y },
				inner: { x: first.imageRightEye.inner.x + 0.05, y: first.imageRightEye.inner.y },
				upper: { x: first.imageRightEye.upper.x + 0.05, y: first.imageRightEye.upper.y },
				lower: { x: first.imageRightEye.lower.x + 0.05, y: first.imageRightEye.lower.y },
			},
		});
		tracker.update(first, 0);
		tracker.update(shifted, 100);

		const predicted = tracker.update(null, 150);

		expect(predicted).toMatchObject({ opacity: 1, isFading: true });
		expect(predicted?.geometry.imageLeftEye.outer.x).toBeCloseTo(0.375, 6);
		expect(predicted?.geometry.timestampMs).toBe(150);
	});

	it("predicts the same media-time position across different inference sampling intervals", () => {
		const current = makeGeometry({ timestampMs: 100 });
		const slowTracker = new CartoonFaceTracker();
		const fastTracker = new CartoonFaceTracker();
		slowTracker.update(translateGeometry(current, 0, -0.05), 0);
		slowTracker.update(current, 100);
		fastTracker.update(translateGeometry(current, 67, -0.0165), 67);
		fastTracker.update(current, 100);

		const slowPrediction = slowTracker.update(null, 150);
		const fastPrediction = fastTracker.update(null, 150);

		expect(slowPrediction?.geometry.imageLeftEye.outer.x).toBeCloseTo(0.325, 6);
		expect(fastPrediction?.geometry.imageLeftEye.outer.x).toBeCloseTo(0.325, 6);
		expect(fastPrediction?.geometry.mouth.right.x).toBeCloseTo(
			slowPrediction?.geometry.mouth.right.x ?? 0,
			6,
		);
		expect(fastPrediction?.geometry.face.top.y).toBeCloseTo(
			slowPrediction?.geometry.face.top.y ?? 0,
			6,
		);
		expect(fastPrediction?.opacity).toBe(slowPrediction?.opacity);
	});

	it("clears the old face immediately across a seek discontinuity", () => {
		const tracker = new CartoonFaceTracker();
		tracker.update(makeGeometry(), 100);

		expect(tracker.update(null, 5000, true)).toBeNull();
	});
});

describe("drawCartoonFace", () => {
	it("draws two white eyes, two dark pupils, and a divided toothy smile", () => {
		const context = {
			save: vi.fn(),
			restore: vi.fn(),
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
			globalAlpha: 1,
			fillStyle: "#000000",
			strokeStyle: "#000000",
			lineWidth: 1,
		} as unknown as CanvasRenderingContext2D;
		const layout = createCartoonFaceLayout(
			{
				geometry: makeGeometry(),
				opacity: 0.75,
				unmaskedOpacity: 0.75,
				isFading: false,
			},
			640,
			360,
		)!;

		drawCartoonFace(context, layout);

		expect(context.ellipse).toHaveBeenCalledTimes(2);
		expect(context.arc).toHaveBeenCalledTimes(2);
		expect(context.clip).toHaveBeenCalledTimes(1);
		expect(context.lineTo).toHaveBeenCalledTimes(4);
		expect(context.globalAlpha).toBe(0.75);
	});
});
