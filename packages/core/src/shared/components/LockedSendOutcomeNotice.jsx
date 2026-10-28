// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The outcome of a send that settled while another window had locked the
// wallet. The lock takes the sending window to Unlock before the send returns,
// so this is the first place the person can learn whether it went out.
//
// One notice for every such send of the wallet, a line each, read once when
// the unlocked shell mounts. The host forgets an outcome when the person moves
// on from the page that showed it (another route, another wallet, a lock),
// so it is told once and needs no control of its own.

import { useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/pending.js';

const LEAD = {
    sent: 'pending.lockedOutcome.sentLead',
    queued: 'pending.lockedOutcome.queuedLead',
    failed: 'pending.lockedOutcome.failedLead',
    unsent: 'pending.lockedOutcome.failedLead',
};

const BODY = {
    sent: 'pending.lockedOutcome.sent',
    queued: 'pending.lockedOutcome.queued',
    failed: 'pending.lockedOutcome.failed',
    unsent: 'pending.lockedOutcome.unsent',
};

function summaryOf(outcome) {
    if (typeof outcome.summary === 'string' && outcome.summary.trim()) return outcome.summary.trim();
    if (outcome.amount && outcome.tick) {
        return t('pending.lockedOutcome.amountSummary', { amount: outcome.amount, tick: outcome.tick });
    }
    return t('pending.lockedOutcome.plainSummary');
}

// How long an outcome shows before an unmount counts as the person moving on.
const SETTLE_MS = 2000;

function shortTxid(txid) {
    return typeof txid === 'string' && txid.length > 16 ? `${txid.slice(0, 8)}…${txid.slice(-8)}` : String(txid ?? '');
}

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.routeKey]   the shell's current route; a change after the notice shows clears it
 */
export function LockedSendOutcomeNotice({ walletId, routeKey }) {
    const { messaging } = useMessaging();
    // Read through a ref: a shell that hands a new messaging object on each
    // render must not re-list, and so reset, the notice it shows.
    const messagingRef = useRef(messaging);
    messagingRef.current = messaging;
    const [outcomes, setOutcomes] = useState(/** @type {any[]} */ ([]));
    const shownRef = useRef({ ids: /** @type {string[]} */ ([]), routeKey, at: 0 });

    useEffect(() => {
        // The notice slot outlives a wallet switch: one wallet's sends never
        // show under the next. An outcome not yet forgotten shows again when
        // its own wallet is back.
        setOutcomes((shown) => (shown.length === 0 ? shown : []));
        shownRef.current = { ids: [], routeKey, at: 0 };
        const api = messagingRef.current;
        if (!walletId || typeof api?.listLockedSendOutcomes !== 'function') return undefined;
        let live = true;
        api.listLockedSendOutcomes({ walletId })
            .then((list) => {
                if (!live || !Array.isArray(list) || list.length === 0) return;
                shownRef.current = { ids: list.map((o) => o.id), routeKey, at: Date.now() };
                setOutcomes(list);
            })
            .catch(() => { /* the record itself is finished on the host; only the notice is missed */ });
        return () => {
            live = false;
            // The shell can remount its notices while it settles right after an
            // unlock; an outcome only just shown stays for the next mount.
            if (Date.now() - shownRef.current.at >= SETTLE_MS) forget();
        };
        // routeKey is read once at mount; its later changes are handled below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [walletId]);

    useEffect(() => {
        if (shownRef.current.ids.length > 0 && routeKey !== shownRef.current.routeKey) {
            forget();
            setOutcomes([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeKey]);

    function forget() {
        const { ids } = shownRef.current;
        if (ids.length === 0) return;
        shownRef.current = { ids: [], routeKey: shownRef.current.routeKey, at: 0 };
        const api = messagingRef.current;
        if (typeof api?.clearLockedSendOutcomes === 'function') {
            api.clearLockedSendOutcomes({ ids }).catch(() => { /* shown again at the next unlock */ });
        }
    }

    if (outcomes.length === 0) return null;
    const anyNotSent = outcomes.some((o) => o.kind !== 'sent');
    return (
        <StatusMessage variant={anyNotSent ? 'warning' : 'success'} testId="locked-send-outcome">
            {outcomes.map((o) => (
                <p key={o.id}>
                    <strong>{t(LEAD[o.kind] ?? LEAD.unsent)}</strong>{' '}
                    {t(BODY[o.kind] ?? BODY.unsent, { summary: summaryOf(o), transactionId: shortTxid(o.txid) })}
                </p>
            ))}
        </StatusMessage>
    );
}
