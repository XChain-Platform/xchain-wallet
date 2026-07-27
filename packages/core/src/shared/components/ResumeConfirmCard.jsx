// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ResumeConfirmCard ( §5.4). Home's offer to finish a confirm the
// popup closed on, in the same slot and shape as the pending-airdrop and
// payment-due cards that already live there.
//
// It says "not sent yet" out loud. A card offering to resume something is
// ambiguous about whether the money already moved, and the whole point of the
// stored session is that it holds an UNSIGNED PSBT: nothing has been signed,
// nothing has been broadcast, and the user is one Approve away from both.

import { flows as flowsLib } from '@xchain-wallet/core';

/**
 * @param {object} props
 * @param {any[]} props.sessions                      stored confirm sessions (unfiltered)
 * @param {(id: string) => void} props.onResume
 * @param {(id: string) => void} props.onDiscard
 * @param {string} [props.className]
 */
export function ResumeConfirmCard({ sessions, onResume, onDiscard, className }) {
    const offerable = flowsLib.resumableSessions(sessions);
    if (offerable.length === 0) return null;

    return (
        <div role="group" aria-label="Unfinished transactions">
            {offerable.map((session) => {
                const info = flowsLib.describeResumeSession(session);
                return (
                    <div key={info.id} className={className} data-testid="resume-confirm-card">
                        <button
                            type="button"
                            onClick={() => onResume(info.id)}
                            data-testid={`resume-confirm-${info.id}`}
                        >
                            <span>Finish {info.label}</span>
                            <span>Not sent yet. Approve to sign and send it.</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onDiscard(info.id)}
                            aria-label={`Discard unfinished ${info.label}`}
                            data-testid={`discard-confirm-${info.id}`}
                        >
                            Discard
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
