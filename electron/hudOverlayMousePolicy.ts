export function resolveHudOverlayIgnoreMouse({
	requestedIgnore,
	sourceSelectionActive,
}: {
	requestedIgnore: boolean;
	sourceSelectionActive: boolean;
	recordingActive: boolean;
}): boolean {
	if (sourceSelectionActive) {
		return true;
	}
	return requestedIgnore;
}
