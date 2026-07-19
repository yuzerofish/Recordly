import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const releaseRoot = path.join(projectRoot, "release");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const productName = packageJson.productName ?? packageJson.name ?? "Recordly";
const packageName = packageJson.name ?? "recordly";

function relativePath(filePath) {
	return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function fail(message) {
	throw new Error(`[packaged-smoke] ${message}`);
}

function assertFile(filePath, label, { executable = false } = {}) {
	if (!existsSync(filePath)) {
		fail(`${label} is missing at ${relativePath(filePath)}`);
	}

	if (!statSync(filePath).isFile()) {
		fail(`${label} is not a file at ${relativePath(filePath)}`);
	}

	if (executable && process.platform !== "win32") {
		try {
			accessSync(filePath, constants.X_OK);
		} catch {
			fail(`${label} is not executable at ${relativePath(filePath)}`);
		}
	}

	console.log(`[packaged-smoke] ${label}: ${relativePath(filePath)}`);
}

function findDirectoriesByName(rootDir, directoryName, maxDepth = 8) {
	if (!existsSync(rootDir)) {
		return [];
	}

	const matches = [];
	const queue = [{ dir: rootDir, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || current.depth > maxDepth) {
			continue;
		}

		for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}

			const childDir = path.join(current.dir, entry.name);
			if (entry.name === directoryName) {
				matches.push(childDir);
				continue;
			}

			queue.push({ dir: childDir, depth: current.depth + 1 });
		}
	}

	return matches;
}

function findAppBundleDir(startDir) {
	let current = startDir;
	while (current !== path.dirname(current)) {
		if (current.endsWith(".app")) {
			return current;
		}
		current = path.dirname(current);
	}

	return null;
}

function findFirstExistingFile(candidates) {
	return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function assertPackagedAppExecutable(unpackedRoot) {
	const resourcesDir = path.dirname(unpackedRoot);

	if (process.platform === "darwin") {
		const appBundleDir = findAppBundleDir(resourcesDir);
		if (!appBundleDir) {
			fail(`macOS app bundle not found for ${relativePath(unpackedRoot)}`);
		}

		const executablePath = findFirstExistingFile([
			path.join(appBundleDir, "Contents", "MacOS", productName),
			path.join(appBundleDir, "Contents", "MacOS", packageName),
		]);
		assertFile(
			executablePath ?? path.join(appBundleDir, "Contents", "MacOS", productName),
			"packaged app executable",
			{ executable: true },
		);
		return executablePath ?? path.join(appBundleDir, "Contents", "MacOS", productName);
	}

	const appDir = path.dirname(resourcesDir);
	const executableCandidates =
		process.platform === "win32"
			? [
					path.join(appDir, `${productName}.exe`),
					path.join(appDir, `${packageName}.exe`),
					path.join(appDir, "Recordly.exe"),
				]
			: [
					path.join(appDir, packageName),
					path.join(appDir, productName),
					path.join(appDir, productName.toLowerCase()),
				];

	const executablePath = findFirstExistingFile(executableCandidates);
	assertFile(executablePath ?? executableCandidates[0], "packaged app executable", {
		executable: true,
	});
	return executablePath ?? executableCandidates[0];
}

function getNativeArchTag(platform = process.platform, arch = process.arch) {
	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}

	if (platform === "win32") {
		return arch === "arm64" ? "win32-arm64" : "win32-x64";
	}

	if (platform === "linux") {
		return arch === "arm64" ? "linux-arm64" : "linux-x64";
	}

	return `${platform}-${arch}`;
}

