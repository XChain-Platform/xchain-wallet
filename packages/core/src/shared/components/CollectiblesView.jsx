import { useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { Icon } from '@xchain-wallet/core/ui';
import { EmptyStateNudge } from './EmptyStateNudge.jsx';
import { useAssetInfo } from '../hooks/useAssetInfo.js';
import styles from './CollectiblesView.module.css';

/**
 * §27.5 / G074 — Collectibles view. Renders an NFT-shaped grid (large
 * square thumbnails) instead of the row layout used for fungible
 * balances. Each card shows the asset image when one is available and
 * falls back to a colored ticker-letter placeholder; tapping a card
 * surfaces the §27.6 token detail page via `onSelectToken` (the same
 * payload `<BalanceList>` emits, so the consuming router doesn't change).
 *
 * Image URLs come from two paths: row-payload `imageUrl` (when the
 * caller already has one) takes precedence, and `<CollectibleCard>`
 * falls back to fetching `messaging.getAssetInfo` per-card via the
 * shared `useAssetInfo` hook (Cluster I FOLLOWUP 3 / Cluster C
 * FOLLOWUP 3). The hook's module-level cache means revisits don't
 * re-fetch, and a missing / failing image leaves the ticker-letter
 * placeholder in place.
 *
 * @param {object} props
 * @param {Array<{chainId: string, asset: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string, imageUrl?: string | null}>} props.rows
 * @param {string} [props.emptyTitle]
 * @param {string} [props.emptyBody]
 * @param {() => void} [props.onReceive]
 * @param {(token: object) => void} [props.onSelectToken]
 * @param {Set<string> | null} [props.pinnedKeys]
 * @param {(key: string, nextPinned: boolean) => void} [props.onTogglePin]
 * @param {Set<string> | null} [props.hiddenKeys]
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]
 */
export function CollectiblesView({
    rows,
    emptyTitle = 'No collectibles yet',
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

    const visible = hiddenKeys
        ? rows.filter((r) => !hiddenKeys.has(`${r.chainId}:${r.asset}`))
        : rows;
    const hidden = hiddenKeys
        ? rows.filter((r) => hiddenKeys.has(`${r.chainId}:${r.asset}`))
        : [];
    const sortedRows = pinnedKeys && pinnedKeys.size > 0
        ? [
            ...visible.filter((r) => pinnedKeys.has(`${r.chainId}:${r.asset}`)),
            ...visible.filter((r) => !pinnedKeys.has(`${r.chainId}:${r.asset}`)),
        ]
        : visible;

    return (
        <div className={styles.wrap}>
            <div className={styles.grid} role="list" aria-label="Collectibles">
                {sortedRows.map((r) => (
                    <CollectibleCard
                        key={`${r.chainId}:${r.asset}`}
                        row={r}
                        pinned={pinnedKeys ? pinnedKeys.has(`${r.chainId}:${r.asset}`) : false}
                        hidden={false}
                        onSelect={onSelectToken}
                        onTogglePin={onTogglePin}
                        onToggleHide={onToggleHide}
                    />
                ))}
            </div>
            {hidden.length > 0 ? (
                <button
                    type="button"
                    className={styles.hiddenToggle}
                    onClick={() => setHiddenExpanded((v) => !v)}
                    aria-expanded={hiddenExpanded}
                >
                    {hiddenExpanded
                        ? `Hide ${hidden.length} hidden collectible${hidden.length === 1 ? '' : 's'}`
                        : `Show ${hidden.length} hidden collectible${hidden.length === 1 ? '' : 's'}`}
                </button>
            ) : null}
            {hidden.length > 0 && hiddenExpanded ? (
                <div className={styles.grid}>
                    {hidden.map((r) => (
                        <CollectibleCard
                            key={`hidden:${r.chainId}:${r.asset}`}
                            row={r}
                            pinned={false}
                            hidden
                            onSelect={onSelectToken}
                            onTogglePin={onTogglePin}
                            onToggleHide={onToggleHide}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function CollectibleCard({ row, pinned, hidden, onSelect, onTogglePin, onToggleHide }) {
    const [imgFailed, setImgFailed] = useState(false);
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    // Cluster I FOLLOWUP 3 — fetch asset metadata to surface a real image
    // when the row payload doesn't already carry one. `useAssetInfo`'s
    // module-level cache means revisits don't re-fetch, and silent
    // failure leaves the ticker-letter placeholder in place.
    const assetInfo = useAssetInfo({
        chainId: row.chainId,
        asset: row.asset,
        skip: row.kind === 'native' || hidden,
    });
    const fallbackImageUrl = assetInfo && typeof assetInfo.imageUrl === 'string'
        && assetInfo.imageUrl.length > 0
        ? assetInfo.imageUrl
        : null;
    const effectiveImageUrl = (typeof row.imageUrl === 'string' && row.imageUrl.length > 0)
        ? row.imageUrl
        : fallbackImageUrl;
    const showImage = typeof effectiveImageUrl === 'string'
        && effectiveImageUrl.length > 0
        && !imgFailed;
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
    const key = `${row.chainId}:${row.asset}`;
    return (
        <Tag
            className={`${styles.card} ${clickable ? styles.cardClickable : ''} ${pinned ? styles.cardPinned : ''} ${hidden ? styles.cardHidden : ''}`}
            type={clickable ? 'button' : undefined}
            role="listitem"
            onClick={handleClick}
            aria-label={clickable
                ? `Open ${row.displayName || row.asset} details`
                : undefined}
        >
            <div className={styles.thumb}>
                {showImage ? (
                    <img
                        src={effectiveImageUrl}
                        alt=""
                        aria-hidden="true"
                        className={styles.thumbImg}
                        onError={() => setImgFailed(true)}
                    />
                ) : (
                    <span
                        className={styles.thumbLetter}
                        style={{ background: tickerColor(row.asset) }}
                        aria-hidden="true"
                    >
                        {row.asset.slice(0, 2)}
                    </span>
                )}
                {chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        title={row.chainDisplayName}
                        className={styles.chainOverlay}
                    />
                ) : null}
                {typeof onTogglePin === 'function' ? (
                    <span
                        role="button"
                        tabIndex={0}
                        className={`${styles.pinBtn} ${pinned ? styles.pinBtnActive : ''}`}
                        aria-pressed={pinned}
                        aria-label={pinned ? `Unpin ${row.asset}` : `Pin ${row.asset}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onTogglePin(key, !pinned);
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
                        aria-label={hidden ? `Unhide ${row.asset}` : `Hide ${row.asset}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onToggleHide(key, !hidden);
                        }}
                    >
                        {hidden ? '⊕' : '⊘'}
                    </span>
                ) : null}
            </div>
            <div className={styles.meta}>
                <div className={styles.name} title={row.displayName}>{row.displayName}</div>
                <div className={styles.subtitle}>{row.asset}</div>
            </div>
        </Tag>
    );
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
