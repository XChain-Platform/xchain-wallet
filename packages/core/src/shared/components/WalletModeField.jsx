// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet-mode choice (§20) on the create and import forms. Wallet mode
// is a property of each wallet, chosen once here (or by pairing) and shown
// read-only on Wallet Details afterwards, so the field says it is final.

import { Icon, Select } from '@xchain-wallet/core/ui';
import { WALLET_MODES } from '../../schemas/wallet.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletDetails.js';

const MODE_ICONS = {
    full: Icon.WalletIcon,
    watcher: Icon.EyeIcon,
    signer: Icon.KeyIcon,
};

/**
 * The display name of a wallet mode: Normal, Watch-only or Air-gapped signer.
 *
 * @param {string | null | undefined} mode
 * @returns {string}
 */
export function walletModeLabel(mode) {
    if (mode === 'watcher') return t('walletDetails.walletMode.watcher');
    if (mode === 'signer') return t('walletDetails.walletMode.signer');
    return t('walletDetails.walletMode.full');
}

/** @param {string} mode */
function walletModeHint(mode) {
    if (mode === 'watcher') return t('walletDetails.walletMode.watcherHint');
    if (mode === 'signer') return t('walletDetails.walletMode.signerHint');
    return t('walletDetails.walletMode.fullHint');
}

/**
 * @param {object} props
 * @param {'full' | 'watcher' | 'signer'} props.value
 * @param {(mode: 'full' | 'watcher' | 'signer') => void} props.onChange
 * @param {string} [props.name]
 * @param {boolean} [props.disabled]
 */
export function WalletModeField({ value, onChange, name = 'wallet-mode', disabled = false }) {
    // A few named choices, so it is the standard icon dropdown with an icon
    // and a one-line description per mode (G44, G96), never a radio list.
    return (
        <Select
            label={t('walletDetails.walletMode')}
            help={t('walletDetails.walletMode.help')}
            hint={t('walletDetails.walletMode.final')}
            name={name}
            value={value}
            disabled={disabled}
            onChange={(event) => {
                const next = event.target.value;
                if (WALLET_MODES.includes(/** @type {any} */ (next))) onChange(/** @type {any} */ (next));
            }}
            options={WALLET_MODES.map((mode) => {
                const ModeIcon = MODE_ICONS[mode];
                return {
                    value: mode,
                    label: walletModeLabel(mode),
                    sub: walletModeHint(mode),
                    icon: <ModeIcon />,
                };
            })}
        />
    );
}
