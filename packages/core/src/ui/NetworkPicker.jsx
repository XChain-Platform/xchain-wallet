// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useMemo, useRef } from 'react';
import * as branding from '../branding/branding.js';
import { useFocusTrap } from '../shared/utils/focusTrap.js';
import { CheckIcon, FilterIcon } from './icons/index.jsx';
import { tickerForCoin } from '../registry/coinTicker.js';
import { ListPage } from './ListPage.jsx';
import { ListRow } from './ListRow.jsx';
import { PageHeader } from './PageHeader.jsx';
import { Screen } from './Screen.jsx';
import { useBackHandler } from './backStack.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/firstPaint.js';
import '../i18n/locales/en/ui.js';
import styles from './NetworkPicker.module.css';

/** Full-screen list of networks used by NetworkField. */
export function NetworkPicker({
    value,
    onSelect,
    onBack,
    chainIds,
    chainRegistry,
    label = t('settings.network.label'),
    contained = false,
    allOption = false,
}) {
    const titleId = useId();
    const pickerRef = useRef(null);
    useBackHandler(onBack);
    useFocusTrap(pickerRef, { active: true });

    const entries = useMemo(() => (chainIds || []).map((id) => {
        const descriptor = chainRegistry?.get(id);
        return {
            id,
            label: descriptor?.displayName || id,
            networkKind: descriptor?.networkKind || 'mainnet',
            ticker: tickerForCoin(descriptor?.coin),
            iconUrl: branding.chainIconSmallUrl(id),
        };
    }), [chainIds, chainRegistry]);

    return (
        <div
            ref={pickerRef}
            className={`${styles.overlay} ${contained ? styles.contained : ''}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
        >
            <Screen
                variant="full"
                bodyAs="section"
                bodyLabelledBy={titleId}
                header={(
                    <PageHeader
                        title={label}
                        titleId={titleId}
                        onBack={onBack}
                        nested
                    />
                )}
            >
                <ListPage>
                    <ul className={styles.list}>
                        {allOption ? (
                            <li>
                                <ListRow
                                    aria-current={value === 'all' ? 'true' : undefined}
                                    aria-label={t('ui.networkPicker.selectNetwork', {
                                        network: t('common.allNetworks'),
                                    })}
                                    leading={(
                                        <span className={styles.icon} aria-hidden="true">
                                            <FilterIcon />
                                        </span>
                                    )}
                                    title={t('common.allNetworks')}
                                    trailing={value === 'all' ? <CheckIcon /> : null}
                                    onClick={() => onSelect('all')}
                                />
                            </li>
                        ) : null}
                        {entries.map((entry) => {
                            const selected = entry.id === value;
                            return (
                                <li key={entry.id}>
                                    <ListRow
                                        aria-current={selected ? 'true' : undefined}
                                        aria-label={networkSelectionLabel(entry)}
                                        leading={entry.iconUrl ? (
                                            <span className={styles.icon} aria-hidden="true">
                                                <img src={entry.iconUrl} alt="" />
                                            </span>
                                        ) : null}
                                        title={entry.label}
                                        trailing={selected ? <CheckIcon /> : null}
                                        onClick={() => onSelect(entry.id)}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                </ListPage>
            </Screen>
        </div>
    );
}

function networkSelectionLabel(entry) {
    const network = entry.networkKind === 'mainnet'
        ? entry.label
        : `${entry.label} ${entry.networkKind} ${entry.ticker}`;
    return t('ui.networkPicker.selectNetwork', { network });
}
