import { describe, expect, it } from "vitest";
import { createFaceLandmarkerOptions } from "./faceLandmarkerConfig";

describe("createFaceLandmarkerOptions", () => {
	it("enables local blendshape output for the required expression channels", () => {
		const options = createFaceLandmarkerOptions({
			modelAssetPath: "app://mediapipe/models/face.task",
			delegate: "GPU",
		});

		expect(options).toMatchObject({
			baseOptions: {
				modelAssetPath: "app://mediapipe/models/face.task",
				delegate: "GPU",
			},
			runningMode: "VIDEO",
			numFaces: 1,
			outputFaceBlendshapes: true,
			outputFacialTransformationMatrixes: false,
		});
	});
});