function getRequiredArchTags(defaultArchTag) {
	const configured = process.env.PACKAGED_SMOKE_ARCH_TAGS?.trim();
	if (!configured) {
		return [defaultArchTag];
	}

	return [
		...new Set(
			configured
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

function getDarwinArchitectures(binaryPath) {
	const output = execFileSync("lipo", ["-archs", binaryPath], {
		encoding: "utf8",
		timeout: 15000,
	}).trim();
	return output.split(/\s+/).filter(Boolean);
}

function assertDarwinBinaryArchitecture(binaryPath, archTag, label) {
	if (process.platform !== "darwin" || !archTag.startsWith("darwin-")) {
		return;
	}

	const expectedArchitecture = archTag === "darwin-arm64" ? "arm64" : "x86_64";
	const architectures = getDarwinArchitectures(binaryPath);
	if (!architectures.includes(expectedArchitecture)) {
		fail(
			`${label} does not include ${expectedArchitecture} at ${relativePath(binaryPath)} ` +
				`(found: ${architectures.join(", ") || "none"})`,
		);
	}

	console.log(`[packaged-smoke] ${label} architecture: ${architectures.join(", ")}`);
}

function getPackagedArchTag(executablePath) {
	if (process.platform !== "darwin") {
		return getNativeArchTag();
	}

	const architectures = getDarwinArchitectures(executablePath);
	if (architectures.length !== 1) {
		fail(`packaged app must have one target architecture, found: ${architectures.join(", ")}`);
	}
	if (architectures[0] === "arm64") return "darwin-arm64";
	if (architectures[0] === "x86_64") return "darwin-x64";
	fail(`unsupported packaged macOS architecture: ${architectures[0]}`);
}

function getExpectedNativeHelperFiles(archTag) {
	if (archTag.startsWith("win32-")) {
		const helpers = [
			{ name: "wgc-capture.exe", label: "Windows capture helper", executable: true },
			{
				name: "cursor-monitor.exe",
				label: "Windows cursor monitor helper",
				executable: true,
			},
			{
				name: "recordly-gpu-export.exe",
				label: "Windows GPU export helper",
				executable: true,
			},
			{ name: "helpers-manifest.json", label: "Windows helper manifest" },
			{ name: "whisper-cli.exe", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
		if (archTag === "win32-x64") {
			helpers.push({
				name: "recordly-nvidia-cuda-compositor.exe",
				label: "NVIDIA CUDA compositor helper",
				executable: true,
			});
		}
		return helpers;
	}

	if (archTag.startsWith("darwin-")) {
		return [
			{
				name: "recordly-screencapturekit-helper",
				label: "ScreenCaptureKit helper",
				executable: true,
			},
			{ name: "recordly-window-list", label: "Window list helper", executable: true },
			{ name: "recordly-system-cursors", label: "System cursor helper", executable: true },
			{
				name: "recordly-native-cursor-monitor",
				label: "Native cursor monitor helper",
				executable: true,
			},
			{ name: "whisper-cli", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
	}

	if (archTag.startsWith("linux-")) {
		return [
			{ name: "whisper-cli", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
	}

	return [];
}

function verifyFfmpeg(unpackedRoot, archTag) {
	const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const ffmpegPath = path.join(unpackedRoot, "node_modules", "ffmpeg-static", binaryName);

	assertFile(ffmpegPath, "packaged FFmpeg binary", { executable: true });
	assertDarwinBinaryArchitecture(ffmpegPath, archTag, "packaged FFmpeg binary");

	if (process.platform === "darwin" && archTag !== getNativeArchTag()) {
		console.log(`[packaged-smoke] skipping cross-architecture FFmpeg execution for ${archTag}`);
		return;
	}

	const output = execFileSync(ffmpegPath, ["-version"], {
		encoding: "utf8",
		timeout: 15000,
		windowsHide: true,
	});

	if (!output.startsWith("ffmpeg version")) {
		fail(`FFmpeg version smoke returned unexpected output from ${relativePath(ffmpegPath)}`);
	}

	console.log(output.split(/\r?\n/, 1)[0]);
}

function verifyNativeHelpers(unpackedRoot, defaultArchTag) {
	const nativeBinRoot = path.join(unpackedRoot, "electron", "native", "bin");
	if (!existsSync(nativeBinRoot)) {
		fail(`native helper bin directory is missing at ${relativePath(nativeBinRoot)}`);
	}

	for (const archTag of getRequiredArchTags(defaultArchTag)) {
		const archDir = path.join(nativeBinRoot, archTag);
		if (!existsSync(archDir)) {
			fail(`native helper arch directory is missing at ${relativePath(archDir)}`);
		}

		const expectedFiles = getExpectedNativeHelperFiles(archTag);
		if (expectedFiles.length === 0) {
			fail(`no packaged helper expectations are defined for ${archTag}`);
		}

		for (const expectedFile of expectedFiles) {
			const binaryPath = path.join(archDir, expectedFile.name);
			assertFile(binaryPath, `${expectedFile.label} (${archTag})`, {
				executable: expectedFile.executable,
			});
			if (expectedFile.executable) {
				assertDarwinBinaryArchitecture(binaryPath, archTag, expectedFile.label);
			}
		}
	}
}

function verifyUiohook(unpackedRoot, archTag) {
	if (process.platform !== "darwin") return;

	const binaryPath = path.join(
		unpackedRoot,
		"node_modules",
		"uiohook-napi",
		"build",
		"Release",
		"uiohook_napi.node",
	);
	assertFile(binaryPath, "packaged uiohook native module");
	assertDarwinBinaryArchitecture(binaryPath, archTag, "packaged uiohook native module");
}

const unpackedRoots = findDirectoriesByName(releaseRoot, "app.asar.unpacked");

if (unpackedRoots.length === 0) {
	fail("no packaged app.asar.unpacked directory found under release/");
}

console.log(
	`[packaged-smoke] verifying ${unpackedRoots.length} packaged app root(s) for ${process.platform}/${process.arch}`,
);

for (const unpackedRoot of unpackedRoots) {
	console.log(`[packaged-smoke] root: ${relativePath(unpackedRoot)}`);
	const executablePath = assertPackagedAppExecutable(unpackedRoot);
	const packagedArchTag = getPackagedArchTag(executablePath);
	assertDarwinBinaryArchitecture(executablePath, packagedArchTag, "packaged app executable");
	verifyFfmpeg(unpackedRoot, packagedArchTag);
	verifyNativeHelpers(unpackedRoot, packagedArchTag);
	verifyUiohook(unpackedRoot, packagedArchTag);
}

console.log("[packaged-smoke] packaged binary path smoke passed");
