import type { RecordingSessionData } from "../../electron/ipc/types";

export async function finalizeCompleteRecordingSession({
	videoPath,
	webcamPath,
	timeOffsetMs,
	hideOverlayCursorByDefault,
	webcamCaptureRequested,
	commitSession,
	openEditor,
	onMissingWebcam,
}: {
	videoPath: string;
	webcamPath: string | null | Promise<string | null>;
	timeOffsetMs: number;
	hideOverlayCursorByDefault: boolean;
	webcamCaptureRequested: boolean;
	commitSession: (session: RecordingSessionData) => Promise<unknown>;
	openEditor: () => Promise<unknown>;
	onMissingWebcam: () => void;
}): Promise<RecordingSessionData> {
	const resolvedWebcamPath = await webcamPath;
	if (webcamCaptureRequested && !resolvedWebcamPath) {
		onMissingWebcam();
	}

	const session: RecordingSessionData = {
		videoPath,
		webcamPath: resolvedWebcamPath,
		timeOffsetMs,
		hideOverlayCursorByDefault,
	};
	await commitSession(session);
	await openEditor();
	return session;
}
