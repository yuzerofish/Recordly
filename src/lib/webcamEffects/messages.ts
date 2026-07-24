export interface PersonMask {
	data: Float32Array;
	width: number;
	height: number;
	timestampMs: number;
}

export interface NormalizedFacePoint {
	x: number;
	y: number;
}

export interface CartoonFaceEyeGeometry {
	outer: NormalizedFacePoint;
	inner: NormalizedFacePoint;
	upper: NormalizedFacePoint;
	lower: NormalizedFacePoint;
	iris?: NormalizedFacePoint;
}

export interface CartoonFaceExpression {
	eyeBlinkLeft: number;
	eyeBlinkRight: number;
	mouthSmileLeft: number;
	mouthSmileRight: number;
	jawOpen: number;
}

export interface CartoonFaceGeometry {
	timestampMs: number;
	expression?: CartoonFaceExpression;
	imageLeftEye: CartoonFaceEyeGeometry;
	imageRightEye: CartoonFaceEyeGeometry;
	mouth: {
		left: NormalizedFacePoint;
		right: NormalizedFacePoint;
		upper: NormalizedFacePoint;
		lower: NormalizedFacePoint;
	};
	face: {
		left: NormalizedFacePoint;
		right: NormalizedFacePoint;
		top: NormalizedFacePoint;
		bottom: NormalizedFacePoint;
	};
}

export interface WebcamEffectInference {
	mask: PersonMask;
	face: CartoonFaceGeometry | null;
}

export type SegmentationDelegate = "GPU" | "CPU";

export type SegmentationWorkerRequest =
	| {
			type: "initialize";
			assetBaseUrl: string;
			preferredDelegate: SegmentationDelegate;
	  }
	| {
			type: "segment";
			requestId: number;
			frame: ImageBitmap;
			timestampMs: number;
			discontinuity: boolean;
	  }
	| { type: "reset" }
	| { type: "dispose" };

export type SegmentationWorkerResponse =
	| { type: "ready"; delegate: SegmentationDelegate }
	| {
			type: "result";
			requestId: number;
			mask: PersonMask;
	  }
	| { type: "error"; requestId?: number; message: string };

export type FaceLandmarkerWorkerRequest =
	| {
			type: "initialize";
			assetBaseUrl: string;
			preferredDelegate: SegmentationDelegate;
	  }
	| {
			type: "track";
			requestId: number;
			frame: ImageBitmap;
			timestampMs: number;
			discontinuity: boolean;
	  }
	| { type: "reset" }
	| { type: "dispose" };

export type FaceLandmarkerWorkerResponse =
	| { type: "ready"; delegate: SegmentationDelegate }
	| {
			type: "result";
			requestId: number;
			face: CartoonFaceGeometry | null;
	  }
	| { type: "error"; requestId?: number; message: string };
