// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Input, ListPage, PageHeader, Screen, SectionHeader, Select } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/alerts.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/firstPaint.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/home.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActivityIcon, BillIcon, DoubleCheckIcon, FunnelIcon, MessageIcon, PriceTrendIcon, SearchIcon, SecurityShieldIcon, WalletAlertIcon } from '../components/alertIcons.jsx';
import styles from './AlertsRoute.module.css';

const TYPE_ORDER = ['all', 'price', 'activity', 'payments', 'messages', 'security', 'wallet'];
const TYPE_ICON = { price: PriceTrendIcon, activity: ActivityIcon, payments: BillIcon, messages: MessageIcon, security: SecurityShieldIcon, wallet: WalletAlertIcon };
const TYPE_LABEL = {
    all: () => t('alerts.type.all'),
    price: () => t('components.placeOrderPanel.price'),
    activity: () => t('home.tabs.activity'),
    payments: () => t('alerts.type.payments'),
    messages: () => t('alerts.type.messages'),
    security: () => t('alerts.type.security'),
    wallet: () => t('settings.thisWallet.wallet'),
};
const TYPE_ICON_CLASS = {
    activity: styles.iconActivity,
    payments: styles.iconPayments,
    security: styles.iconSecurity,
};
const TYPE_LABEL_CLASS = {
    activity: styles.labelActivity,
    payments: styles.labelPayments,
    security: styles.labelSecurity,
};
const typeLabel = (type) => (TYPE_LABEL[type] || TYPE_LABEL.wallet)();

function dayKey(at, now = new Date()) {
    const date = new Date(at);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rowStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (rowStart === start) return t('history.group.today');
    if (rowStart === start - 86_400_000) return t('history.group.yesterday');
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(date);
}

