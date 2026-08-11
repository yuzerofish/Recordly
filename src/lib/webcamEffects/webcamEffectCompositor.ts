import type { WebcamEffectSettings } from "@/components/video-editor/types";
import type { CartoonFacePresentation } from "./cartoonFace";
import type { PersonMask } from "./messages";
import { MonkeyCompositor } from "./monkeyCompositor";
import { SilhouetteCompositor } from "./silhouetteCompositor";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface WebcamEffectCompositor {
	prepare?(settings: WebcamEffectSettings): Promise<void>;
	compose(
		source: CanvasImageSource,
		mask: PersonMask,
		settings: WebcamEffectSettings,
		face: CartoonFacePresentation | null,
		presentationMirror?: boolean,
	): RenderCanvas;
	getCanvas(): RenderCanvas;
}

export class DefaultWebcamEffectCompositor implements WebcamEffectCompositor {
	private readonly silhouette = new SilhouetteCompositor();
	private readonly monkey = new MonkeyCompositor();
	private active: "silhouette" | "monkey" = "silhouette";

	async prepare(settings: WebcamEffectSettings): Promise<void> {
		if (settings.type === "monkey") await this.monkey.prepare();
	}

	compose(
		source: CanvasImageSource,
		mask: PersonMask,
		settings: WebcamEffectSettings,
		face: CartoonFacePresentation | null,
		presentationMirror = false,
	): RenderCanvas {
		if (settings.type === "monkey") {
			this.active = "monkey";
			return this.monkey.compose(source, settings, face, presentationMirror);
		}
		this.active = "silhouette";
		return this.silhouette.compose(source, mask, settings, face);
	}

	getCanvas(): RenderCanvas {
		return this.active === "monkey" ? this.monkey.getCanvas() : this.silhouette.getCanvas();
	}
}
