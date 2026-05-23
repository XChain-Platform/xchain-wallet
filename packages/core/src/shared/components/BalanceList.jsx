import { useMemo, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { MultisigBadge, Icon } from '@xchain-wallet/core/ui';
import { EmptyStateNudge } from './EmptyStateNudge.jsx';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import styles from './BalanceList.module.css';

/**
 * Renders a flat list of balance rows. Filtering, tab selection, and
 * sectioning live in the parent (typically `<HomeTabs>`); this is a
 * dumb renderer so each tab can reuse the same row layout against
 * its own slice of the data.
 *
 * @param {object} props
 * @param {Array<BalanceRow>} props.rows
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {string} [props.emptyTitle]                empty-state headline
 * @param {string} [props.emptyBody]                 explanatory body copy
 * @param {() => void} [props.onReceive]             when supplied, the empty-state shows a Receive CTA
 * @param {(token: { chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string }) => void} [props.onSelectToken]
 *        Click handler for a balance row — surfaces the §27.6 Token detail page (G071) when supplied.
 * @param {Set<string> | null} [props.pinnedKeys]    `chainId:tick` keys pinned by the user — pinned rows sort to the top (§27.3 / G072)
 * @param {(key: string, nextPinned: boolean) => void} [props.onTogglePin]   per-row pin/unpin callback; when supplied each row renders a star button
 * @param {Set<string> | null} [props.hiddenKeys]    `chainId:tick` keys hidden by the user — hidden rows collapse into the Hidden footer section (§27.4 / G073)
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]  per-row hide/unhide callback; when supplied, each row gains a "hide" entry in its overflow menu
 */
export function BalanceList({
    rows,
    multisig,
    multisigChainId,
    emptyTitle = 'No balances yet',
    emptyBody,
    onReceive,
    onSelectToken,
    pinnedKeys,
    onTogglePin,
    hiddenKeys,
    onToggleHide,
}) {
    const [hiddenExpanded, setHiddenExpanded] = useState(false);
    if (!rows || rows.length === 0) {
        return (
            <EmptyStateNudge
                title={emptyTitle}
                body={emptyBody}
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }
    // Stable sort: pinned rows first (preserving each section's existing
    // chain/tick order), then unpinned. Caller already sorted within each
    // group via sortByChainThenAsset.
    const visible = hiddenKeys
        ? rows.filter((r) => !hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : rows;
    const hidden = hiddenKeys
        ? rows.filter((r) => hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : [];
    const sortedRows = pinnedKeys && pinnedKeys.size > 0
        ? [
            ...visible.filter((r) => pinnedKeys.has(`${r.chainId}:${r.tick}`)),
            ...visible.filter((r) => !pinnedKeys.has(`${r.chainId}:${r.tick}`)),
        ]
        : visible;
    return (
        <div className={styles.list} role="list" aria-label="Balances">
            {sortedRows.map((r) => {
                const key = `${r.chainId}:${r.tick}`;
                const pinned = pinnedKeys ? pinnedKeys.has(key) : false;
                return (
                    <BalanceRowEl
                        key={key}
                        row={r}
                        multisig={r.chainId === multisigChainId ? multisig : null}
                        onSelect={onSelectToken}
                        pinned={pinned}
                        onTogglePin={onTogglePin}
                        hidden={false}
                        onToggleHide={onToggleHide}
                    />
                );
            })}
            {hidden.length > 0 ? (
                <>
                    <button
                        type="button"
                        className={styles.hiddenToggle}
                        onClick={() => setHiddenExpanded((v) => !v)}
                        aria-expanded={hiddenExpanded}
                    >
                        {hiddenExpanded
                            ? `Hide ${hidden.length} hidden token${hidden.length === 1 ? '' : 's'}`
                            : `Show ${hidden.length} hidden token${hidden.length === 1 ? '' : 's'}`}
                    </button>
                    {hiddenExpanded ? hidden.map((r) => {
                        const key = `${r.chainId}:${r.tick}`;
                        return (
                            <BalanceRowEl
                                key={`hidden:${key}`}
                                row={r}
                                multisig={r.chainId === multisigChainId ? multisig : null}
                                onSelect={onSelectToken}
                                pinned={false}
                                onTogglePin={onTogglePin}
                                hidden
                                onToggleHide={onToggleHide}
                            />
                        );
                    }) : null}
                </>
            ) : null}
        </div>
    );
}

function BalanceRowEl({ row, multisig, onSelect, pinned, onTogglePin, hidden, onToggleHide }) {
    const isNative = row.kind === 'native';
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    // App-wide privacy toggle — when on, replace the per-row qty and
    // fiat values with dots so navigating to / from the row leaks
    // nothing. Distinct from the per-row `hidden` prop above, which
    // controls whether this row appears in the Hidden tokens section.
    const [balancesHidden] = useBalancesHidden();
    // Network/env (mainnet/testnet/regtest) is already chosen globally
    // in Settings — repeating it on every row adds noise. Show just the
    // tick symbol; chain family is conveyed by the chain icon.
    const subtitle = row.tick;
    const fiat = useMemo(
        () => fiatValue(row.quantity, row.divisibility, row.fiatRate),
        [row.quantity, row.divisibility, row.fiatRate],
    );
    const clickable = typeof onSelect === 'function';
    const handleClick = clickable
        ? () => onSelect({
            chainId: row.chainId,
            tick: row.tick,
            kind: row.kind,
            displayName: row.displayName,
            divisibility: row.divisibility,
            fiatRate: row.fiatRate,
            quantity: row.quantity,
            imageUrl: row.imageUrl,
        })
        : undefined;
    const showPin = typeof onTogglePin === 'function';
    const pinKey = `${row.chainId}:${row.tick}`;
    const Tag = clickable ? 'button' : 'div';
    return (
        <Tag
            className={`${styles.row} ${clickable ? styles.rowClickable : ''} ${pinned ? styles.rowPinned : ''}`}
            role="listitem"
            type={clickable ? 'button' : undefined}
            onClick={handleClick}
            aria-label={clickable
                ? `Open ${row.displayName || row.tick} details`
                : undefined}
        >
            <div className={styles.iconWrap}>
                {isNative && chainIconUrl ? (
                    <img src={chainIconUrl} alt="" aria-hidden="true" className={styles.iconImg} />
                ) : row.imageUrl ? (
                    <img
                        src={row.imageUrl}
                        alt=""
                        aria-hidden="true"
                        className={styles.iconImg}
                        onError={(e) => {
                            // If the published image 404s, fall back to
                            // the letter chip by hiding the broken img;
                            // the next render still has imageUrl set, so
                            // we can't swap to <span> — just hide.
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <span
                        className={styles.iconLetter}
                        style={{ background: tickerColor(row.tick), color: '#FFFFFF' }}
                        aria-hidden="true"
                    >
                        {row.tick.slice(0, 1)}
                    </span>
                )}
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
                    <span className={styles.name} title={row.displayName}>{row.displayName}</span>
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
                <div className={styles.qty}>
                    {balancesHidden ? '•••••' : formatAmount(row.quantity, row.divisibility)}
                </div>
                <div className={styles.fiat}>
                    {balancesHidden ? '•••' : formatFiat(fiat)}
                </div>
            </div>
            {showPin ? (
                <span
                    role="button"
                    tabIndex={0}
                    className={`${styles.pinBtn} ${pinned ? styles.pinBtnActive : ''}`}
                    aria-pressed={pinned}
                    aria-label={pinned ? `Unpin ${row.tick}` : `Pin ${row.tick}`}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onTogglePin(pinKey, !pinned);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onTogglePin(pinKey, !pinned);
                        }
                    }}
                >
                    {pinned ? '★' : '☆'}
                </span>
            ) : null}
            {typeof onToggleHide === 'function' ? (
                <span
                    role="button"
                    tabIndex={0}
                    className={`${styles.hideBtn} ${hidden ? styles.hideBtnActive : ''}`}
                    aria-pressed={hidden}
                    aria-label={hidden ? `Unhide ${row.tick}` : `Hide ${row.tick}`}
                    title={hidden ? 'Unhide' : 'Hide'}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onToggleHide(pinKey, !hidden);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onToggleHide(pinKey, !hidden);
                        }
                    }}
                >
                    {hidden ? '⊕' : '⊘'}
                </span>
            ) : null}
        </Tag>
    );
}