function Highlight({ text, query }) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = String(text).split(new RegExp(`(${escaped})`, 'ig'));
    return parts.map((part, index) => part.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function AlertsRoute({ onBack, walletId, alerts = [] }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [inboxAlerts, setInboxAlerts] = useState([]);
    const [localRead, setLocalRead] = useState(() => new Set());
    const [query, setQuery] = useState('');
    const [type, setType] = useState('all');

    useEffect(() => {
        let active = true;
        if (typeof messaging?.listAlertInbox !== 'function') return undefined;
        messaging.listAlertInbox({ walletId }).then((rows) => {
            if (active) setInboxAlerts(Array.isArray(rows) ? rows : []);
        }).catch(() => {});
        return () => { active = false; };
    }, [messaging, walletId]);

    const allAlerts = useMemo(() => {
        const byId = new Map();
        for (const alert of [...inboxAlerts, ...(Array.isArray(alerts) ? alerts : [])]) {
            if (!alert?.id) continue;
            const previous = byId.get(alert.id);
            byId.set(alert.id, {
                ...previous, ...alert,
                type: alert.type || previous?.type || 'wallet',
                at: Number(alert.at || previous?.at || 0),
                read: alert.read === true || previous?.read === true || localRead.has(alert.id),
                action: alert.action || previous?.action,
            });
        }
        return [...byId.values()].sort((a, b) => b.at - a.at);
    }, [alerts, inboxAlerts, localRead]);

    const counts = useMemo(() => Object.fromEntries(TYPE_ORDER.map((key) => [key, key === 'all' ? allAlerts.length : allAlerts.filter((alert) => alert.type === key).length])), [allAlerts]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visible = allAlerts.filter((alert) => (type === 'all' || alert.type === type)
        && (!normalizedQuery || [typeLabel(alert.type), alert.title, alert.message].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery))));
    const groups = visible.reduce((map, alert) => {
        const key = dayKey(alert.at);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(alert);
        return map;
    }, new Map());
    const unreadCount = allAlerts.filter((alert) => !alert.read).length;

    const markRead = (alert) => {
        setLocalRead((current) => new Set([...current, alert.id]));
        setInboxAlerts((rows) => rows.map((row) => row.id === alert.id ? { ...row, read: true } : row));
        messaging?.markAlertRead?.({ id: alert.id, walletId })?.catch?.(() => {});
    };
    const openAlert = async (alert) => {
        markRead(alert);
        try { await alert.action?.onSelect?.(); } catch { /* Navigation failures do not undo read state. */ }
    };
    const markAllRead = async () => {
        setLocalRead(new Set(allAlerts.map((alert) => alert.id)));
        setInboxAlerts((rows) => rows.map((row) => ({ ...row, read: true })));
        try { await messaging?.markAllAlertsRead?.({ walletId }); } catch { /* Keep the local read state. */ }
    };

    const toolbar = (
        <div className={styles.filters}>
            <div className={styles.searchWrap}>
                <SearchIcon />
                <Input type="search" aria-label={t('alerts.search')} placeholder={t('alerts.search')} value={query} onChange={(event) => setQuery(event.target.value)} className={styles.searchInput} />
                {query ? <Button className={styles.clearSearch} variant="ghost" size="sm" icon={null} aria-label={t('alerts.clearSearch')} onClick={() => setQuery('')}>×</Button> : null}
            </div>
            <div className={`${styles.typeWrap} ${type !== 'all' ? styles.typeWrapActive : ''}`}>
                <FunnelIcon />
                <Select aria-label={t('alerts.filterType')} value={type} onChange={(event) => setType(event.target.value)} className={styles.typeSelect}>
                    {TYPE_ORDER.map((key) => <option key={key} value={key}>{typeLabel(key)} ({counts[key]})</option>)}
                </Select>
            </div>
        </div>
    );

    return (
        <Screen variant={variant} header={<PageHeader
            onBack={onBack}
            title={t('alerts.title')}
            trailing={(
                <span className={styles.markAllWrap}>
                    <Button variant="secondary" size="sm" icon={<DoubleCheckIcon />} aria-label={t('alerts.markAllRead')} disabled={unreadCount === 0} onClick={markAllRead} />
                    {unreadCount > 0 ? <span className={styles.badge} aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
                </span>
            )}
        />}>
            <ListPage toolbar={toolbar} className={styles.page}>
                {normalizedQuery ? <p className={styles.matchCount}>{t('alerts.matches', { count: visible.length })}</p> : null}
                {visible.length === 0 ? <EmptyState title={t('alerts.empty.title')} body={t('alerts.empty.body')} /> : (
                    <div className={styles.groups}>
                        {[...groups.entries()].map(([label, rows]) => (
                            <section key={label} aria-label={label}>
                                <SectionHeader className={styles.day} title={<span className={styles.dayLabel}>{label}</span>} />
                                {/* Safari needs an explicit list role because this class removes list styling. */}
                                <ul className={styles.list} role="list">
                                    {rows.map((alert) => {
                                        const TypeIcon = TYPE_ICON[alert.type] || WalletAlertIcon;
                                        return (
                                            <li key={alert.id} className={`${styles.row} ${alert.read ? styles.read : styles.unread}`}>
                                                <Button variant="rowAction" icon={null} className={styles.rowButton} onClick={() => openAlert(alert)} aria-label={alert.action?.label || alert.title}>
                                                    <span className={styles.rowGrid}>
                                                        <span className={`${styles.iconTile} ${TYPE_ICON_CLASS[alert.type] || ''}`}><TypeIcon /></span>
                                                        <span className={styles.copy}>
                                                            <span className={`${styles.typeLabel} ${TYPE_LABEL_CLASS[alert.type] || ''}`}><Highlight text={typeLabel(alert.type)} query={normalizedQuery} /></span>
                                                            <span className={styles.title}><Highlight text={alert.title} query={normalizedQuery} /></span>
                                                            <span className={styles.message}><Highlight text={alert.message} query={normalizedQuery} /></span>
                                                        </span>
                                                        <span className={styles.meta}>
                                                            <time dateTime={new Date(alert.at).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(alert.at)}</time>
                                                            {!alert.read ? <span className={styles.unreadDot} aria-label={t('alerts.unread')} /> : null}
                                                        </span>
                                                    </span>
                                                </Button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </ListPage>
        </Screen>
    );
}
