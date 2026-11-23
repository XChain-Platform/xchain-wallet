// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/watch.js';
import { createWatchBridge } from '../../../watch/watchBridge.js';
import { nativePlatformName } from '../../nativeShell.js';
import { formatRelativeTime } from '../../utils/dateTime.js';
import { InlineRowFrame } from './SettingsInlineRow.jsx';

const HINT_KEYS = {
    pairWatchIos: 'watch.status.hint.pairApple',
    installWatchIos: 'watch.status.hint.installApple',
    installWatchAndroid: 'watch.status.hint.installWear',
    bringWatchNear: 'watch.status.hint.unreachable',
};

export function watchStatusHint({ paired, installed, reachable }, platform) {
    if (platform !== 'ios' && platform !== 'android') return null;

    if (platform === 'ios' && !paired) return 'pairWatchIos';
    if (platform === 'ios' && !installed) return 'installWatchIos';
    if (platform === 'android' && (!paired || !installed)) return 'installWatchAndroid';
    if (!reachable) return 'bringWatchNear';

    return null;
}

function emptySnapshot(enabled, inbox = []) {
    const now = Date.now();
    return {
        v: 1, builtAt: now, balancesAt: now, pricesAt: now,
        session: 'unlocked', network: { kind: 'mainnet', isTest: false },
        fiatCode: 'USD', hidden: false, unitDefault: 'fiat', walletName: '',
        totals: { fiatText: '', unitsText: 'Balances' }, rows: [], capped: false,
        receive: [], inbox,
        request: { id: '00000000000000000000000000000000', kind: 'request', iconHash: '', sentence: '', amountText: '' },
        settings: { showTotal: false, enabled },
    };
}

export function WatchStatusRows({ bridge, platform = nativePlatformName() }) {
    const defaultBridge = useRef();
    if (!bridge && !defaultBridge.current) defaultBridge.current = createWatchBridge();
    const activeBridge = bridge || defaultBridge.current;
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        Promise.resolve(activeBridge.status()).then((next) => {
            if (active) setStatus(next);
        });
        return () => { active = false; };
    }, [activeBridge]);

    const value = (answer) => (answer ? t('watch.value.on') : t('watch.value.off'));
    const hint = status && watchStatusHint(status, platform);
    const run = async (action) => {
        setBusy(true);
        try { await action(); } finally { setBusy(false); }
    };
    const sendTest = () => activeBridge.sendSnapshot(emptySnapshot(true, [{
        id: `watch-test-${Date.now()}`, family: 'priceAlerts', kind: 'price-alert',
        title: t('watch.testAlert.title'), body: t('watch.testAlert.body'), at: Date.now(), read: false,
    }]));
    const removeData = async () => {
        try {
            await activeBridge.sendSnapshot(emptySnapshot(false));
        } finally {
            await activeBridge.removeWatchData();
        }
    };

    return (
        <>
            <InlineRowFrame title={t('watch.status.paired')} line={hint ? t(HINT_KEYS[hint]) : null}>{status ? value(status.paired) : '-'}</InlineRowFrame>
            <InlineRowFrame title={t('watch.status.installed')}>{status ? value(status.installed) : '-'}</InlineRowFrame>
            <InlineRowFrame title={t('watch.status.reachable')}>{status ? value(status.reachable) : '-'}</InlineRowFrame>
            <InlineRowFrame title={t('watch.status.lastSync')}>{status?.lastSyncAt ? formatRelativeTime(status.lastSyncAt) : '-'}</InlineRowFrame>
            <InlineRowFrame title={t('watch.sendTestAlert')}><Button type="button" size="sm" variant="secondary" icon={<Icon.BellIcon />} disabled={busy} onClick={() => run(sendTest)}>{t('watch.sendTestAlert')}</Button></InlineRowFrame>
            <InlineRowFrame title={t('watch.removeData')}><Button type="button" size="sm" variant="danger" icon={<Icon.TrashIcon />} disabled={busy} onClick={() => run(removeData)}>{t('watch.removeData')}</Button></InlineRowFrame>
        </>
    );
}
