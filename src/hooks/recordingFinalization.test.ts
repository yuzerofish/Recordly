import { describe, expect, it, vi } from "vitest";
import { finalizeCompleteRecordingSession } from "./recordingFinalization";

describe("finalizeCompleteRecordingSession", () => {
	it("waits for the webcam sidecar before committing one complete session", async () => {
		let resolveWebcam: (path: string | null) => void = () => undefined;
		const webcamPath = new Promise<string | null>((resolve) => {
			resolveWebcam = resolve;
		});
		const calls: string[] = [];
		const commitSession = vi.fn(async () => {
			calls.push("commit");
		});
		const openEditor = vi.fn(async () => {
			calls.push("open");
		});

		const pending = finalizeCompleteRecordingSession({
			videoPath: "/recordings/screen.mp4",
			webcamPath,
			timeOffsetMs: 37,
			hideOverlayCursorByDefault: true,
			webcamCaptureRequested: true,
			commitSession,
			openEditor,
			onMissingWebcam: vi.fn(),
		});
		await Promise.resolve();
		expect(commitSession).not.toHaveBeenCalled();
		expect(openEditor).not.toHaveBeenCalled();

		resolveWebcam("/recordings/webcam.webm");
		await expect(pending).resolves.toMatchObject({
			videoPath: "/recordings/screen.mp4",
			webcamPath: "/recordings/webcam.webm",
		});
		expect(calls).toEqual(["commit", "open"]);
		expect(commitSession).toHaveBeenCalledWith({
			videoPath: "/recordings/screen.mp4",
			webcamPath: "/recordings/webcam.webm",
			timeOffsetMs: 37,
			hideOverlayCursorByDefault: true,
		});
	});

	it("does not open the editor or downgrade to video-only when the atomic commit fails", async () => {
		const openEditor = vi.fn(async () => undefined);
		const commitError = new Error("manifest write failed");

		await expect(
			finalizeCompleteRecordingSession({
				videoPath: "/recordings/screen.mp4",
				webcamPath: "/recordings/webcam.webm",
				timeOffsetMs: 0,
				hideOverlayCursorByDefault: false,
				webcamCaptureRequested: true,
				commitSession: vi.fn(async () => {
					throw commitError;
				}),
				openEditor,
				onMissingWebcam: vi.fn(),
			}),
		).rejects.toBe(commitError);
		expect(openEditor).not.toHaveBeenCalled();
	});

	it("reports an explicitly requested webcam failure before committing the safe session", async () => {
		const onMissingWebcam = vi.fn();
		const commitSession = vi.fn(async () => undefined);

		await finalizeCompleteRecordingSession({
			videoPath: "/recordings/screen.mp4",
			webcamPath: null,
			timeOffsetMs: 0,
			hideOverlayCursorByDefault: false,
			webcamCaptureRequested: true,
			commitSession,
			openEditor: vi.fn(async () => undefined),
			onMissingWebcam,
		});

		expect(onMissingWebcam).toHaveBeenCalledTimes(1);
		expect(commitSession).toHaveBeenCalledWith(expect.objectContaining({ webcamPath: null }));
	});
});
