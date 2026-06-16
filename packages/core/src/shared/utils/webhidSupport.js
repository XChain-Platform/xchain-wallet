// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Browser-capability detection for WebHID — used by PairSignerForm to warn
// before the user attempts to pair a Ledger in a browser that lacks the
// API. Ledger's transport requires `navigator.hid`; Firefox and Safari do
// not implement it as of 2026.
//
// Exported as a function rather than a constant so callers can run it in
// SSR / test contexts where `navigator` is undefined without a module-load
// crash.

export function isWebHidSupported() {
    if (typeof navigator === 'undefined') return false;
    return typeof navigator.hid === 'object' && navigator.hid !== null;
}

// Best-effort browser-family hint for messaging. We only branch into "we
// know this browser doesn't support WebHID" vs. "switch to Chrome / Edge /
// Brave" — anything else falls through to the generic switch-browser copy.
//
// UA sniffing is intentionally narrow: we identify Firefox and Safari
// because those are the two desktop browsers that ship without WebHID. We
// do not try to identify Chrome / Edge / Brave because the WebHID feature
// detect already covers them.
export function detectBrowserFamilyForWebHidHint() {
    if (typeof navigator === 'undefined') return 'unknown';
    const ua = String(navigator.userAgent || '');
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
        return 'safari';
    }
    return 'unknown';
}
