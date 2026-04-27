import { useMemo, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { MultisigBadge, Icon } from '@xchain-wallet/core/ui';
import { NetworkFilter } from './NetworkFilter.jsx';
import { EmptyStateNudge } from './EmptyStateNudge.jsx';
import styles from './UnifiedBalanceList.module.css';

/**
 * Single unified list of every balance across every chain. Coins first,
 * then tokens, both rendered inside one card with section labels as
 * inline dividers (rather than separate cards) so the list reads as one
 * thing. A filter chip row above the list narrows the visible chains:
 * `All` shows everything, per-chain chips (`BTC`, `LTC`, `DOGE`, etc.)
 * restrict the list to that coin family.
 *
 * @param {object} props
 * @param {import('../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {Record<string, Array<{ address: string, label: string, balances: any | null, error: string | null }>>} props.balances
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {(token: { chainId: string, asset: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string }) => void} [props.onSelectToken]
 *        Click handler for a balance row — surfaces the §27.6 Token detail page (G071) when supplied.
 */
export function UnifiedBalanceList({ chainRegistry, balances, multisig, multisigChainId, onReceive, onSelectToken }) {
    const allRows = useMemo(() => buildRows(balances, chainRegistry), [balances, chainRegistry]);

    // Active filter — 'all' or a coin family ('bitcoin'/'litecoin'/...).
    const [filter, setFilter] = useState('all');

    // Coin families that show up in the dataset, in canonical order.
    // Added chains slot in at the end automatically.
    const coinFamilies = useMemo(() => {
        const seen = new Set();
        for (const r of allRows) seen.add(coinFromChainId(r.chainId));
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    }, [allRows]);

    const visibleRows = useMemo(() => {
        if (filter === 'all') return allRows;
        return allRows.filter((r) => coinFromChainId(r.chainId) === filter);
    }, [allRows, filter]);

    const natives = visibleRows
        .filter((r) => r.kind === 'native')
        .sort(byChainOrder);
    const tokens = visibleRows
        .filter((r) => r.kind !== 'native')
        .sort((a, b) => byChainOrder(a, b) || a.asset.localeCompare(b.asset));

    if (allRows.length === 0) {
        return (
            <EmptyStateNudge
                title="No balances yet"
                body="Receive coins or tokens on any chain to populate this list."
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }

    return (
        <div className={styles.wrap}>
            <NetworkFilter
                chainRegistry={chainRegistry}
                coinFamilies={coinFamilies}
                value={filter}
                onChange={setFilter}
            />

            <div className={styles.list} role="list" aria-label="Balances">
                {natives.length > 0 ? (
                    <div className={styles.sectionLabel}>
                        Coins <span className={styles.sectionCount}>· {natives.length}</span>
                    </div>
                ) : null}
                {natives.map((r) => (
                    <BalanceRow
                        key={`${r.chainId}:${r.asset}`}
                        row={r}
                        multisig={r.chainId === multisigChainId ? multisig : null}
                        onSelect={onSelectToken}
                    />
                ))}
                {tokens.length > 0 ? (
                    <div className={styles.sectionLabel}>
                        Tokens <span className={styles.sectionCount}>· {tokens.length}</span>
                    </div>
                ) : null}
                {tokens.map((r) => (
                    <BalanceRow
                        key={`${r.chainId}:${r.asset}`}
                        row={r}
                        multisig={null}
                        onSelect={onSelectToken}
                    />
                ))}
                {natives.length === 0 && tokens.length === 0 ? (
                    <EmptyStateNudge
                        title="No balances on this network"
                        body="Switch to All in the network filter, or receive coins on this chain."
                    />
                ) : null}
            </div>
        </div>
    );
}

function BalanceRow({ row, multisig, onSelect }) {
    const isNative = row.kind === 'native';
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    // Subtitle is the ticker, with the network kind appended for
    // non-mainnet networks (testnet / regtest) so the user still
    // distinguishes them at a glance.
    const subtitle = row.networkKind !== 'mainnet'
        ? `${row.asset} · ${row.networkKind}`
        : row.asset;
    const fiat = fiatValue(row.quantity, row.divisibility, row.fiatRate);
    const clickable = typeof onSelect === 'function';
    const handleClick = clickable
        ? () => onSelect({
            chainId: row.chainId,
            asset: row.asset,
            kind: row.kind,
            displayName: row.displayName,
            divisibility: row.divisibility,
            fiatRate: row.fiatRate,
            quantity: row.quantity,
        })
        : undefined;
    const Tag = clickable ? 'button' : 'div';
    return (
        <Tag
            className={`${styles.row} ${clickable ? styles.rowClickable : ''}`}
            role="listitem"
            type={clickable ? 'button' : undefined}
            onClick={handleClick}
            aria-label={clickable
                ? `Open ${row.displayName || row.asset} details`
                : undefined}
        >
            <div className={styles.iconWrap}>
                {isNative && chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        className={styles.iconImg}
                    />
                ) : (
                    <span
                        className={styles.iconLetter}
                        style={{ background: tickerColor(row.asset), color: '#FFFFFF' }}
                        aria-hidden="true"
                    >
                        {row.asset.slice(0, 1)}
                    </span>
                )}
                {/* Chain badge overlay — only on tokens, since native rows
                    ARE the chain icon and would just repeat themselves. */}
                {!isNative && chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        title={row.chainDisplayName}
                        className={styles.chainOverlay}
                    />
                ) : null}
            </div>
            <div className={styles.body}>
                <div className={styles.title}>
                    <span className={styles.name} title={row.displayName}>
                        {row.displayName}
                    </span>
                    {multisig ? (
                        <MultisigBadge
                            threshold={multisig.threshold}
                            cosignerCount={multisig.cosignerCount}
                            scheme={multisig.scheme}
                            size="sm"
                        />
                    ) : null}
                </div>
                <div className={styles.subtitle}>{subtitle}</div>
            </div>
            <div className={styles.amounts}>
                <div className={styles.qty}>{formatAmount(row.quantity, row.divisibility)}</div>
                <div className={styles.fiat}>{formatFiat(fiat)}</div>
            </div>
        </Tag>
    );
}

