// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_FAMILIES } from '../../../packages/core/src/notifications/notificationSounds.js';
import kindsMap from '../../../packages/core/src/watch/contract/kinds.json';

const javaPath = join(
    process.cwd(),
    'packages', 'mobile', 'android', 'app', 'src', 'main', 'java',
    'io', 'xchain', 'wallet', 'android', 'notify', 'NotifyChannels.java',
);

function javaFamilies() {
    const java = readFileSync(javaPath, 'utf8');
    const initializer = java.match(
        /FAMILIES\s*=\s*Collections\.unmodifiableList\(\s*Arrays\.asList\(([\s\S]*?)\)\s*\);/,
    );
    expect(initializer, 'FAMILIES must use Collections.unmodifiableList(Arrays.asList(...))').not.toBeNull();
    expect(initializer[1].replace(/"[^"]*"/g, '').replace(/[\s,]/g, '')).toBe('');
    return [...initializer[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

describe('Android notification channel families', () => {
    it('matches SOUND_FAMILIES in order', () => {
        expect(javaFamilies()).toEqual(SOUND_FAMILIES.map(({ key }) => key));
    });

    it('leaves exactly request and paydue outside the sound channel table', () => {
        const channelFamilies = new Set(javaFamilies());
        expect(Object.keys(kindsMap).filter((family) => !channelFamilies.has(family)))
            .toEqual(['request', 'paydue']);
    });
});
