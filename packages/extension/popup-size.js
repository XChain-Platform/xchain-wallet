// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Toolbar popup bootstrap: popup.html only, a classic script in <head> ahead
// of the module bundle (vite.config.js startupThemePlugin emits and injects
// it).
//
// WHY IT RUNS BEFORE THE BUNDLE
//
// Chrome sizes the toolbar popup from its content. popup.css gives the
// document 360x600 only under `html.xchain-toolbar-popup`, and the boot
// screen is position: fixed, so it adds no size of its own. If the class
// waits for main.jsx, any chunk that fails to load or throws while its
// imports evaluate leaves the class unset, and Chrome shrinks the popup to
// its 25x25 minimum: an empty square with nothing to read and no way out.
// main.jsx still toggles the class with the same test (isToolbarPopupView in
// src/popup/launchState.js); the two must agree, so keep them in step.
//
// WHAT IT SHOWS WHEN THE APP CANNOT START
//
// The first `error` (a thrown exception, or a <script> that failed to load)
// or `unhandledrejection` while the boot screen is still up replaces the
// boot screen with a danger notice (Notice Standard, G120), the error text
// under Technical details, and Reload and Open in tab beneath it. It renders
// inside #xchain-popup-root, so an app that mounts late replaces it. Once
// the app has mounted (React has replaced the boot screen) the listeners
// remove themselves on the next event and never touch the page.
//
// RULES FOR EDITING THIS FILE
//   1. ES5 syntax and plain DOM only: no imports, no bundler features. It is
//      copied verbatim into dist/ and must run when the bundle does not.
//   2. Copy is plain English constants. The i18n dictionary ships inside the
//      bundle this screen reports on, so it cannot be loaded here. Each
//      string matches the English of the dictionary key named beside it, and
//      test/unit/popup/popupSize.test.js pins them together.
//   3. Styles are inline with var(--xc-token, literal) fallbacks, so the
//      notice reads the same whether or not the tokens stylesheet arrived.
//      The extension CSP allows inline styles and forbids inline scripts.

