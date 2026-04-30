import { useEffect, useMemo, useState } from 'react';
import { Screen, Button, ChainBadge, Icon } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { StalenessLabel } from '../components/StalenessLabel.jsx';
import styles from './TokenDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * §27.6 token detail page (G071).
 *
 * Single-token view that aggregates everything we know about one
 * (chainId, asset) pair from the data surfaces the wallet already
 * exposes: the row metadata threaded in from the unified balance list,
 * `messaging.getHoldersForToken` for the distribution panel, and the
 * existing History route as the "View activity" target (pre-filtered
 * by tick via History's `initialSearchQuery` prop).
 *
 * Phase-3 features named in the spec — Sell on DEX, Market view, supply
 * chart over time — and the richer asset metadata (description, creator
 * with identicon, issuance date, lock status, reputation) require host
 * messaging methods that don't exist yet (`getAssetInfo`,
 * `getSupplyHistory`); they're tracked in FOLLOWUPS.md under §27.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.asset                       ticker (uppercase canonical)
 * @param {'native' | 'token' | 'subtoken' | string} [props.kind]
 * @param {string} [props.displayName]               human-readable name (defaults to ticker)
 * @param {number} [props.divisibility]
 * @param {number | null} [props.fiatRate]           USD per token if known
 * @param {string} [props.quantity]                  atomic-unit balance string
 * @param {() => void} props.onBack
 * @param {() => void} [props.onSend]                navigate to Send route
 * @param {() => void} [props.onReceive]             navigate to Receive route
 * @param {() => void} [props.onViewActivity]        navigate to History pre-filtered to this asset
 */
