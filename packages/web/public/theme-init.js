// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
(function applyStartupTheme() {
    'use strict';

    function readTheme() {
        try {
            var raw = window.localStorage && window.localStorage.getItem('xc:displayPrefs');
            var prefs = raw && JSON.parse(raw);
            if (prefs && (prefs.theme === 'light' || prefs.theme === 'dark')) {
                return prefs.theme;
            }
        } catch (_) {
            // A blocked or damaged preference cache falls back to the OS theme.
        }
        return 'system';
    }

    var mediaQuery = null;
    try {
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    } catch (_) {
        // Engines without matchMedia use the light palette default.
    }

    function applyTheme() {
        var theme = readTheme();
        var root = document.documentElement;
        if (theme === 'light' || theme === 'dark') {
            root.setAttribute('data-xc-theme', theme);
        } else {
            root.removeAttribute('data-xc-theme');
        }

        var dark = theme === 'dark' || (theme === 'system' && mediaQuery && mediaQuery.matches);
        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute('content', dark ? '#0B0F17' : '#FFFFFF');

        try {
            var systemBars = window.Capacitor
                && window.Capacitor.Plugins
                && window.Capacitor.Plugins.SystemBars;
            if (systemBars && typeof systemBars.setStyle === 'function') {
                var result = systemBars.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
                if (result && typeof result.catch === 'function') result.catch(function ignore() {});
            }
        } catch (_) {
            // Native chrome is a visual enhancement and must never block startup.
        }
    }

    applyTheme();

    if (!mediaQuery) return;
    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', applyTheme);
    } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(applyTheme);
    }

    function cleanup() {
        if (typeof mediaQuery.removeEventListener === 'function') {
            mediaQuery.removeEventListener('change', applyTheme);
        } else if (typeof mediaQuery.removeListener === 'function') {
            mediaQuery.removeListener(applyTheme);
        }
        window.removeEventListener('pagehide', cleanup);
    }
    window.addEventListener('pagehide', cleanup);
}());
