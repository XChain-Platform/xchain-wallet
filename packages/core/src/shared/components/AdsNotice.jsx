// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Icon } from '@xchain-wallet/core/ui';

/**
 * §36.1 ADS notice: the one-time screen at the end of onboarding, after a
 * wallet is created, imported, migrated from FreeWallet or restored from a
 * backup. It informs; it does not ask. ADS_DEFAULT_ENABLED already holds,
 * so there is nothing to write here. Amounts, frequency and the off switch
 * live in Settings -> ADS, the same shape FreeWallet desktop uses (operator
 * ruling 2026-10-12).
 *
 * The route supplies its own header classes so the notice matches the
 * screens before it.
 *
 * @param {object} props
 * @param {() => void} props.onContinue
 * @param {boolean} props.isFull
 * @param {string} props.headClass
 * @param {string} props.titleClass
 * @param {string} props.subtitleClass
 * @param {string} props.actionsClass
 */
export function AdsNotice({ onContinue, isFull, headClass, titleClass, subtitleClass, actionsClass }) {
    return (
        <>
            <header className={headClass}>
                <h1 className={titleClass}>Automatic Donation System</h1>
                <p className={subtitleClass}>
                    XChain Platform includes an Automatic Donation System (ADS)
                    that supports continued development.
                </p>
            </header>
            <ul style={{
                margin: 0,
                padding: 'var(--xc-space-2) var(--xc-space-3) var(--xc-space-2) var(--xc-space-5)',
                background: 'var(--xc-surface-raised)',
                border: '1px solid var(--xc-border)',
                borderRadius: 'var(--xc-radius-md)',
                fontSize: 'var(--xc-text-sm)',
                color: 'var(--xc-text-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--xc-space-1)',
            }}>
                <li>
                    ADS is on by default. It sets aside a small amount when you send a
                    transaction and sends it as one donation once it adds up.
                </li>
                <li>You do not need to donate to use XChain Platform.</li>
                <li>
                    Choose the amount and frequency under Settings &rarr; Automatic Donation System.
                    ADS can also be turned off entirely there.
                </li>
            </ul>
            <div className={actionsClass}>
                <Button
                    variant="primary"
                    onClick={onContinue}
                    block={!isFull}
                    size={isFull ? undefined : 'sm'}
                    icon={<Icon.CheckIcon />}
                >
                    Continue
                </Button>
            </div>
        </>
    );
}
