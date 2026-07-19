import {
	WEBCAM_SILHOUETTE_COLOR,
	type WebcamEffectSettings,
} from "@/components/video-editor/types";
import {
	type CartoonFacePresentation,
	createCartoonFaceLayout,
	drawCartoonFace,
} from "./cartoonFace";
import type { PersonMask } from "./messages";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SilhouetteCompositorOptions {
	createCanvas?: () => RenderCanvas;
}

function defaultCreateCanvas(): RenderCanvas {
	if (typeof document !== "undefined") {
		return document.createElement("canvas");
	}
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(1, 1);
	}
	throw new Error("Canvas is unavailable for the webcam silhouette effect");
}

function getContext(canvas: RenderCanvas): RenderContext {
	const context = canvas.getContext("2d", {
		alpha: true,
		willReadFrequently: false,
	}) as RenderContext | null;
	if (!context) {
		throw new Error("Could not create a 2D canvas for the webcam silhouette effect");
	}
	return context;
}

function setCanvasSize(canvas: RenderCanvas, width: number, height: number): void {
	const normalizedWidth = Math.max(1, Math.round(width));
	const normalizedHeight = Math.max(1, Math.round(height));
	if (canvas.width !== normalizedWidth) canvas.width = normalizedWidth;
	if (canvas.height !== normalizedHeight) canvas.height = normalizedHeight;
}

function getSourceDimensions(source: CanvasImageSource): { width: number; height: number } {
	const candidate = source as unknown as Record<string, number | undefined>;
	const width =
		candidate.displayWidth ??
		candidate.videoWidth ??
		candidate.naturalWidth ??
		candidate.width ??
		0;
	const height =
		candidate.displayHeight ??
		candidate.videoHeight ??
		candidate.naturalHeight ??
		candidate.height ??
		0;
	return { width: Math.max(1, width), height: Math.max(1, height) };
}

function writeMaskImageData(context: RenderContext, mask: PersonMask): void {
	const imageData = context.createImageData(mask.width, mask.height);
	for (let index = 0; index < mask.data.length; index++) {
		const pixelOffset = index * 4;
		const alpha = Math.round(Math.max(0, Math.min(1, mask.data[index] ?? 0)) * 255);
		imageData.data[pixelOffset] = 255;
		imageData.data[pixelOffset + 1] = 255;
		imageData.data[pixelOffset + 2] = 255;
		imageData.data[pixelOffset + 3] = alpha;
	}
	context.putImageData(imageData, 0, 0);
}

function sampleMask(mask: PersonMask, point: { x: number; y: number }): number {
	const x = Math.max(0, Math.min(mask.width - 1, Math.round(point.x * (mask.width - 1))));
	const y = Math.max(0, Math.min(mask.height - 1, Math.round(point.y * (mask.height - 1))));
	return mask.data[y * mask.width + x] ?? 0;
}

function faceOverlapsPersonMask(mask: PersonMask, face: CartoonFacePresentation): boolean {
	const geometry = face.geometry;
	const points = [
		geometry.imageLeftEye.outer,
		geometry.imageLeftEye.inner,
		geometry.imageRightEye.outer,
		geometry.imageRightEye.inner,
		geometry.mouth.left,
		geometry.mouth.right,
	];
	return points.some((point) => sampleMask(mask, point) >= 0.2);
}

export class SilhouetteCompositor {
	private readonly outputCanvas: RenderCanvas;
	private readonly outputContext: RenderContext;
	private readonly maskCanvas: RenderCanvas;
	private readonly maskContext: RenderContext;
	private readonly foregroundCanvas: RenderCanvas;
	private readonly foregroundContext: RenderContext;
	private readonly faceCanvas: RenderCanvas;
	private readonly faceContext: RenderContext;

	constructor(options: SilhouetteCompositorOptions = {}) {
		const createCanvas = options.createCanvas ?? defaultCreateCanvas;
		this.outputCanvas = createCanvas();
		this.outputContext = getContext(this.outputCanvas);
		this.maskCanvas = createCanvas();
		this.maskContext = getContext(this.maskCanvas);
		this.foregroundCanvas = createCanvas();
		this.foregroundContext = getContext(this.foregroundCanvas);
		this.faceCanvas = createCanvas();
		this.faceContext = getContext(this.faceCanvas);
	}

