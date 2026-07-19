import type { PersonMask } from "./messages";

export const PERSON_MASK_LOSS_HOLD_MS = 150;
export const PERSON_MASK_LOSS_FADE_MS = 150;

const PERSON_CONFIDENCE_THRESHOLD = 0.55;
const MIN_PERSON_AREA_RATIO = 0.001;
const MAX_SMOOTHING_GAP_MS = 125;
const SMOOTHING_TIME_CONSTANT_MS = 22;

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function copyMask(mask: PersonMask, timestampMs = mask.timestampMs): PersonMask {
	return {
		data: new Float32Array(mask.data),
		width: mask.width,
		height: mask.height,
		timestampMs,
	};
}

function emptyMaskLike(mask: PersonMask): PersonMask {
	return {
		data: new Float32Array(mask.data.length),
		width: mask.width,
		height: mask.height,
		timestampMs: mask.timestampMs,
	};
}

function dimensionsMatch(left: PersonMask, right: PersonMask): boolean {
	return (
		left.width === right.width &&
		left.height === right.height &&
		left.data.length === right.data.length
	);
}

export function personMaskContainsPerson(mask: PersonMask): boolean {
	const requiredPixels = Math.max(1, Math.ceil(mask.data.length * MIN_PERSON_AREA_RATIO));
	let confidentPixels = 0;
	for (const confidence of mask.data) {
		if (!(confidence >= PERSON_CONFIDENCE_THRESHOLD)) continue;
		confidentPixels += 1;
		if (confidentPixels >= requiredPixels) return true;
	}
	return false;
}

function blendMasks(previous: PersonMask, current: PersonMask, timestampMs: number): PersonMask {
	const elapsedMs = timestampMs - previous.timestampMs;
	if (elapsedMs <= 0 || elapsedMs > MAX_SMOOTHING_GAP_MS) return copyMask(current, timestampMs);
	const currentWeight = 1 - Math.exp(-elapsedMs / SMOOTHING_TIME_CONSTANT_MS);
	const data = new Float32Array(current.data.length);
	for (let index = 0; index < data.length; index++) {
		const previousValue = previous.data[index] ?? 0;
		data[index] = previousValue + ((current.data[index] ?? 0) - previousValue) * currentWeight;
	}
	return { data, width: current.width, height: current.height, timestampMs };
}

function scaleMask(mask: PersonMask, opacity: number, timestampMs: number): PersonMask {
	const data = new Float32Array(mask.data.length);
	for (let index = 0; index < data.length; index++) {
		data[index] = (mask.data[index] ?? 0) * opacity;
	}
	return { data, width: mask.width, height: mask.height, timestampMs };
}

export class PersonMaskTracker {
	private lastPersonMask: PersonMask | null = null;
	private lastProcessedTimestampMs: number | null = null;

	update(mask: PersonMask, discontinuity = false): PersonMask {
		const movedBackward =
			this.lastProcessedTimestampMs !== null &&
			mask.timestampMs < this.lastProcessedTimestampMs - 0.001;
		if (discontinuity || movedBackward) this.reset();

		this.lastProcessedTimestampMs = mask.timestampMs;
		if (personMaskContainsPerson(mask)) {
			const tracked =
				this.lastPersonMask && dimensionsMatch(this.lastPersonMask, mask)
					? blendMasks(this.lastPersonMask, mask, mask.timestampMs)
					: copyMask(mask);
			this.lastPersonMask = tracked;
			return copyMask(tracked);
		}

		if (!this.lastPersonMask || !dimensionsMatch(this.lastPersonMask, mask)) {
			this.lastPersonMask = null;
			return emptyMaskLike(mask);
		}

		const missingDurationMs = Math.max(0, mask.timestampMs - this.lastPersonMask.timestampMs);
		if (missingDurationMs <= PERSON_MASK_LOSS_HOLD_MS) {
			return copyMask(this.lastPersonMask, mask.timestampMs);
		}

		const fadeOpacity = clamp(
			1 - (missingDurationMs - PERSON_MASK_LOSS_HOLD_MS) / PERSON_MASK_LOSS_FADE_MS,
			0,
			1,
		);
		if (fadeOpacity <= 0) {
			this.lastPersonMask = null;
			return emptyMaskLike(mask);
		}
		return scaleMask(this.lastPersonMask, fadeOpacity, mask.timestampMs);
	}

	reset(): void {
		this.lastPersonMask = null;
		this.lastProcessedTimestampMs = null;
	}
}
