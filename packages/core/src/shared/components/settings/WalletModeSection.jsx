// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WalletModeSection: §20 wallet-mode selector. A mode change affects every
// signing surface, so the choice stays pending until the user confirms it.

import { useState } from 'react';
import { RadioGroup } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { WALLET_MODES, WALLET_MODE_DEFAULT } from '../../../schemas/settings.js';
import { SettingsLoadError, Status } from './_settingsPrimitives.jsx';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { useBackHandler } from '../../../ui/backStack.js';
import cardStyles from '../../../ui/Card.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';
import '../../../i18n/locales/en/ui.js';

// Built per call so a locale switch applies.
const modeOptions = () => /** @type {const} */ ([
    {
        value: 'full',
        label: t('ui.feeSelector.normal'),
        hint: t('settings.walletMode.normalHint'),
        confirmation: t('settings.walletMode.normalConfirm'),
    },
    {
        value: 'watcher',
        label: t('settings.page.modeWatcher'),
        hint: t('settings.walletMode.watcherHint'),
        confirmation: t('settings.walletMode.watcherConfirm'),
    },
    {
        value: 'signer',
        label: t('settings.page.modeSigner'),
        hint: t('settings.walletMode.signerHint'),
        confirmation: t('settings.walletMode.signerConfirm'),
    },
]);

export function WalletModeSection() {
    const { settings, loading, error, update } = useSettings();
    const [pending, setPending] = useState(/** @type {typeof WALLET_MODES[number] | null} */ (null));
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    useBackHandler(pending ? () => setPending(null) : undefined, saving);

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const current = WALLET_MODES.includes(settings.walletMode)
        ? settings.walletMode
        : WALLET_MODE_DEFAULT;

    const onChange = (next) => {
        if (!WALLET_MODES.includes(next)) return;
        setSaveError(null);
        setPending(next === current ? null : next);
    };

    const confirmChange = async () => {
        if (!pending || saving) return;
        setSaving(true);
        setSaveError(null);
        try {
            await update({ walletMode: pending });
            setPending(null);
        } catch (err) {
            setSaveError(err?.message || 'Could not save the wallet mode.');
            // eslint-disable-next-line no-console
            console.error('walletMode update failed:', err);
        } finally {
            setSaving(false);
        }
    };

    const selected = pending || current;
    const options = modeOptions();
    const pendingOption = options.find((opt) => opt.value === pending);

    return (
        <>
            <div className={cardStyles.card}>
            <RadioGroup
                legend={t('settings.walletMode.chooseHowThisWalletHandles')}
                name="walletMode"
                value={selected}
                onChange={onChange}
                disabled={saving}
                options={options.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    description: opt.hint,
                }))}
            />
            </div>
            {pendingOption ? (
                <ConfirmModal
                    title={t('settings.walletMode.switchToMode', { label: pendingOption.label })}
                    message={pendingOption.confirmation}
                    confirmLabel={t('settings.walletMode.confirmModeChange')}
                    busy={saving}
                    error={saveError}
                    onConfirm={confirmChange}
                    onCancel={() => setPending(null)}
                />
            ) : null}
        </>
    );
}