/**
 * Heuristic for the "hide spam" affordance — flags rows that are
 * tiny / unknown-issuer / zero-balance so the UI can surface a "hide all
 * spam" sweep button. Conservative: only obvious noise. Callers pass the
 * resulting key set into `<BalanceList>` `hiddenKeys`.
 *
 * @param {Array<{chainId: string, tick: string, kind: string, quantity: string, divisibility: number, fiatRate: number | null}>} rows
 * @returns {string[]}                          `chainId:tick` keys flagged as likely spam
 */
export function detectSpamCandidates(rows) {
    const flagged = [];
    for (const r of rows || []) {
        if (!r || r.kind === 'native') continue;
        const q = safeBigInt(r.quantity);
        if (q === 0n) {
            flagged.push(`${r.chainId}:${r.tick}`);
            continue;
        }
        // Subdivisible token whose magnitude rounds to 0.0001 of a unit
        // and has no fiat price — almost always airdrop dust.
        if (r.fiatRate === null && r.divisibility > 0) {
            const div = 10n ** BigInt(r.divisibility);
            if (q < div / 10000n) flagged.push(`${r.chainId}:${r.tick}`);
        }
    }
    return flagged;
}

/* ───── Aggregation helpers exported for tab components ───── */

/**
 * Aggregates raw `balances` keyed by chainId + chain registry into
 * a flat list of `BalanceRow`s. Used by every tab so each tab gets
 * the same shape and only needs to filter.
 */
