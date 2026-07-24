export const RECORDLY_PERSONAL_BUNDLE_IDENTIFIER = "dev.recordly.silhouette.personal";

export function createMacCaptureHostExclusion({ hostProcessId }: { hostProcessId: number }): {
	hostProcessId: number;
	hostBundleIdentifier: string;
} {
	if (!Number.isSafeInteger(hostProcessId) || hostProcessId <= 0) {
		throw new Error("A valid Recordly host process ID is required for macOS capture");
	}
	return {
		hostProcessId,
		hostBundleIdentifier: RECORDLY_PERSONAL_BUNDLE_IDENTIFIER,
	};
}

export function getMacCaptureFilterPolicy(sourceId: string): {
	mode: "display" | "window";
	excludeHostApplication: boolean;
} {
	if (sourceId.startsWith("window:")) {
		return { mode: "window", excludeHostApplication: false };
	}
	return { mode: "display", excludeHostApplication: true };
}
