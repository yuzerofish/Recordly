import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { WebcamEffectSettings } from "@/components/video-editor/types";
import { WebcamEffectPipeline, type WebcamEffectPipelineStatus } from "@/lib/webcamEffects";
import { canShowFloatingWebcamPreview } from "../floatingWebcamPreview";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };

export function useWebcamPreviewOverlay({
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
	hudOverlayMousePassthroughSupported,
	webcamEffect,
}: {
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
	webcamEffect: WebcamEffectSettings;
}) {
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewOffsetRef = useRef(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const webcamPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const recordingWebcamPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const webcamEffectPipelineRef = useRef<WebcamEffectPipeline | null>(null);
	const [webcamEffectRendered, setWebcamEffectRendered] = useState(false);
	const [webcamEffectStatus, setWebcamEffectStatus] =
		useState<WebcamEffectPipelineStatus>("idle");
	const [previewNodeRevision, setPreviewNodeRevision] = useState(0);
	const [webcamEffectRevision, setWebcamEffectRevision] = useState(0);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const previewDragMoveRafRef = useRef<number | null>(null);
	const previewDragPendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const isWebcamPreviewDraggingRef = useRef(false);
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled && (showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));
	const webcamEffectRestartKey = `${previewNodeRevision}:${webcamEffectRevision}`;
	const {
		type: webcamEffectType,
		opacity: webcamEffectOpacity,
		feather: webcamEffectFeather,
		background: webcamEffectBackground,
		silhouetteColor: webcamEffectSilhouetteColor,
	} = webcamEffect;

	useEffect(() => {
		if (!webcamEnabled) {
			webcamPreviewOffsetRef.current = DEFAULT_WEBCAM_PREVIEW_OFFSET;
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = "translate(0px, 0px)";
			}
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
		}
	}, [webcamEnabled]);

	const handleWebcamPreviewPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}

		const previewRect = event.currentTarget.getBoundingClientRect();

		event.preventDefault();
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
		webcamPreviewDragStartRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: webcamPreviewOffsetRef.current.x,
			originY: webcamPreviewOffsetRef.current.y,
			initialLeft: previewRect.left,
			initialTop: previewRect.top,
			previewWidth: previewRect.width,
			previewHeight: previewRect.height,
			dragging: false,
		};
		event.currentTarget.setPointerCapture(event.pointerId);
	}, []);

	const handleWebcamPreviewPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;

		if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD) {
			return;
		}

		if (!dragState.dragging) {
			dragState.dragging = true;
			isWebcamPreviewDraggingRef.current = true;
		}

		previewDragPendingPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
		if (previewDragMoveRafRef.current !== null) {
			return;
		}

		previewDragMoveRafRef.current = requestAnimationFrame(() => {
			previewDragMoveRafRef.current = null;
			const latestDragState = webcamPreviewDragStartRef.current;
			const pointer = previewDragPendingPointerRef.current;
			if (!latestDragState || !pointer) {
				return;
			}

			const latestDeltaX = pointer.clientX - latestDragState.startX;
			const latestDeltaY = pointer.clientY - latestDragState.startY;
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			const unclampedLeft = latestDragState.initialLeft + latestDeltaX;
			const unclampedTop = latestDragState.initialTop + latestDeltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - latestDragState.previewWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - latestDragState.previewHeight),
			);

			const nextOffset = {
				x: latestDragState.originX + (clampedLeft - latestDragState.initialLeft),
				y: latestDragState.originY + (clampedTop - latestDragState.initialTop),
			};
			webcamPreviewOffsetRef.current = nextOffset;
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;
			}
		});
	}, []);

	const handleWebcamPreviewPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}
		if (previewDragMoveRafRef.current !== null) {
			cancelAnimationFrame(previewDragMoveRafRef.current);
			previewDragMoveRafRef.current = null;
		}
		previewDragPendingPointerRef.current = null;

		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		setWebcamPreviewOffset({ ...webcamPreviewOffsetRef.current });
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, []);

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) {
			return;
		}

		videoElement.srcObject = previewStream;
		const playPromise = videoElement.play();
		if (playPromise) {
			playPromise.catch(() => {
				// Ignore autoplay interruptions while the preview element mounts.
			});
		}
	}, []);

	const setWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			if (webcamPreviewRef.current === node) return;
			webcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
			setWebcamEffectRendered(false);
			setPreviewNodeRevision((revision) => revision + 1);
		},
		[attachPreviewStreamToNode],
	);

	const setRecordingWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			if (recordingWebcamPreviewRef.current === node) return;
			recordingWebcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
			setWebcamEffectRendered(false);
			setPreviewNodeRevision((revision) => revision + 1);
		},
		[attachPreviewStreamToNode],
	);

	const setWebcamPreviewCanvasNode = useCallback((node: HTMLCanvasElement | null) => {
		if (webcamPreviewCanvasRef.current === node) return;
		webcamPreviewCanvasRef.current = node;
		setWebcamEffectRendered(false);
	}, []);

	const setRecordingWebcamPreviewCanvasNode = useCallback((node: HTMLCanvasElement | null) => {
		if (recordingWebcamPreviewCanvasRef.current === node) return;
		recordingWebcamPreviewCanvasRef.current = node;
		setWebcamEffectRendered(false);
	}, []);

	useEffect(() => {
		return () => {
			if (previewDragMoveRafRef.current !== null) {
				cancelAnimationFrame(previewDragMoveRafRef.current);
			}
			previewDragMoveRafRef.current = null;
			previewDragPendingPointerRef.current = null;
		};
	}, []);

	useEffect(() => {
		let mounted = true;

		const startPreview = async () => {
			if (!shouldStreamWebcamPreview) {
				return;
			}

			try {
				const previewStream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							}
						: {
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							},
					audio: false,
				});

				if (!mounted) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				previewStreamRef.current = previewStream;
				attachPreviewStreamToNode(webcamPreviewRef.current);
				attachPreviewStreamToNode(recordingWebcamPreviewRef.current);
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			const previewNode = webcamPreviewRef.current;
			const recordingPreviewNode = recordingWebcamPreviewRef.current;
			const previewStream = previewStreamRef.current;

			[previewNode, recordingPreviewNode]
				.filter((node): node is HTMLVideoElement => Boolean(node))
				.forEach((videoElement) => {
					videoElement.pause();
					videoElement.srcObject = null;
				});
			previewStream?.getTracks().forEach((track) => track.stop());
			if (previewStreamRef.current === previewStream) {
				previewStreamRef.current = null;
			}
		};
	}, [attachPreviewStreamToNode, shouldStreamWebcamPreview, webcamDeviceId]);

	useEffect(() => {
		if (!shouldStreamWebcamPreview || webcamEffectType !== "silhouette") {
			webcamEffectPipelineRef.current?.dispose();
			webcamEffectPipelineRef.current = null;
			setWebcamEffectRendered(false);
			setWebcamEffectStatus("idle");
			return;
		}

		let cancelled = false;
		let videoFrameRequestId: number | null = null;
		let animationFrameRequestId: number | null = null;
		let scheduledVideo: HTMLVideoElement | null = null;
		let rendering = false;
		const effectSettings: WebcamEffectSettings = {
			type: webcamEffectType,
			opacity: webcamEffectOpacity,
			feather: webcamEffectFeather,
			background: webcamEffectBackground,
			silhouetteColor: webcamEffectSilhouetteColor,
		};
		void webcamEffectRestartKey;
		const getActiveVideo = () => {
			const popoverVideo = webcamPreviewRef.current;
			if (popoverVideo?.isConnected) return popoverVideo;
			const recordingVideo = recordingWebcamPreviewRef.current;
			if (recordingVideo?.isConnected) return recordingVideo;
			return popoverVideo ?? recordingVideo;
		};
		const drawToCanvas = (canvas: HTMLCanvasElement | null, source: CanvasImageSource) => {
			if (!canvas) return;
			const video = getActiveVideo();
			if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
			if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
			if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
			const context = canvas.getContext("2d", { alpha: true });
			if (!context) return;
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(source, 0, 0, canvas.width, canvas.height);
		};
		const schedule = () => {
			if (cancelled) return;
			const video = getActiveVideo() as
				| (HTMLVideoElement & {
						requestVideoFrameCallback?: (
							callback: (_now: number, metadata: { mediaTime: number }) => void,
						) => number;
						cancelVideoFrameCallback?: (handle: number) => void;
				  })
				| null;
			if (video?.requestVideoFrameCallback) {
				scheduledVideo = video;
				videoFrameRequestId = video.requestVideoFrameCallback((_now, metadata) => {
					videoFrameRequestId = null;
					scheduledVideo = null;
					void tick(Math.max(0, metadata.mediaTime * 1000));
				});
				return;
			}
			animationFrameRequestId = requestAnimationFrame(() => {
				animationFrameRequestId = null;
				void tick();
			});
		};
		const tick = async (presentedTimestampMs?: number) => {
			if (cancelled) return;
			const video = getActiveVideo();
			if (
				!rendering &&
				video &&
				video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
				video.videoWidth > 0 &&
				video.videoHeight > 0
			) {
				rendering = true;
				try {
					if (!webcamEffectPipelineRef.current) {
						webcamEffectPipelineRef.current = new WebcamEffectPipeline();
						setWebcamEffectStatus("loading");
					}
					const result = await webcamEffectPipelineRef.current.processFrame({
						source: video,
						timestampMs: Math.max(0, presentedTimestampMs ?? video.currentTime * 1000),
						settings: effectSettings,
						mode: "preview",
						realtime: true,
					});
					if (cancelled) return;
					setWebcamEffectStatus(result.status);
					if (result.processed) {
						drawToCanvas(webcamPreviewCanvasRef.current, result.source);
						drawToCanvas(recordingWebcamPreviewCanvasRef.current, result.source);
						setWebcamEffectRendered(true);
					} else if (result.status !== "loading") {
						setWebcamEffectRendered(false);
					}
				} finally {
					rendering = false;
				}
			}
			schedule();
		};

		void tick();
		return () => {
			cancelled = true;
			if (videoFrameRequestId !== null) {
				scheduledVideo?.cancelVideoFrameCallback?.(videoFrameRequestId);
			}
			if (animationFrameRequestId !== null) cancelAnimationFrame(animationFrameRequestId);
			webcamEffectPipelineRef.current?.dispose();
			webcamEffectPipelineRef.current = null;
		};
	}, [
		shouldStreamWebcamPreview,
		webcamEffectRestartKey,
		webcamEffectBackground,
		webcamEffectFeather,
		webcamEffectOpacity,
		webcamEffectSilhouetteColor,
		webcamEffectType,
	]);

	const retryWebcamEffect = useCallback(() => {
		webcamEffectPipelineRef.current?.dispose();
		webcamEffectPipelineRef.current = null;
		setWebcamEffectRendered(false);
		setWebcamEffectStatus("loading");
		setWebcamEffectRevision((revision) => revision + 1);
	}, []);

	return {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setWebcamPreviewCanvasNode,
		setRecordingWebcamPreviewNode,
		setRecordingWebcamPreviewCanvasNode,
		webcamEffectRendered,
		webcamEffectStatus,
		retryWebcamEffect,
		showRecordingWebcamPreview,
	};
}
