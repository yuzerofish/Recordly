import type { CartoonFaceEyeGeometry, CartoonFaceGeometry, NormalizedFacePoint } from "./messages";

type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface LandmarkLike {
	x?: number;
	y?: number;
}

interface PixelPoint {
	x: number;
	y: number;
}

interface EyeLandmarkIndices {
	outer: number;
	inner: number;
	upper: number;
	lower: number;
	iris: number;
}

export interface CartoonFacePresentation {
	geometry: CartoonFaceGeometry;
	opacity: number;
	unmaskedOpacity: number;
	isFading: boolean;
}

export interface CartoonEyeLayout {
	x: number;
	y: number;
	radiusX: number;
	radiusY: number;
	pupilX: number;
	pupilY: number;
	pupilRadius: number;
}

export interface CartoonMouthLayout {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CartoonFaceLayout {
	originX: number;
	originY: number;
	rollRadians: number;
	opacity: number;
	imageLeftEye: CartoonEyeLayout;
	imageRightEye: CartoonEyeLayout;
	mouth: CartoonMouthLayout;
}

export const CARTOON_FACE_LOSS_FADE_MS = 150;
export const CARTOON_FACE_LOSS_HOLD_MS = 150;
const CARTOON_FACE_PREDICTION_HORIZON_MS = 120;
const MAX_NORMALIZED_CENTER_SPEED_PER_MS = 0.001;

const LANDMARK_INDEX = {
	imageLeftEye: { outer: 33, inner: 133, upper: 159, lower: 145, iris: 468 },
	imageRightEye: { outer: 263, inner: 362, upper: 386, lower: 374, iris: 473 },
	mouth: { left: 61, right: 291, upper: 13, lower: 14 },
	face: { left: 234, right: 454, top: 10, bottom: 152 },
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function point(landmarks: LandmarkLike[], index: number): NormalizedFacePoint | null {
	const landmark = landmarks[index];
	if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
	return { x: landmark.x as number, y: landmark.y as number };
}

function eyeGeometry(
	landmarks: LandmarkLike[],
	indices: EyeLandmarkIndices,
): CartoonFaceEyeGeometry | null {
	const outer = point(landmarks, indices.outer);
	const inner = point(landmarks, indices.inner);
	const upper = point(landmarks, indices.upper);
	const lower = point(landmarks, indices.lower);
	if (!outer || !inner || !upper || !lower) return null;
	return {
		outer,
		inner,
		upper,
		lower,
		...(point(landmarks, indices.iris) ? { iris: point(landmarks, indices.iris)! } : {}),
	};
}

export function extractCartoonFaceGeometry(
	landmarks: LandmarkLike[] | undefined,
	timestampMs: number,
): CartoonFaceGeometry | null {
	if (!landmarks) return null;
	const imageLeftEye = eyeGeometry(landmarks, LANDMARK_INDEX.imageLeftEye);
	const imageRightEye = eyeGeometry(landmarks, LANDMARK_INDEX.imageRightEye);
	const mouthLeft = point(landmarks, LANDMARK_INDEX.mouth.left);
	const mouthRight = point(landmarks, LANDMARK_INDEX.mouth.right);
	const mouthUpper = point(landmarks, LANDMARK_INDEX.mouth.upper);
	const mouthLower = point(landmarks, LANDMARK_INDEX.mouth.lower);
	const faceLeft = point(landmarks, LANDMARK_INDEX.face.left);
	const faceRight = point(landmarks, LANDMARK_INDEX.face.right);
	const faceTop = point(landmarks, LANDMARK_INDEX.face.top);
	const faceBottom = point(landmarks, LANDMARK_INDEX.face.bottom);
	if (
		!imageLeftEye ||
		!imageRightEye ||
		!mouthLeft ||
		!mouthRight ||
		!mouthUpper ||
		!mouthLower ||
		!faceLeft ||
		!faceRight ||
		!faceTop ||
		!faceBottom
	) {
		return null;
	}
	return {
		timestampMs,
		imageLeftEye,
		imageRightEye,
		mouth: { left: mouthLeft, right: mouthRight, upper: mouthUpper, lower: mouthLower },
		face: { left: faceLeft, right: faceRight, top: faceTop, bottom: faceBottom },
	};
}

function toPixel(point: NormalizedFacePoint, width: number, height: number): PixelPoint {
	return { x: point.x * width, y: point.y * height };
}

function midpoint(first: PixelPoint, second: PixelPoint): PixelPoint {
	return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: PixelPoint, second: PixelPoint): number {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizedEyeCenter(eye: CartoonFaceEyeGeometry): NormalizedFacePoint {
	return {
		x: (eye.outer.x + eye.inner.x + eye.upper.x + eye.lower.x) / 4,
		y: (eye.outer.y + eye.inner.y + eye.upper.y + eye.lower.y) / 4,
	};
}

function predictGeometry(
	previous: CartoonFaceGeometry | null,
	current: CartoonFaceGeometry,
	timestampMs: number,
): CartoonFaceGeometry {
	if (!previous || current.timestampMs <= previous.timestampMs) {
		return { ...current, timestampMs };
	}

	const previousLeft = normalizedEyeCenter(previous.imageLeftEye);
	const previousRight = normalizedEyeCenter(previous.imageRightEye);
	const currentLeft = normalizedEyeCenter(current.imageLeftEye);
	const currentRight = normalizedEyeCenter(current.imageRightEye);
	const previousCenter = {
		x: (previousLeft.x + previousRight.x) / 2,
		y: (previousLeft.y + previousRight.y) / 2,
	};
	const currentCenter = {
		x: (currentLeft.x + currentRight.x) / 2,
		y: (currentLeft.y + currentRight.y) / 2,
	};
	const sampleIntervalMs = current.timestampMs - previous.timestampMs;
	const predictionIntervalMs = clamp(
		timestampMs - current.timestampMs,
		0,
		CARTOON_FACE_PREDICTION_HORIZON_MS,
	);
	const centerVelocityX = clamp(
		(currentCenter.x - previousCenter.x) / sampleIntervalMs,
		-MAX_NORMALIZED_CENTER_SPEED_PER_MS,
		MAX_NORMALIZED_CENTER_SPEED_PER_MS,
	);
	const centerVelocityY = clamp(
		(currentCenter.y - previousCenter.y) / sampleIntervalMs,
		-MAX_NORMALIZED_CENTER_SPEED_PER_MS,
		MAX_NORMALIZED_CENTER_SPEED_PER_MS,
	);
	const predictedCenter = {
		x: currentCenter.x + centerVelocityX * predictionIntervalMs,
		y: currentCenter.y + centerVelocityY * predictionIntervalMs,
	};
	const transformPoint = (value: NormalizedFacePoint): NormalizedFacePoint => {
		return {
			x: value.x + predictedCenter.x - currentCenter.x,
			y: value.y + predictedCenter.y - currentCenter.y,
		};
	};
	const transformEye = (eye: CartoonFaceEyeGeometry): CartoonFaceEyeGeometry => ({
		outer: transformPoint(eye.outer),
		inner: transformPoint(eye.inner),
		upper: transformPoint(eye.upper),
		lower: transformPoint(eye.lower),
		...(eye.iris ? { iris: transformPoint(eye.iris) } : {}),
	});

	return {
		timestampMs,
		imageLeftEye: transformEye(current.imageLeftEye),
		imageRightEye: transformEye(current.imageRightEye),
		mouth: {
			left: transformPoint(current.mouth.left),
			right: transformPoint(current.mouth.right),
			upper: transformPoint(current.mouth.upper),
			lower: transformPoint(current.mouth.lower),
		},
		face: {
			left: transformPoint(current.face.left),
			right: transformPoint(current.face.right),
			top: transformPoint(current.face.top),
			bottom: transformPoint(current.face.bottom),
		},
	};
}

function toLocal(point: PixelPoint, origin: PixelPoint, rollRadians: number): PixelPoint {
	const x = point.x - origin.x;
	const y = point.y - origin.y;
	const cosine = Math.cos(rollRadians);
	const sine = Math.sin(rollRadians);
	return { x: cosine * x + sine * y, y: -sine * x + cosine * y };
}

function createEyeLayout(
	eye: CartoonFaceEyeGeometry,
	width: number,
	height: number,
	origin: PixelPoint,
	rollRadians: number,
	interocularDistance: number,
	referenceEyeWidth: number,
): CartoonEyeLayout {
	const outer = toPixel(eye.outer, width, height);
	const inner = toPixel(eye.inner, width, height);
	const upper = toPixel(eye.upper, width, height);
	const lower = toPixel(eye.lower, width, height);
	const center = midpoint(midpoint(outer, inner), midpoint(upper, lower));
	const localCenter = toLocal(center, origin, rollRadians);
	const actualWidth = Math.max(1, distance(outer, inner));
	const actualHeight = Math.max(1, distance(upper, lower));
	const perspectiveScale = clamp(actualWidth / Math.max(1, referenceEyeWidth), 0.72, 1.22);
	const radiusX = interocularDistance * 0.18 * perspectiveScale;
	const radiusY = interocularDistance * 0.28 * Math.sqrt(perspectiveScale);

	let pupilOffsetX = 0;
	let pupilOffsetY = 0;
	if (eye.iris) {
		const localIris = toLocal(toPixel(eye.iris, width, height), origin, rollRadians);
		pupilOffsetX =
			clamp((localIris.x - localCenter.x) / (actualWidth * 0.5), -0.48, 0.48) *
			radiusX *
			0.62;
		pupilOffsetY =
			clamp((localIris.y - localCenter.y) / (actualHeight * 0.5), -0.45, 0.45) *
			radiusY *
			0.5;
	}

	return {
		x: localCenter.x,
		y: localCenter.y,
		radiusX,
		radiusY,
		pupilX: localCenter.x + pupilOffsetX,
		pupilY: localCenter.y + pupilOffsetY,
		pupilRadius: interocularDistance * 0.062,
	};
}

export function createCartoonFaceLayout(
	presentation: CartoonFacePresentation,
	width: number,
	height: number,
): CartoonFaceLayout | null {
	const geometry = presentation.geometry;
	const imageLeftEyeCenter = midpoint(
		midpoint(
			toPixel(geometry.imageLeftEye.outer, width, height),
			toPixel(geometry.imageLeftEye.inner, width, height),
		),
		midpoint(
			toPixel(geometry.imageLeftEye.upper, width, height),
			toPixel(geometry.imageLeftEye.lower, width, height),
		),
	);
	const imageRightEyeCenter = midpoint(
		midpoint(
			toPixel(geometry.imageRightEye.outer, width, height),
			toPixel(geometry.imageRightEye.inner, width, height),
		),
		midpoint(
			toPixel(geometry.imageRightEye.upper, width, height),
			toPixel(geometry.imageRightEye.lower, width, height),
		),
	);
	const origin = midpoint(imageLeftEyeCenter, imageRightEyeCenter);
	const interocularDistance = distance(imageLeftEyeCenter, imageRightEyeCenter);
	if (!Number.isFinite(interocularDistance) || interocularDistance < 3) return null;
	const rollRadians = Math.atan2(
		imageRightEyeCenter.y - imageLeftEyeCenter.y,
		imageRightEyeCenter.x - imageLeftEyeCenter.x,
	);
	const imageLeftActualWidth = distance(
		toPixel(geometry.imageLeftEye.outer, width, height),
		toPixel(geometry.imageLeftEye.inner, width, height),
	);
	const imageRightActualWidth = distance(
		toPixel(geometry.imageRightEye.outer, width, height),
		toPixel(geometry.imageRightEye.inner, width, height),
	);
	const referenceEyeWidth = (imageLeftActualWidth + imageRightActualWidth) / 2;
	const mouthLeft = toPixel(geometry.mouth.left, width, height);
	const mouthRight = toPixel(geometry.mouth.right, width, height);
	const mouthCenter = midpoint(
		midpoint(mouthLeft, mouthRight),
		midpoint(
			toPixel(geometry.mouth.upper, width, height),
			toPixel(geometry.mouth.lower, width, height),
		),
	);
	const localMouth = toLocal(mouthCenter, origin, rollRadians);
	const detectedMouthWidth = distance(mouthLeft, mouthRight);
	const mouthWidth = clamp(
		detectedMouthWidth * 0.95,
		interocularDistance * 0.52,
		interocularDistance * 0.78,
	);

	return {
		originX: origin.x,
		originY: origin.y,
		rollRadians,
		opacity: clamp(presentation.opacity, 0, 1),
		imageLeftEye: createEyeLayout(
			geometry.imageLeftEye,
			width,
			height,
			origin,
			rollRadians,
			interocularDistance,
			referenceEyeWidth,
		),
		imageRightEye: createEyeLayout(
			geometry.imageRightEye,
			width,
			height,
			origin,
			rollRadians,
			interocularDistance,
			referenceEyeWidth,
		),
		mouth: {
			x: localMouth.x,
			y: localMouth.y,
			width: mouthWidth,
			height: mouthWidth * 0.34,
		},
	};
}

function traceSmile(context: DrawContext, mouth: CartoonMouthLayout): void {
	const halfWidth = mouth.width / 2;
	const halfHeight = mouth.height / 2;
	context.beginPath();
	context.moveTo(mouth.x - halfWidth, mouth.y - halfHeight * 0.55);
	context.quadraticCurveTo(
		mouth.x,
		mouth.y - halfHeight * 0.15,
		mouth.x + halfWidth,
		mouth.y - halfHeight * 0.55,
	);
	context.quadraticCurveTo(
		mouth.x + halfWidth * 0.72,
		mouth.y + halfHeight,
		mouth.x,
		mouth.y + halfHeight,
	);
	context.quadraticCurveTo(
		mouth.x - halfWidth * 0.72,
		mouth.y + halfHeight,
		mouth.x - halfWidth,
		mouth.y - halfHeight * 0.55,
	);
	context.closePath();
}

function drawEye(context: DrawContext, eye: CartoonEyeLayout): void {
	context.fillStyle = "#FFFFFF";
	context.beginPath();
	context.ellipse(eye.x, eye.y, eye.radiusX, eye.radiusY, 0, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#050505";
	context.beginPath();
	context.arc(eye.pupilX, eye.pupilY, eye.pupilRadius, 0, Math.PI * 2);
	context.fill();
}

export function drawCartoonFace(context: DrawContext, layout: CartoonFaceLayout): void {
	if (layout.opacity <= 0) return;
	context.save();
	context.globalAlpha = layout.opacity;
	context.translate(layout.originX, layout.originY);
	context.rotate(layout.rollRadians);
	drawEye(context, layout.imageLeftEye);
	drawEye(context, layout.imageRightEye);

	traceSmile(context, layout.mouth);
	context.fillStyle = "#FFFFFF";
	context.fill();
	context.strokeStyle = "#050505";
	context.lineWidth = Math.max(1, layout.mouth.width * 0.045);
	context.stroke();

	context.save();
	traceSmile(context, layout.mouth);
	context.clip();
	context.beginPath();
	context.moveTo(
		layout.mouth.x - layout.mouth.width * 0.43,
		layout.mouth.y + layout.mouth.height * 0.02,
	);
	context.quadraticCurveTo(
		layout.mouth.x,
		layout.mouth.y + layout.mouth.height * 0.17,
		layout.mouth.x + layout.mouth.width * 0.43,
		layout.mouth.y + layout.mouth.height * 0.02,
	);
	context.stroke();
	for (const offset of [-0.3, -0.1, 0.1, 0.3]) {
		context.beginPath();
		context.moveTo(
			layout.mouth.x + layout.mouth.width * offset,
			layout.mouth.y - layout.mouth.height * 0.18,
		);
		context.lineTo(
			layout.mouth.x + layout.mouth.width * offset * 0.86,
			layout.mouth.y + layout.mouth.height * 0.42,
		);
		context.stroke();
	}
	context.restore();
	context.restore();
}

export class CartoonFaceTracker {
	private previousGeometry: CartoonFaceGeometry | null = null;
	private lastGeometry: CartoonFaceGeometry | null = null;

	update(
		geometry: CartoonFaceGeometry | null,
		timestampMs: number,
		discontinuity = false,
	): CartoonFacePresentation | null {
		if (discontinuity) this.reset();
		if (geometry) {
			this.previousGeometry =
				this.lastGeometry && geometry.timestampMs > this.lastGeometry.timestampMs
					? this.lastGeometry
					: null;
			this.lastGeometry = geometry;
			return { geometry, opacity: 1, unmaskedOpacity: 1, isFading: false };
		}
		if (!this.lastGeometry) return null;
		const missingDurationMs = Math.max(0, timestampMs - this.lastGeometry.timestampMs);
		const opacity = clamp(
			1 -
				Math.max(0, missingDurationMs - CARTOON_FACE_LOSS_HOLD_MS) /
					CARTOON_FACE_LOSS_FADE_MS,
			0,
			1,
		);
		const unmaskedOpacity = clamp(1 - missingDurationMs / CARTOON_FACE_LOSS_FADE_MS, 0, 1);
		if (opacity <= 0) {
			this.reset();
			return null;
		}
		return {
			geometry: predictGeometry(this.previousGeometry, this.lastGeometry, timestampMs),
			opacity,
			unmaskedOpacity,
			isFading: true,
		};
	}

	reset(): void {
		this.previousGeometry = null;
		this.lastGeometry = null;
	}
}
