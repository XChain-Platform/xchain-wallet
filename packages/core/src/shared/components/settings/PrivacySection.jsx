// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PrivacySection (§35.1 Privacy panel). Every switch describes its live
// consumer, including shell limits and the behavior of default-on fields.
// Form-draft retention is a select because it has more than two states.
//
// Clipboard auto-clear (seconds) is a live control again: it writes
// `settings.privacy.clipboardAutoClearSeconds`, which shared/clipboard.js
// reads on every shell, so a privacy control here always governs something.

import { useState } from 'react';
import { Button, Input, Select } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { shellCapabilities } from '../../shellCapabilities.js';
import { isNativeShell } from '../../nativeShell.js';
import {
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_1H,
    FORM_DRAFT_TTL_24H,
    FORM_DRAFT_TTL_7D,
    FORM_DRAFT_TTL_DEFAULT,
    FORM_DRAFT_TTL_OPTIONS,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    CLIPBOARD_AUTO_CLEAR_MAX,
    CLIPBOARD_AUTO_CLEAR_MIN,
} from '../../../schemas/settings.js';
import {
    ROW,
    ROW_HINT,
    ROW_VALUE,
    ToggleRow,
    SettingsLoadError,
    Status,
    STACK,
} from './_settingsPrimitives.jsx';
import { blurNumberInputOnWheel } from '../../utils/formInput.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/settings.js';

const PRIVACY_CONTROL_DEFAULTS = Object.freeze({
    torRouting: false,
    changeAddressRotation: false,
    blurOnBlur: false,
    labelsSurviveRestore: false,
    hapticsEnabled: true,
    priceDataEnabled: true,
    metadataFetchEnabled: true,
    alwaysRequireHwExplicitConfirm: false,
    clipboardAutoClearSeconds: CLIPBOARD_AUTO_CLEAR_DEFAULT,
    formDraftTtlMs: FORM_DRAFT_TTL_DEFAULT,
});

export function PrivacySection() {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const onToggle = async (field, next) => {
        setSaveError(null);
        try {
            await update({ privacy: { [field]: next } });
        } catch (err) {
            setSaveError(field);
            // eslint-disable-next-line no-console
            console.error(`privacy.${field} update failed:`, err);
        }
    };

    const resetPrivacy = async () => {
        setSaveError(null);
        try {
            await update({ privacy: PRIVACY_CONTROL_DEFAULTS });
        } catch (err) {
            setSaveError('reset');
            // eslint-disable-next-line no-console
            console.error('privacy settings reset failed:', err);
        }
    };

    return (
        <div style={STACK}>
            {/* Only a host that can proxy wallet-owned traffic exposes the
                live setting. Browser-based shells show the disabled row. */}
            {shellCapabilities().socksProxy && (
                <>
                    <ToggleRow
                        label={t('settings.privacy.torRouting')}
                        hint={t('settings.privacy.desktopOnlySendWalletTraffic')}
                        checked={settings.privacy.torRouting}
                        onChange={(v) => onToggle('torRouting', v)}
                    />
                    <PrivacySaveError visible={saveError === 'torRouting'} />
                </>
            )}
            {/* An unavailable shell always renders this switch off because
                its stored desktop preference cannot affect local traffic. */}
            {!shellCapabilities().socksProxy && (
                <ToggleRow
                    label={t('settings.privacy.torRouting')}
                    hint={isNativeShell()
                        ? t('settings.privacy.notAvailableInNativeApp')
                        : t('settings.privacy.notAvailableOnThisPlatform')}
                    checked={false}
                    disabled
                    onChange={() => {}}
                />
            )}
            <ToggleRow
                label={t('settings.privacy.changeAddressRotation')}
                hint={t('settings.privacy.importedKeyAndWatchOnly')}
                checked={settings.privacy.changeAddressRotation}
                onChange={(v) => onToggle('changeAddressRotation', v)}
            />
            <PrivacySaveError visible={saveError === 'changeAddressRotation'} />
            <ToggleRow
                label={t('settings.privacy.blurSensitiveDataOnBlur')}
                hint={t('settings.privacy.blurTheEntireWalletDisplay')}
                checked={Boolean(settings.privacy.blurOnBlur)}
                onChange={(v) => onToggle('blurOnBlur', v)}
            />
            <PrivacySaveError visible={saveError === 'blurOnBlur'} />
            <ToggleRow
                label={t('settings.privacy.labelsSurviveRestore')}
                hint={t('settings.privacy.inTheBrowserExtensionBatch')}
                checked={Boolean(settings.privacy.labelsSurviveRestore)}
                onChange={(v) => onToggle('labelsSurviveRestore', v)}
            />
            <PrivacySaveError visible={saveError === 'labelsSurviveRestore'} />
            <ToggleRow
                label={t('settings.privacy.hapticFeedback')}
                hint={t('settings.privacy.allowVibrationForTapSuccess')}
                checked={settings.privacy.hapticsEnabled !== false}
                onChange={(v) => onToggle('hapticsEnabled', v)}
            />
            <PrivacySaveError visible={saveError === 'hapticsEnabled'} />
            <ToggleRow
                label={t('settings.notifications.nativeCoinPriceData')}
                hint={t('settings.privacy.allowCoingeckoRequestsForNative')}
                checked={settings.privacy.priceDataEnabled !== false}
                onChange={(v) => onToggle('priceDataEnabled', v)}
            />
            <PrivacySaveError visible={saveError === 'priceDataEnabled'} />
            <ToggleRow
                label={t('settings.privacy.fetchTokenMetadata')}
                hint={t('settings.privacy.fetchTokenInformationStandardTis')}
                checked={settings.privacy.metadataFetchEnabled !== false}
                onChange={(v) => onToggle('metadataFetchEnabled', v)}
            />
            <PrivacySaveError visible={saveError === 'metadataFetchEnabled'} />
            <ToggleRow
                label={t('settings.privacy.alwaysRequireHardwareCrossCheck')}
                hint={t('settings.privacy.requireTheIVeVerified')}
                checked={settings.privacy.alwaysRequireHwExplicitConfirm === true}
                onChange={(v) => onToggle('alwaysRequireHwExplicitConfirm', v)}
            />
            <PrivacySaveError visible={saveError === 'alwaysRequireHwExplicitConfirm'} />
            <ClipboardAutoClearRow settings={settings} update={update} />
            <FormDraftTtlRow settings={settings} update={update} />
            <div style={ROW}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={ROW_VALUE}>{t('settings.privacy.resetPrivacySettings')}</span>
                    <span style={ROW_HINT}>{t('settings.privacy.restoreThePrivacyControlsAbove')}</span>
                    <PrivacySaveError visible={saveError === 'reset'} />
                </div>
                <Button size="sm" variant="secondary" icon={null} onClick={resetPrivacy}>
                    {t('settings.display.resetToDefaults')}
                </Button>
            </div>
        </div>
    );
}

