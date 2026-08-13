interface PresentedWebcamFrameMetadata {
	mediaTime?: number;
}

export interface WebcamEffectFrameVideo {
	paused: boolean;
	ended: boolean;
	requestVideoFrameCallback?: (
		callback: (now: DOMHighResTimeStamp, metadata: PresentedWebcamFrameMetadata) => void,
	) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
	addEventListener(type: "play" | "pause", listener: () => void): void;
	removeEventListener(type: "play" | "pause", listener: () => void): void;
}

interface WebcamEffectFrameLoopOptions {
	getVideo: () => WebcamEffectFrameVideo | null;
	renderFrame: (presentedTimestampMs?: number) => Promise<void>;
	onRenderError?: (error: unknown) => void;
	requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	cancelAnimationFrame?: (handle: number) => void;
}

export function createWebcamEffectFrameLoop({
	getVideo,
	renderFrame,
	onRenderError,
	requestAnimationFrame: requestAnimationFrameImpl = requestAnimationFrame,
	cancelAnimationFrame: cancelAnimationFrameImpl = cancelAnimationFrame,
}: WebcamEffectFrameLoopOptions) {
	let disposed = false;
	let started = false;
	let rendering = false;
	let callbackEpoch = 0;
	let attachedVideo: WebcamEffectFrameVideo | null = null;
	let videoFrameRequestId: number | null = null;
	let animationFrameRequestId: number | null = null;

	const cancelScheduledFrame = () => {
		callbackEpoch += 1;
		if (videoFrameRequestId !== null) {
			attachedVideo?.cancelVideoFrameCallback?.(videoFrameRequestId);
			videoFrameRequestId = null;
		}
		if (animationFrameRequestId !== null) {
			cancelAnimationFrameImpl(animationFrameRequestId);
			animationFrameRequestId = null;
		}
	};

	const cancelAnimationFrameOnly = () => {
		if (animationFrameRequestId === null) return;
		callbackEpoch += 1;
		cancelAnimationFrameImpl(animationFrameRequestId);
		animationFrameRequestId = null;
	};

	const schedule = () => {
		const video = attachedVideo;
		if (
			disposed ||
			rendering ||
			!video ||
			video.ended ||
			videoFrameRequestId !== null ||
			animationFrameRequestId !== null
		) {
			return;
		}

		if (video.requestVideoFrameCallback) {
			const epoch = callbackEpoch;
			let requestHandle: number | null = null;
			requestHandle = video.requestVideoFrameCallback((_now, metadata) => {
				if (disposed || epoch !== callbackEpoch || videoFrameRequestId !== requestHandle) {
					return;
				}
				videoFrameRequestId = null;
				const mediaTime = metadata.mediaTime;
				void tick(
					Number.isFinite(mediaTime) ? Math.max(0, (mediaTime ?? 0) * 1000) : undefined,
				);
			});
			videoFrameRequestId = requestHandle;
			return;
		}

		if (video.paused) return;

		const epoch = callbackEpoch;
		let requestHandle: number | null = null;
		requestHandle = requestAnimationFrameImpl(() => {
			if (disposed || epoch !== callbackEpoch || animationFrameRequestId !== requestHandle) {
				return;
			}
			animationFrameRequestId = null;
			void tick();
		});
		animationFrameRequestId = requestHandle;
	};

	const tick = async (presentedTimestampMs?: number) => {
		if (disposed || rendering) return;
		rendering = true;
		try {
			await renderFrame(presentedTimestampMs);
		} catch (error) {
			onRenderError?.(error);
		} finally {
			rendering = false;
		}
		schedule();
	};

	const handlePlay = () => {
		schedule();
	};

	const handlePause = () => {
		// A pending rVFC sleeps with the paused video and wakes on the next
		// presented frame. Keep it armed so a missing play event cannot freeze
		// the editor. RAF has no media-frame semantics, so stop that fallback.
		cancelAnimationFrameOnly();
	};

	const refresh = () => {
		if (disposed || !started) return;
		const nextVideo = getVideo();
		if (nextVideo === attachedVideo) {
			schedule();
			return;
		}

		attachedVideo?.removeEventListener("play", handlePlay);
		attachedVideo?.removeEventListener("pause", handlePause);
		cancelScheduledFrame();
		attachedVideo = nextVideo;
		attachedVideo?.addEventListener("play", handlePlay);
		attachedVideo?.addEventListener("pause", handlePause);
		if (attachedVideo) void tick();
	};

	return {
		start() {
			if (disposed || started) return;
			started = true;
			refresh();
		},
		refresh,
		dispose() {
			if (disposed) return;
			disposed = true;
			attachedVideo?.removeEventListener("play", handlePlay);
			attachedVideo?.removeEventListener("pause", handlePause);
			cancelScheduledFrame();
			attachedVideo = null;
		},
	};
}
