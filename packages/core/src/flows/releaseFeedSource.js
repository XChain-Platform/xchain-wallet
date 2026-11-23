// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Where the About panel reads the release feed from. The panel fetches the
// feed from the page by default; a shell whose page may not make that request
// (the desktop renderer pins connect-src 'self') installs a source that
// returns the feed text from its host instead. The panel still parses and
// validates whatever text comes back, so a source is only a transport.

/** @type {null | (() => Promise<string>)} */
let feedTextSource = null;

/**
 * @param {{ fetchText?: () => Promise<string> }} [next]  call with nothing to restore the page fetch
 */
export function configureReleaseFeedSource(next = {}) {
    feedTextSource = typeof next?.fetchText === 'function' ? next.fetchText : null;
}

/** @returns {null | (() => Promise<string>)} */
export function getReleaseFeedSource() {
    return feedTextSource;
}
