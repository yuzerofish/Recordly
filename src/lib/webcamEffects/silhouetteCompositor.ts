import type { WebcamEffectSettings } from "@/components/video-editor/types";
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

export class SilhouetteCompositor {
	private readonly outputCanvas: RenderCanvas;
	private readonly outputContext: RenderContext;
	private readonly maskCanvas: RenderCanvas;
	private readonly maskContext: RenderContext;
	private readonly foregroundCanvas: RenderCanvas;
	private readonly foregroundContext: RenderContext;

	constructor(options: SilhouetteCompositorOptions = {}) {
		const createCanvas = options.createCanvas ?? defaultCreateCanvas;
		this.outputCanvas = createCanvas();
		this.outputContext = getContext(this.outputCanvas);
		this.maskCanvas = createCanvas();
		this.maskContext = getContext(this.maskCanvas);
		this.foregroundCanvas = createCanvas();
		this.foregroundContext = getContext(this.foregroundCanvas);
	}

	compose(
		source: CanvasImageSource,
		mask: PersonMask,
		settings: WebcamEffectSettings,
	): RenderCanvas {
		const { width, height } = getSourceDimensions(source);
		setCanvasSize(this.outputCanvas, width, height);
		setCanvasSize(this.foregroundCanvas, width, height);
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
		this.foregroundContext.fillStyle = settings.silhouetteColor;
		this.foregroundContext.fillRect(0, 0, width, height);
		this.foregroundContext.globalAlpha = 1;
		this.foregroundContext.globalCompositeOperation = "destination-in";
		this.foregroundContext.filter =
			settings.feather > 0 ? `blur(${Math.max(0, settings.feather)}px)` : "none";
		this.foregroundContext.drawImage(this.maskCanvas, 0, 0, width, height);
		this.foregroundContext.restore();

		this.outputContext.drawImage(this.foregroundCanvas, 0, 0);
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
	const color = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(settings.silhouetteColor);
	const red = color ? Number.parseInt(color[1], 16) : 5;
	const green = color ? Number.parseInt(color[2], 16) : 5;
	const blue = color ? Number.parseInt(color[3], 16) : 5;
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
