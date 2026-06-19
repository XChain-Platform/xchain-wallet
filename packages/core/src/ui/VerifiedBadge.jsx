/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * SPV proof-verification indicator (§7/§8). Shows whether a balance or
 * action was cryptographically proven against a quorum-signed checkpoint:
 *
 *   verified    proof recomputed the quorum-signed root (trust-minimized)
 *   failed      the proof contradicts the claimed amount/inclusion (alarm)
 *   unavailable could not verify (thin replica / pre-commitment / pending)
 *   pending     verification in flight
 *
 * Renders nothing for any other status (e.g. the native coin, which is not
 * an XChain state-tree balance and so is not provable). Mirrors the inline
 * span pattern of `MultisigBadge` and the History `StatusPill`.
 *
 * @param {object} props
 * @param {'verified' | 'failed' | 'unavailable' | 'pending'} props.status
 * @param {string | null} [props.reason]   light-client reason code, shown in the tooltip
 * @param {'sm' | 'md'} [props.size]        default 'sm'
 */
export function VerifiedBadge({ status, reason, size = 'sm' }) {
    const spec = BADGE_SPEC[status];
    if (!spec) return null;

    const title = spec.title + (reason ? ` (${humanizeReason(reason)})` : '');
    const padX = size === 'sm' ? '0.25rem' : '0.4rem';
    const padY = size === 'sm' ? '0.05rem' : '0.1rem';
    const fontSize = size === 'sm' ? '0.7rem' : '0.78rem';
    return (
        <span
            role="img"
            aria-label={title}
            data-testid="verified-badge"
            data-status={status}
            title={title}
            style={{
                display: 'inline-flex',
                gap: '0.2rem',
                alignItems: 'center',
                padding: `${padY} ${padX}`,
                fontSize,
                fontWeight: 600,
                borderRadius: 4,
                background: spec.bg,
                color: spec.fg,
                border: `1px solid ${spec.border}`,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
            }}
        >
            <span aria-hidden="true">{spec.glyph}</span>
            <span>{spec.label}</span>
        </span>
    );
}

const BADGE_SPEC = {
    verified: {
        glyph: '✓',
        label: 'Verified',
        title: 'Cryptographically verified against a quorum-signed checkpoint',
        bg: '#DCFCE7', fg: '#166534', border: '#86EFAC', // green
    },
    failed: {
        glyph: '✕',
        label: 'Proof failed',
        title: 'The server could not prove this value; do not trust it',
        bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5', // red
    },
    unavailable: {
        glyph: '∘',
        label: 'Unverified',
        title: 'No proof available to verify this value',
        bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', // slate
    },
    pending: {
        glyph: '…',
        label: 'Verifying',
        title: 'Verifying against a quorum-signed checkpoint',
        bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', // slate
    },
};

// Turn a few common light-client reason codes into a short plain phrase for
// the tooltip; otherwise show the raw code (still useful to a power user).
const REASON_TEXT = {
    NOT_YET_CHECKPOINTED: 'block not yet checkpointed',
    CHECKPOINT_PRE_COMMITMENT: 'state commitment not active yet',
    SPV_UNSUPPORTED: 'this connection cannot serve proofs',
    CHECKPOINT_QUORUM_FAILED: 'checkpoint quorum not met',
};

function humanizeReason(reason) {
    const key = String(reason || '');
    return REASON_TEXT[key] || key;
}
