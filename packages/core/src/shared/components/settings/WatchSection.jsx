// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSettings } from '../../hooks/useSettings.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/watch.js';
import { SettingsInlineRow, SettingsLoadError } from './SettingsInlineRow.jsx';
import { STACK, Status } from './_settingsPrimitives.jsx';
import { watchControls } from './watchSectionControls.js';

const labelledOptions = (control, labels) => ({
    ...control,
    options: (settings) => control.options(settings).map((option) => ({
        ...option,
        label: labels[option.value],
    })),
});

const rows = [
    { id: 'watch-enabled', title: t('watch.showWallet'), control: watchControls.enabled },
    { id: 'watch-token-mode', title: t('watch.tokens'), control: labelledOptions(watchControls.tokenMode, {
        home: t('watch.tokens.followHome'), pinned: t('watch.tokens.pinnedOnly'),
    }) },
    { id: 'watch-start-in', title: t('watch.startIn'), control: labelledOptions(watchControls.startIn, {
        fiat: t('watch.startIn.fiat'), units: t('watch.startIn.units'),
    }) },
    { id: 'watch-show-total', title: t('watch.showTotal'), control: watchControls.showTotal },
];

export function WatchSection() {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    return (
        <div style={STACK}>
            {rows.map((row) => (
                <SettingsInlineRow key={row.id} row={row} settings={settings} update={update} />
            ))}
        </div>
    );
}
