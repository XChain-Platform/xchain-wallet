// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MULTIPART_ENVELOPE_PART_CAPACITY } from '../../../packages/core/src/flows/fileSizeLimits.js';
import { planMultipartStream } from '../../../packages/core/src/flows/multipartStreamPlan.js';
import { recordingPartSource } from '../../helpers/recordingPartSource.js';

describe('recording part source', () => {
    it('records slice reads in order and supports same-size replacement', async () => {
        const source = recordingPartSource(new Uint8Array([1, 2, 3, 4, 5]), {
            name: 'sample.bin',
            type: 'application/octet-stream',
        });

        expect(await source.readSlice(1, 3)).toEqual(new Uint8Array([2, 3]));
        expect(await source.readSlice(3, 5)).toEqual(new Uint8Array([4, 5]));
        expect(source.reads()).toEqual([[1, 3], [3, 5]]);
        expect(source.bytesRead()).toBe(4);
        expect(source.largestRead()).toBe(2);
        expect(source.readWhole()).toBe(false);

        await source.readSlice(0, source.size);
        expect(source.readWhole()).toBe(true);

        source.resetReads();
        source.replaceBytes(new Uint8Array([9, 8, 7, 6, 5]));
        expect(source.reads()).toEqual([]);
        expect(source.bytesRead()).toBe(0);
        expect(source.largestRead()).toBe(0);
        expect(await source.readSlice(0, 2)).toEqual(new Uint8Array([9, 8]));
        expect(() => source.replaceBytes(new Uint8Array(4))).toThrow(/same size/);
    });

    it('shows envelope planning reads one pass without reading the whole input', async () => {
        const bytes = randomBytes(MULTIPART_ENVELOPE_PART_CAPACITY * 3);
        const source = recordingPartSource(bytes);
        const plan = await planMultipartStream(source, {}, { carrier: 'envelope' });

        expect(source.bytesRead()).toBe(bytes.length);
        expect(source.largestRead()).toBeLessThanOrEqual(plan.partCapacity);
        expect(source.readWhole()).toBe(false);
    });
});
