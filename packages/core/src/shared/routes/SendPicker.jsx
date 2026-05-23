import { useEffect, useMemo, useState } from 'react';
import { Screen, ScreenHeader, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib, flows as flowsLib } from '@xchain-wallet/core';
import {
    BalanceList,
    buildBalanceRows,
    sortByChainThenAsset,
    coinFromChainId,
} from '../components/BalanceList.jsx';
import { HeaderNetworkButton } from '../components/HeaderNetworkButton.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './SendPicker.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Send picker — landing screen for the Send quick-action. Renders a flat
 * scrollable list of every spendable balance the active wallet/account
 * holds (native coins + tokens + NFTs combined, same row layout as the
 * Home Coins/Tokens tabs). Selecting a row hands {chainId, tick} to the
 * host so the Send form opens with that asset pre-populated.
 *
 * The header hosts the same combined filter button used on Home — a
 * network picker (limit the list to one chain family) plus a free-text
 * search over tick / display name. Hidden tokens (§27.4 / G073) are
 * excluded; pinned tokens (§27.3 / G072) sort to the top.
 *
 * `networkFilter` / `tokenQuery` follow the parent-vs-local pattern from
 * Home: when the shell passes controlled props, the picker stays in
 * sync with the global filter; when it doesn't, the picker owns its
 * own state so changes here don't leak back.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.accountId]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]
 * @param {string} [props.tokenQuery]
 * @param {(query: string) => void} [props.onTokenQueryChange]
 * @param {'all' | 'coins' | 'tokens'} [props.kindFilter]
 * @param {(kind: 'all' | 'coins' | 'tokens') => void} [props.onKindFilterChange]
 * @param {boolean} [props.hideOwnFilter]  when true, suppress the picker's local filter button (e.g. when the shell's AppHeader already renders the global filter on this route)
 * @param {() => void} [props.onBack]
 * @param {(sel: { chainId: string, tick: string, kind?: string, displayName?: string, imageUrl?: string | null }) => void} props.onSelect
 */
export function SendPicker({
    walletId,
    accountId,
    networkFilter: networkFilterProp,
    onNetworkFilterChange: onNetworkFilterChangeProp,
    tokenQuery: tokenQueryProp,
    onTokenQueryChange: onTokenQueryChangeProp,
    kindFilter: kindFilterProp,
    onKindFilterChange: onKindFilterChangeProp,
    hideOwnFilter = false,
    onBack,
    onSelect,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [networkFilterLocal, setNetworkFilterLocal] = useState('all');
    const networkFilter = networkFilterProp ?? networkFilterLocal;
    const setNetworkFilter = onNetworkFilterChangeProp ?? setNetworkFilterLocal;

    const [tokenQueryLocal, setTokenQueryLocal] = useState('');
    const tokenQuery = tokenQueryProp ?? tokenQueryLocal;
    const setTokenQuery = onTokenQueryChangeProp ?? setTokenQueryLocal;

    const [kindFilterLocal, setKindFilterLocal] = useState(/** @type {'all' | 'coins' | 'tokens'} */ ('all'));
    const kindFilter = kindFilterProp ?? kindFilterLocal;
    const setKindFilter = onKindFilterChangeProp ?? setKindFilterLocal;

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        messaging.getSettings()
            .then((s) => {
                if (cancelled) return;
                const hides = Array.isArray(s?.hiddenTokens)
                    ? s.hiddenTokens.filter((k) => typeof k === 'string')
                    : [];
                const pins = Array.isArray(s?.pinnedTokens)
                    ? s.pinnedTokens.filter((k) => typeof k === 'string')
                    : [];
                setHiddenTokens(hides);
                setPinnedTokens(pins);
            })
            .catch(() => { /* empty hide/pin lists are fine defaults */ });
        return () => { cancelled = true; };
    }, [messaging]);

    useEffect(() => {
        if (!walletId) return undefined;
        let cancelled = false;
        setBalances(null);
        setLoadError(null);
        (async () => {
            try {
                let b;
                if (flowsLib.isDemoWallet(walletId)
                    && typeof messaging.getAddressesByChain === 'function') {
                    const byChain = await messaging.getAddressesByChain(walletId, accountId);
                    b = flowsLib.synthesizeDemoBalances(byChain);
                } else {
                    b = await messaging.getWalletBalances(walletId, accountId);
                }
                if (!cancelled) setBalances(b);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load balances.');
            }
        })();
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging]);

    const allRows = useMemo(
        () => buildBalanceRows(balances, chainRegistry),
        [balances],
    );

    const coinFamilies = useMemo(() => {
        const seen = new Set();
        for (const r of allRows) {
            const coin = coinFromChainId(r.chainId);
            if (coin) seen.add(coin);
        }
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    }, [allRows]);

    const tokenQueryTrim = tokenQuery.trim().toLowerCase();
    const rows = useMemo(() => {
        let next = allRows;
        if (networkFilter !== 'all') {
            next = next.filter((r) => coinFromChainId(r.chainId) === networkFilter);
        }
        if (kindFilter === 'coins') {
            next = next.filter((r) => r.kind === 'native');
        } else if (kindFilter === 'tokens') {
            next = next.filter((r) => r.kind !== 'native');
        }
        if (tokenQueryTrim) {
            next = next.filter((r) => {
                const tick = String(r.tick || '').toLowerCase();
                const name = String(r.displayName || '').toLowerCase();
                return tick.includes(tokenQueryTrim) || name.includes(tokenQueryTrim);
            });
        }
        return sortByChainThenAsset(next);
    }, [allRows, networkFilter, kindFilter, tokenQueryTrim]);

    const hiddenSet = useMemo(() => new Set(hiddenTokens), [hiddenTokens]);
    const pinnedSet = useMemo(() => new Set(pinnedTokens), [pinnedTokens]);

    const filterButton = !hideOwnFilter ? (
        <HeaderNetworkButton
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={networkFilter}
            onNetworkFilterChange={setNetworkFilter}
            tokenQuery={tokenQuery}
            onTokenQueryChange={setTokenQuery}
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
        />
    ) : null;

    const header = (
        <ScreenHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Send"
            titleIcon={<Icon.SendIcon />}
            trailing={filterButton}
        />
    );

    const emptyTitle = tokenQueryTrim
        ? 'No matching balances'
        : (networkFilter === 'all'
            ? 'Nothing to send yet'
            : 'No balances on this network');
    const emptyBody = tokenQueryTrim
        ? `Nothing matches "${tokenQuery.trim()}". Clear the filter to see everything.`
        : (networkFilter === 'all'
            ? 'Receive coins or tokens first, then come back to send them.'
            : undefined);

    const body = (
        <>
            {loadError ? (
                <div role="alert" className={styles.error}>{loadError}</div>
            ) : null}
            {balances === null && !loadError ? (
                <div role="status" aria-label="Loading balances">
                    <Skeleton.List rows={5} />
                </div>
            ) : null}
            {balances ? (
                <BalanceList
                    rows={rows}
                    emptyTitle={emptyTitle}
                    emptyBody={emptyBody}
                    onSelectToken={(tok) => onSelect?.({
                        chainId: tok.chainId,
                        tick: tok.tick,
                        kind: tok.kind,
                        displayName: tok.displayName,
                        imageUrl: tok.imageUrl,
                    })}
                    hiddenKeys={hiddenSet}
                    pinnedKeys={pinnedSet}
                />
            ) : null}
        </>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{body}</div> : body}
        </Screen>
    );
}
