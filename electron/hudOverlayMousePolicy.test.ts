import { describe, expect, it } from "vitest";
import { resolveHudOverlayIgnoreMouse } from "./hudOverlayMousePolicy";

describe("resolveHudOverlayIgnoreMouse", () => {
	it("honors renderer passthrough requests while recording", () => {
		expect(
			resolveHudOverlayIgnoreMouse({
				requestedIgnore: true,
				sourceSelectionActive: false,
				recordingActive: true,
			}),
		).toBe(true);
	});

	it("keeps the HUD interactive while its controls are hovered", () => {
		expect(
			resolveHudOverlayIgnoreMouse({
				requestedIgnore: false,
				sourceSelectionActive: false,
				recordingActive: true,
			}),
		).toBe(false);
	});

	it("forces passthrough while source selection is active", () => {
		expect(
			resolveHudOverlayIgnoreMouse({
				requestedIgnore: false,
				sourceSelectionActive: true,
				recordingActive: false,
			}),
		).toBe(true);
	});
});
