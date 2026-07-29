import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	RECORDLY_PERSONAL_BUNDLE_IDENTIFIER,
	createMacCaptureHostExclusion,
	getMacCaptureFilterPolicy,
} from "./macCaptureFilterPolicy";

describe("macOS ScreenCaptureKit host exclusion", () => {
	it("passes the Electron host process and personal bundle identity to display capture", () => {
		expect(
			createMacCaptureHostExclusion({
				hostProcessId: 4242,
			}),
		).toEqual({
			hostProcessId: 4242,
			hostBundleIdentifier: RECORDLY_PERSONAL_BUNDLE_IDENTIFIER,
		});
		expect(getMacCaptureFilterPolicy("screen:0:0")).toEqual({
			mode: "display",
			excludeHostApplication: true,
		});
	});

	it("uses a desktop-independent target for window capture without compositing the HUD twice", () => {
		expect(getMacCaptureFilterPolicy("window:987:0")).toEqual({
			mode: "window",
			excludeHostApplication: false,
		});
	});

	it("wires the host identity into the native SCContentFilter implementation", () => {
		const sourcePath = fileURLToPath(
			new URL("../../native/ScreenCaptureKitRecorder.swift", import.meta.url),
		);
		const source = readFileSync(sourcePath, "utf8");

		expect(source).toContain(
			"SCContentFilter(display: display, excludingApplications: hostApplications, exceptingWindows: [])",
		);
		expect(source).toContain("window.owningApplication?.processID == hostProcessId");
		expect(source).toContain("HOST_APPLICATION_EXCLUDED");
	});

	it("extends a sparse or static display capture through the actual stop time", () => {
		const sourcePath = fileURLToPath(
			new URL("../../native/ScreenCaptureKitRecorder.swift", import.meta.url),
		);
		const source = readFileSync(sourcePath, "utf8");

		expect(source).toContain("activeCaptureDuration(atHostTime: captureEndHostTime)");
		expect(source).toContain("let durationAlignedTime = max(.zero, recordedDuration - terminalFrameDuration)");
		expect(source).toContain("videoEndTime = additionalTime + terminalFrameDuration");
	});
});
