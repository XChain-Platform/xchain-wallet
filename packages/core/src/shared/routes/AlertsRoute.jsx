// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, EmptyState, Icon, InfoTip, ListPage, PageHeader, Screen, SectionHeader } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/alerts.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/firstPaint.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/home.js';
import '../../i18n/locales/en/ui.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ActivityIcon, BillIcon, DoubleCheckIcon, FunnelIcon, MessageIcon, PriceTrendIcon, SecurityShieldIcon, WalletAlertIcon } from '../components/alertIcons.jsx';
import { ListFilterMenu } from '../components/ListFilterMenu.jsx';
import { announceNotificationsChanged } from '../hooks/useNotificationUnreadCount.js';
import { usePendingNoticeAlerts } from '../hooks/usePendingNoticeAlerts.js';
import { withoutDeadNoticeAlerts } from '../walletAlerts.js';
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

// The inbox record of a wallet-level warning: everything but its action, which
// is a function, so the warning keeps its read state once it has been opened.
function storable({ id, type, label, title, message, at }) {
    return { id, type, ...(label ? { label } : {}), title, message, at: Number(at) || Date.now(), read: true };
}

// Line 1 of a row: the kind of activity the alert carries ("Governance poll"),
// or its type's name when the alert names no kind of its own.
const rowLabel = (alert) => alert.label || typeLabel(alert.type);

function Highlight({ text, query }) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = String(text).split(new RegExp(`(${escaped})`, 'ig'));
    return parts.map((part, index) => part.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? <mark key={`${part}-${index}`}>{part}</mark> : part);
}

