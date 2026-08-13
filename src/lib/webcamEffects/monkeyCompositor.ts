import type { WebcamEffectSettings } from "@/components/video-editor/types";
import type { CartoonFacePresentation } from "./cartoonFace";
import { getWebcamEffectAssetUrls } from "./assets";
import type { CartoonFaceEyeGeometry, NormalizedFacePoint } from "./messages";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const SCENE_WIDTH = 1600;
const SCENE_HEIGHT = 900;
const TARGETS = {
	imageLeftEye: { x: 800, y: 459, width: 136, height: 98 },
	imageRightEye: { x: 931, y: 465, width: 136, height: 98 },
	mouth: { x: 852, y: 691, width: 236, height: 152 },
} as const;

export interface MonkeyCompositorOptions {
	createCanvas?: () => RenderCanvas;
	loadScene?: () => Promise<CanvasImageSource>;
}

function defaultCreateCanvas(): RenderCanvas {
	if (typeof document !== "undefined") return document.createElement("canvas");
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1);
	throw new Error("Canvas is unavailable for the monkey webcam effect");
}

async function defaultLoadScene(): Promise<CanvasImageSource> {
	if (typeof Image === "undefined") throw new Error("Image loading is unavailable");
	const image = new Image();
	image.decoding = "async";
	image.src = getWebcamEffectAssetUrls().monkeySceneUrl;
	if (typeof image.decode === "function") await image.decode();
	else if (!image.complete) {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not load the monkey scene"));
		});
	}
	return image;
}

function getContext(canvas: RenderCanvas): RenderContext {
	const context = canvas.getContext("2d", { alpha: true }) as RenderContext | null;
	if (!context) throw new Error("Could not create a 2D canvas for the monkey effect");
	return context;
}

function dimensions(source: CanvasImageSource): { width: number; height: number } {
	const value = source as unknown as Record<string, number | undefined>;
	return {
		width: Math.max(
			1,
			value.displayWidth ?? value.videoWidth ?? value.naturalWidth ?? value.width ?? 1,
		),
		height: Math.max(
			1,
			value.displayHeight ?? value.videoHeight ?? value.naturalHeight ?? value.height ?? 1,
		),
	};
}

