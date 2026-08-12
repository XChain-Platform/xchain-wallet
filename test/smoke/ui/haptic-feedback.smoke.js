// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §37.3 / G120 Haptic feedback. Pins the public hook surface
// + the ToastHost integration so a future refactor can't silently
// remove the vibration calls or the reduced-motion guard.

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
const toastSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'shared', 'components', 'ToastHost.jsx'),
    'utf8',
);
const sendSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
const lockedSrc = readFileSync(
    join(root, 'packages', 'core', 'src', 'shared', 'routes', 'Locked.jsx'),
    'utf8',
);

// 1. The hook exports its public function and the named-pulse map.
assert.ok(/export function useHaptic\(/.test(hookSrc), 'useHaptic exports the hook');
assert.ok(/export const HAPTIC_PATTERNS\b/.test(hookSrc), 'useHaptic exports HAPTIC_PATTERNS');

// 2. All four named pulses (tap / success / warn / error) are defined.
for (const name of ['tap', 'success', 'warn', 'error']) {
    assert.ok(
        new RegExp(`\\b${name}\\b`).test(hookSrc),
        `useHaptic defines a "${name}" pulse`,
    );
}

// 3. The hook calls navigator.vibrate behind a feature-detect.
assert.ok(/typeof navigator\.vibrate === 'function'/.test(hookSrc),
    'useHaptic feature-detects navigator.vibrate');
assert.ok(/navigator\.vibrate\(/.test(hookSrc),
    'useHaptic actually calls navigator.vibrate');

// 4. Reduced-motion is honoured via the shared resolver, which weighs the
//    in-app Settings > Appearance override ahead of the OS media query
// (reading matchMedia here ignored "Always reduce" outright).
assert.ok(
    /useReducedMotion\(\)/.test(hookSrc),
    'useHaptic resolves reduced motion through useReducedMotion',
);
assert.ok(
    !/matchMedia\(/.test(hookSrc),
    'useHaptic does not read matchMedia behind the resolver\'s back',
);
assert.ok(
    /if \(reducedMotion\) return;/.test(hookSrc),
    'useHaptic short-circuits firing when reducedMotion is true',
);

// 5. Errors thrown by navigator.vibrate (background tab, permissions
//    policy) must not crash the caller.
assert.ok(/try \{[\s\S]*navigator\.vibrate[\s\S]*\} catch/.test(hookSrc),
    'useHaptic wraps navigator.vibrate in try/catch');

// 6. ToastHost mounts the hook and fires variant-aware pulses.
assert.ok(/from '\.\.\/hooks\/useHaptic\.js'/.test(toastSrc),
    'ToastHost imports useHaptic');
assert.ok(/const haptic = useHaptic\(\);/.test(toastSrc),
    'ToastHost calls useHaptic at the top of the provider');
assert.ok(/record\.variant === 'error'[\s\S]*haptic\.error\(\)/.test(toastSrc),
    'ToastHost fires haptic.error for error toasts');
assert.ok(/record\.variant === 'success'[\s\S]*haptic\.success\(\)/.test(toastSrc),
    'ToastHost fires haptic.success for success toasts');
assert.ok(/haptic\.tap\(\)/.test(toastSrc),
    'ToastHost fires haptic.tap for default toasts');

// 7. Send.jsx wires success on broadcast and error on submit failure.
assert.ok(/from '\.\.\/hooks\/useHaptic\.js'/.test(sendSrc),
    'Send.jsx imports useHaptic');
assert.ok(/setStage\('done'\);\s*\n\s*haptic\.success\(\);/.test(sendSrc),
    'Send.jsx fires haptic.success after a confirmed broadcast');
assert.ok(/setStage\('review'\);\s*\n\s*haptic\.error\(\);/.test(sendSrc),
    'Send.jsx fires haptic.error after a submit failure');

// 8. Locked.jsx wires success on unlock + error on bad password / biometric fail.
assert.ok(/from '\.\.\/hooks\/useHaptic\.js'/.test(lockedSrc),
    'Locked.jsx imports useHaptic');
assert.ok(/haptic\.success\(\);[\s\S]{0,200}onUnlocked\?\.\(\)/.test(lockedSrc),
    'Locked.jsx fires haptic.success before invoking onUnlocked');
assert.ok((lockedSrc.match(/haptic\.error\(\)/g) || []).length >= 2,
    'Locked.jsx fires haptic.error on at least two failure branches (bad password + biometric / non-bad-password)');

console.log('OK: useHaptic + ToastHost / Send / Locked wiring smoke (8 checks)');
