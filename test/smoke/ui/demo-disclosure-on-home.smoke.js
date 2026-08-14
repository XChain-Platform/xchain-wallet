// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the demo disclosure reaches Home in every shell,
// exactly once.
//
// The component's own behaviour is covered by
// test/unit/components/DemoBanner.test.jsx. What is pinned HERE is the
// wiring around it, because that is what regressed and what a unit test
// mounting one component cannot see:
//
//   1. DemoBanner is not suppressed back to an unconditional `return
//      null`. It was, for months, while still mounting for its 24h
//      auto-expire effect, which is exactly why the absence read as
//      "component exists, must be fine".
//   2. Home mounts it for shells that have nowhere else to put it.
//   3. Shells that DO mount it in their layout header say so with
//      `demoBannerInHeader`, so the disclosure never renders twice on
//      Home. The header mount renders above Home in those shells, so
//      the visitor is still told without leaving Home.
//
// The extension popup has no header slot, so it must NOT pass the flag;
// asserting that keeps a well-meaning "make the shells consistent" edit
// from silently deleting the popup's only disclosure.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const bannerSrc = read('packages', 'core', 'src', 'shared', 'components', 'DemoBanner.jsx');
const homeSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
const webSrc = read('packages', 'web', 'src', 'App.jsx');
const desktopSrc = read('packages', 'desktop', 'renderer', 'App.jsx');
const popupSrc = read('packages', 'extension', 'src', 'popup', 'App.jsx');

// ─── 1. the banner is visible again ────────────────────────────────────

assert.doesNotMatch(
    bannerSrc,
    /Visible banner suppressed/,
    'the suppression comment is gone with the suppression',
);
assert.doesNotMatch(
    bannerSrc,
    /void expiry; void handleExit; void error;/,
    'the void-the-unused-state line that stood in for a render is gone',
);
assert.match(
    bannerSrc,
    /if \(!isDemo\) return null;/,
    'the banner renders nothing for a real wallet, and only for a real wallet',
);
assert.match(
    bannerSrc,
    /role="status"/,
    'the banner is an announced status region, not silent decoration',
);

// The two halves of the disclosure. Either alone leaves the funnel
// broken: naming the demo without explaining the zero still reads as a
// wallet that cannot spend its own displayed balance.
assert.match(bannerSrc, /read-only/i, 'the copy says the demo is read-only');
assert.match(
    bannerSrc,
    /0 available/,
    'the copy explains why the action forms read 0 available',
);
assert.match(
    bannerSrc,
    /sample\s+\n?\s*data/,
    'the copy says the balances on screen are sample data',
);

// The auto-expire effect the suppressed version existed to keep alive
// must survive the restoration.
assert.match(
    bannerSrc,
    /setInterval\(tick, 60_000\)/,
    'the 24h auto-expire check still runs on its interval',
);

// ─── 2. Home mounts it, gated ──────────────────────────────────────────

assert.match(
    homeSrc,
    /demoBannerInHeader = false \}\) \{/,
    'Home takes demoBannerInHeader, defaulting to mounting its own banner',
);

const homeMounts = homeSrc.match(/\{activeWalletId && !demoBannerInHeader \? \(\s*\n\s*<DemoBanner/g) || [];
assert.equal(
    homeMounts.length, 2,
    'both Home bodies (signer-mode and normal) gate the banner the same way',
);
assert.doesNotMatch(
    homeSrc,
    /shell === 'popup' \? \(\s*\n\s*<DemoBanner/,
    'the old width-derived popup gate is gone (web renders shell="popup" below 900px '
    + 'while STILL mounting the header banner, so that gate double-rendered)',
);

// ─── 3. shells declare where the banner lives ──────────────────────────

for (const [label, src] of [['web', webSrc], ['desktop', desktopSrc]]) {
    assert.match(
        src,
        /<DemoBanner activeWalletId=\{activeWalletId\} onExited=\{refresh\} \/>/,
        `${label} mounts the banner in its layout header`,
    );
    assert.match(
        src,
        /demoBannerInHeader/,
        `${label} tells Home the header already carries the banner`,
    );
}

assert.doesNotMatch(
    popupSrc,
    /demoBannerInHeader/,
    'the extension popup has no header slot, so Home must keep mounting the banner there',
);
assert.doesNotMatch(
    popupSrc,
    /<DemoBanner/,
    'the popup shell does not mount its own banner either',
);

console.log('demo-disclosure-on-home smoke OK');
