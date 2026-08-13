import { describe, expect, it } from "vitest";

import { createProjectData, normalizeProjectEditor } from "./projectPersistence";
import {
	ADVANCED_VERTICAL_PADDING_MAX,
	DEFAULT_WEBCAM_EFFECT_SETTINGS,
	DEFAULT_WEBCAM_OVERLAY,
	WEBCAM_SILHOUETTE_COLOR,
} from "./types";

describe("normalizeProjectEditor", () => {
	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("migrates legacy webcam settings to the disabled effect", () => {
		const editor = normalizeProjectEditor({
			webcam: { enabled: true } as never,
		});

		expect(editor.webcam.effect).toEqual(DEFAULT_WEBCAM_EFFECT_SETTINGS);
	});

	it("normalizes and clamps webcam effect settings", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				effect: {
					type: "silhouette",
					silhouetteColor: "#abc",
					opacity: 2,
					feather: -4,
					background: "blur",
				},
			},
		});

		expect(editor.webcam.effect).toEqual({
			type: "silhouette",
			silhouetteColor: WEBCAM_SILHOUETTE_COLOR,
			opacity: 1,
			feather: 0,
			background: "transparent",
		});

		const invalid = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				effect: {
					type: "unknown",
					silhouetteColor: "black",
					opacity: Number.NaN,
					feather: Number.POSITIVE_INFINITY,
					background: "removed",
				} as never,
			},
		});
		expect(invalid.webcam.effect).toEqual(DEFAULT_WEBCAM_EFFECT_SETTINGS);
	});

	it("round-trips webcam effects and freezes legacy appearance fields", () => {
		const effect = {
			type: "silhouette" as const,
			silhouetteColor: "#050505",
			opacity: 0.8,
			feather: 9,
			background: "transparent" as const,
		};
		const project = createProjectData("file:///recording.mp4", {
			webcam: { ...DEFAULT_WEBCAM_OVERLAY, effect },
		});
		const parsed = JSON.parse(JSON.stringify(project)) as typeof project;

		expect(normalizeProjectEditor(parsed.editor).webcam.effect).toEqual({
			...effect,
			silhouetteColor: WEBCAM_SILHOUETTE_COLOR,
			opacity: 1,
			background: "transparent",
		});
	});

	it("preserves the monkey webcam effect when reopening a project", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				effect: { ...DEFAULT_WEBCAM_EFFECT_SETTINGS, type: "monkey" },
			},
		});

		expect(editor.webcam.effect.type).toBe("monkey");
	});
});
