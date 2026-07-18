export interface PersonMask {
	data: Float32Array;
	width: number;
	height: number;
	timestampMs: number;
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
