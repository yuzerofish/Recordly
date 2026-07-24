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

	it("matches the reference face's large eyes, pupils, and compact toothy mouth", () => {
		const layout = createCartoonFaceLayout(
			{
				geometry: makeGeometry(),
				opacity: 1,
				unmaskedOpacity: 1,
				isFading: false,
			},
			640,
			360,
		)!;
		const interocularDistance = Math.abs(layout.imageRightEye.x - layout.imageLeftEye.x);

		expect(layout.imageLeftEye.radiusX / interocularDistance).toBeGreaterThanOrEqual(0.195);
		expect(layout.imageLeftEye.radiusX / interocularDistance).toBeLessThanOrEqual(0.215);
		expect(layout.imageLeftEye.radiusY / interocularDistance).toBeGreaterThanOrEqual(0.295);
		expect(layout.imageLeftEye.radiusY / interocularDistance).toBeLessThanOrEqual(0.315);
		expect(layout.imageLeftEye.pupilRadius / interocularDistance).toBeGreaterThanOrEqual(0.065);
		expect(layout.imageLeftEye.pupilRadius / interocularDistance).toBeLessThanOrEqual(0.071);
		expect(layout.mouth.width / interocularDistance).toBeGreaterThanOrEqual(0.66);
		expect(layout.mouth.width / interocularDistance).toBeLessThanOrEqual(0.72);
		expect(layout.mouth.height / layout.mouth.width).toBeGreaterThanOrEqual(0.39);
		expect(layout.mouth.height / layout.mouth.width).toBeLessThanOrEqual(0.44);
	});

	it("lets pupils follow extreme gaze to every white-eye edge without escaping it", () => {
		const base = makeGeometry();
		const layouts = [
			createCartoonFaceLayout(
				{
					geometry: makeGeometry({
						imageLeftEye: { ...base.imageLeftEye, iris: { x: 0.27, y: 0.35 } },
						imageRightEye: { ...base.imageRightEye, iris: { x: 0.73, y: 0.35 } },
					}),
					opacity: 1,
					unmaskedOpacity: 1,
					isFading: false,
				},
				640,
				360,
			)!,
			createCartoonFaceLayout(
				{
					geometry: makeGeometry({
						imageLeftEye: { ...base.imageLeftEye, iris: { x: 0.35, y: 0.27 } },
						imageRightEye: { ...base.imageRightEye, iris: { x: 0.65, y: 0.43 } },
					}),
					opacity: 1,
					unmaskedOpacity: 1,
					isFading: false,
				},
				640,
				360,
			)!,
		];

		for (const [index, layout] of layouts.entries()) {
			for (const eye of [layout.imageLeftEye, layout.imageRightEye]) {
				const occupiedRadius =
					(index === 0 ? Math.abs(eye.pupilX - eye.x) : Math.abs(eye.pupilY - eye.y)) +
					eye.pupilRadius;
				const whiteRadius = index === 0 ? eye.radiusX : eye.radiusY;
				expect(occupiedRadius / whiteRadius).toBeGreaterThanOrEqual(0.96);
				expect(occupiedRadius).toBeLessThanOrEqual(whiteRadius);
			}
		}
	});

	it("maps an anatomical right-eye blink to the image-left eye before the final mirror", () => {
		const layout = createCartoonFaceLayout(
			{
				geometry: makeGeometry({
					expression: {
						eyeBlinkLeft: 0,
						eyeBlinkRight: 1,
						mouthSmileLeft: 0,
						mouthSmileRight: 0,
						jawOpen: 0,
					},
				}),
				opacity: 1,
				unmaskedOpacity: 1,
				isFading: false,
			},
			640,
			360,
		)!;

		expect(layout.imageLeftEye.radiusY).toBeLessThan(layout.imageRightEye.radiusY * 0.25);
		expect(layout.imageLeftEye.pupilRadius).toBeLessThan(
			layout.imageRightEye.pupilRadius * 0.2,
		);
	});

	it("compresses both white eyes and hides their pupils for a double blink", () => {
		const layout = createCartoonFaceLayout(
			{
				geometry: makeGeometry({
					expression: {
						eyeBlinkLeft: 1,
						eyeBlinkRight: 1,
						mouthSmileLeft: 0,
						mouthSmileRight: 0,
						jawOpen: 0,
					},
				}),
				opacity: 1,
				unmaskedOpacity: 1,
				isFading: false,
			},
			640,
			360,
		)!;

		expect(layout.imageLeftEye.radiusY).toBeLessThan(layout.imageLeftEye.radiusX * 0.25);
		expect(layout.imageRightEye.radiusY).toBeLessThan(layout.imageRightEye.radiusX * 0.25);
		expect(layout.imageLeftEye.pupilOpacity).toBe(0);
		expect(layout.imageRightEye.pupilOpacity).toBe(0);
	});

	it("widens and lifts a clear grin while jawOpen independently increases mouth height", () => {
		const presentation = (expression?: CartoonFaceGeometry["expression"]) => ({
			geometry: makeGeometry({ expression }),
			opacity: 1,
			unmaskedOpacity: 1,
			isFading: false,
		});
		const neutral = createCartoonFaceLayout(presentation(undefined), 640, 360)!;
		const grin = createCartoonFaceLayout(
			presentation({
				eyeBlinkLeft: 0,
				eyeBlinkRight: 0,
				mouthSmileLeft: 1,
				mouthSmileRight: 1,
				jawOpen: 0,
			}),
			640,
			360,
		)!;
		const open = createCartoonFaceLayout(
			presentation({
				eyeBlinkLeft: 0,
				eyeBlinkRight: 0,
				mouthSmileLeft: 0,
				mouthSmileRight: 0,
				jawOpen: 1,
			}),
			640,
			360,
		)!;

		expect(grin.mouth.width).toBeGreaterThan(neutral.mouth.width * 1.2);
		expect(grin.mouth.leftCornerLift).toBeGreaterThan(neutral.mouth.leftCornerLift);
		expect(grin.mouth.rightCornerLift).toBeGreaterThan(neutral.mouth.rightCornerLift);
		expect(open.mouth.height).toBeGreaterThan(neutral.mouth.height * 1.5);
		expect(open.mouth.y).toBeGreaterThan(neutral.mouth.y);
		expect(open.mouth.leftCornerLift).toBeCloseTo(neutral.mouth.leftCornerLift, 6);
		expect(open.mouth.rightCornerLift).toBeCloseTo(neutral.mouth.rightCornerLift, 6);
	});

	it("uses the friendly neutral toothy layout when blendshapes are missing", () => {
		const withoutBlendshapes = createCartoonFaceLayout(
			{
				geometry: makeGeometry(),
				opacity: 1,
				unmaskedOpacity: 1,
				isFading: false,
			},
			640,
			360,
		)!;
		const explicitNeutral = createCartoonFaceLayout(
			{
				geometry: makeGeometry({
					expression: {
						eyeBlinkLeft: 0,
						eyeBlinkRight: 0,
						mouthSmileLeft: 0,
						mouthSmileRight: 0,
						jawOpen: 0,
					},
				}),
				opacity: 1,
				unmaskedOpacity: 1,
				isFading: false,
			},
			640,
			360,
		)!;

		expect(withoutBlendshapes).toEqual(explicitNeutral);
		expect(withoutBlendshapes.mouth.height).toBeGreaterThan(0);
	});

	it("extracts and clamps the five required MediaPipe blendshapes", () => {
		const geometry = extractCartoonFaceGeometry(makeLandmarks(), 1250, [
			{ categoryName: "eyeBlinkLeft", score: 0.25 },
			{ categoryName: "eyeBlinkRight", score: 1.2 },
			{ categoryName: "mouthSmileLeft", score: 0.6 },
			{ categoryName: "mouthSmileRight", score: 0.7 },
			{ categoryName: "jawOpen", score: -0.5 },
		]);

		expect(geometry?.expression).toEqual({
			eyeBlinkLeft: 0.25,
			eyeBlinkRight: 1,
			mouthSmileLeft: 0.6,
			mouthSmileRight: 0.7,
			jawOpen: 0,
		});
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
		expect(tracker.update(null, CARTOON_FACE_LOSS_FADE_MS / 2)).toMatchObject({
			opacity: 1,
			unmaskedOpacity: 0.5,
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

	it("holds a missing face for bounded hysteresis only while the person mask remains present", () => {
		const facePresent = new CartoonFaceTracker();
		const personGone = new CartoonFaceTracker();
		facePresent.update(makeGeometry(), 0);
		personGone.update(makeGeometry(), 0);

		expect(facePresent.update(null, 600, false, true)).toMatchObject({ opacity: 1 });
		expect(facePresent.update(null, 801, false, true)).toBeNull();
		expect(personGone.update(null, 151, false, false)).toBeNull();
	});

	it("smooths expressions only from media timestamps and yields identical preview/export state", () => {
		const preview = new CartoonFaceTracker();
		const exporter = new CartoonFaceTracker();
		const samples = [
			makeGeometry({
				timestampMs: 0,
				expression: {
					eyeBlinkLeft: 0,
					eyeBlinkRight: 0,
					mouthSmileLeft: 0,
					mouthSmileRight: 0,
					jawOpen: 0,
				},
			}),
			makeGeometry({
				timestampMs: 40,
				expression: {
					eyeBlinkLeft: 1,
					eyeBlinkRight: 0.5,
					mouthSmileLeft: 1,
					mouthSmileRight: 0.8,
					jawOpen: 0.9,
				},
			}),
		];

		const previewPresentation = samples.map((sample) =>
			preview.update(sample, sample.timestampMs),
		);
		const exportPresentation = samples.map((sample) =>
			exporter.update(sample, sample.timestampMs),
		);

		expect(previewPresentation).toEqual(exportPresentation);
		expect(previewPresentation[1]?.geometry.expression?.eyeBlinkLeft).toBeGreaterThan(0);
		expect(previewPresentation[1]?.geometry.expression?.eyeBlinkLeft).toBeLessThan(1);
	});
});

describe("drawCartoonFace", () => {
	it("draws two white eyes, edge-clipped pupils, and a six-column toothy smile", () => {
		const fillStyles: string[] = [];
		const strokeStyles: string[] = [];
		const moveTo = vi.fn();
		const context = {
			save: vi.fn(),
			restore: vi.fn(),
			translate: vi.fn(),
			rotate: vi.fn(),
			beginPath: vi.fn(),
			closePath: vi.fn(),
			moveTo,
			lineTo: vi.fn(),
			quadraticCurveTo: vi.fn(),
			ellipse: vi.fn(),
			arc: vi.fn(),
			fill: vi.fn(),
			stroke: vi.fn(),
			clip: vi.fn(),
			globalAlpha: 1,
			get fillStyle() {
				return fillStyles.at(-1) ?? "#000000";
			},
			set fillStyle(value) {
				fillStyles.push(String(value));
			},
			get strokeStyle() {
				return strokeStyles.at(-1) ?? "#000000";
			},
			set strokeStyle(value) {
				strokeStyles.push(String(value));
			},
			lineWidth: 1,
		} as unknown as CanvasRenderingContext2D;
		const layout = createCartoonFaceLayout(
			{
				geometry: makeGeometry({
					expression: {
						eyeBlinkLeft: 0,
						eyeBlinkRight: 0,
						mouthSmileLeft: 0.62,
						mouthSmileRight: 0.62,
						jawOpen: 1,
					},
				}),
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
		expect(context.clip).toHaveBeenCalledTimes(3);
		expect(context.lineTo).toHaveBeenCalledTimes(5);
		expect(context.globalAlpha).toBe(0.75);
		expect(fillStyles.filter((style) => style === "#000000")).toHaveLength(2);
		expect(strokeStyles).toEqual(["#000000"]);
		for (const [, startY] of moveTo.mock.calls.slice(-5)) {
			expect(startY).toBeCloseTo(layout.mouth.y - layout.mouth.height, 6);
		}
	});
});
