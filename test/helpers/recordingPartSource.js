// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { bytesPartSource } from '../../packages/core/src/flows/filePartSource.js';

export function recordingPartSource(bytes, { name = '', type = '' } = {}) {
    let source = bytesPartSource(bytes);
    const size = source.size;
    let recordedReads = [];

    return {
        size,
        name,
        type,
        async readSlice(start, end) {
            recordedReads.push([start, end]);
            return source.readSlice(start, end);
        },
        reads() {
            return recordedReads.map((range) => range.slice());
        },
        bytesRead() {
            return recordedReads.reduce((total, [start, end]) => total + end - start, 0);
        },
        largestRead() {
            return recordedReads.reduce(
                (largest, [start, end]) => Math.max(largest, end - start),
                0,
            );
        },
        readWhole() {
            return recordedReads.some(([start, end]) => start === 0 && end === size);
        },
        resetReads() {
            recordedReads = [];
        },
        replaceBytes(nextBytes) {
            const replacement = bytesPartSource(nextBytes);
            if (replacement.size !== size) {
                throw new RangeError('replacement bytes must have the same size');
            }
            source = replacement;
        },
    };
}
