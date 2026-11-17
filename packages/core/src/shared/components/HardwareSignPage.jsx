// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The page a hardware wallet signs behind (hw-3 layout 2, trimmed). Each
// shell mounts it once; it reads the hardware session itself and shows only
// while a signPsbt or signMessage op is open, so a status poll never opens
// it. It draws the device picture, "Confirm on your Trezor", one line on what
// to check and the four steps (Device, Unlock, Confirm, Signed). It has no
// amount, fee or recipient card and no Cancel: Back rejects the op with
// HW_SIGN_BACK, which every form takes back to its Confirm page.
//
// It covers the page it opens over instead of replacing it, so the form and
// its Confirm page stay mounted underneath and keep their state for Back.

import { useContext, useEffect, useId, useState } from 'react';
import { FormPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useBackHandler } from '../../ui/backStack.js';
import { MessagingContext } from '../MessagingContext.js';
import { screenVariantFor } from '../useMessaging.js';
import { HardwareStatusLine, hardwareVendorName } from './hardware/index.js';
import { signerVendorLogoUrl } from '../../branding/branding.js';
import { AppHeader } from './AppHeader.jsx';
import {
    HW_STEPS, SIGN_OPS, cancel, current, subscribe,
} from '../../signers/hardwareSession.js';
import { ledgerAppNameFor } from '../../signers/ledgerIdentity.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/actionDetail.js';
import '../../i18n/locales/en/hardwareConnect.js';
import '../../i18n/locales/en/hardwareSign.js';
import styles from './HardwareSignPage.module.css';

// Unlock, Confirm, Signed and Try again are the words the connect flow, the
// confirm button and the activity steps already use.
const STEP_LABEL_KEYS = {
    connected: 'hardwareSign.step.device',
    unlocked: 'hardwareConnect.connect.unlock',
    confirm: 'common.confirm',
    signed: 'actionDetail.step.signed',
};

const FAILURE_KEYS = {
    unplugged: 'hardwareSign.failed.unplugged',
    rejected: 'hardwareSign.failed.rejected',
    timeout: 'hardwareSign.failed.timeout',
    other: 'hardwareSign.failed.other',
};

/**
 * The failure line for an op. A wrong-app failure on a Ledger names the app
 * the chain needs ("Open the Litecoin app on your Ledger, then try again.");
 * any other vendor has no per-coin apps, so it keeps the couldn't-sign line.
 *
 * @param {{vendor: string, chainId?: string|null, failure: {kind: string}|null}} op
 * @returns {string|null}
 */
export function failureLine(op) {
    if (!op?.failure) return null;
    const vendor = hardwareVendorName(op.vendor);
    if (op.failure.kind === 'wrong-app' && op.vendor === 'ledger') {
        const app = ledgerAppNameFor(op.chainId);
        return app
            ? t('hardwareSign.failed.wrongApp', { app })
            : t('hardwareSign.failed.wrongAppAny');
    }
    return t(FAILURE_KEYS[op.failure.kind] || FAILURE_KEYS.other, { vendor });
}

/**
 * The four steps as the status line draws them: every recorded step is
 * done, the first one not done is active (or failed when the op failed),
 * and the rest wait.
 *
 * @param {{steps: string[], failure: {kind: string}|null}} op
 * @returns {Array<{label: string, state: 'done'|'active'|'todo'|'failed'}>}
 */
export function signSteps(op) {
    const doneSet = new Set(op.steps || []);
    const firstOpen = HW_STEPS.findIndex((name) => !doneSet.has(name));
    return HW_STEPS.map((name, index) => {
        let state = 'todo';
        if (doneSet.has(name)) state = 'done';
        else if (index === firstOpen) state = op.failure ? 'failed' : 'active';
        return { label: t(STEP_LABEL_KEYS[name]), state };
    });
}

/**
 * A Ledger signs regtest in its Bitcoin Test app, which prints the testnet
 * form (tb1...) of an address the wallet shows as bcrt1... for the same key.
 * Only a send shows addresses on the device, so only a send gets the line.
 *
 * @param {{vendor: string, op: string, chainId?: string|null}} op
 * @returns {boolean}
 */
export function showsTestnetPrefix(op) {
    return op?.vendor === 'ledger' && op?.chainId === 'bitcoin-regtest' && op?.op === 'signPsbt';
}

/** The open sign op, kept in step with the session. */
function useSignOp() {
    const [op, setOp] = useState(current);
    useEffect(() => {
        setOp(current());
        return subscribe((event) => {
            if (!SIGN_OPS.includes(event.op.op)) return;
            if (event.type === 'end') {
                setOp((shown) => (shown?.opId === event.op.opId ? current() : shown));
                return;
            }
            setOp(event.op);
        });
    }, []);
    return op && SIGN_OPS.includes(op.op) ? op : null;
}

/**
 * @param {object} [props]
 * @param {boolean} [props.inline]  render in the page flow instead of over it,
 *   for a shell that hides the page underneath itself.
 */
export function HardwareSignPage({ inline = false } = {}) {
    const op = useSignOp();
    const shell = useContext(MessagingContext)?.shell;
    const titleId = useId();
    // Escape and the system Back act as the page's Back. A screen step
    // outranks the Confirm page under it, so one press cancels the op and
    // never also rejects the Confirm page; backgrounding the app leaves it.
    useBackHandler(op ? () => cancel(op.opId) : undefined, false, 'screen');
    if (!op) return null;

    const vendor = hardwareVendorName(op.vendor);
    const logo = signerVendorLogoUrl(op.vendor);
    const failureText = failureLine(op);

    const screen = (
        <Screen
            variant={screenVariantFor(shell)}
            bodyClassName={styles.screenBody}
            header={(
                <PageHeader
                    nested
                    onBack={() => cancel(op.opId)}
                    backLabel={t('hardwareSign.backToConfirm')}
                    title={t('hardwareSign.title', { vendor })}
                    titleId={titleId}
                />
            )}
        >
            {/* The G126 form card: bare below 600px, one centred card at the
                form column width from 600px, the notice at its top. */}
            <FormPage as="div" label={t('hardwareSign.title', { vendor })}>
                <div className={styles.body} data-hardware-sign-page="" data-op={op.op}>
                    {failureText ? (
                        <StatusMessage
                            variant="error"
                            keepsShellNotice
                        >
                            {failureText}
                        </StatusMessage>
                    ) : null}
                    {/* The logo's own box, so the notice above sits 8px from it. */}
                    {logo ? (
                        <span className={styles.picture} aria-hidden="true">
                            <img className={styles.logo} src={logo} alt="" width="96" height="96" />
                        </span>
                    ) : null}
                    <h2 className={styles.heading}>{t('hardwareSign.heading', { vendor })}</h2>
                    <p className={styles.hint}>
                        {t(op.op === 'signMessage' ? 'hardwareSign.checkMessage' : 'hardwareSign.checkSend')}
                    </p>
                    {showsTestnetPrefix(op) ? (
                        <p className={styles.hint} data-ledger-regtest-prefix="">
                            {t('hardwareSign.ledgerRegtestPrefix')}
                        </p>
                    ) : null}
                    <HardwareStatusLine steps={signSteps(op)} label={t('hardwareSign.statusLabel')} />
                </div>
            </FormPage>
        </Screen>
    );

    const page = (
        <>
            <div className={styles.appBar} data-hardware-sign-app-bar="">
                <AppHeader />
            </div>
            <div className={styles.screenFrame}>{screen}</div>
        </>
    );

    if (inline) return <div className={styles.inline}>{page}</div>;
    return (
        <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            {page}
        </div>
    );
}
