// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlertsSection: Settings, Notifications, Price alerts (2026-11-14).
//
// The page draws its own header (a list filter and the plus). Its pages:
//   list   a chevron row per alert, "BTC above $70,000" over "Now $68,412,
//          2.3% to go" (a paused alert says Paused, a fired one when it
//          fired); the plus adds one; none saved shows "No price alerts yet"
//   alert  the Price Alert page: the identity card, then the Actions | Details
//          toggle (G102); Edit, Pause or Resume, Re-arm (a fired alert) and
//          Delete
//   add    Add Price Alert, the Form Standard page (also opened by Token
//          detail with its token chosen); Edit Price Alert reuses it filled in
// The page's own on/off lives on the Notifications page, so nothing here
// depends on a switch. Pages sit under one registered Settings page, and each
// Back returns one page.
//
// The list costs one read of the alerts plus one batched price read per
// display currency and one per distinct token, however many alerts there are.

import { useMemo, useState } from 'react';
import {
    Button,
    EmptyState,
    Icon,
    ListPage,
    ListRow,
    PageHeader,
    Screen,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { AssetMark } from '../../../ui/AssetMark.jsx';
import { useBackHandler } from '../../../ui/backStack.js';
import { defaultRegistry } from '../../../registry/index.js';
import { tickerForDescriptor } from '../../../registry/coinTicker.js';
import { useSettings } from '../../hooks/useSettings.js';
import { usePriceAlerts } from '../../hooks/usePriceAlerts.js';
import { usePriceAlertPrices } from '../../hooks/usePriceAlertPrices.js';
import { useConfirmModal } from '../../hooks/useConfirmModal.js';
import { useMessaging, screenVariantFor } from '../../useMessaging.js';
import { expandDecimalNotation } from '../../utils/amountFormat.js';
import { formatLocalDateTime } from '../../utils/dateTime.js';
import { ActionList, ActionListItem } from '../ActionList.jsx';
import { ActionsDetailsToggle } from '../ActionsDetailsToggle.jsx';
import { ConfirmModal } from '../ConfirmModal.jsx';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { RelativeTime } from '../RelativeTime.jsx';
import {
    PriceAlertForm,
    alertAssetTicker,
    coinLabelForChain,
    formatCurrentPrice,
    formatPercent,
} from '../PriceAlertForm.jsx';
import { Status, SettingsLoadError } from './_settingsPrimitives.jsx';
import styles from './PriceAlertsSection.module.css';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/common.js';
import '../../../i18n/locales/en/components.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/routes.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/walletDetails.js';
import '../../../i18n/locales/en/settings.js';

const chainRegistry = defaultRegistry();

/**
 * Compact, locale-free threshold label, e.g. 70000/usd → "$70,000". Only the
 * whole-number part takes thousands separators; the fraction and any
 * exponent form print as plain digits so "0.1234" never reads "0.1,234".
 */
export function formatThreshold(value, fiatCurrency) {
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const n = Number(value);
    let body = String(value);
    if (Number.isFinite(n)) {
        const plain = expandDecimalNotation(String(Math.abs(n))) || String(Math.abs(n));
        const [whole, fraction] = plain.split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        body = (n < 0 ? '-' : '') + (fraction ? `${grouped}.${fraction}` : grouped);
    }
    return cur === 'usd' ? `$${body}` : `${body} ${cur.toUpperCase()}`;
}

/** "BTC above $70,000": the alert's terms, shown once on each row and page. */
export function alertTerms(alert) {
    return t(alert.direction === 'above' ? 'settings.priceAlerts.termsAbove' : 'settings.priceAlerts.termsBelow', {
        asset: alertAssetTicker(alert.chainId, alert.tick),
        target: formatThreshold(alert.targetFiat, alert.fiatCurrency),
    });
}

function isNativeAlert(alert) {
    if (!alert.tick) return true;
    const native = String(tickerForDescriptor(chainRegistry.get(alert.chainId)) || '').toUpperCase();
    return String(alert.tick).toUpperCase() === native;
}

function assetMarkFor(alert) {
    return <AssetMark chainId={alert.chainId} tick={alertAssetTicker(alert.chainId, alert.tick)} isNative={isNativeAlert(alert)} />;
}

/** "Now $68,412, 2.3% to go" for a watching alert; null while no price has landed. */
function nowLine(alert, price) {
    if (price == null) return null;
    const now = formatCurrentPrice(price, alert.fiatCurrency);
    const met = alert.direction === 'above' ? price >= alert.targetFiat : price <= alert.targetFiat;
    if (met) return t('settings.priceAlerts.nowPrice', { price: now });
    const pct = Math.abs(alert.targetFiat - price) / price * 100;
    return t('settings.priceAlerts.rowNowToGo', { price: now, percent: formatPercent(pct) });
}

function statusLabel(alert) {
    if (alert.status === 'paused') return t('routes.manageToken.paused');
    if (alert.status === 'triggered') return t('settings.priceAlerts.statusFired');
    return t('settings.display.watchingLabel');
}

/**
 * The Add Price Alert and Edit Price Alert page: a Screen with a title-only
 * header around the shared form. The Choose Asset page replaces it while open
 * and the form keeps its state behind it.
 *
 * @param {object} props
 * @param {{ id: string, chainId: string, tick?: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string } | null} [props.editing]
 * @param {() => void} props.onBack
 * @param {(input: object) => Promise<void> | void} props.onSave
 * @param {string | null | undefined} props.walletId
 * @param {string} [props.fiatCurrency]
 * @param {boolean} [props.allowCoingeckoFallback]
 * @param {string} [props.initialChainId]
 * @param {string} [props.initialTick]
 * @param {number | null} [props.currentPrice]
 * @param {'small' | 'full'} [props.variant]
 * @param {boolean} [props.nested]
 * @param {string} [props.backLabel]
 */
export function PriceAlertEditorPage({
    editing = null,
    onBack,
    onSave,
    walletId,
    fiatCurrency = 'usd',
    allowCoingeckoFallback = true,
    initialChainId,
    initialTick,
    currentPrice = null,
    variant,
    nested = true,
    backLabel,
}) {
    const [pickerScreen, setPickerScreen] = useState(null);
    const { shell } = useMessaging();
    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={editing ? t('settings.priceAlerts.editTitle') : t('settings.priceAlerts.addTitle')}
        />
    );
    return (
        <>
            {pickerScreen}
            <div hidden={Boolean(pickerScreen)} style={pickerScreen ? undefined : { display: 'contents' }}>
                <Screen variant={variant || screenVariantFor(shell)} header={header} scrollKey={editing ? `price-alert-edit-${editing.id}` : 'price-alert-add'} restoreScroll={false}>
                    <PriceAlertForm
                        key={editing?.id || 'new'}
                        walletId={walletId || undefined}
                        fiatCurrency={editing?.fiatCurrency || fiatCurrency}
                        allowCoingeckoFallback={allowCoingeckoFallback}
                        initialAlert={editing || undefined}
                        initialChainId={initialChainId}
                        initialTick={initialTick}
                        currentPrice={currentPrice}
                        onCreate={onSave}
                        onTokenPickerScreenChange={setPickerScreen}
                    />
                </Screen>
            </div>
        </>
    );
}

