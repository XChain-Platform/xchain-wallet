// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// QueuedResultPanel (leg a): the done screen for a transaction that
// was SIGNED but never reached the network.
//
// useConfirmAction deliberately ends a TRANSIENT post-sign broadcast failure
// in its own `signed-not-broadcast` phase and RESOLVES with
// `{ queued: true, broadcast: 'queued' }`, so the caller does not render an
// error - the signed transaction is safe in the §49.5 rebroadcast queue and
// can still confirm. Every authoring form then read only `result.txid` and,
// finding none, printed "Broadcast complete." - which is exactly the queued
// case, and exactly the wrong sentence: a user whose node was briefly
// unreachable was told the action was done.
//
// Send.jsx already owned this copy inline; this is the same panel for the
// ~13 action forms that own their own done screen, so the wording (and the
// deliberate ABSENCE of a "do it again" button - re-signing while a signed
// copy is queued is the §5.3.4 double-broadcast trap) lives in one place.
//
// the wording promises a REMINDER, not an automatic retry, because a
// reminder is all the wallet does - the queue drains only when the user
// presses "Broadcast now" in QueuedBroadcastBanner.

import { Button } from '../../ui/index.js';
import { SIGNED_NOT_BROADCAST_TITLE } from '../utils/submitFailureMessage.js';
import styles from './QueuedResultPanel.module.css';

/**
 * @param {object} props
 * @param {() => void} props.onDone            back to wherever the form was launched from
 * @param {string} [props.title]               heading; defaults to the action-neutral sentence
 * @param {string} [props.what]                what was signed, e.g. 'dividend' - used in the hint
 */
export function QueuedResultPanel({ onDone, title = SIGNED_NOT_BROADCAST_TITLE, what }) {
    const noun = what ? `Your ${what}` : 'Your transaction';
    return (
        <>
            <div className={styles.queuedCard} role="status" aria-live="polite">
                <div className={styles.queuedIcon} aria-hidden="true">⏳</div>
                <h2 className={styles.queuedTitle}>{title}</h2>
                <p className={styles.queuedHint}>
                    {noun} is signed but couldn&apos;t reach the network just now. It&apos;s
                    waiting in the queued-transactions banner and only goes out when you
                    broadcast it from there; the wallet reminds you when the network is
                    back. Don&apos;t submit this again.
                </p>
            </div>
            <div className={styles.actions}>
                <Button variant="primary" onClick={onDone}>Done</Button>
            </div>
        </>
    );
}