/* ------------------------------------------------------------------ *
 *  Aggregation
 * ------------------------------------------------------------------ */

function buildRows(balances, chainRegistry) {
    const out = [];
    if (!balances || typeof balances !== 'object') return out;

    for (const [chainId, entries] of Object.entries(balances)) {
        if (!Array.isArray(entries)) continue;
        const descriptor = chainRegistry.get(chainId);
        if (!descriptor) continue;

        let nativeAcc = null;
        const tokenAcc = new Map();

        for (const entry of entries) {
            const b = entry.balances;
            if (!b || typeof b !== 'object') continue;

            if (b.native && b.native.quantity != null) {
                if (!nativeAcc) {
                    nativeAcc = mkRow({
                        kind: 'native',
                        chainId,
                        descriptor,
                        asset: b.native.asset || descriptor.coin.toUpperCase(),
                        displayName: b.native.displayName || descriptor.displayName,
                        divisibility: Number(b.native.divisibility ?? 8),
                        fiatRate: b.native.fiatRate,
                    });
                }
                nativeAcc.quantity += safeBigInt(b.native.quantity);
            }

            if (Array.isArray(b.assets)) {
                for (const a of b.assets) {
                    if (!a || typeof a.asset !== 'string') continue;
                    let acc = tokenAcc.get(a.asset);
                    if (!acc) {
                        acc = mkRow({
                            kind: a.kind || 'token',
                            chainId,
                            descriptor,
                            asset: a.asset,
                            displayName: a.displayName || a.asset,
                            divisibility: Number(a.divisibility ?? 8),
                            fiatRate: a.fiatRate,
                        });
                        tokenAcc.set(a.asset, acc);
                    }
                    acc.quantity += safeBigInt(a.quantity);
                }
            }
        }

        if (nativeAcc) out.push(nativeAcc);
        for (const acc of tokenAcc.values()) out.push(acc);
    }
    return out.map((r) => ({ ...r, quantity: r.quantity.toString() }));
}

function mkRow({ kind, chainId, descriptor, asset, displayName, divisibility, fiatRate }) {
    return {
        kind,
        chainId,
        chainShort: shortChainName(descriptor),
        chainDisplayName: descriptor.displayName,
        chainColor: descriptor.color,
        networkKind: descriptor.networkKind,
        asset,
        displayName,
        divisibility,
        fiatRate: typeof fiatRate === 'number' ? fiatRate : null,
        quantity: 0n,
    };
}

function shortChainName(descriptor) {
    return shortLabelForCoin(descriptor.coin);
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}

function colorForCoin(coin, chainRegistry) {
    if (!chainRegistry) return null;
    const arr = chainRegistry.byCoin(coin);
    return arr && arr[0] ? arr[0].color : null;
}

const CHAIN_ORDER = { bitcoin: 0, litecoin: 1, dogecoin: 2 };
function byChainOrder(a, b) {
    const ax = CHAIN_ORDER[coinFromChainId(a.chainId)] ?? 99;
    const bx = CHAIN_ORDER[coinFromChainId(b.chainId)] ?? 99;
    return ax - bx;
}
function coinFromChainId(id) {
    if (typeof id !== 'string') return '';
    const dash = id.indexOf('-');
    return dash > 0 ? id.slice(0, dash) : id;
}

/* ------------------------------------------------------------------ *
 *  Formatting + colour helpers
 * ------------------------------------------------------------------ */

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

/**
 * Convert (atomic-unit quantity × fiatRate) to a USD float. Splits the
 * BigInt quantity into whole + fractional parts before casting so we
 * don't blow precision on huge atomic counts.
 */
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
    if (usd === null || usd === undefined) return '';
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