export function TokenDetail({
    walletId,
    chainId,
    asset,
    kind = 'token',
    displayName,
    divisibility = 8,
    fiatRate = null,
    quantity = '0',
    onBack,
    onSend,
    onReceive,
    onViewActivity,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const descriptor = chainRegistry.get(chainId);
    const isNative = kind === 'native';

    const [holdersOpen, setHoldersOpen] = useState(false);
    const [holders, setHolders] = useState(/** @type {any[] | null} */ (null));
    const [holdersError, setHoldersError] = useState(/** @type {string | null} */ (null));
    const [holdersLoading, setHoldersLoading] = useState(false);
    // Cluster G FOLLOWUP 5 — Unix ms of the last holders fetch; drives a
    // staleness label inside the holders panel so the user can tell at
    // a glance whether the listing is live.
    const [holdersFetchedAt, setHoldersFetchedAt] = useState(
        /** @type {number | null} */ (null),
    );

    useEffect(() => {
        if (!holdersOpen || holders !== null || isNative) return undefined;
        if (typeof messaging.getHoldersForToken !== 'function') {
            setHoldersError('Holders lookup is not available in this build.');
            return undefined;
        }
        let cancelled = false;
        setHoldersLoading(true);
        setHoldersError(null);
        messaging.getHoldersForToken({ chainId, tick: asset })
            .then((resp) => {
                if (cancelled) return;
                const list = Array.isArray(resp) ? resp
                    : Array.isArray(resp?.data) ? resp.data
                    : Array.isArray(resp?.rows) ? resp.rows
                    : [];
                setHolders(list);
                setHoldersFetchedAt(Date.now());
            })
            .catch((err) => {
                if (cancelled) return;
                setHoldersError(err?.message || 'Failed to load holders.');
            })
            .finally(() => { if (!cancelled) setHoldersLoading(false); });
        return () => { cancelled = true; };
    }, [holdersOpen, holders, isNative, asset, chainId, messaging]);

    const fiat = useMemo(() => {
        if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
        return fiatValue(quantity, divisibility, fiatRate);
    }, [quantity, divisibility, fiatRate]);

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back"
            >
                <Icon.BackIcon />
            </button>
            <span className={styles.title}>{displayName || asset}</span>
            <span className={styles.spacer} />
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={styles.body}>
                <section className={styles.heroCard}>
                    <div className={styles.iconRow}>
                        <span
                            className={styles.iconLetter}
                            style={{ background: tickerColor(asset) }}
                            aria-hidden="true"
                        >
                            {asset.slice(0, 1)}
                        </span>
                        <div className={styles.heroText}>
                            <div className={styles.heroName}>{displayName || asset}</div>
                            <div className={styles.heroSub}>
                                <span className={styles.ticker}>{asset}</span>
                                {descriptor ? (
                                    <ChainBadge descriptor={descriptor} size="sm" />
                                ) : null}
                                {descriptor?.networkKind && descriptor.networkKind !== 'mainnet' ? (
                                    <span className={styles.network}>{descriptor.networkKind}</span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className={styles.balanceBlock}>
                        <div className={styles.balanceLabel}>Your balance</div>
                        <div className={styles.balanceQty}>
                            {formatAmount(quantity, divisibility)} {asset}
                        </div>
                        <div className={styles.balanceFiat}>
                            {fiat == null ? '—' : formatFiat(fiat)}
                        </div>
                    </div>
                </section>

                <section className={styles.metadataCard}>
                    <h3 className={styles.sectionTitle}>Metadata</h3>
                    <dl className={styles.metaList}>
                        <div className={styles.metaRow}>
                            <dt>Type</dt>
                            <dd>{kindLabel(kind)}</dd>
                        </div>
                        <div className={styles.metaRow}>
                            <dt>Ticker</dt>
                            <dd>{asset}</dd>
                        </div>
                        <div className={styles.metaRow}>
                            <dt>Divisibility</dt>
                            <dd>{divisibility}</dd>
                        </div>
                        <div className={styles.metaRow}>
                            <dt>Chain</dt>
                            <dd>{descriptor?.displayName || chainId}</dd>
                        </div>
                        <div className={styles.metaRow}>
                            <dt>Fiat rate</dt>
                            <dd>{fiatRate == null ? '—' : `$${fiatRate.toFixed(6)} / ${asset}`}</dd>
                        </div>
                    </dl>
                    <p className={styles.metadataHint}>
                        Description, creator, issuance date, supply history, and lock
                        status require additional explorer endpoints — coming next.
                    </p>
                </section>

                <section className={styles.actionsCard}>
                    <h3 className={styles.sectionTitle}>Actions</h3>
                    <div className={styles.actionsRow}>
                        <Button
                            type="button"
                            variant="primary"
                            disabled={!onSend}
                            onClick={onSend}
                        >
                            Send
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={!onReceive}
                            onClick={onReceive}
                        >
                            Receive
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={!onViewActivity}
                            onClick={onViewActivity}
                        >
                            View activity
                        </Button>
                    </div>
                </section>

                {!isNative ? (
                    <section className={styles.holdersCard}>
                        <button
                            type="button"
                            className={styles.holdersToggle}
                            onClick={() => setHoldersOpen((v) => !v)}
                            aria-expanded={holdersOpen}
                            aria-controls="token-holders-panel"
                        >
                            <h3 className={styles.sectionTitleInline}>Holders</h3>
                            <span className={styles.holdersChevron} aria-hidden="true">
                                {holdersOpen ? '▾' : '▸'}
                            </span>
                        </button>
                        {holdersOpen ? (
                            <div id="token-holders-panel" className={styles.holdersBody}>
                                {holdersFetchedAt && !holdersLoading && !holdersError ? (
                                    <div className={styles.holdersStaleness}>
                                        <StalenessLabel
                                            lastSyncedAt={holdersFetchedAt}
                                            warnAfterMs={10 * 60_000}
                                        />
                                    </div>
                                ) : null}
                                {holdersLoading ? (
                                    <p className={styles.muted}>Loading holders…</p>
                                ) : holdersError ? (
                                    <p role="alert" className={styles.error}>{holdersError}</p>
                                ) : holders && holders.length > 0 ? (
                                    <ol className={styles.holdersList}>
                                        {holders.slice(0, 25).map((h, i) => (
                                            <li key={`${h.address || ''}:${i}`} className={styles.holdersRow}>
                                                <span className={styles.holdersAddr}>
                                                    {shorten(h.address || h.ADDRESS || '—')}
                                                </span>
                                                <span className={styles.holdersQty}>
                                                    {formatAmount(
                                                        String(h.quantity ?? h.QUANTITY ?? '0'),
                                                        divisibility,
                                                    )}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <p className={styles.muted}>No holders reported.</p>
                                )}
                            </div>
                        ) : null}
                    </section>
                ) : null}
            </div>
        </Screen>
    );
}

function kindLabel(kind) {
    if (kind === 'native') return 'Native coin';
    if (kind === 'subtoken') return 'Sub-token';
    return 'Token';
}

function shorten(addr) {
    if (!addr || addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function safeBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') {
        const t = v.trim();
        if (!/^-?\d+$/.test(t)) return 0n;
        return BigInt(t);
    }
    return 0n;
}

function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) return groupThousands(q);
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    let frac = padded.slice(padded.length - divisibility);
    frac = frac.replace(/0+$/, '');
    const out = frac ? `${groupThousands(whole)}.${frac}` : groupThousands(whole);
    return negative ? `-${out}` : out;
}

function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fiatValue(quantityStr, divisibility, fiatRate) {
    if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
    const q = safeBigInt(quantityStr);
    if (q === 0n) return 0;
    if (!divisibility || divisibility <= 0) return Number(q) * fiatRate;
    const div = 10n ** BigInt(divisibility);
    const whole = Number(q / div);
    const frac = Number(q % div) / Number(div);
    return (whole + frac) * fiatRate;
}

function formatFiat(usd) {
    if (usd === null || usd === undefined) return '—';
    if (usd === 0) return '$0.00';
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return '$' + usd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

const PALETTE = [
    '#1E90C7', '#7B2C8F', '#0EA5E9', '#10B981', '#F59E0B',
    '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
    '#6366F1', '#84CC16', '#06B6D4', '#A855F7', '#F43F5E',
];
function tickerColor(asset) {
    let h = 0;
    for (let i = 0; i < asset.length; i += 1) {
        h = (h * 31 + asset.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}
