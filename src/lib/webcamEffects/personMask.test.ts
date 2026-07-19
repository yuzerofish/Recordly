import { describe, expect, it } from "vitest";
import type { PersonMask } from "./messages";
import {
	PERSON_MASK_LOSS_FADE_MS,
	PERSON_MASK_LOSS_HOLD_MS,
	PersonMaskTracker,
	personMaskContainsPerson,
} from "./personMask";

function makeMask(
	values: number[],
	timestampMs: number,
	width = values.length,
	height = 1,
): PersonMask {
	return { data: new Float32Array(values), width, height, timestampMs };
}

describe("personMaskContainsPerson", () => {
	it("requires meaningful area instead of one noisy confidence pixel", () => {
		const noise = new Array<number>(2_000).fill(0);
		noise[100] = 1;
		const person = [...noise];
		person[101] = 0.8;

		expect(personMaskContainsPerson(makeMask(noise, 0, 50, 40))).toBe(false);
		expect(personMaskContainsPerson(makeMask(person, 0, 50, 40))).toBe(true);
		expect(personMaskContainsPerson(makeMask([Number.NaN], 0))).toBe(false);
	});
});

describe("PersonMaskTracker", () => {
	it("smooths consecutive masks without mutating worker-owned input data", () => {
		const tracker = new PersonMaskTracker();
		const first = makeMask([1, 0], 0);
		const second = makeMask([0, 1], 33);

		const firstOutput = tracker.update(first);
		const secondOutput = tracker.update(second);

		expect(Array.from(firstOutput.data)).toEqual([1, 0]);
		expect(secondOutput.data[0]).toBeGreaterThan(0);
		expect(secondOutput.data[0]).toBeLessThan(0.35);
		expect(secondOutput.data[1]).toBeGreaterThan(0.65);
		expect(secondOutput.data[1]).toBeLessThan(1);
		expect(Array.from(first.data)).toEqual([1, 0]);
		expect(Array.from(second.data)).toEqual([0, 1]);
		expect(secondOutput.data).not.toBe(second.data);
	});

	it("keeps time-based smoothing stable when preview skips an intermediate frame", () => {
		const fullRate = new PersonMaskTracker();
		const skippedFrame = new PersonMaskTracker();
		fullRate.update(makeMask([1, 0], 0));
		skippedFrame.update(makeMask([1, 0], 0));
		fullRate.update(makeMask([0, 1], 16));

		const fullRateAt32 = fullRate.update(makeMask([0, 1], 32));
		const skippedAt32 = skippedFrame.update(makeMask([0, 1], 32));

		expect(fullRateAt32.data[0]).toBeCloseTo(skippedAt32.data[0] ?? 0, 6);
		expect(fullRateAt32.data[1]).toBeCloseTo(skippedAt32.data[1] ?? 0, 6);
	});

	it("holds a briefly lost person for 150ms, fades for 150ms, then clears", () => {
		const tracker = new PersonMaskTracker();
		tracker.update(makeMask([1], 0));

		expect(tracker.update(makeMask([0], 100)).data[0]).toBe(1);
		expect(tracker.update(makeMask([0], PERSON_MASK_LOSS_HOLD_MS)).data[0]).toBe(1);
		expect(
			tracker.update(makeMask([0], PERSON_MASK_LOSS_HOLD_MS + PERSON_MASK_LOSS_FADE_MS / 2))
				.data[0],
		).toBeCloseTo(0.5, 6);
		expect(
			tracker.update(makeMask([0], PERSON_MASK_LOSS_HOLD_MS + PERSON_MASK_LOSS_FADE_MS))
				.data[0],
		).toBe(0);
		expect(tracker.update(makeMask([0], 500)).data[0]).toBe(0);
	});

	it("removes low-confidence background noise when no person is present", () => {
		const tracker = new PersonMaskTracker();

		expect(Array.from(tracker.update(makeMask([0.54, 0.2, 0.01], 0)).data)).toEqual([0, 0, 0]);
		tracker.update(makeMask([1], 100));
		expect(tracker.update(makeMask([0.2], 401)).data[0]).toBe(0);
	});

	it("accepts a reappearing person as a fresh mask after loss", () => {
		const tracker = new PersonMaskTracker();
		tracker.update(makeMask([1], 0));
		tracker.update(makeMask([0], 301));

		expect(tracker.update(makeMask([0.8], 350)).data[0]).toBeCloseTo(0.8, 6);
	});

	it("never carries a person across a seek or a mask-size change", () => {
		const seekTracker = new PersonMaskTracker();
		seekTracker.update(makeMask([1], 0));
		expect(seekTracker.update(makeMask([0], 100), true).data[0]).toBe(0);

		const resizeTracker = new PersonMaskTracker();
		resizeTracker.update(makeMask([1], 0));
		expect(Array.from(resizeTracker.update(makeMask([0, 0], 100)).data)).toEqual([0, 0]);
	});

	it("clears history when media time moves backward", () => {
		const tracker = new PersonMaskTracker();
		tracker.update(makeMask([1], 500));

		expect(tracker.update(makeMask([0], 100)).data[0]).toBe(0);
	});
});