function PrivacySaveError({ visible }) {
    return visible ? (
        <Status text={t('settings.privacy.couldNotSaveThisPrivacy')} tone="error" />
    ) : null;
}

function ClipboardAutoClearRow({ settings, update }) {
    const [saveError, setSaveError] = useState(false);
    const [inputError, setInputError] = useState(false);
    // What the user has typed while the field has focus. A controlled value
    // alone refuses every keystroke that is not a valid number yet (an empty
    // field, a lone minus), so the field could never be cleared and retyped.
    const [typed, setTyped] = useState(/** @type {string | null} */ (null));
    const stored = settings?.privacy?.clipboardAutoClearSeconds;
    const current = Number.isInteger(stored) ? stored : CLIPBOARD_AUTO_CLEAR_DEFAULT;
    const onChange = async (event) => {
        const raw = event.target.value.trim();
        const next = Number(raw);
        setTyped(event.target.value);
        if (raw === ''
            || !Number.isInteger(next)
            || next < CLIPBOARD_AUTO_CLEAR_MIN
            || next > CLIPBOARD_AUTO_CLEAR_MAX) {
            setInputError(true);
            return;
        }
        setInputError(false);
        setSaveError(null);
        try {
            await update({ privacy: { clipboardAutoClearSeconds: next } });
        } catch (err) {
            setSaveError(true);
            // eslint-disable-next-line no-console
            console.error('privacy.clipboardAutoClearSeconds update failed:', err);
        }
    };
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={ROW_VALUE}>
                    {t('settings.privacy.clipboardAutoClear')}
                </span>
                <span style={ROW_HINT}>
                    {t('settings.privacy.setTo0ToKeep')}
                </span>
            </div>
            <div data-settings-control="">
                <Input
                    type="number"
                    inputMode="numeric"
                    enterKeyHint="done"
                    autoComplete="off"
                    min={CLIPBOARD_AUTO_CLEAR_MIN}
                    max={CLIPBOARD_AUTO_CLEAR_MAX}
                    step="1"
                    value={typed ?? current}
                    onChange={onChange}
                    onBlur={() => { setTyped(null); setInputError(false); }}
                    onWheel={blurNumberInputOnWheel}
                    aria-label={t('settings.privacy.clipboardAutoClearSeconds')}
                    style={{ width: '6rem' }}
                />
            </div>
            {inputError ? (
                <Status
                    text={t('settings.privacy.enterAWholeNumberFrom', { min: CLIPBOARD_AUTO_CLEAR_MIN, max: CLIPBOARD_AUTO_CLEAR_MAX })}
                    tone="error"
                />
            ) : null}
            <PrivacySaveError visible={saveError} />
        </div>
    );
}

// Cluster P FOLLOWUP 6: form-draft retention dropdown.
function FormDraftTtlRow({ settings, update }) {
    const [saveError, setSaveError] = useState(false);
    const current = Number.isFinite(settings?.privacy?.formDraftTtlMs)
        ? Number(settings.privacy.formDraftTtlMs)
        : FORM_DRAFT_TTL_DEFAULT;
    const onChange = async (e) => {
        const raw = e.target.value.trim();
        const next = Number(raw);
        if (raw === '' || !FORM_DRAFT_TTL_OPTIONS.includes(next)) return;
        setSaveError(null);
        try {
            await update({ privacy: { formDraftTtlMs: next } });
        } catch (err) {
            setSaveError(true);
            // eslint-disable-next-line no-console
            console.error('privacy.formDraftTtlMs update failed:', err);
        }
    };
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={ROW_VALUE}>
                    {t('settings.privacy.formDraftRetention')}
                </span>
                <span style={ROW_HINT}>
                    {t('settings.privacy.keepInProgressSendAnd')}
                </span>
            </div>
            <div data-settings-control="">
                <Select
                    value={current}
                    onChange={onChange}
                    aria-label={t('settings.privacy.formDraftRetention')}
                    style={{ width: '7.5rem' }}
                >
                    <option value={FORM_DRAFT_TTL_OFF}>{t('settings.privacy.off')}</option>
                    <option value={FORM_DRAFT_TTL_1H}>{t('settings.developer.1Hour')}</option>
                    <option value={FORM_DRAFT_TTL_24H}>{t('settings.privacy.24Hours')}</option>
                    <option value={FORM_DRAFT_TTL_7D}>{t('history.filters.last7Days')}</option>
                </Select>
            </div>
            <PrivacySaveError visible={saveError} />
        </div>
    );
}
