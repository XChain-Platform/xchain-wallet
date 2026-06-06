/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * §22 + §22.4 multisig indicator. Displays "<T>-of-<N> <scheme>"
 * with a scheme-tinted background, used everywhere a single-key
 * surface would normally show a plain address (Receive, History,
 * Balances, sign screens). The shape of `props` matches the
 * persistent `MultisigConfig` (or `MultisigSigningSession`)
 * verbatim so callers can spread either record in.
 *
 * @param {object} props
 * @param {number} props.threshold
 * @param {number} props.cosignerCount
 * @param {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} props.scheme
 * @param {'sm' | 'md'} [props.size]    default 'md'
 */
export function MultisigBadge({ threshold, cosignerCount, scheme, size = 'md' }) {
    if (!Number.isInteger(threshold) || !Number.isInteger(cosignerCount) || !scheme) {
        return null;
    }
    const tag = SCHEME_TAG[scheme] || scheme;
    const tone = SCHEME_TONE[scheme] || SCHEME_TONE['p2wsh-multisig'];
    const aria = `${threshold} of ${cosignerCount} multisig (${SCHEME_DESCRIPTION[scheme] || scheme})`;
    const padX = size === 'sm' ? '0.25rem' : '0.4rem';
    const padY = size === 'sm' ? '0.05rem' : '0.1rem';
    const fontSize = size === 'sm' ? '0.7rem' : '0.78rem';
    return (
        <span
            role="img"
            aria-label={aria}
            data-testid="multisig-badge"
            data-scheme={scheme}
            title={aria}
            style={{
                display: 'inline-flex',
                gap: '0.25rem',
                alignItems: 'center',
                padding: `${padY} ${padX}`,
                fontSize,
                fontWeight: 600,
                borderRadius: 4,
                background: tone.bg,
                color: tone.fg,
                border: `1px solid ${tone.border}`,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
            }}
        >
            <span>{threshold}-of-{cosignerCount}</span>
            <span style={{ opacity: 0.85 }}>{tag}</span>
        </span>
    );
}

const SCHEME_TAG = {
    'p2sh-multisig':  'P2SH',
    'p2wsh-multisig': 'P2WSH',
    'taproot-musig2': 'MuSig2',
};

const SCHEME_DESCRIPTION = {
    'p2sh-multisig':  'Classic multi-signature',
    'p2wsh-multisig': 'SegWit multi-signature (lower fees)',
    'taproot-musig2': 'Taproot-MuSig2',
};

// Three distinct tones so a glance distinguishes scheme families
// without the user having to read the tag.
const SCHEME_TONE = {
    'p2sh-multisig':  { bg: '#FEF3C7', fg: '#78350F', border: '#FCD34D' }, // amber — classic P2SH
    'p2wsh-multisig': { bg: '#DBEAFE', fg: '#1E3A8A', border: '#93C5FD' }, // blue — segwit
    'taproot-musig2': { bg: '#EDE9FE', fg: '#4C1D95', border: '#C4B5FD' }, // violet — taproot
};