	compose(
		source: CanvasImageSource,
		mask: PersonMask,
		settings: WebcamEffectSettings,
		face: CartoonFacePresentation | null = null,
	): RenderCanvas {
		const { width, height } = getSourceDimensions(source);
		setCanvasSize(this.outputCanvas, width, height);
		setCanvasSize(this.foregroundCanvas, width, height);
		setCanvasSize(this.faceCanvas, width, height);
		setCanvasSize(this.maskCanvas, mask.width, mask.height);

		this.maskContext.clearRect(0, 0, mask.width, mask.height);
		writeMaskImageData(this.maskContext, mask);

		this.outputContext.save();
		this.outputContext.clearRect(0, 0, width, height);
		if (settings.background === "original") {
			this.outputContext.drawImage(source, 0, 0, width, height);
		} else if (settings.background === "blur") {
			this.outputContext.filter = `blur(${Math.max(0, settings.feather * 1.5)}px)`;
			this.outputContext.drawImage(source, 0, 0, width, height);
			this.outputContext.filter = "none";
		}
		this.outputContext.restore();

		this.foregroundContext.save();
		this.foregroundContext.clearRect(0, 0, width, height);
		this.foregroundContext.globalAlpha = Math.max(0, Math.min(1, settings.opacity));
		this.foregroundContext.fillStyle = WEBCAM_SILHOUETTE_COLOR;
		this.foregroundContext.fillRect(0, 0, width, height);
		this.foregroundContext.globalAlpha = 1;
		this.foregroundContext.globalCompositeOperation = "destination-in";
		this.foregroundContext.filter =
			settings.feather > 0 ? `blur(${Math.max(0, settings.feather)}px)` : "none";
		this.foregroundContext.drawImage(this.maskCanvas, 0, 0, width, height);
		this.foregroundContext.restore();

		this.outputContext.drawImage(this.foregroundCanvas, 0, 0);

		this.faceContext.save();
		this.faceContext.clearRect(0, 0, width, height);
		if (face) {
			const effectOpacity = Math.max(0, Math.min(1, settings.opacity));
			const clipToPerson = !face.isFading || faceOverlapsPersonMask(mask, face);
			const trackedPresentation = clipToPerson
				? face
				: { ...face, opacity: Math.min(face.opacity, face.unmaskedOpacity) };
			const presentation = {
				...trackedPresentation,
				opacity: trackedPresentation.opacity * effectOpacity,
			};
			const layout = createCartoonFaceLayout(presentation, width, height);
			if (layout) drawCartoonFace(this.faceContext, layout);
			// If the person mask disappears too, only deterministic artwork remains
			// and it uses the shorter unmasked fade instead of leaving a full-bright
			// face behind. Source camera pixels are never retained.
			if (clipToPerson) {
				this.faceContext.globalCompositeOperation = "destination-in";
				this.faceContext.drawImage(this.maskCanvas, 0, 0, width, height);
			}
		}
		this.faceContext.restore();
		this.outputContext.drawImage(this.faceCanvas, 0, 0);
		return this.outputCanvas;
	}

	getCanvas(): RenderCanvas {
		return this.outputCanvas;
	}
}

export function composeSilhouettePixels(
	source: Uint8ClampedArray,
	personMask: Float32Array,
	settings: WebcamEffectSettings,
): Uint8ClampedArray {
	if (source.length !== personMask.length * 4) {
		throw new Error("Source pixels and person mask dimensions do not match");
	}

	const output = new Uint8ClampedArray(source.length);
	const red = 0;
	const green = 0;
	const blue = 0;
	const opacity = Math.max(0, Math.min(1, settings.opacity));

	for (let index = 0; index < personMask.length; index++) {
		const offset = index * 4;
		const maskAlpha = Math.max(0, Math.min(1, personMask[index] ?? 0));
		const personAlpha = maskAlpha * opacity;
		if (settings.background === "transparent") {
			output[offset] = red;
			output[offset + 1] = green;
			output[offset + 2] = blue;
			output[offset + 3] = Math.round(personAlpha * 255);
			continue;
		}

		const inverseAlpha = 1 - personAlpha;
		output[offset] = Math.round(red * personAlpha + (source[offset] ?? 0) * inverseAlpha);
		output[offset + 1] = Math.round(
			green * personAlpha + (source[offset + 1] ?? 0) * inverseAlpha,
		);
		output[offset + 2] = Math.round(
			blue * personAlpha + (source[offset + 2] ?? 0) * inverseAlpha,
		);
		output[offset + 3] = source[offset + 3] ?? 255;
	}

	return output;
}
