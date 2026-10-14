// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The iOS shell splits layout ownership deliberately: native configuration
// leaves safe areas and keyboard fitting to the web layer, while UIKit pins
// the root scroll view and status bar to platform behavior. This smoke keeps
// those halves aligned without requiring Xcode.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const config = JSON.parse(read('packages', 'mobile', 'capacitor.config.json'));
const mobilePackage = JSON.parse(read('packages', 'mobile', 'package.json'));
const mainViewController = read(
    'packages', 'mobile', 'ios', 'App', 'App', 'MainViewController.swift',
);
const infoPlist = read('packages', 'mobile', 'ios', 'App', 'App', 'Info.plist');
const webIndex = read('packages', 'web', 'index.html');
const webMain = read('packages', 'web', 'src', 'main.jsx');
const keyboardViewport = read('packages', 'web', 'src', 'platform', 'keyboardViewport.js');
const tokens = read('packages', 'core', 'src', 'ui', 'tokens.css');
const bottomTab = read(
    'packages', 'core', 'src', 'shared', 'components', 'BottomTabBar.module.css',
);
const startupTheme = read('packages', 'web', 'public', 'theme-init.js');
const liveTheme = read(
    'packages', 'core', 'src', 'shared', 'hooks', 'useSettingsRootAttributes.js',
);

// CSS owns every safe-area edge, so UIKit must not add a second inset.
assert.equal(config.ios?.contentInset, 'never');
assert.match(webIndex, /<meta name="viewport"[^>]*viewport-fit=cover/);
for (const edge of ['top', 'left', 'right']) {
    assert.match(tokens, new RegExp(`padding-${edge}: env\\(safe-area-inset-${edge}, 0\\)`));
}
assert.match(bottomTab, /padding-bottom:\s*env\(safe-area-inset-bottom, 0\)/);

// The document stays fixed while route-level overflow containers scroll.
assert.match(
    mainViewController,
    /webView\?\.scrollView\.bounces = false/,
    'the root WKWebView must not rubber-band under fixed app chrome',
);

// iOS overlays the keyboard. The web-owned resize mode fits the shell to
// visualViewport and reveals focus inside the nearest route scroller.
assert.equal(config.plugins?.Keyboard, undefined);
assert.equal(mobilePackage.dependencies['@capacitor/keyboard'], undefined);
assert.match(webMain, /installKeyboardViewport\(\)/);
assert.match(keyboardViewport, /visualViewport/);
assert.match(keyboardViewport, /--xc-viewport-h/);
assert.match(keyboardViewport, /revealInScroller\(active, win\)/);

// A fixed percentage prevents WebKit rotation heuristics from enlarging text.
const bodyRule = tokens.match(/body\s*\{[^}]*\}/)?.[0] ?? '';
assert.match(bodyRule, /-webkit-text-size-adjust:\s*100%/);
assert.match(bodyRule, /(?:^|\s)text-size-adjust:\s*100%/);

// The plist and config start from the system default so launch icons contrast
// with either splash appearance. Both theme paths update SystemBars after
// startup so dark and light palettes keep contrasting icons.
assert.equal(config.plugins?.SystemBars?.style, 'DEFAULT');
assert.match(
    infoPlist,
    /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\/>/,
);
assert.match(
    infoPlist,
    /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDefault<\/string>/,
);
for (const source of [startupTheme, liveTheme]) {
    assert.match(source, /style:\s*dark \? 'DARK' : 'LIGHT'/);
}

console.log('OK - mobile iOS WebView config smoke (safe areas, scroll, keyboard, text, and status bar)');