export function AlertsRoute({ onBack, walletId, accountId = null, alerts: walletAlerts = [], isWatcherMode = false, onResumeCoinpay, onResumeAirdrop }) {
    const { messaging, shell } = useMessaging();
    // The Home notices (payment due, pending airdrop) list here beside the
    // wallet-level alerts, opening the same destination the Home notice does.
    const noticeAlerts = usePendingNoticeAlerts({ walletId, accountId, isWatcherMode, onResumeCoinpay, onResumeAirdrop });
    const alerts = useMemo(() => [...(Array.isArray(walletAlerts) ? walletAlerts : []), ...noticeAlerts], [walletAlerts, noticeAlerts]);
    const variant = screenVariantFor(shell);
    const [inboxAlerts, setInboxAlerts] = useState([]);
    const [localRead, setLocalRead] = useState(() => new Set());
    const [query, setQuery] = useState('');
    // Checked alert types; empty means All types.
    const [types, setTypes] = useState(() => new Set());
    // Unread works beside the types: it narrows whatever they select.
    const [unreadOnly, setUnreadOnly] = useState(false);

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
        // A stored payment-due or airdrop-pending row lists only while its notice is pending.
        for (const alert of [...withoutDeadNoticeAlerts(inboxAlerts, noticeAlerts), ...(Array.isArray(alerts) ? alerts : [])]) {
            if (!alert?.id) continue;
            const previous = byId.get(alert.id);
            byId.set(alert.id, {
                ...previous, ...alert,
                type: alert.type || previous?.type || 'wallet',
                at: Number(previous?.at || alert.at || 0),
                read: alert.read === true || previous?.read === true || localRead.has(alert.id),
                action: alert.action || previous?.action,
            });
        }
        return [...byId.values()].sort((a, b) => b.at - a.at);
    }, [alerts, noticeAlerts, inboxAlerts, localRead]);

    const counts = useMemo(() => Object.fromEntries(TYPE_ORDER.map((key) => [key, key === 'all' ? allAlerts.length : allAlerts.filter((alert) => alert.type === key).length])), [allAlerts]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visible = allAlerts.filter((alert) => (types.size === 0 || types.has(alert.type)) && (!unreadOnly || !alert.read)
        && (!normalizedQuery || [typeLabel(alert.type), alert.label, alert.title, alert.message].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery))));
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
        Promise.resolve(messaging?.markAlertRead?.({ id: alert.id, walletId, alert: storable(alert) }))
            .catch(() => {})
            .finally(announceNotificationsChanged);
    };
    const openAlert = async (alert) => {
        markRead(alert);
        try { await alert.action?.onSelect?.(); } catch { /* Navigation failures do not undo read state. */ }
    };
    const markAllRead = async () => {
        setLocalRead(new Set(allAlerts.map((alert) => alert.id)));
        setInboxAlerts((rows) => rows.map((row) => ({ ...row, read: true })));
        // Warnings the wallet derives are recorded as read too, so they stay read.
        for (const alert of allAlerts) if (!alert.read) messaging?.markAlertRead?.({ id: alert.id, walletId, alert: storable(alert) })?.catch?.(() => {});
        try { await messaging?.markAllAlertsRead?.({ walletId }); } catch { /* Keep the local read state. */ }
        announceNotificationsChanged();
    };

    // All types and the single types are one choice: All clears the rest, a
    // single type clears All, and unchecking the last type falls back to All.
    const toggleType = (key) => setTypes((current) => {
        if (key === 'all') return new Set();
        const next = new Set(current);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const filterActive = normalizedQuery !== '' || types.size > 0 || unreadOnly;
    // The count is announced only while a search or type filter is set. It is
    // read to screen readers and never drawn: nothing sits between the header
    // and the list (G95), and the filter button's dot already shows a filter is on.
    const matchLine = <p className="sr-only" aria-live="polite" data-alert-match-count="">{filterActive ? t('alerts.matches', { count: visible.length }) : ''}</p>;
    const filterButton = (
        <ListFilterMenu
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder={t('alerts.search')}
            searchLabel={t('alerts.search')}
            label={t('alerts.filter')}
            active={types.size > 0 || unreadOnly}
        >
            <fieldset className={styles.typeGroup}>
                <legend className={styles.typeLegend}>
                    {t('alerts.filterType')}{' '}
                    <InfoTip
                        label={t('alerts.filterTypeHelp')}
                        aria={t('ui.field.about', { label: t('alerts.filterType') })}
                    />
                </legend>
                <div className={styles.typeOptions}>
                    <Checkbox
                        checked={unreadOnly}
                        onChange={() => setUnreadOnly((value) => !value)}
                        label={<span className={styles.typeOption}><span className={styles.filterDot} aria-hidden="true" />{t('alerts.unread')} ({unreadCount})</span>}
                    />
                    <div className={styles.typeDivider} role="separator" />
                    {TYPE_ORDER.map((key) => {
                        const TypeIcon = TYPE_ICON[key] || FunnelIcon;
                        const checked = key === 'all' ? types.size === 0 : types.has(key);
                        return (
                            <Checkbox
                                key={key}
                                checked={checked}
                                onChange={() => toggleType(key)}
                                label={<span className={styles.typeOption}><TypeIcon />{typeLabel(key)} ({counts[key]})</span>}
                            />
                        );
                    })}
                </div>
            </fieldset>
        </ListFilterMenu>
    );

    return (
        <Screen variant={variant} header={<PageHeader
            onBack={onBack}
            title={t('alerts.title')}
            trailing={(
                <span className={styles.headerActions}>
                    <span className={styles.markAllWrap}>
                        <Button variant="secondary" size="sm" icon={<DoubleCheckIcon />} aria-label={t('alerts.markAllRead')} disabled={unreadCount === 0} onClick={markAllRead} />
                        {unreadCount > 0 ? <span className={styles.badge} aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
                    </span>
                    {filterButton}
                </span>
            )}
        />}>
            <ListPage className={styles.page}>
                {matchLine}
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
                                            <li key={alert.id} className={`${styles.row} ${alert.read ? styles.read : styles.unread} ${alert.attention === 'autopay-cannot-sign' ? styles.attention : ''}`}>
                                                <Button variant="rowAction" icon={null} className={styles.rowButton} onClick={() => openAlert(alert)} aria-label={alert.action?.label || alert.title}>
                                                    <span className={styles.rowGrid}>
                                                        <span className={`${styles.iconTile} ${TYPE_ICON_CLASS[alert.type] || ''}`}><TypeIcon /></span>
                                                        {/* Exactly three lines, each clamped to one line with an
                                                            ellipsis: the kind of activity (the time is beside it),
                                                            a short detail, a short description. The rows' copy is
                                                            written to fit (alertCopy.js); the clamp is the backstop. */}
                                                        <span className={styles.copy}>
                                                            <span className={`${styles.typeLabel} ${TYPE_LABEL_CLASS[alert.type] || ''}`} data-alert-line="label"><Highlight text={rowLabel(alert)} query={normalizedQuery} /></span>
                                                            <span className={styles.title} data-alert-line="title"><Highlight text={alert.title} query={normalizedQuery} /></span>
                                                            <span className={styles.message} data-alert-line="message"><Highlight text={alert.attention === 'autopay-cannot-sign' ? t('alerts.paymentDue.autoPayCannotSign') : alert.message} query={normalizedQuery} /></span>
                                                        </span>
                                                        <span className={styles.meta}>
                                                            <time dateTime={new Date(alert.at).toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(alert.at)}</time>
                                                            {!alert.read ? <span className={styles.unreadDot} aria-label={t('alerts.unread')} /> : null}
                                                        </span>
                                                        {/* Every row ends in the same chevron-wide slot, so the
                                                            time and dot share one right edge. A row that opens a
                                                            page fills it with the standard chevron (G97); a row
                                                            that only marks itself read leaves it empty. */}
                                                        {typeof alert.action?.onSelect === 'function' ? (
                                                            <span className={styles.chevron} aria-hidden="true" data-alert-chevron=""><Icon.ForwardIcon /></span>
                                                        ) : (
                                                            <span className={styles.chevron} aria-hidden="true" data-alert-chevron-slot="" />
                                                        )}
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
