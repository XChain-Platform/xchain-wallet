// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  responsive-first program, slice 1: one interface across every
// width, with one place that owns the breakpoints.
//
// The regression this guards against is concrete. The shell used to hold
// two thresholds that drifted apart: the web shell flipped its variant at
// 640px in JS while LeftNav.module.css collapsed the sidebar with
// `@media (max-width: 899px)`. Between the two, the wallet rendered
// neither the bottom tab bar (JS-gated on the `small` variant) nor the
// sidebar (CSS-gated at 900px), so tablet portrait and half-screen desktop
// windows had no persistent navigation.
//
// Asserts:
//   1. shared/styles/breakpoints.js is the source of truth: the tier
//      boundaries and the tier helpers live there.
//   2. No layout-tier width literal is duplicated outside it. In
//      particular no `@media` width query survives in the shell's layout
//      CSS, and the web shell imports the threshold instead of defining
//      one.
//   3. useLayoutTier measures the CONTAINER (getBoundingClientRect +
//      ResizeObserver) with a viewport fallback, so a 360px popup inside
//      a 1400px window reads as compact.
//   4. FullLayoutWithNav publishes `data-xc-tier` and mounts exactly one
//      nav surface per tier.
//   5. LeftNav.module.css keys its tier rules off `data-xc-tier`, and the
//      rail tier clips labels rather than removing them (accessible names
//      survive the icon-only rail).
//   6. Web + desktop shells hand both nav slots to the layout instead of
//      gating them on a shell-local width threshold.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const stylesDir = join(core, 'src', 'shared', 'styles');

// --- 1. breakpoints.js is the source of truth ---------------------------

const bpPath = join(stylesDir, 'breakpoints.js');
assert.ok(existsSync(bpPath), 'shared/styles/breakpoints.js exists');
const bpSrc = readFileSync(bpPath, 'utf8');

assert.ok(/export const TIER_RAIL_MIN_PX = 640;/.test(bpSrc),
    'rail tier starts at 640px');
assert.ok(/export const TIER_FULL_MIN_PX = 900;/.test(bpSrc),
    'full tier starts at 900px');
for (const fn of ['tierForWidth', 'showsSidebar', 'showsBottomBar']) {
    assert.ok(new RegExp(`export function ${fn}\\b`).test(bpSrc),
        `breakpoints.js exports ${fn}()`);
}
assert.ok(/LAYOUT_TIERS/.test(bpSrc) && /'compact'/.test(bpSrc)
    && /'rail'/.test(bpSrc) && /'full'/.test(bpSrc),
'breakpoints.js names all three tiers');

// --- 2. the numbers are not duplicated elsewhere ------------------------

const navCssPath = join(core, 'src', 'shared', 'components', 'LeftNav.module.css');
const navCssSrc = readFileSync(navCssPath, 'utf8');
assert.ok(!/@media[^{]*\b(min|max)-width/.test(navCssSrc),
    'layout CSS carries no viewport width media query (tier attribute drives it)');

const devVariantSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'devVariant.js'),
    'utf8',
);
assert.ok(
    /import \{ TIER_RAIL_MIN_PX \} from '@xchain-wallet\/core\/shared\/styles\/breakpoints\.js'/
        .test(devVariantSrc),
    'web devVariant imports the shared rail breakpoint',
);
assert.ok(/export const THRESHOLD_PX = TIER_RAIL_MIN_PX;/.test(devVariantSrc),
    'web variant threshold IS the shared rail breakpoint, not a second copy');

// --- 2b. no persisted variant override  ------------------------
//
// The dev-preview frames pin a fixed 360/375px column. A copy of the
// chosen variant used to live in localStorage, which is how the live web
// wallet came to render at extension-popup width on a 1489px desktop and
// stay that way across a hard reload. The URL is the whole persistence
// mechanism now: visible, per-navigation, and escapable by opening the
// bare origin. test/unit/web/devVariant.test.js asserts the behaviour;
// this asserts the write is gone, since a re-added `setItem` would restore
// the trap for anyone who touches the badge once.

assert.ok(!/localStorage\.setItem/.test(devVariantSrc),
    'web devVariant never persists a variant override');
assert.ok(/export function purgeStoredVariantOverride\b/.test(devVariantSrc),
    'web devVariant exports the sweeper that heals an already-trapped browser');
