import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default async function stabilizeMacAdhocIdentity(context) {
	if (context.electronPlatformName !== "darwin") {
		return;
	}

	const projectDir = context.packager.projectDir;
	const appName = `${context.packager.appInfo.productFilename}.app`;
	const appPath = path.join(context.appOutDir, appName);
	const entitlementsPath = path.join(projectDir, "build", "entitlements.mac.plist");
	const requirementsPath = path.join(projectDir, "build", "recordly-personal.requirements");

	// electron-builder already signs nested code inside-out. Re-sign only the outer
	// app with an explicit designated requirement so local rebuilds keep one TCC
	// identity instead of receiving a new cdhash-only identity each time.
	await execFileAsync("codesign", [
		"--force",
		"--sign",
		"-",
		"--options",
		"runtime",
		"--entitlements",
		entitlementsPath,
		"--requirements",
		requirementsPath,
		appPath,
	]);

	await execFileAsync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
}
