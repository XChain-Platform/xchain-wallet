// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §37.3 / G120 / Cluster P FOLLOWUP 1 — haptic settings
// opt-out. Adds a `settings.privacy.hapticsEnabled` field (v2-tolerant,
// default true) that suppresses every `useHaptic` pulse alongside the
// OS-level reduced-motion preference.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const hookSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'shared', 'hooks', 'useHaptic.js'),
    'utf8',
);
const settingsSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'schemas', 'settings.js'),
    'utf8',
);
const privacySectionSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PrivacySection.jsx'),
    'utf8',
);

// --- 1. useHaptic reads settings + short-circuits on opt-out -----------

assert.ok(
    /from '\.\/useSettings\.js'/.test(hookSrc),
    'useHaptic imports useSettings',
);
assert.ok(
    /const \{ settings \} = useSettings\(\)/.test(hookSrc),
    'useHaptic pulls settings via useSettings',
);
assert.ok(
    /settings\?\.privacy\?\.hapticsEnabled !== false/.test(hookSrc),
    'useHaptic uses `!== false` so missing field defaults to enabled',
);
assert.ok(
    /if \(!settingsEnabled\) return;/.test(hookSrc),
    'useHaptic short-circuits firing when settingsEnabled is false',
);
// Reduced-motion guard is unchanged.
assert.ok(
    /if \(reducedMotion\) return;/.test(hookSrc),
    'useHaptic still honors prefers-reduced-motion',
);

// --- 2. Schema declares hapticsEnabled v2-tolerant ---------------------

assert.ok(
    /hapticsEnabled\?: boolean/.test(settingsSrc),
    'Settings typedef declares hapticsEnabled?: boolean',
);
assert.ok(
    /hapticsEnabled: true/.test(settingsSrc),
    'createDefaultSettings sets hapticsEnabled: true',
);
assert.ok(
    /r\.privacy\.hapticsEnabled === undefined\s*\|\|\s*isBoolean\(r\.privacy\.hapticsEnabled\)/.test(settingsSrc),
    'validateSettings accepts hapticsEnabled when undefined or boolean',
);

// --- 3. PrivacySection ships the toggle --------------------------------

assert.ok(
    /label="Haptic feedback"/.test(privacySectionSrc),
    'Privacy panel ships a "Haptic feedback" toggle row',
);
assert.ok(
    /checked=\{settings\.privacy\.hapticsEnabled !== false\}/.test(privacySectionSrc),
    'Privacy panel toggle uses the !== false default-true read',
);
assert.ok(
    /onChange=\{\(v\) => onToggle\('hapticsEnabled', v\)\}/.test(privacySectionSrc),
    'Privacy panel toggle writes through to settings.privacy.hapticsEnabled',
);

console.log('haptics-settings-opt-out smoke OK');