assert.ok(/export function resolveVariant\(\)\s*\{\s*purgeStoredVariantOverride\(\);/
    .test(devVariantSrc),
'resolveVariant sweeps a stored override on every resolve');
assert.ok(!/source: 'storage'/.test(devVariantSrc),
    'stored state is not a variant source');

// --- 3. useLayoutTier measures the container ----------------------------

const hookPath = join(stylesDir, 'useLayoutTier.js');
assert.ok(existsSync(hookPath), 'shared/styles/useLayoutTier.js exists');
const hookSrc = readFileSync(hookPath, 'utf8');

assert.ok(/export function useLayoutTier\b/.test(hookSrc),
    'useLayoutTier is a named export');
assert.ok(/getBoundingClientRect/.test(hookSrc),
    'useLayoutTier measures the container box, not the viewport');
assert.ok(/new ResizeObserver\(measure\)/.test(hookSrc),
    'useLayoutTier re-measures on container resize');
assert.ok(/observer\.disconnect\(\)/.test(hookSrc),
    'the ResizeObserver is disconnected on unmount');
assert.ok(/window\.addEventListener\('resize', measure\)/.test(hookSrc)
    && /window\.removeEventListener\('resize', measure\)/.test(hookSrc),
'useLayoutTier falls back to window resize where ResizeObserver is missing');
assert.ok(/tierForWidth\(measured \|\| viewportWidth\(\)\)/.test(hookSrc),
    'an unlaid-out (0-width) container falls back to the viewport');

// --- 4. FullLayoutWithNav publishes and applies the tier ----------------

const navJsxSrc = readFileSync(
    join(core, 'src', 'shared', 'components', 'LeftNav.jsx'),
    'utf8',
);
assert.ok(/const \[layoutRef, tier\] = useLayoutTier\(\);/.test(navJsxSrc),
    'FullLayoutWithNav resolves its own tier');
assert.ok(/data-xc-tier=\{tier\}/.test(navJsxSrc),
    'FullLayoutWithNav publishes the tier as data-xc-tier for the CSS');
assert.ok(/const sidebar = showsSidebar\(tier\) \? nav : null;/.test(navJsxSrc),
    'the sidebar slot is mounted only on tiers that show a sidebar');
assert.ok(/const bar = showsBottomBar\(tier\) \? bottomBar : null;/.test(navJsxSrc),
    'the bottom bar slot is mounted only on the compact tier');
assert.ok(/\{sidebar \? <aside className=\{styles\.sidebar\}>\{sidebar\}<\/aside>/.test(navJsxSrc),
    'the tier-resolved sidebar is what renders');
assert.ok(/\$\{bar \? styles\.layoutWithBottomBar : ''\}/.test(navJsxSrc),
    'the 56px bottom padding follows the tier-resolved bar, not the raw prop');

// --- 5. tier-keyed CSS + accessible rail --------------------------------

assert.ok(/\.layout\[data-xc-tier='compact'\]\s+\.sidebar\s*\{[\s\S]*?display:\s*none/
    .test(navCssSrc),
'compact tier hides the sidebar');
assert.ok(/\.layout\[data-xc-tier='rail'\]\s+\.sidebar\s*\{[\s\S]*?flex:\s*0 0 64px/
    .test(navCssSrc),
'rail tier narrows the sidebar to a 64px icon rail');

const railLabel = /\.layout\[data-xc-tier='rail'\]\s+\.label\s*\{([\s\S]*?)\}/.exec(navCssSrc);
assert.ok(railLabel, 'rail tier styles the nav labels');
assert.ok(/clip-path:\s*inset\(50%\)/.test(railLabel[1]),
    'rail labels are clipped, keeping each button its accessible name');
assert.ok(!/display:\s*none/.test(railLabel[1]),
    'rail labels are NOT display:none (that would strip the accessible name)');

// --- 6. shells delegate the choice to the layout ------------------------

for (const [label, appPath] of [
    ['web', join(wsRoot, 'packages', 'web', 'src', 'App.jsx')],
    ['desktop', join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx')],
]) {
    const src = readFileSync(appPath, 'utf8');
    const layout = /<FullLayoutWithNav([\s\S]*?)header=\{/.exec(src);
    assert.ok(layout, `${label} App mounts <FullLayoutWithNav>`);
    const slots = layout[1];
    assert.ok(/nav=\{\s*<LeftNav/.test(slots),
        `${label} App hands the nav slot in unconditionally`);
    assert.ok(/bottomBar=\{\s*<BottomTabBar/.test(slots),
        `${label} App hands the bottomBar slot in unconditionally`);
    assert.ok(!/variant === 'small'/.test(slots) && !/isFull \?/.test(slots),
        `${label} App does not re-gate the nav slots on a shell-local width`);
}

console.log(
    'OK: responsive-layout-tiers smoke ( slice 1: shared/styles/breakpoints.js owns the 640/900 tier boundaries + tierForWidth/showsSidebar/showsBottomBar; useLayoutTier measures the container via getBoundingClientRect + ResizeObserver with a viewport fallback; FullLayoutWithNav publishes data-xc-tier and mounts exactly one nav surface; LeftNav CSS is tier-keyed with no viewport media query and clips rail labels instead of removing them; web + desktop hand both slots to the layout; : no persisted variant override, and resolveVariant sweeps a legacy one)',
);
