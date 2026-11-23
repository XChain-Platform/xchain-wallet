// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Switch } from '@xchain-wallet/core/ui';
import { resolveWatchSettings } from '../../../schemas/settings.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/watch.js';
import { useSettings } from '../../hooks/useSettings.js';
import { getNativePlugin } from '../../nativeShell.js';
import {
    ROW,
    ROW_COPY,
    ROW_HINT,
    ROW_TITLE,
    STACK,
    SettingsLoadError,
    Status,
} from './_settingsPrimitives.jsx';

export function backgroundCheckRowState(settings) {
    return {
        on: resolveWatchSettings(settings).backgroundActivityCheck,
        locked: settings?.privacy?.torRouting === true,
    };
}

export function summarizeRunLog(times, { limit = 20 } = {}) {
    if (!Array.isArray(times)) return { count: 0, times: [] };

    const max = Math.max(0, Math.trunc(limit));
    const kept = times
        .filter(time => typeof time === 'number' && Number.isFinite(time) && time >= 0)
        .sort((a, b) => b - a)
        .slice(0, max);

    return { count: kept.length, times: kept };
}

export function WatchAlertsRows({ runTimes } = {}) {
    const { settings, loading, error, update } = useSettings({ reportsOwnError: true });
    const [nativeRunTimes, setNativeRunTimes] = useState([]);
    const [showTorNote, setShowTorNote] = useState(false);

    useEffect(() => {
        if (runTimes !== undefined) return undefined;
        let active = true;
        const plugin = getNativePlugin('XChainActivity', { method: 'runLog' });
        Promise.resolve(plugin?.runLog?.())
            .then((result) => {
                if (active) setNativeRunTimes(result?.times ?? result ?? []);
            })
            .catch(() => {});
        return () => { active = false; };
    }, [runTimes]);

    if (loading) return <Status text={t('common.loading')} />;
    if (error) return <SettingsLoadError error={error} />;
    if (!settings) return <Status text={t('common.settingsUnavailable')} tone="error" />;

    const state = backgroundCheckRowState(settings);
    const runs = summarizeRunLog(runTimes ?? nativeRunTimes);
    const setEnabled = (event) => {
        if (state.locked) {
            setShowTorNote(true);
            return;
        }
        update({ watch: { backgroundActivityCheck: event.target.checked } });
    };

    return (
        <div style={STACK}>
            <div style={ROW}>
                <Switch
                    label={t('watch.backgroundActivityCheck')}
                    help={t('watch.backgroundActivityCheck.help')}
                    description={state.locked && showTorNote ? t('watch.torUnavailable') : undefined}
                    checked={state.on}
                    aria-disabled={state.locked || undefined}
                    onChange={setEnabled}
                />
            </div>
            <section style={ROW} aria-label={t('watch.backgroundActivityRuns', { count: runs.count })}>
                <div style={ROW_COPY}>
                    <span style={ROW_TITLE}>{t('watch.backgroundActivityRuns', { count: runs.count })}</span>
                    {runs.count === 0 ? <span style={ROW_HINT}>{t('watch.backgroundActivityNeverRun')}</span> : null}
                </div>
                {runs.count > 0 ? (
                    <ol>
                        {runs.times.map((time, index) => (
                            <li key={`${time}-${index}`}>
                                <time dateTime={new Date(time).toISOString()}>{new Date(time).toLocaleString()}</time>
                            </li>
                        ))}
                    </ol>
                ) : null}
            </section>
        </div>
    );
}
