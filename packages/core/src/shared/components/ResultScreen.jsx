// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ResultScreen: the one screen a form shows after its submit finishes. A
// StatusMessage is always the first content, details follow it, and one action
// row closes the screen, so every form's outcome reads the same.
//
// States:
//   success               the action went through (green notice)
//   failure               the action failed (red notice)
//   pending               the action is under way (blue notice)
//   signed-not-broadcast  signed, safe in the rebroadcast queue, not yet on the
//                         network (amber notice, a stage line and a hint)
//   unsigned              a watcher-mode wallet built a PSBT to carry to a
//                         signing device (blue notice, the export body)
//
// useConfirmAction deliberately ends a TRANSIENT post-sign broadcast failure
// in its own `signed-not-broadcast` phase and RESOLVES with
// `{ queued: true, broadcast: 'queued' }`, so the caller does not render an
// error: the signed transaction is safe in the rebroadcast queue and can
// still confirm. The wording promises a REMINDER, not an automatic retry,
// because a reminder is all the wallet does: the queue drains only when the
// user presses "Broadcast now" in QueuedBroadcastBanner. The signed-not-broadcast
// state offers no "do it again" button, since re-signing while a signed copy
// is queued is the §5.3.4 double-broadcast trap.

import { useEffect, useState } from 'react';
import { Button, StatusMessage } from '../../ui/index.js';
import {
    clearQueuedResultHandoff,
    readQueuedResultHandoff,
    SIGNED_NOT_BROADCAST_TITLE,
    SIGNED_NOT_BROADCAST_UNSAVED_WARNING,
} from '../utils/submitFailureMessage.js';
import { useToast } from './ToastHost.jsx';
import { WatcherExport } from './WatcherExport.jsx';
import styles from './ResultScreen.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

const NOTICE_VARIANT = {
    success: 'success',
    failure: 'error',
    pending: 'info',
    'signed-not-broadcast': 'warning',
    unsigned: 'info',
};

export const RESULT_STATES = Object.keys(NOTICE_VARIANT);

function ActionRow({ doneLabel, onDone, secondaryLabel, onSecondary }) {
    return (
        <div className={styles.actions}>
            {onSecondary ? (
                <Button variant="secondary" onClick={onSecondary}>{secondaryLabel}</Button>
            ) : null}
            {onDone ? (
                <Button variant="primary" onClick={onDone}>{doneLabel}</Button>
            ) : null}
        </div>
    );
}

function SignedNotBroadcastScreen({ onDone, title = SIGNED_NOT_BROADCAST_TITLE, what, unsaved }) {
    const noun = what ? `Your ${what}` : 'Your transaction';
    const [handoffUnsaved] = useState(() => readQueuedResultHandoff()?.unsaved === true);
    const showUnsaved = unsaved === undefined ? handoffUnsaved : unsaved === true;
    const handleDone = () => {
        clearQueuedResultHandoff();
        onDone();
    };
    return (
        <>
            <StatusMessage variant="warning" lead={title} testId="result-screen-notice" keepsShellNotice>
                <p className={styles.line}>{t('components.queuedResultPanel.currentStageWaitingToBroadcast')}</p>
                {showUnsaved ? (
                    <p className={styles.line} role="alert">{SIGNED_NOT_BROADCAST_UNSAVED_WARNING}</p>
                ) : null}
                <p className={styles.line}>
                    {noun} {t('components.queuedResultPanel.isSignedButCouldnT')}
                </p>
            </StatusMessage>
            <ActionRow doneLabel={t('common.done')} onDone={handleDone} />
        </>
    );
}

function UnsignedScreen({ result, onBuildAnother, onSendAnother, onDone, title }) {
    const { announce } = useToast();
    const heading = title || t('components.watcherResultPanel.unsignedTransactionReadyForSigning');
    useEffect(() => {
        announce(heading);
    }, [announce, heading]);
    const buildAnother = onBuildAnother || onSendAnother;
    return (
        <>
            <StatusMessage variant="info" lead={heading} testId="result-screen-notice" keepsShellNotice>
                {t('components.watcherResultPanel.takeThisTransactionToYour')}
            </StatusMessage>
            <WatcherExport result={result} />
            <ActionRow
                doneLabel={t('common.done')}
                onDone={onDone}
                secondaryLabel={t('components.watcherResultPanel.buildAnother')}
                onSecondary={buildAnother}
            />
        </>
    );
}

/**
 * @param {object} props
 * @param {'success' | 'failure' | 'pending' | 'signed-not-broadcast' | 'unsigned'} props.state
 * @param {() => void} [props.onDone]            primary action, back to wherever the form was launched from
 * @param {string} [props.title]                 bold lead-in of the notice; the signed-not-broadcast and unsigned states default to their own sentence
 * @param {import('react').ReactNode} [props.message]   notice text (success, failure and pending)
 * @param {import('react').ReactNode} [props.children]  details under the notice (success, failure and pending)
 * @param {string} [props.doneLabel]             primary button text (success, failure and pending), default "Done"
 * @param {string} [props.secondaryLabel]        secondary button text (success, failure and pending)
 * @param {() => void} [props.onSecondary]       secondary action (success, failure and pending)
 * @param {string} [props.what]                  signed-not-broadcast: what was signed, e.g. 'dividend'
 * @param {boolean} [props.unsaved]              signed-not-broadcast: signed bytes are held only in the current window;
 *   omitted by existing result screens, which consume the result handed off by useConfirmAction
 * @param {{ psbtHex: string, encoding?: string, fromAddress?: string, chainId?: string }} [props.result]   unsigned: the PSBT envelope
 * @param {() => void} [props.onBuildAnother]    unsigned: secondary "Build another" action
 * @param {() => void} [props.onSendAnother]     unsigned: alias for onBuildAnother (Send.jsx legacy prop name)
 */
export function ResultScreen({
    state,
    onDone,
    title,
    message,
    children,
    doneLabel,
    secondaryLabel,
    onSecondary,
    what,
    unsaved,
    result,
    onBuildAnother,
    onSendAnother,
}) {
    if (state === 'signed-not-broadcast') {
        return <SignedNotBroadcastScreen onDone={onDone} title={title} what={what} unsaved={unsaved} />;
    }
    if (state === 'unsigned') {
        return (
            <UnsignedScreen
                result={result}
                onBuildAnother={onBuildAnother}
                onSendAnother={onSendAnother}
                onDone={onDone}
                title={title}
            />
        );
    }
    return (
        <>
            <StatusMessage variant={NOTICE_VARIANT[state] || 'info'} lead={title} testId="result-screen-notice" keepsShellNotice>
                {message}
            </StatusMessage>
            {children ? <div className={styles.body}>{children}</div> : null}
            <ActionRow
                doneLabel={doneLabel || t('common.done')}
                onDone={onDone}
                secondaryLabel={secondaryLabel}
                onSecondary={onSecondary}
            />
        </>
    );
}
