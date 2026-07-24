export function subscribeAndReplayRecordingSession<T>({
	subscribe,
	getSnapshot,
	onSession,
}: {
	subscribe: (callback: (session: T | null) => void) => () => void;
	getSnapshot: () => Promise<T | null>;
	onSession: (session: T | null) => void;
}): {
	ready: Promise<void>;
	unsubscribe: () => void;
} {
	let disposed = false;
	let eventRevision = 0;
	const unsubscribeFromEvents = subscribe((session) => {
		if (disposed) return;
		eventRevision += 1;
		onSession(session);
	});
	const snapshotRevision = eventRevision;
	const ready = getSnapshot().then((snapshot) => {
		if (disposed || eventRevision !== snapshotRevision) return;
		onSession(snapshot);
	});

	return {
		ready,
		unsubscribe: () => {
			if (disposed) return;
			disposed = true;
			unsubscribeFromEvents();
		},
	};
}
