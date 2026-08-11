import {
	ArrowClockwiseIcon,
	CaretUpIcon,
	DotsThreeVerticalIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	SpinnerGapIcon,
	TimerIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	WarningCircleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { Separator } from "@/components/ui/separator";
import {
	DEFAULT_EDITOR_PREFERENCES,
	loadEditorPreferences,
	saveEditorPreferences,
} from "@/components/video-editor/editorPreferences";
import { getWebcamEffectLayerVisibility } from "@/lib/webcamEffects";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { Button } from "../ui/button";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import { canToggleFloatingWebcamPreview } from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";
import { CountdownPopover } from "./popovers/CountdownPopover";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { MicPopover } from "./popovers/MicPopover";
import { MorePopover } from "./popovers/MorePopover";
import { ProjectPopover } from "./popovers/ProjectPopover";
import { SourcePopover } from "./popovers/SourcePopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { RecordingControls } from "./RecordingControls";
import { MarqueeText } from "./SourceSelector";

const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const { openId, requestClose, requestOpen } = useLaunchPopoverCoordinator();

	const {
		recording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
	} = useScreenRecorder();

	const { elapsed, formatTime } = useRecordingTimer(recording, paused);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const [webcamEffect, setWebcamEffect] = useState(() => ({
		...loadEditorPreferences().webcam.effect,
	}));
	useEffect(() => {
		const syncPersistedWebcamEffect = () => {
			if (document.visibilityState === "visible") {
				setWebcamEffect({ ...loadEditorPreferences().webcam.effect });
			}
		};
		document.addEventListener("visibilitychange", syncPersistedWebcamEffect);
		window.addEventListener("focus", syncPersistedWebcamEffect);
		window.addEventListener("storage", syncPersistedWebcamEffect);
		return () => {
			document.removeEventListener("visibilitychange", syncPersistedWebcamEffect);
			window.removeEventListener("focus", syncPersistedWebcamEffect);
			window.removeEventListener("storage", syncPersistedWebcamEffect);
		};
	}, []);
	const updateWebcamEffectType = (type: "none" | "silhouette" | "monkey") => {
		const nextEffect = { ...webcamEffect, type };
		setWebcamEffect(nextEffect);
		const persistedWebcam = loadEditorPreferences().webcam ?? DEFAULT_EDITOR_PREFERENCES.webcam;
		saveEditorPreferences({
			webcam: { ...persistedWebcam, effect: nextEffect },
		});
	};

	const {
		selectedSource,
		hasSelectedSource,
		projectLibraryEntries,
		handleSourceSelect,
		openVideoFile,
		openProjectFromLibrary,
		syncSelectedSource,
		refreshProjectLibrary,
	} = useLaunchWindowActions();

	const showWebcamControls = webcamEnabled && !recording;
	const webcamPreviewIsTransparent =
		webcamEffect.type === "silhouette" && webcamEffect.background === "transparent";
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || openId === "mic",
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || openId === "webcam");

	const {
		hudOverlayMousePassthroughSupported,
		platform,
		appVersion,
		hideHudFromCapture,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
	} = useLaunchWindowSystemState();

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (!selectedDeviceId) {
			return;
		}

		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	const {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		showRecordingWebcamPreview,
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
	} = useWebcamPreviewOverlay({
		webcamEnabled,
		webcamDeviceId,
		showWebcamControls,
		webcamPopoverOpen: openId === "webcam",
		hudOverlayMousePassthroughSupported,
		webcamEffect,
	});
	const webcamEffectLayerVisibility = getWebcamEffectLayerVisibility({
		effectType: webcamEffect.type,
		status: webcamEffectStatus,
		hasSafeFrame: webcamEffectRendered,
	});

	useEffect(() => {
		window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(showRecordingWebcamPreview);
	}, [showRecordingWebcamPreview]);

	useEffect(() => {
		return () => {
			window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(false);
		};
	}, []);

	const {
		recordingHudOffset,
		isHudDragging,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useHudBarDrag({
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		});

	useEffect(() => {
		if (!recording) return;
		if (openId) requestClose(openId);
		const restorePassthrough = window.setTimeout(() => {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}, 0);
		return () => window.clearTimeout(restorePassthrough);
	}, [openId, recording, requestClose]);

	useEffect(() => {
		let mounted = true;

		void window.electronAPI.getSelectedSource().then((source) => {
			if (mounted) syncSelectedSource(source);
		});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource]);

	const hudStateTransition = {
		duration: 0.24,
		ease: [0.22, 1, 0.36, 1] as const,
	};

	const recordingControls = (
		<RecordingControls
			paused={paused}
			microphoneEnabled={microphoneEnabled}
			elapsed={elapsed}
			onToggleMicrophone={() => setMicrophoneEnabled(!microphoneEnabled)}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecording}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<>
			{platform !== "linux" && (
				<>
					<SourcePopover
						selectedSource={selectedSource}
						onSourceSelect={handleSourceSelect}
						onOpen={beginInteractiveHudAction}
						trigger={
							<Button
								variant="outline"
								size="lg"
								className={`${styles.electronNoDrag} group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] shrink-0 border-[var(--launch-border)] bg-[var(--launch-surface)] text-[var(--launch-text)] hover:border-[var(--launch-border-strong)] hover:bg-[var(--launch-hover)] transition-all ${openId === "sources" ? "border-[var(--launch-border-strong)] bg-[var(--launch-hover)]" : ""}`}
								title={selectedSource}
							>
								<MonitorIcon size={16} className="shrink-0" />
								<div className="flex-1 min-w-0 overflow-hidden">
									<MarqueeText text={selectedSource} />
								</div>
								<CaretUpIcon
									size={10}
									className={`text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200 ${
										openId === "sources" ? "" : "rotate-180"
									}`}
								/>
							</Button>
						}
					/>

					<Separator orientation="vertical" className="mx-[5px] h-6" />
				</>
			)}

			<MicPopover
				disabled={recording}
				systemAudioEnabled={systemAudioEnabled}
				onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
				microphoneEnabled={microphoneEnabled}
				onDisableMicrophone={() => setMicrophoneEnabled(false)}
				devices={devices}
				microphoneDeviceId={microphoneDeviceId}
				selectedDeviceId={selectedDeviceId}
				onSelectDevice={(deviceId) => {
					setMicrophoneEnabled(true);
					setSelectedDeviceId(deviceId);
					setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={
							microphoneEnabled
								? t("recording.disableMicrophone")
								: t("recording.enableMicrophone")
						}
						className={microphoneEnabled ? styles.ibActive : ""}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon size={18} />
						) : (
							<MicrophoneSlashIcon size={18} />
						)}
					</Button>
				}
			/>

			<WebcamPopover
				disabled={recording}
				webcamEnabled={webcamEnabled}
				onDisableWebcam={() => setWebcamEnabled(false)}
				canToggleFloatingPreview={canToggleFloatingWebcamPreview(
					hudOverlayMousePassthroughSupported,
				)}
				showFloatingWebcamPreview={showFloatingWebcamPreview}
				onToggleFloatingPreview={() => setShowFloatingWebcamPreview((current) => !current)}
				showWebcamControls={showWebcamControls}
				setWebcamPreviewNode={setWebcamPreviewNode}
				setWebcamPreviewCanvasNode={setWebcamPreviewCanvasNode}
				webcamEffectType={webcamEffect.type}
				webcamEffectRendered={webcamEffectRendered}
				webcamEffectStatus={webcamEffectStatus}
				onRetryWebcamEffect={retryWebcamEffect}
				onWebcamEffectTypeChange={updateWebcamEffectType}
				videoDevices={videoDevices}
				webcamDeviceId={webcamDeviceId}
				selectedVideoDeviceId={selectedVideoDeviceId}
				onSelectVideoDevice={(deviceId) => {
					setWebcamEnabled(true);
					setSelectedVideoDeviceId(deviceId);
					setWebcamDeviceId(deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={
							webcamEnabled
								? t("recording.disableWebcam")
								: t("recording.enableWebcam")
						}
						className={webcamEnabled ? styles.ibActive : ""}
					>
						{webcamEnabled ? (
							<VideoCameraIcon size={18} />
						) : (
							<VideoCameraSlashIcon size={18} />
						)}
					</Button>
				}
			/>

			<CountdownPopover
				countdownDelay={countdownDelay}
				onSelectDelay={setCountdownDelay}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={t("recording.countdownDelay")}
						className={countdownDelay > 0 ? styles.ibActive : ""}
					>
						<TimerIcon size={18} />
					</Button>
				}
			/>

			<button
				type="button"
				className={`${styles.recBtn} ${styles.electronNoDrag}`}
				onClick={
					hasSelectedSource || platform === "linux"
						? toggleRecording
						: () => {
								beginInteractiveHudAction();
								requestOpen("sources");
							}
				}
				disabled={countdownActive}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</button>

			<Separator orientation="vertical" className="mx-[5px] h-6" />

			<div className="relative w-0 h-0">
				<ProjectPopover
					entries={projectLibraryEntries}
					onOpenProject={openProjectFromLibrary}
					trigger={<div className="absolute inset-0 pointer-events-none opacity-0" />}
				/>
			</div>

			<MorePopover
				supportsHudCaptureProtection={supportsHudCaptureProtection}
				hideHudFromCapture={hideHudFromCapture}
				onToggleHudCaptureProtection={() => {
					void toggleHudCaptureProtection();
				}}
				onChooseRecordingsDirectory={() => {
					void chooseRecordingsDirectory();
				}}
				onOpenVideoFile={() => {
					void openVideoFile();
				}}
				onOpenProjectBrowser={() => {
					refreshProjectLibrary().then(() => {
						requestOpen("projects");
					});
				}}
				showDevUpdatePreview={SHOW_DEV_UPDATE_PREVIEW}
				onPreviewUpdateUi={() => {
					if (openId) requestClose(openId);
					void window.electronAPI.previewUpdateToast().catch((error) => {
						console.warn("Failed to preview update toast:", error);
					});
				}}
				appVersion={appVersion}
				trigger={
					<Button variant="ghost" size="icon" iconSize="lg" title={t("recording.more")}>
						<DotsThreeVerticalIcon size={18} />
					</Button>
				}
			/>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<MinusIcon size={16} />
			</Button>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayClose?.()}
				title={t("recording.closeApp")}
			>
				<XIcon size={16} />
			</Button>
		</>
	);

	const finalizingControls = (
		<div className={styles.finalizingState}>
			<ArrowClockwiseIcon size={15} className={styles.finalizingSpin} />
			<div className={styles.finalizingCopy}>
				<span>{t("recording.preparing", "Preparing recording")}</span>
				<small>{t("recording.preparingSubtitle", "Opening the editor in a moment")}</small>
			</div>
		</div>
	);

	const hudMode = finalizing ? "finalizing" : recording ? "recording" : "idle";
	const useNativeHudBarDrag =
		platform === "linux" || hudOverlayMousePassthroughSupported === false;

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div
						className="flex flex-col items-center pointer-events-auto p-2"
						onMouseEnter={handleHudMouseEnter}
						onMouseLeave={handleHudMouseLeave}
					>
						<div
							ref={hudBarTransformRef}
							style={{
								transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
							}}
						>
							<motion.div
								ref={hudBarRef}
								layout={!showRecordingWebcamPreview && !isHudDragging}
								transition={hudStateTransition}
								className={`${styles.bar} launch-theme mb-2`}
							>
								<div
									// Linux compositors and non-passthrough Windows fallback windows
									// need native window dragging; the JS drag path only translates
									// content inside the HUD window.
									className={`flex items-center px-0.5 cursor-grab active:cursor-grabbing ${
										useNativeHudBarDrag ? styles.electronDrag : ""
									}`}
									onPointerDown={handleHudBarPointerDown}
									onPointerMove={handleHudBarPointerMove}
									onPointerUp={handleHudBarPointerUp}
									onPointerCancel={handleHudBarPointerUp}
								>
									<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
								</div>

								<div className={styles.barStateViewport}>
									<AnimatePresence initial={false} mode="wait">
										<motion.div
											key={hudMode}
											layout={!showRecordingWebcamPreview && !isHudDragging}
											className={styles.barState}
											initial={{
												opacity: 0,
												y: 10,
												scale: 0.985,
												filter: "blur(8px)",
											}}
											animate={{
												opacity: 1,
												y: 0,
												scale: 1,
												filter: "blur(0px)",
											}}
											exit={{
												opacity: 0,
												y: -10,
												scale: 0.985,
												filter: "blur(6px)",
											}}
											transition={hudStateTransition}
										>
											{finalizing
												? finalizingControls
												: recording
													? recordingControls
													: idleControls}
										</motion.div>
									</AnimatePresence>
								</div>
							</motion.div>
						</div>
						{showRecordingWebcamPreview && (
							<div
								ref={recordingWebcamPreviewContainerRef}
								className={`${styles.recordingWebcamPreview} ${
									webcamPreviewIsTransparent
										? styles.recordingWebcamPreviewTransparent
										: ""
								} ${styles.electronNoDrag} pointer-events-auto`}
								data-hud-interactive
								title={t("recording.webcam")}
								style={{
									transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
								}}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
								onPointerDown={handleWebcamPreviewPointerDown}
								onPointerMove={handleWebcamPreviewPointerMove}
								onPointerUp={handleWebcamPreviewPointerUp}
								onPointerCancel={handleWebcamPreviewPointerUp}
							>
								<video
									ref={setRecordingWebcamPreviewNode}
									className={styles.recordingWebcamPreviewVideo}
									muted
									playsInline
									style={{
										opacity: webcamEffectLayerVisibility.rawOpacity,
										transform: "scaleX(-1)",
									}}
								/>
								<canvas
									ref={setRecordingWebcamPreviewCanvasNode}
									className={styles.recordingWebcamPreviewVideo}
									style={{
										opacity: webcamEffectLayerVisibility.processedOpacity,
										transform: "scaleX(-1)",
									}}
									aria-hidden="true"
								/>
								{webcamEffect.type !== "none" &&
								webcamEffectStatus === "loading" &&
								!webcamEffectRendered ? (
									<div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
										<SpinnerGapIcon className="h-6 w-6 animate-spin drop-shadow" />
									</div>
								) : null}
								{webcamEffect.type !== "none" &&
								webcamEffectStatus === "fallback" ? (
									<div
										className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white"
										title={t("recording.personSilhouetteRetry")}
									>
										<WarningCircleIcon className="h-5 w-5" weight="fill" />
									</div>
								) : null}
							</div>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
