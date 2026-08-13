import { describe, expect, it, vi } from "vitest";
import type { RecordingSessionData } from "../../../electron/ipc/types";
import { subscribeAndReplayRecordingSession } from "./recordingSessionSync";

function session(webcamPath: string | null): RecordingSessionData {
	return {
		videoPath: "/recordings/screen.mp4",
		webcamPath,
		timeOffsetMs: webcamPath ? 42 : 0,
	};
}

function createSource(initial: RecordingSessionData | null) {
	let authoritative = initial;
	let listener: ((value: RecordingSessionData | null) => void) | null = null;
	return {
		set(value: RecordingSessionData | null, emit = true) {
			authoritative = value;
			if (emit) listener?.(value);
		},
		subscribe(callback: (value: RecordingSessionData | null) => void) {
			listener = callback;
			return () => {
				if (listener === callback) listener = null;
			};
		},
		getSnapshot: vi.fn(async () => authoritative),
	};
}

describe("subscribeAndReplayRecordingSession", () => {
	it("replays a webcam session whose one-shot event happened before editor mount", async () => {
		const source = createSource(session("/recordings/webcam.webm"));
		const received: Array<RecordingSessionData | null> = [];

		const subscription = subscribeAndReplayRecordingSession({
			subscribe: source.subscribe,
			getSnapshot: source.getSnapshot,
			onSession: (value) => received.push(value),
		});
		await subscription.ready;

		expect(received).toEqual([session("/recordings/webcam.webm")]);
		subscription.unsubscribe();
	});

	it("does not let a stale first snapshot overwrite an event received before state commit", async () => {
		let resolveSnapshot: (value: RecordingSessionData | null) => void = () => undefined;
		let listener: ((value: RecordingSessionData | null) => void) | null = null;
		const received: Array<RecordingSessionData | null> = [];
		const stale = session(null);
		const complete = session("/recordings/webcam.webm");

		const subscription = subscribeAndReplayRecordingSession({
			subscribe(callback) {
				listener = callback;
				return () => {
					listener = null;
				};
			},
			getSnapshot: () =>
				new Promise<RecordingSessionData | null>((resolve) => {
					resolveSnapshot = resolve;
				}),
			onSession: (value) => received.push(value),
		});

		listener?.(complete);
		resolveSnapshot(stale);
		await subscription.ready;

		expect(received).toEqual([complete]);
		subscription.unsubscribe();
	});

	it("recovers a webcam update that occurs in an unsubscribe/resubscribe gap", async () => {
		const source = createSource(session(null));
		const received: Array<RecordingSessionData | null> = [];
		const first = subscribeAndReplayRecordingSession({
			subscribe: source.subscribe,
			getSnapshot: source.getSnapshot,
			onSession: (value) => received.push(value),
		});
		await first.ready;
		first.unsubscribe();

		source.set(session("/recordings/webcam.webm"), false);

		const second = subscribeAndReplayRecordingSession({
			subscribe: source.subscribe,
			getSnapshot: source.getSnapshot,
			onSession: (value) => received.push(value),
		});
		await second.ready;

		expect(received.at(-1)).toEqual(session("/recordings/webcam.webm"));
		second.unsubscribe();
	});
});
