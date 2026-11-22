// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export function checkFixtureFile(
    path,
    value,
    {
        write = process.env.WATCH_FIXTURES_WRITE === '1',
        allowContentChange = false,
    } = {},
) {
    const expected = `${JSON.stringify(value, null, 4)}\n`;
    let current;

    try {
        current = readFileSync(path);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }

        if (!write) {
            return { status: 'missing' };
        }

        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, expected);
        return { status: 'created' };
    }

    if (current.equals(Buffer.from(expected))) {
        return { status: 'same' };
    }

    if (!write) {
        return { status: 'differs' };
    }

    let currentValue;
    let validJson = true;
    try {
        currentValue = JSON.parse(current.toString('utf8'));
    } catch {
        validJson = false;
    }

    if (validJson && isDeepStrictEqual(currentValue, value)) {
        writeFileSync(path, expected);
        return { status: 'reformatted' };
    }

    if (!allowContentChange) {
        return { status: 'contentChanged' };
    }

    writeFileSync(path, expected);
    return { status: 'rewritten' };
}
