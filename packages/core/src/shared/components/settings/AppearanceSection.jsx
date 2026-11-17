// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// AppearanceSection (§35.1 Appearance panel).
//
// Live:
//   - Theme picker: system / light / dark.
//   - Reduced-motion override: auto (follow OS) / always / never.
//
// Both are applied by DisplayPrefsGate, which stamps them on <html> as
// `data-xc-theme` / `data-xc-reduced-motion`; tokens.css keys the palette
// and the motion switch off those attributes and `useReducedMotion` gives
// JS-driven animations the same verdict. Before both selectors wrote
// a value that nothing read, so the app just followed the OS.
//
// Deferred:
//   - Accent color (per spec §35.1 only "when brand is finalized"); no row renders until it exists.

import { useState } from 'react';
import { Icon, Select } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import {
    STACK, SettingsFieldRow, SettingsLoadError, Status,
} from './_settingsPrimitives.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/settings.js';

export const THEME_OPTIONS = /** @type {const} */ ([
    { value: 'system', label: 'System default' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
]);

// Short names under the "Reduce motion" title (On reduces always, Off never,
// System follows the device), so the row's dropdown fits beside its title on
// a 360px phone and at large text (2026-11-15 wall check).
export const REDUCED_MOTION_OPTIONS = /** @type {const} */ ([
    { value: 'auto', label: 'System' },
    { value: 'always', label: 'On' },
    { value: 'never', label: 'Off' },
]);

/** The Theme row's current value as its option reads. */
export function themeLabel(value) {
    return THEME_OPTIONS.find((opt) => opt.value === (value || 'system'))?.label ?? THEME_OPTIONS[0].label;
}

/** The Reduced motion row's current value as its option reads. */
export function reducedMotionLabel(value) {
    return REDUCED_MOTION_OPTIONS.find((opt) => opt.value === (value || 'auto'))?.label ?? REDUCED_MOTION_OPTIONS[0].label;
}

// `only` renders one control ('theme' or 'motion') for its own Settings page;
// with no `only` both rows render.
export function AppearanceSection({ only = null } = {}) {
    const show = (part) => !only || only === part;
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const onThemeChange = async (next) => {
        setSaveError(null);
        try {
            await update({ theme: next });
        } catch (err) {
            setSaveError(userFacingMessage(err, 'Could not save appearance settings. Try again.'));
            // eslint-disable-next-line no-console
            console.error('appearance.theme update failed:', err);
        }
    };
    const onReducedMotionChange = async (next) => {
        setSaveError(null);
        try {
            await update({ reducedMotion: next });
        } catch (err) {
            setSaveError(userFacingMessage(err, 'Could not save appearance settings. Try again.'));
            // eslint-disable-next-line no-console
            console.error('appearance.reducedMotion update failed:', err);
        }
    };

    return (
        <div style={STACK}>
            {saveError ? <Status text={saveError} tone="error" /> : null}
            {show('theme') ? (
                <SettingsFieldRow
                    label={t('settings.appearance.theme')}
                    help={t('settings.help.appearance.theme')}
                >
                    <Select
                        value={settings.theme}
                        onChange={(e) => onThemeChange(e.target.value)}
                    >
                        {THEME_OPTIONS.map((opt) => (
                            <Select.Option
                                key={opt.value}
                                value={opt.value}
                                icon={opt.value === 'light' ? <Icon.EyeIcon /> : opt.value === 'dark' ? <Icon.EyeOffIcon /> : <Icon.GearIcon />}
                            >
                                {opt.label}
                            </Select.Option>
                        ))}
                    </Select>
                </SettingsFieldRow>
            ) : null}
            {show('motion') ? (
                <SettingsFieldRow
                    label={t('settings.appearance.reducedMotion')}
                    help={t('settings.help.appearance.reducedMotion')}
                >
                    <Select
                        value={settings.reducedMotion ?? 'auto'}
                        onChange={(e) => onReducedMotionChange(e.target.value)}
                    >
                        {REDUCED_MOTION_OPTIONS.map((opt) => (
                            <Select.Option
                                key={opt.value}
                                value={opt.value}
                                icon={opt.value === 'always' ? <Icon.PauseIcon /> : opt.value === 'never' ? <Icon.PlayIcon /> : <Icon.GearIcon />}
                            >
                                {opt.label}
                            </Select.Option>
                        ))}
                    </Select>
                </SettingsFieldRow>
            ) : null}
        </div>
    );
}