export function buildBalanceRows(balances, chainRegistry) {
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
                        tick: b.native.tick || descriptor.coin.toUpperCase(),
                        displayName: b.native.displayName || descriptor.displayName,
                        divisibility: Number(b.native.divisibility ?? 8),
                        fiatRate: b.native.fiatRate,
                    });
                }
                nativeAcc.quantity += safeBigInt(b.native.quantity);
            }

            if (Array.isArray(b.tokens)) {
                for (const a of b.tokens) {
                    if (!a || typeof a.tick !== 'string') continue;
                    let acc = tokenAcc.get(a.tick);
                    if (!acc) {
                        acc = mkRow({
                            kind: a.kind || 'token',
                            chainId,
                            descriptor,
                            tick: a.tick,
                            displayName: a.displayName || a.tick,
                            divisibility: Number(a.divisibility ?? 8),
                            fiatRate: a.fiatRate,
                            imageUrl: typeof a.imageUrl === 'string' && a.imageUrl.length > 0
                                ? a.imageUrl
                                : null,
                        });
                        tokenAcc.set(a.tick, acc);
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

function mkRow({ kind, chainId, descriptor, tick, displayName, divisibility, fiatRate, imageUrl }) {
    return {
        kind,
        chainId,
        chainShort: shortLabelForCoin(descriptor.coin),
        chainDisplayName: descriptor.displayName,
        chainColor: descriptor.color,
        networkKind: descriptor.networkKind,
        tick,
        displayName,
        divisibility,
        fiatRate: typeof fiatRate === 'number' ? fiatRate : null,
        quantity: 0n,
        imageUrl: typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null,
    };
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}

const CHAIN_ORDER = { bitcoin: 0, litecoin: 1, dogecoin: 2 };
export function sortByChainThenAsset(rows) {
    return rows.slice().sort((a, b) => {
        const ax = CHAIN_ORDER[coinFromChainId(a.chainId)] ?? 99;
        const bx = CHAIN_ORDER[coinFromChainId(b.chainId)] ?? 99;
        return (ax - bx) || a.tick.localeCompare(b.tick);
    });
}
export function coinFromChainId(id) {
    if (typeof id !== 'string') return '';
    const dash = id.indexOf('-');
    return dash > 0 ? id.slice(0, dash) : id;
}

/* ───── Formatting / colour helpers ───── */

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
    const frac = padded.slice(padded.length - divisibility);
    const out = `${groupThousands(whole)}.${frac}`;
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

/**
 * Sum the fiat value across an arbitrary list of `BalanceRow`s. Rows
 * without a `fiatRate` (no price data) are SKIPPED in the sum and
 * counted as `unpriced` so the caller can surface "X tokens not
 * priced" if it cares.
 *
 * @param {Array<{quantity: string, divisibility: number, fiatRate: number | null}>} rows
 * @returns {{ total: number, priced: number, unpriced: number }}
 */
export function sumFiatValue(rows) {
    let total = 0;
    let priced = 0;
    let unpriced = 0;
    for (const r of rows || []) {
        const v = fiatValue(r.quantity, r.divisibility, r.fiatRate);
        if (v === null) unpriced += 1;
        else { total += v; priced += 1; }
    }
    return { total, priced, unpriced };
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
export function tickerColor(tick) {
    let h = 0;
    for (let i = 0; i < tick.length; i += 1) {
        h = (h * 31 + tick.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}
