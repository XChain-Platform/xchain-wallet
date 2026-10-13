// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export function WatchOnlyBadge({ visible = false }) {
    if (!visible) return null;
    return (
        <span role="status" aria-label="Watch-only wallet" style={BADGE_STYLE}>
            Watch-only
        </span>
    );
}

const BADGE_STYLE = {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    border: '1px solid var(--xc-warning)',
    borderRadius: 'var(--xc-radius-pill)',
    padding: '2px var(--xc-space-2)',
    color: 'var(--xc-warning-text)',
    background: 'var(--xc-warning-bg)',
    fontSize: 'var(--xc-text-xs)',
    fontWeight: 700,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
};
