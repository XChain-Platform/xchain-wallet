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
 */
import { InfoTip } from './InfoTip.jsx';

/**
 * @param {object} props
 * @param {'verified' | 'failed' | 'unavailable' | 'pending'} props.status
 * @param {string | null} [props.reason]   light-client reason code, shown in the info tip
 * @param {'sm' | 'md'} [props.size]        default 'sm'
 * @param {boolean} [props.details]          default true. Pass false where the
 *   badge sits inside a button (a History or balance row): the info tip is a
 *   button itself, and a button inside a button is invalid HTML whose inner
 *   click also toggles the row. The badge's accessible name still carries the
 *   full explanation, and the detail screens show the tip.
 */
export function VerifiedBadge({ status, reason, size = 'sm', details = true }) {
    const spec = BADGE_SPEC[status];
    if (!spec) return null;

    const reasonPhrase = reason ? humanizeReason(reason) : null;
    const title = spec.title + (reasonPhrase ? ` (${reasonPhrase})` : '');
    const padX = size === 'sm' ? '0.25rem' : '0.4rem';
    const padY = size === 'sm' ? '0.05rem' : '0.1rem';
    const fontSize = size === 'sm' ? '0.7rem' : '0.78rem';
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span
                role="img"
                aria-label={title}
                data-testid="verified-badge"
                data-status={status}
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
            {details ? <InfoTip aria={`${spec.label} details`} label={title} /> : null}
        </span>
    );
}

// Info-tip copy describes the GUARANTEE, never the mechanism: "quorum-signed
// checkpoint" and friends are consensus internals a non-technical user cannot
// interpret (house voice: no jargon without translation).
const BADGE_SPEC = {
    verified: {
        glyph: '✓',
        label: 'Verified',
        title: 'The wallet independently checked this value against the network',
        bg: 'var(--xc-success-bg)', fg: 'var(--xc-success)', border: 'var(--xc-success)', // green
    },
    failed: {
        glyph: '✕',
        label: 'Proof failed',
        title: 'The network check failed. Do not trust this value',
        bg: 'var(--xc-danger-bg)', fg: 'var(--xc-danger-text)', border: 'var(--xc-danger-fg)', // red
    },
    unavailable: {
        glyph: '∘',
        label: 'Unverified',
        title: 'The wallet could not check this value against the network',
        bg: 'var(--xc-bg-muted)', fg: 'var(--xc-text-muted)', border: 'var(--xc-border-strong)', // slate
    },
    pending: {
        glyph: '…',
        label: 'Verifying',
        title: 'The wallet is checking this value against the network',
        bg: 'var(--xc-bg-muted)', fg: 'var(--xc-text-muted)', border: 'var(--xc-border-strong)', // slate
    },
};

// Turn a few common light-client reason codes into a short plain phrase for
// the info tip. An unmapped reason (including a raw transport/RPC message that
// useProofVerification synthesizes from a thrown error) returns null so no
// parenthetical is shown: the badge label already carries the verdict, and the
// raw code stays for the log path only rather than leaking SCREAMING_SNAKE
// jargon into the user-facing info tip.
const REASON_TEXT = {
    NOT_YET_CHECKPOINTED: 'this transaction is too new to verify yet',
    CHECKPOINT_PRE_COMMITMENT: 'the network cannot check this transaction yet',
    SPV_UNSUPPORTED: 'this connection cannot check the value',
    CHECKPOINT_QUORUM_FAILED: 'the network check did not match',
};

function humanizeReason(reason) {
    const key = String(reason || '');
    return REASON_TEXT[key] || null;
}