(function () {
    'use strict';

    var ROOT_ID = 'xchain-popup-root';
    var BOOT_SELECTOR = '.xc-boot';
    var POPUP_CLASS = 'xchain-toolbar-popup';
    var COMPACT_FALLBACK_MAX_WIDTH = 600;
    var POPUP_WIDTH = '360px';
    var POPUP_HEIGHT = '600px';
    var MAX_DETAIL_LINES = 12;

    var COPY = {
        // Plain English by design (rule 2 above); not a translatable surface.
        title: 'XChain Wallet couldn\'t start.',
        // pending.detail.technicalDetails
        details: 'Technical details',
        // extension.connection.reload
        reload: 'Reload',
        // importWallet.openInTab
        openInTab: 'Open in tab',
        unknown: 'Unknown error',
        scriptFailed: 'Failed to load script: '
    };

    var chromeApi = window.chrome;
    var root = document.documentElement;

    // Same answer as isToolbarPopupView(): the side panel never, view
    // enumeration when the browser offers it, and a narrow popup.html as the
    // fallback. popup.html opened in a tab gets no class.
    function isToolbarPopup() {
        var path = (window.location && window.location.pathname) || '';
        if (/\/sidepanel\.html$/.test(path)) return false;
        try {
            var ext = chromeApi && chromeApi.extension;
            if (ext && typeof ext.getViews === 'function') {
                var views = ext.getViews({ type: 'popup' });
                if (Array.isArray(views)) return views.indexOf(window) !== -1;
            }
        } catch (_) {
            // Fall through to the narrow popup.html test.
        }
        return /\/popup\.html$/.test(path) && Number(window.innerWidth) <= COMPACT_FALLBACK_MAX_WIDTH;
    }

    var popup = isToolbarPopup();
    if (popup) root.classList.add(POPUP_CLASS);

    var shown = false;
    var pending = null;

    function appRoot() {
        return document.getElementById(ROOT_ID);
    }

    // The app has mounted once its root exists and the boot screen is gone.
    function appMounted() {
        var container = appRoot();
        return Boolean(container) && !container.querySelector(BOOT_SELECTOR);
    }

    function clip(text) {
        var lines = String(text).split('\n');
        return lines.length > MAX_DETAIL_LINES ? lines.slice(0, MAX_DETAIL_LINES).join('\n') : lines.join('\n');
    }

    function describeReason(reason) {
        if (reason && typeof reason === 'object') {
            if (typeof reason.stack === 'string' && reason.stack) return clip(reason.stack);
            if (typeof reason.message === 'string' && reason.message) {
                return (reason.name ? reason.name + ': ' : '') + reason.message;
            }
        }
        if (reason === undefined || reason === null || reason === '') return COPY.unknown;
        try {
            return String(reason);
        } catch (_) {
            return COPY.unknown;
        }
    }

    // The text for Technical details, or null for an event that is not an
    // app failure (an image or stylesheet that failed to load).
    function describe(event) {
        if (event.type === 'unhandledrejection') return describeReason(event.reason);
        var target = event.target;
        if (target && target !== window && target.nodeType === 1) {
            if (String(target.tagName).toUpperCase() !== 'SCRIPT') return null;
            return COPY.scriptFailed + (target.src || target.getAttribute('src') || '');
        }
        if (event.error) return describeReason(event.error);
        var text = event.message || COPY.unknown;
        if (event.filename) {
            text += '\n    at ' + event.filename + ':' + (event.lineno || 0) + ':' + (event.colno || 0);
        }
        return text;
    }

    function styled(tag, css) {
        var node = document.createElement(tag);
        node.style.cssText = css;
        return node;
    }

    var BUTTON_CSS = 'flex:1 1 0;min-width:0;min-height:var(--xc-control-h-md, 36px);padding:0 16px;'
        + 'border-radius:var(--xc-control-radius, 8px);font:inherit;font-size:14px;font-weight:600;'
        + 'line-height:1.25;cursor:pointer;';

    function button(label, primary, onClick) {
        var node = styled('button', BUTTON_CSS + (primary
            ? 'border:1px solid transparent;background:var(--xc-accent-primary, #1A7BAC);color:var(--xc-on-accent, #FFFFFF);'
            : 'border:1px solid var(--xc-border-strong, #CBD5E1);background:transparent;color:var(--xc-accent-text, #156690);'));
        node.type = 'button';
        node.textContent = label;
        node.addEventListener('click', onClick);
        return node;
    }

    // The circled ! of the danger tone (core AlertCircleIcon).
    function dangerIcon() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        var attrs = { width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
        for (var key in attrs) svg.setAttribute(key, attrs[key]);
        var circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', '12'); line.setAttribute('y1', '7.5'); line.setAttribute('x2', '12'); line.setAttribute('y2', '13');
        var dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', '12'); dot.setAttribute('cy', '16.5'); dot.setAttribute('r', '0.5'); dot.setAttribute('fill', 'currentColor');
        svg.appendChild(circle); svg.appendChild(line); svg.appendChild(dot);
        return svg;
    }

    function canOpenTab() {
        return popup
            && Boolean(chromeApi && chromeApi.tabs && typeof chromeApi.tabs.create === 'function')
            && Boolean(chromeApi.runtime && typeof chromeApi.runtime.getURL === 'function');
    }

    // The full-page wallet is popup.html in a tab, the same URL
    // openExtensionTab() hands off to; the popup closes once the tab exists.
    function openInTab() {
        function closePopup() {
            try { window.close(); } catch (_) { /* The tab is open either way. */ }
        }
        try {
            var created = chromeApi.tabs.create({ url: chromeApi.runtime.getURL('popup.html') });
            if (created && typeof created.then === 'function') created.then(closePopup, function () {});
            else closePopup();
        } catch (_) {
            // Reload stays on screen as the way forward.
        }
    }

    function render(details) {
        var container = appRoot() || document.body;
        if (!container) return false;
        if (popup) {
            // Held inline as well, for a failure that also lost popup.css.
            root.style.width = POPUP_WIDTH;
            root.style.height = POPUP_HEIGHT;
        }
        container.textContent = '';

        var page = styled('div', 'box-sizing:border-box;height:100%;min-height:' + (popup ? POPUP_HEIGHT : '100vh') + ';'
            + 'overflow:auto;display:flex;flex-direction:column;justify-content:center;gap:12px;'
            + 'max-width:480px;margin:0 auto;padding:var(--xc-page-top, 8px) var(--xc-page-gutter, 8px);'
            + 'font-family:var(--xc-font-sans, system-ui, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif);'
            + 'color:var(--xc-text, #0F172A);');
        page.setAttribute('data-xc-boot-failure', '');

        var notice = styled('div', 'display:flex;align-items:flex-start;gap:8px;padding:8px 12px;'
            + 'border-radius:var(--xc-card-radius, 8px);border:1px solid var(--xc-danger, #DC2626);'
            + 'background:var(--xc-danger-bg, rgba(220, 38, 38, 0.10));color:var(--xc-danger-text, #7F1D1D);'
            + 'font-size:var(--xc-text-sm, 13px);line-height:1.4;');
        notice.setAttribute('role', 'alert');
        notice.setAttribute('data-tone', 'danger');
        notice.setAttribute('data-xc-notice', '');

        var icon = styled('span', 'flex:0 0 auto;display:inline-flex;align-items:center;height:1.4em;');
        icon.setAttribute('aria-hidden', 'true');
        icon.appendChild(dangerIcon());

        var text = styled('div', 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere;');
        var title = styled('div', 'font-weight:600;');
        title.textContent = COPY.title;
        var disclosure = styled('details', 'margin-top:4px;');
        var summary = document.createElement('summary');
        summary.textContent = COPY.details;
        var code = styled('code', 'display:block;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;');
        code.textContent = details;
        disclosure.appendChild(summary);
        disclosure.appendChild(code);
        text.appendChild(title);
        text.appendChild(disclosure);
        notice.appendChild(icon);
        notice.appendChild(text);

        var actions = styled('div', 'display:flex;gap:8px;');
        actions.appendChild(button(COPY.reload, true, function () { window.location.reload(); }));
        if (canOpenTab()) actions.appendChild(button(COPY.openInTab, false, openInTab));

        page.appendChild(notice);
        page.appendChild(actions);
        container.appendChild(page);
        return true;
    }

    function disarm() {
        window.removeEventListener('error', onFailure, true);
        window.removeEventListener('unhandledrejection', onFailure);
    }

    function renderPending() {
        document.removeEventListener('DOMContentLoaded', renderPending);
        if (pending !== null && !shown) shown = render(pending);
    }

    function onFailure(event) {
        if (shown) return;
        if (appMounted()) {
            disarm();
            return;
        }
        var details = describe(event);
        if (details === null) return;
        disarm();
        if (!appRoot() && document.readyState === 'loading') {
            // The body is not parsed yet: draw once it is.
            pending = details;
            document.addEventListener('DOMContentLoaded', renderPending);
            return;
        }
        shown = render(details);
    }

    // Capture phase, so a <script> that fails to load (an error event that
    // does not bubble) is seen as well as uncaught exceptions.
    window.addEventListener('error', onFailure, true);
    window.addEventListener('unhandledrejection', onFailure);
}());
