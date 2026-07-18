import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageRoot = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
const publicRoot = path.join(root, "public", "mediapipe");
const wasmTarget = path.join(publicRoot, "vision", "wasm");
const modelPath = path.join(publicRoot, "models", "selfie_segmenter-float16-v1.tflite");

const expected = new Map([
	["vision_wasm_internal.js", "e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c"],
	[
		"vision_wasm_internal.wasm",
		"6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc",
	],
	[
		"vision_wasm_module_internal.js",
		"1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44",
	],
	[
		"vision_wasm_module_internal.wasm",
		"617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756",
	],
	[
		"vision_wasm_nosimd_internal.js",
		"438d1fe8ff7f4d946025bc211c291543c037d8a3785ed4eee60f1f521b236296",
	],
	[
		"vision_wasm_nosimd_internal.wasm",
		"8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31",
	],
]);
const expectedModelHash = "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b";

function sha256(data) {
	return createHash("sha256").update(data).digest("hex");
}

const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "0.10.35") {
	throw new Error(`Expected @mediapipe/tasks-vision 0.10.35, found ${packageJson.version}`);
}

await mkdir(wasmTarget, { recursive: true });
for (const [fileName, expectedHash] of expected) {
	const source = await readFile(path.join(packageRoot, "wasm", fileName));
	const actualHash = sha256(source);
	if (actualHash !== expectedHash) {
		throw new Error(`Unexpected checksum for MediaPipe asset ${fileName}: ${actualHash}`);
	}
	await writeFile(path.join(wasmTarget, fileName), source);
}

const model = await readFile(modelPath);
const modelHash = sha256(model);
if (modelHash !== expectedModelHash) {
	throw new Error(`Unexpected checksum for Selfie Segmenter model: ${modelHash}`);
}

console.log(
	`[mediapipe] Verified ${expected.size} WASM assets and local Selfie Segmenter model (${model.length} bytes).`,
);
