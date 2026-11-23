// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    SOUND_FAMILIES,
    SOUND_PALETTE,
} from '../../../packages/core/src/notifications/notificationSounds.js';

const source = readFileSync(resolve(
    'packages/mobile/ios/App/App/notify/NotifyPostArgs.swift',
), 'utf8');

function initializerStrings(name) {
    const initializer = source.match(new RegExp(
        `static let ${name} = \\[([\\s\\S]*?)\\]`,
    ));
    expect(initializer, `missing ${name} initializer`).not.toBeNull();
    return [...initializer[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe('NotifyPostArgs manifest parity', () => {
    it('keeps notification families in contract order', () => {
        expect(initializerStrings('families')).toEqual([
            ...SOUND_FAMILIES.map(({ key }) => key),
            'request',
            'paydue',
            'alert',
        ]);
    });

    it('keeps bundled sound ids in palette order', () => {
        expect(initializerStrings('soundIds')).toEqual(
            SOUND_PALETTE.map(({ id }) => id),
        );
    });
});
