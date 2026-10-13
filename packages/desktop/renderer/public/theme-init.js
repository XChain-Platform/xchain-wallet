(function applyStartupTheme() {
    'use strict';

    var theme = 'system';
    try {
        var raw = window.localStorage && window.localStorage.getItem('xc:displayPrefs');
        var prefs = raw && JSON.parse(raw);
        if (prefs && (prefs.theme === 'light' || prefs.theme === 'dark')) {
            theme = prefs.theme;
        }
    } catch (_) {
        // A blocked or damaged preference cache falls back to the OS theme.
    }

    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
        root.setAttribute('data-xc-theme', theme);
    } else {
        root.removeAttribute('data-xc-theme');
    }

    var osDark = false;
    try {
        osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
        // Engines without matchMedia use the light palette default.
    }
    var dark = theme === 'dark' || (theme === 'system' && osDark);
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
}());
