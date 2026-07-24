import {
	ArrowClockwise,
	Eye,
	EyeSlash as EyeOff,
	SpinnerGap,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WEBCAM_SILHOUETTE_COLOR } from "@/components/video-editor/types";
import { useScopedT } from "@/contexts/I18nContext";
import {
	getWebcamEffectLayerVisibility,
	type WebcamEffectPipelineStatus,
} from "@/lib/webcamEffects";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "webcam";

export function WebcamPopover({
	trigger,
	disabled,
	webcamEnabled,
	onDisableWebcam,
	canToggleFloatingPreview,
	showFloatingWebcamPreview,
	onToggleFloatingPreview,
	showWebcamControls,
	setWebcamPreviewNode,
	setWebcamPreviewCanvasNode,
	webcamEffectType,
	webcamEffectRendered,
	webcamEffectStatus,
	onRetryWebcamEffect,
	onWebcamEffectTypeChange,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	webcamEnabled: boolean;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	setWebcamPreviewCanvasNode: (node: HTMLCanvasElement | null) => void;
	webcamEffectType: "none" | "silhouette";
	webcamEffectRendered: boolean;
	webcamEffectStatus: WebcamEffectPipelineStatus;
	onRetryWebcamEffect: () => void;
	onWebcamEffectTypeChange: (type: "none" | "silhouette") => void;
	videoDevices: DeviceOption[];
	webcamDeviceId?: string;
	selectedVideoDeviceId?: string;
	onSelectVideoDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const webcamEffectLayerVisibility = getWebcamEffectLayerVisibility({
		effectType: webcamEffectType,
		status: webcamEffectStatus,
		hasSafeFrame: webcamEffectRendered,
	});

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabled) {
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="center"
		>
			<div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--launch-label)]">
				{t("recording.webcam")}
			</div>
			{webcamEnabled && (
				<>
					<DropdownItem
						icon={<VideoOff size={16} />}
						onClick={() => {
							onDisableWebcam();
							requestClose(POPOVER_ID);
						}}
					>
						{t("recording.turnOffWebcam")}
					</DropdownItem>
					{canToggleFloatingPreview ? (
						<DropdownItem
							icon={
								showFloatingWebcamPreview ? <EyeOff size={16} /> : <Eye size={16} />
							}
							selected={showFloatingWebcamPreview}
							onClick={onToggleFloatingPreview}
						>
							{showFloatingWebcamPreview
								? t("recording.hideFloatingWebcamPreview")
								: t("recording.showFloatingWebcamPreview")}
						</DropdownItem>
					) : null}
				</>
			)}
			{!webcamEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectWebcamToEnable")}
				</div>
			)}
			{showWebcamControls && (
				<div className="flex flex-col gap-2 px-3 py-2">
					<div className="relative mx-auto h-24 w-24 overflow-hidden rounded-2xl bg-[var(--launch-hover)] ring-1 ring-[var(--launch-border-strong)]">
						<video
							ref={setWebcamPreviewNode}
							className="absolute inset-0 h-full w-full object-cover"
							muted
							playsInline
							style={{
								opacity: webcamEffectLayerVisibility.rawOpacity,
								transform: "scaleX(-1)",
							}}
						/>
						<canvas
							ref={setWebcamPreviewCanvasNode}
							className="absolute inset-0 h-full w-full object-cover"
							style={{
								opacity: webcamEffectLayerVisibility.processedOpacity,
								transform: "scaleX(-1)",
							}}
							aria-hidden="true"
						/>
						{webcamEffectType === "silhouette" &&
						webcamEffectStatus === "loading" &&
						!webcamEffectRendered ? (
							<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10 text-white">
								<SpinnerGap className="h-5 w-5 animate-spin drop-shadow" />
							</div>
						) : null}
						{webcamEffectType === "silhouette" && webcamEffectStatus === "fallback" ? (
							<button
								type="button"
								onClick={onRetryWebcamEffect}
								className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85"
								title={t("recording.personSilhouetteRetry")}
							>
								<ArrowClockwise className="h-4 w-4" />
							</button>
						) : null}
					</div>
					<ToggleGroup
						type="single"
						value={webcamEffectType}
						onValueChange={(value) => {
							if (value === "none" || value === "silhouette") {
								onWebcamEffectTypeChange(value);
							}
						}}
						className="grid grid-cols-2 gap-1 rounded-md bg-[var(--launch-hover)] p-1"
					>
						<ToggleGroupItem value="none" className="h-7 rounded text-[10px]">
							{t("recording.personOriginal")}
						</ToggleGroupItem>
						<ToggleGroupItem value="silhouette" className="h-7 rounded text-[10px]">
							<span
								className="mr-1 h-2.5 w-2.5 rounded-full"
								style={{ backgroundColor: WEBCAM_SILHOUETTE_COLOR }}
							/>
							{t("recording.personSilhouette")}
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			)}
			{videoDevices.map((device) => (
				<DropdownItem
					key={device.deviceId}
					icon={
						webcamEnabled &&
						(webcamDeviceId === device.deviceId ||
							selectedVideoDeviceId === device.deviceId) ? (
							<Video size={16} />
						) : (
							<VideoOff size={16} />
						)
					}
					selected={
						webcamEnabled &&
						(webcamDeviceId === device.deviceId ||
							selectedVideoDeviceId === device.deviceId)
					}
					onClick={() => onSelectVideoDevice(device.deviceId)}
				>
					{device.label}
				</DropdownItem>
			))}
			{videoDevices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noWebcamsFound")}
				</div>
			)}
		</HudPopover>
	);
}
