// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

function read(relativePath) {
    return readFileSync(join(root, relativePath), 'utf8');
}

const query = '@media (orientation: landscape) and (max-height: 480px)';
const appHeader = read('packages/core/src/shared/components/AppHeader.module.css');
const bottomBar = read('packages/core/src/shared/components/BottomTabBar.module.css');
const leftNav = read('packages/core/src/shared/components/LeftNav.module.css');
const screen = read('packages/core/src/ui/Screen.module.css');
const modal = read('packages/core/src/shared/components/NoticeModal.module.css');
const onboarding = read('packages/core/src/shared/routes/Onboarding.module.css');
const carousel = read('packages/core/src/shared/routes/OnboardingCarousel.module.css');

for (const [name, css] of [
    ['app header', appHeader],
    ['bottom bar', bottomBar],
    ['main layout', leftNav],
    ['screen', screen],
    ['notice modal', modal],
    ['onboarding', onboarding],
    ['onboarding carousel', carousel],
]) {
    assert.ok(css.includes(query), `${name} has the short landscape query`);
}

assert.match(bottomBar, /\.bar\s*\{\s*height: 44px;/,
    'bottom bar shrinks to 44px');
assert.match(leftNav, /padding-bottom: calc\(44px \+ env\(safe-area-inset-bottom/,
    'main layout reserves the same 44px bottom-bar height');
assert.match(screen, /:global\(\[data-testid='qr-scanner'\] > video\)[\s\S]*?max-height: min\(40vh, 160px\)/,
    'QR viewfinder is capped by the short viewport');
assert.match(modal, /\.panel\s*\{[\s\S]*?max-height: calc\([\s\S]*?overflow-y: auto;/,
    'shared notice and confirmation panels scroll vertically');
assert.match(carousel, /\.frameViewport\s*\{[\s\S]*?overflow-y: auto;/,
    'active onboarding frame scrolls instead of clipping');
assert.match(onboarding, /\.licenseScroll\s*\{[\s\S]*?min-height: 96px;/,
    'license gate releases decorative height on short screens');

console.log('OK: short phone landscape chrome, dialog scrolling, QR sizing, and onboarding rules');