/**
 * @param {object} props
 * @param {string | null | undefined} [props.walletId]
 * @param {boolean} [props.nested]
 * @param {() => void} [props.onBack]
 * @param {string} [props.backLabel]
 * @param {string} [props.variant]
 */
export function PriceAlertsSection({ walletId, nested = false, onBack, backLabel, variant }) {
    const { settings, loading: settingsLoading, error: settingsError } = useSettings({ reportsOwnError: true });
    const {
        alerts,
        loading,
        supported,
        error,
        addAlert,
        updateAlert,
        removeAlert,
        rearm,
        pause,
        reload,
    } = usePriceAlerts(walletId);
    const [page, setPage] = useState(/** @type {{ name: 'list' | 'alert' | 'add' | 'edit', id?: string }} */ ({ name: 'list' }));
    const [query, setQuery] = useState('');
    const [actionError, setActionError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const confirmDialog = useConfirmModal();
    const fiatCurrency = (typeof settings?.fiatCurrency === 'string' && settings.fiatCurrency) || 'usd';
    const allowFallback = settings?.privacy?.priceDataEnabled !== false;
    const priceFor = usePriceAlertPrices({ alerts, allowCoingeckoFallback: allowFallback });

    const current = page.id ? alerts.find((alert) => alert.id === page.id) || null : null;
    // An alert deleted elsewhere (or a stale id) leaves the page it was open on.
    const view = (page.name === 'alert' || page.name === 'edit') && !current && !loading ? 'list' : page.name;

    const goBack = () => {
        setActionError(null);
        setPage((now) => (now.name === 'edit' ? { name: 'alert', id: now.id } : { name: 'list' }));
    };
    useBackHandler(view !== 'list' ? goBack : undefined, false, 'screen');

    const needle = query.trim().toLowerCase();
    const shown = useMemo(() => {
        if (!needle) return alerts;
        return alerts.filter((alert) => [
            alertTerms(alert),
            coinLabelForChain(alert.chainId),
            alert.chainId,
            statusLabel(alert),
        ].some((value) => String(value || '').toLowerCase().includes(needle)));
    }, [alerts, needle]);

    const run = async (action) => {
        setBusy(true);
        setActionError(null);
        try {
            await action();
            return true;
        } catch {
            setActionError(t('settings.priceAlerts.couldNotUpdate'));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const confirmModal = confirmDialog.request ? (
        <ConfirmModal
            {...confirmDialog.request}
            onConfirm={confirmDialog.onConfirm}
            onCancel={confirmDialog.onCancel}
        />
    ) : null;

    if (view === 'add' || (view === 'edit' && current)) {
        const editing = view === 'edit' ? current : null;
        return (
            <PriceAlertEditorPage
                editing={editing}
                onBack={goBack}
                walletId={walletId}
                fiatCurrency={fiatCurrency}
                allowCoingeckoFallback={allowFallback}
                variant={variant}
                backLabel={backLabel}
                onSave={async (input) => {
                    if (editing) {
                        await updateAlert(editing.id, input);
                        setPage({ name: 'alert', id: editing.id });
                    } else {
                        await addAlert(input);
                        setPage({ name: 'list' });
                    }
                }}
            />
        );
    }

    if (view === 'alert' && current) {
        const alert = current;
        const price = priceFor(alert);
        const watching = alert.status === 'armed' ? nowLine(alert, price) : null;
        const header = <PageHeader nested={nested} onBack={goBack} backLabel={backLabel} title={t('settings.priceAlerts.alertTitle')} />;
        return (
            <Screen variant={variant} header={header} scrollKey={`price-alert-${alert.id}`} restoreScroll={false}>
                <ListPage style={{ '--xc-section-gap': 'var(--xc-space-2)', gap: 'var(--xc-space-2)' }}>
                    {actionError ? <Status text={actionError} tone="error" /> : null}
                    <div className={styles.identity} data-identity-card="">
                        {assetMarkFor(alert)}
                        <div className={styles.identityText}>
                            <strong className={styles.identityName}>{alertTerms(alert)}</strong>
                            <span className={styles.identityMeta}>
                                {[watching, statusLabel(alert)].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                    </div>
                    <ActionsDetailsToggle
                        label={t('settings.priceAlerts.alertSections')}
                        actions={(
                            <ActionList label={t('settings.priceAlerts.alertActions')}>
                                <ActionListItem
                                    icon={<Icon.PencilIcon />}
                                    disabled={busy}
                                    title={t('settings.priceAlerts.editAlert')}
                                    description={t('settings.priceAlerts.editAlertLine')}
                                    onClick={() => { setActionError(null); setPage({ name: 'edit', id: alert.id }); }}
                                />
                                {alert.status === 'triggered' ? (
                                    <ActionListItem
                                        icon={<Icon.RefreshIcon />}
                                        disabled={busy}
                                        title={t('settings.priceAlerts.rearmAlert')}
                                        description={t('settings.priceAlerts.rearmAlertLine')}
                                        onClick={() => run(() => rearm(alert.id))}
                                    />
                                ) : alert.status === 'paused' ? (
                                    <ActionListItem
                                        icon={<Icon.PlayIcon />}
                                        disabled={busy}
                                        title={t('settings.priceAlerts.resumeAlert')}
                                        description={t('settings.priceAlerts.resumeAlertLine')}
                                        onClick={() => run(() => rearm(alert.id))}
                                    />
                                ) : (
                                    <ActionListItem
                                        icon={<Icon.PauseIcon />}
                                        disabled={busy}
                                        title={t('settings.priceAlerts.pauseAlert')}
                                        description={t('settings.priceAlerts.pauseAlertLine')}
                                        onClick={() => run(() => pause(alert.id))}
                                    />
                                )}
                                <ActionListItem
                                    icon={<Icon.TrashIcon />}
                                    disabled={busy}
                                    title={t('settings.priceAlerts.deleteAlert')}
                                    description={t('settings.priceAlerts.deleteAlertLine')}
                                    onClick={async () => {
                                        const confirmed = await confirmDialog.confirm({
                                            title: t('settings.priceAlerts.deleteConfirm'),
                                            confirmLabel: t('settings.notifications.delete'),
                                            danger: true,
                                        });
                                        if (!confirmed) return;
                                        const ok = await run(() => removeAlert(alert.id));
                                        if (ok) setPage({ name: 'list' });
                                    }}
                                />
                            </ActionList>
                        )}
                        details={(
                            <dl className={styles.detailList} aria-label={t('settings.priceAlerts.alertDetails')}>
                                {[
                                    [t('send.asset'), alertAssetTicker(alert.chainId, alert.tick)],
                                    [t('settings.network.label'), coinLabelForChain(alert.chainId)],
                                    [t('settings.priceAlerts.whenThePrice'), alert.direction === 'above' ? t('settings.priceAlerts.risesAbove') : t('settings.priceAlerts.fallsBelow')],
                                    [t('components.priceAlertForm.targetPrice'), formatThreshold(alert.targetFiat, alert.fiatCurrency)],
                                    [t('history.filters.statusHeader'), statusLabel(alert)],
                                    [t('walletDetails.created'), formatLocalDateTime(alert.createdAt)],
                                    ...(alert.triggeredAt ? [[t('settings.priceAlerts.statusFired'), formatLocalDateTime(alert.triggeredAt)]] : []),
                                ].map(([label, value]) => (
                                    <div key={label} className={styles.detailRow}>
                                        <dt className={styles.detailLabel}>{label}</dt>
                                        <dd className={styles.detailValue} title={String(value)}>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                    />
                </ListPage>
                {confirmModal}
            </Screen>
        );
    }

    const addLabel = t('settings.priceAlerts.addTitle');
    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={t('settings.priceAlerts.listTitle')}
            trailing={supported && walletId ? (
                <>
                    <ListFilterMenu
                        query={query}
                        onQueryChange={setQuery}
                        label={t('settings.priceAlerts.filter')}
                        searchPlaceholder={t('settings.priceAlerts.searchPlaceholder')}
                        searchLabel={t('settings.priceAlerts.searchLabel')}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        icon={<Icon.PlusIcon />}
                        aria-label={addLabel}
                        title={addLabel}
                        onClick={() => { setActionError(null); setPage({ name: 'add' }); }}
                    >
                        {null}
                    </Button>
                </>
            ) : null}
        />
    );

    let body;
    if (settingsLoading || (loading && alerts.length === 0)) body = <Status text={t('settings.notifications.loadingPriceAlerts')} />;
    else if (settingsError) body = <SettingsLoadError error={settingsError} />;
    else if (!walletId) {
        body = (
            <EmptyState
                title={t('settings.notifications.noWalletSelected')}
                titleAs="p"
                body={t('settings.notifications.chooseAWalletToManage')}
            />
        );
    } else if (!supported) {
        body = (
            <EmptyState
                title={t('settings.notifications.priceAlertsUnavailable')}
                titleAs="p"
                body={t('settings.notifications.priceAlertsAreNotSupported')}
            />
        );
    } else if (error) {
        body = (
            <StatusMessage variant="error" recovery={{ label: t('common.tryAgain'), onAction: reload }}>
                {t('settings.notifications.couldNotLoadPriceAlerts')}
            </StatusMessage>
        );
    } else if (alerts.length === 0) {
        body = (
            <EmptyState
                title={t('settings.notifications.noPriceAlertsYet')}
                titleAs="p"
                body={t('settings.priceAlerts.emptyHint')}
            />
        );
    } else if (shown.length === 0) {
        body = (
            <EmptyState
                title={t('settings.priceAlerts.noMatches')}
                titleAs="p"
                body={t('settings.priceAlerts.noMatchesBody', { value: query.trim() })}
            />
        );
    } else {
        body = (
            <ul className={styles.list} aria-label={t('settings.priceAlerts.listTitle')} data-price-alert-list="" data-list-card="">
                {shown.map((alert, index) => {
                    const line = alert.status === 'triggered'
                        ? (
                            <>
                                {t('settings.priceAlerts.statusFired')}
                                {alert.triggeredAt ? (
                                    <RelativeTime timestamp={alert.triggeredAt}>{(when) => ` ${when}`}</RelativeTime>
                                ) : null}
                            </>
                        )
                        : alert.status === 'paused'
                            ? t('routes.manageToken.paused')
                            : (nowLine(alert, priceFor(alert)) || t('settings.display.watchingLabel'));
                    return (
                        <li key={alert.id} data-alert-id={alert.id} data-list-divider={index > 0 ? '' : undefined}>
                            <ListRow
                                leading={assetMarkFor(alert)}
                                title={alertTerms(alert)}
                                subtitle={<span className={styles.subtitle}>{line}</span>}
                                chevron
                                aria-label={t('settings.priceAlerts.openAlert', { terms: alertTerms(alert) })}
                                onClick={() => { setActionError(null); setPage({ name: 'alert', id: alert.id }); }}
                            />
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <Screen variant={variant} header={header} scrollKey="price-alerts-list" restoreScroll={false}>
            <ListPage>{body}</ListPage>
        </Screen>
    );
}