function resize(canvas: RenderCanvas, width: number, height: number): void {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function bounds(
	points: NormalizedFacePoint[],
	width: number,
	height: number,
	padX: number,
	padY: number,
) {
	const xs = points.map((point) => point.x * width);
	const ys = points.map((point) => point.y * height);
	const left = Math.min(...xs);
	const right = Math.max(...xs);
	const top = Math.min(...ys);
	const bottom = Math.max(...ys);
	const featureWidth = Math.max(2, right - left);
	const featureHeight = Math.max(2, bottom - top);
	const x = clamp(left - featureWidth * padX, 0, width - 1);
	const y = clamp(top - featureHeight * padY, 0, height - 1);
	return {
		x,
		y,
		width: Math.max(1, Math.min(width - x, featureWidth * (1 + padX * 2))),
		height: Math.max(1, Math.min(height - y, featureHeight * (1 + padY * 2))),
	};
}

function eyePoints(eye: CartoonFaceEyeGeometry): NormalizedFacePoint[] {
	return eye.outline?.length ? eye.outline : [eye.outer, eye.inner, eye.upper, eye.lower];
}

function lensPoint(
	x: number,
	y: number,
	horizontalStrength: number,
	verticalStrength: number,
): { x: number; y: number } {
	const radiusSquared = Math.min(1, x * x + y * y);
	const edgeWeight = 1 - radiusSquared;
	return {
		x: x * (1 - horizontalStrength * edgeWeight),
		y: y * (1 - verticalStrength * edgeWeight),
	};
}

export class MonkeyCompositor {
	private readonly outputCanvas: RenderCanvas;
	private readonly outputContext: RenderContext;
	private readonly featureCanvas: RenderCanvas;
	private readonly featureContext: RenderContext;
	private readonly maskCanvas: RenderCanvas;
	private readonly maskContext: RenderContext;
	private readonly loadScene: () => Promise<CanvasImageSource>;
	private scene: CanvasImageSource | null = null;
	private scenePromise: Promise<CanvasImageSource> | null = null;

	constructor(options: MonkeyCompositorOptions = {}) {
		const createCanvas = options.createCanvas ?? defaultCreateCanvas;
		this.outputCanvas = createCanvas();
		this.outputContext = getContext(this.outputCanvas);
		this.featureCanvas = createCanvas();
		this.featureContext = getContext(this.featureCanvas);
		this.maskCanvas = createCanvas();
		this.maskContext = getContext(this.maskCanvas);
		this.loadScene = options.loadScene ?? defaultLoadScene;
	}

	async prepare(): Promise<void> {
		if (this.scene) return;
		this.scenePromise ??= this.loadScene();
		this.scene = await this.scenePromise;
	}

	compose(
		source: CanvasImageSource,
		_settings: WebcamEffectSettings,
		face: CartoonFacePresentation | null,
		presentationMirror = false,
	): RenderCanvas {
		if (!this.scene) throw new Error("Monkey scene is not ready");
		const { width, height } = dimensions(source);
		resize(this.outputCanvas, width, height);

		const scale = Math.max(width / SCENE_WIDTH, height / SCENE_HEIGHT);
		const sceneWidth = SCENE_WIDTH * scale;
		const sceneHeight = SCENE_HEIGHT * scale;
		const offsetX = (width - sceneWidth) / 2;
		const offsetY = (height - sceneHeight) / 2;
		this.outputContext.save();
		this.outputContext.clearRect(0, 0, width, height);
		if (presentationMirror) {
			this.outputContext.translate(width, 0);
			this.outputContext.scale(-1, 1);
		}
		this.outputContext.drawImage(this.scene, offsetX, offsetY, sceneWidth, sceneHeight);
		this.outputContext.restore();
		if (!face || face.opacity <= 0.001) return this.outputCanvas;

		const sourceSize = dimensions(source);
		const expression = face.geometry.expression;
		const smile = ((expression?.mouthSmileLeft ?? 0) + (expression?.mouthSmileRight ?? 0)) / 2;
		const leftEyeHeight =
			TARGETS.imageLeftEye.height * (1 - 0.72 * (expression?.eyeBlinkLeft ?? 0));
		const rightEyeHeight =
			TARGETS.imageRightEye.height * (1 - 0.72 * (expression?.eyeBlinkRight ?? 0));
		const mouthWidth = TARGETS.mouth.width * (1 + 0.18 * smile);
		const mouthHeight = TARGETS.mouth.height * (1 + 0.34 * (expression?.jawOpen ?? 0));
		const leftCenter = {
			x: presentationMirror
				? width - (offsetX + TARGETS.imageLeftEye.x * scale)
				: offsetX + TARGETS.imageLeftEye.x * scale,
			y: offsetY + TARGETS.imageLeftEye.y * scale,
		};
		const rightCenter = {
			x: presentationMirror
				? width - (offsetX + TARGETS.imageRightEye.x * scale)
				: offsetX + TARGETS.imageRightEye.x * scale,
			y: offsetY + TARGETS.imageRightEye.y * scale,
		};
		const mouthCenter = {
			x: presentationMirror
				? width - (offsetX + TARGETS.mouth.x * scale)
				: offsetX + TARGETS.mouth.x * scale,
			y: offsetY + TARGETS.mouth.y * scale,
		};
		const leftEyeCenter = face.geometry.imageLeftEye;
		const rightEyeCenter = face.geometry.imageRightEye;
		const roll = Math.atan2(
			(rightEyeCenter.inner.y +
				rightEyeCenter.outer.y -
				leftEyeCenter.inner.y -
				leftEyeCenter.outer.y) /
				2,
			(rightEyeCenter.inner.x +
				rightEyeCenter.outer.x -
				leftEyeCenter.inner.x -
				leftEyeCenter.outer.x) /
				2,
		);

		this.drawFeature(
			source,
			bounds(
				eyePoints(face.geometry.imageLeftEye),
				sourceSize.width,
				sourceSize.height,
				0.16,
				0.65,
			),
			leftCenter,
			TARGETS.imageLeftEye.width * scale,
			leftEyeHeight * scale,
			roll,
			face.opacity,
			"eye",
		);
		this.drawFeature(
			source,
			bounds(
				eyePoints(face.geometry.imageRightEye),
				sourceSize.width,
				sourceSize.height,
				0.16,
				0.65,
			),
			rightCenter,
			TARGETS.imageRightEye.width * scale,
			rightEyeHeight * scale,
			roll,
			face.opacity,
			"eye",
		);
		this.drawFeature(
			source,
			bounds(
				face.geometry.mouth.outline?.length
					? face.geometry.mouth.outline
					: [
							face.geometry.mouth.left,
							face.geometry.mouth.right,
							face.geometry.mouth.upper,
							face.geometry.mouth.lower,
						],
				sourceSize.width,
				sourceSize.height,
				0.1,
				0.5,
			),
			mouthCenter,
			mouthWidth * scale,
			mouthHeight * scale,
			roll,
			face.opacity,
			"mouth",
		);
		return this.outputCanvas;
	}

	private drawFeature(
		source: CanvasImageSource,
		sourceRect: { x: number; y: number; width: number; height: number },
		center: { x: number; y: number },
		width: number,
		height: number,
		rotation: number,
		opacity: number,
		kind: "eye" | "mouth",
	): void {
		const feather = Math.max(1.5, Math.min(width, height) * 0.11);
		const padding = Math.ceil(feather * 3);
		const canvasWidth = Math.ceil(width + padding * 2);
		const canvasHeight = Math.ceil(height + padding * 2);
		resize(this.featureCanvas, canvasWidth, canvasHeight);
		resize(this.maskCanvas, canvasWidth, canvasHeight);

		this.featureContext.save();
		this.featureContext.clearRect(0, 0, canvasWidth, canvasHeight);
		this.featureContext.globalAlpha = 1;
		this.featureContext.globalCompositeOperation = "source-over";
		this.featureContext.translate(canvasWidth / 2, canvasHeight / 2);
		this.featureContext.filter =
			kind === "eye"
				? "saturate(0.94) contrast(1.13) brightness(1.01)"
				: "saturate(1.2) contrast(1.1) brightness(1.02)";
		this.drawWarpedCrop(
			this.featureContext,
			source,
			sourceRect,
			width,
			height,
			kind === "eye" ? 0.38 : 0.14,
			kind === "eye" ? 0.38 : 0.24,
		);
		this.featureContext.filter = "none";
		this.featureContext.globalCompositeOperation = "soft-light";
		this.featureContext.globalAlpha = kind === "eye" ? 0.24 : 0.36;
		this.featureContext.fillStyle = kind === "eye" ? "#7b3f86" : "#e34d70";
		this.featureContext.fillRect(-width / 2, -height / 2, width, height);
		this.featureContext.restore();

		this.maskContext.save();
		this.maskContext.clearRect(0, 0, canvasWidth, canvasHeight);
		this.maskContext.globalAlpha = 1;
		this.maskContext.globalCompositeOperation = "source-over";
		this.maskContext.translate(canvasWidth / 2, canvasHeight / 2);
		this.maskContext.fillStyle = `rgba(255,255,255,${clamp(opacity, 0, 1)})`;
		this.maskContext.shadowColor = "#ffffff";
		this.maskContext.shadowBlur = feather * 2;
		this.traceFeaturePath(this.maskContext, width, height, kind);
		this.maskContext.fill();
		this.maskContext.restore();

		this.featureContext.save();
		this.featureContext.globalCompositeOperation = "destination-in";
		this.featureContext.drawImage(this.maskCanvas, 0, 0);
		this.featureContext.restore();

		this.outputContext.save();
		this.outputContext.translate(center.x, center.y);
		this.outputContext.rotate(kind === "mouth" ? rotation * 0.55 : rotation);
		this.outputContext.globalAlpha = 0.98;
		this.outputContext.drawImage(this.featureCanvas, -canvasWidth / 2, -canvasHeight / 2);
		this.outputContext.restore();
	}

	private drawWarpedCrop(
		context: RenderContext,
		source: CanvasImageSource,
		sourceRect: { x: number; y: number; width: number; height: number },
		width: number,
		height: number,
		horizontalStrength: number,
		verticalStrength: number,
	): void {
		const columns = 16;
		const rows = 12;
		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const normalizedLeft = (column / columns) * 2 - 1;
				const normalizedRight = ((column + 1) / columns) * 2 - 1;
				const normalizedTop = (row / rows) * 2 - 1;
				const normalizedBottom = ((row + 1) / rows) * 2 - 1;
				const mappedCorners = [
					lensPoint(normalizedLeft, normalizedTop, horizontalStrength, verticalStrength),
					lensPoint(normalizedRight, normalizedTop, horizontalStrength, verticalStrength),
					lensPoint(
						normalizedLeft,
						normalizedBottom,
						horizontalStrength,
						verticalStrength,
					),
					lensPoint(
						normalizedRight,
						normalizedBottom,
						horizontalStrength,
						verticalStrength,
					),
				];
				const mappedLeft = Math.min(...mappedCorners.map((point) => point.x));
				const mappedRight = Math.max(...mappedCorners.map((point) => point.x));
				const mappedTop = Math.min(...mappedCorners.map((point) => point.y));
				const mappedBottom = Math.max(...mappedCorners.map((point) => point.y));
				const sourceX = sourceRect.x + ((mappedLeft + 1) / 2) * sourceRect.width;
				const sourceY = sourceRect.y + ((mappedTop + 1) / 2) * sourceRect.height;
				const sourceWidth = ((mappedRight - mappedLeft) / 2) * sourceRect.width;
				const sourceHeight = ((mappedBottom - mappedTop) / 2) * sourceRect.height;
				const destinationX = -width / 2 + (column / columns) * width;
				const destinationY = -height / 2 + (row / rows) * height;
				context.drawImage(
					source,
					sourceX,
					sourceY,
					sourceWidth,
					sourceHeight,
					destinationX - 0.35,
					destinationY - 0.35,
					width / columns + 0.7,
					height / rows + 0.7,
				);
			}
		}
	}

	private traceFeaturePath(
		context: RenderContext,
		width: number,
		height: number,
		kind: "eye" | "mouth",
	): void {
		const left = -width / 2;
		const top = -height / 2;
		context.beginPath();
		if (kind === "eye") {
			context.moveTo(left, top + height * 0.52);
			context.bezierCurveTo(
				left + width * 0.2,
				top + height * 0.03,
				left + width * 0.78,
				top + height * 0.02,
				left + width,
				top + height * 0.5,
			);
			context.bezierCurveTo(
				left + width * 0.78,
				top + height * 0.98,
				left + width * 0.2,
				top + height * 0.98,
				left,
				top + height * 0.52,
			);
		} else {
			context.moveTo(left, top + height * 0.46);
			context.bezierCurveTo(
				left + width * 0.18,
				top + height * 0.08,
				left + width * 0.82,
				top + height * 0.06,
				left + width,
				top + height * 0.46,
			);
			context.bezierCurveTo(
				left + width * 0.82,
				top + height * 0.95,
				left + width * 0.18,
				top + height * 0.96,
				left,
				top + height * 0.46,
			);
		}
		context.closePath();
	}

	getCanvas(): RenderCanvas {
		return this.outputCanvas;
	}
}
