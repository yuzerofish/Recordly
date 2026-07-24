import { describe, expect, it, vi } from "vitest";
import { applyHudWindowWorkspacePolicy } from "./hudWindowPolicy";

describe("applyHudWindowWorkspacePolicy", () => {
	it("keeps the HUD visible above macOS full-screen application spaces", () => {
		const window = {
			setVisibleOnAllWorkspaces: vi.fn(),
		};

		applyHudWindowWorkspacePolicy(window, "darwin");

		expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledExactlyOnceWith(true, {
			visibleOnFullScreen: true,
		});
	});

	it("does not apply the macOS workspace API on other platforms", () => {
		const window = {
			setVisibleOnAllWorkspaces: vi.fn(),
		};

		applyHudWindowWorkspacePolicy(window, "win32");

		expect(window.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
	});
});
