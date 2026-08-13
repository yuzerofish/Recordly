export interface HudWorkspaceWindow {
	setVisibleOnAllWorkspaces(
		visible: boolean,
		options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean },
	): void;
}

export function applyHudWindowWorkspacePolicy(
	window: HudWorkspaceWindow,
	platform: NodeJS.Platform = process.platform,
): void {
	if (platform !== "darwin") return;
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}
