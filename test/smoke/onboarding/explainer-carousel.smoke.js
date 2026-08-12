// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §25.2 / Cluster J FOLLOWUP 3 smoke: the first-time explainer
// carousel exists and stays wired into Onboarding. The behaviour is
// covered by test/unit/routes/OnboardingCarousel.test.jsx; this smoke is
// the cheap insurance against a future import-organizer silently dropping
// the wiring (the same failure class the PageHeader note in
// routes-render.test.jsx guards against) and against the reduced-motion
// contract regressing.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const routes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

// --- 1. The component file exists and exports OnboardingCarousel -------

const carousel = readFileSync(join(routes, 'OnboardingCarousel.jsx'), 'utf8');
assert.ok(
    /export function OnboardingCarousel\(/.test(carousel),
    'OnboardingCarousel.jsx exports the OnboardingCarousel component',
);

// --- 2. Reduced-motion contract: matchMedia subscription + stacking ---

// The preference is resolved centrally (OS media query AND the
// in-app Settings > Appearance override), so the carousel asks the shared
// hook instead of reading matchMedia, which could only ever see the OS.
assert.ok(
    /useReducedMotion\(\)/.test(carousel),
    'OnboardingCarousel resolves reduced motion through useReducedMotion',
);
assert.ok(
    !/matchMedia\(/.test(carousel),
    'OnboardingCarousel does not read matchMedia behind the resolver\'s back',
);
assert.ok(
    /if \(reducedMotion\) \{/.test(carousel),
    'reduced motion takes a dedicated stacked-frames branch',
);

// --- 3. Multi-frame pagination markup ---------------------------------

assert.ok(
    /role="tab"/.test(carousel) && /role="tablist"/.test(carousel),
    'carousel renders a dot tablist for pagination',
);
assert.ok(
    /Get started/.test(carousel) && /Skip/.test(carousel),
    'carousel exposes both a finish (Get started) and an early-exit (Skip) affordance',
);

// --- 4. Onboarding wires the carousel behind a one-shot seen-flag -----

const onboarding = readFileSync(join(routes, 'Onboarding.jsx'), 'utf8');
assert.ok(
    /import \{ OnboardingCarousel \} from '\.\/OnboardingCarousel\.jsx'/.test(onboarding),
    'Onboarding imports OnboardingCarousel',
);
assert.ok(
    /<OnboardingCarousel/.test(onboarding),
    'Onboarding renders the carousel',
);
assert.ok(
    /const EXPLAINER_SEEN_KEY = 'xc:onboardingExplainerSeenAt'/.test(onboarding),
    'Onboarding declares the seen-flag localStorage key',
);
assert.ok(
    /const showExplainer = !onBack && !explainerSeenAt/.test(onboarding),
    'carousel shows only on the fresh path (no onBack) until the seen-flag is set',
);

console.log(
    'OK: onboarding explainer-carousel smoke (Cluster J FOLLOWUP 3):'
    + 'OnboardingCarousel exports + honours prefers-reduced-motion (subscription '
    + '+ stacked branch); dot tablist pagination with Get started + Skip; '
    + 'Onboarding imports and renders it behind the xc:onboardingExplainerSeenAt '
    + 'one-shot flag, gated off the unlocked-vault onBack lane',
);
