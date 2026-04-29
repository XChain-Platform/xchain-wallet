import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, Button, Icon, Skeleton } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useAutoLock } from '../hooks/useAutoLock.js';
import { useSettings } from '../hooks/useSettings.js';
import { HomeTabs } from '../components/HomeTabs.jsx';
import { buildBalanceRows, detectSpamCandidates } from '../components/BalanceList.jsx';
import { useToast } from '../components/ToastHost.jsx';
import { BackupReminderCard } from '../components/BackupReminderCard.jsx';
import { DemoBanner } from '../components/DemoBanner.jsx';
import { HeaderActionMenu } from '../components/HeaderActionMenu.jsx';
import { HeaderSettingsButton } from '../components/HeaderSettingsButton.jsx';
import { HeaderNetworkButton } from '../components/HeaderNetworkButton.jsx';
import { AlertsOverlay } from '../components/AlertsOverlay.jsx';
import { Settings } from './Settings.jsx';
import { WALLET_MODE_DEFAULT } from '../../schemas/settings.js';
import styles from './Home.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Home screen — landing view for an unlocked wallet. Header shows the
 * wallet name + Lock button; body renders a per-chain balance card
 * grid; footer exposes Send / Receive / Create-a-token action buttons.
 *
 * When the wallet has pending §40.9 airdrops (LIST signed but AIRDROP
 * still pending, either waiting for the LIST to be indexed or ready
 * to sign), Home surfaces a resume card above the balance grid so the
 * user can pick up where they left off.
 *
 * Auto-lock is foreground-only and enabled for the popup + web shells.
 * Web was opted out historically on the assumption that tab-close
 * implicitly locks; in practice users leave the tab open for hours, and
 * a backgrounded tab still benefits from idle timeout. Desktop manages
 * its own OS-keychain-backed lock cadence and stays opted out here.
 * See `useAutoLock` for the foreground-only scope limitation.
 *
 * @param {object} props
 * @param {() => void} [props.onLocked]        refresh upstream state machine
 * @param {() => void} [props.onSend]          navigate to Send sub-route
 * @param {() => void} [props.onReceive]       navigate to Receive sub-route
 * @param {() => void} [props.onSwap]          navigate to SwapForm sub-route — quick action #3
 * @param {() => void} [props.onBuy]           navigate to a buy flow (DispenserExplorer or fiat ramp) — quick action #4
 * @param {() => void} [props.onCreateToken]   navigate to Token Wizard sub-route (§40.1)
 * @param {() => void} [props.onActions]       navigate to the Actions menu (§40.2+)
 * @param {() => void} [props.onMarkets]       navigate to the Markets list (§41.2)
 * @param {(id: string) => void} [props.onResumeAirdrop]  navigate to AirdropForm with a pending id
 * @param {(ref: { chainId: string, address: string, orderMatchActionIndex: string }) => void} [props.onResumeCoinpay]  navigate to CoinpayForm with a pending obligation (§41.4)
 * @param {() => void} [props.onMessaging]     navigate to the Messaging inbox (§41.7.2)
 * @param {() => void} [props.onContracts]     navigate to the Contracts list (§42.2) — BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onStaking]       navigate to the Staking dashboard (§42.7.4) — BTC-only, App.jsx gates the prop
 * @param {() => void} [props.onHistory]       navigate to the History route (§23 + §23.5 cross-chain threading)
 * @param {() => void} [props.onSignPsbt]      navigate to the PSBT-sign route (§30.4) — surfaced as the marquee CTA when `settings.walletMode === 'signer'` (§20 / G041)
 * @param {() => void} [props.onSignMessage]   navigate to the user-initiated message-sign route (§17.4)
 * @param {() => void} [props.onVerifySignature]   navigate to the signature-verify route (§17.5)
 * @param {() => void} [props.onMigrateToBip39]           navigate to the §40.13 migration wizard when the active wallet is counterwallet-legacy
 * @param {() => void} [props.onOpenWalletPicker]         Settings row → host navigates to the WalletPicker route
 * @param {() => void} [props.onOpenAccountPicker]        Settings row → host navigates to the AccountPicker route
 * @param {string | null} [props.activeAccountId]          App-level active BIP44 account; when supplied, Home is read-only with respect to account selection
 * @param {(accountId: string) => void} [props.onSwitchAccount]   App-level setter for the active account (still used internally if a future inline picker lands)
 * @param {Array<{ id: string, label: string, description?: string, onSelect?: () => void }>} [props.extraActions]   §40+ entries surfaced in the small-mode pancake drawer; in full mode the host renders these via the dedicated ActionsMenu route
 */
export function Home({ onLocked, onSend, onReceive, onSwap, onBuy, onCreateToken, onActions, onMarkets, onResumeAirdrop, onResumeCoinpay, onMessaging, onContracts, onStaking, onHistory, onAddresses, onMigrateToBip39, onOpenWalletPicker, onOpenAccountPicker, onCrossChain, onContacts, onMultisig, onSignPsbt, onSignMessage, onVerifySignature, activeAccountId: activeAccountIdProp, onSwitchAccount, extraActions, onSelectToken }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [accounts, setAccounts] = useState(/** @type {any[] | null} */ (null));
    // Local fallback used only when the host doesn't supply
    // `activeAccountIdProp` (e.g. desktop shell pinned to an older
    // App.jsx). When the prop is set, Home is read-only and the
    // popover delegates switching to `onSwitchAccount`.
    const [activeAccountIdLocal, setActiveAccountIdLocal] = useState(
        /** @type {string | null} */ (null),
    );
    const activeAccountId = activeAccountIdProp ?? activeAccountIdLocal;
    const setActiveAccountId = onSwitchAccount ?? setActiveAccountIdLocal;
    const [balances, setBalances] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [pendingAirdrops, setPendingAirdrops] = useState(
        /** @type {any[]} */ ([]),
    );
    const [pendingCoinpays, setPendingCoinpays] = useState(
        /** @type {any[]} */ ([]),
    );
    const [multisig, setMultisig] = useState(
        /** @type {{ threshold: number, cosignerCount: number, scheme: string } | null} */ (null),
    );
    const [loadError, setLoadError] = useState(
        /** @type {string | null} */ (null),
    );
    const [locking, setLocking] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [alertsOpen, setAlertsOpen] = useState(false);
    const [networkFilter, setNetworkFilter] = useState('all');
    const [settingsOpen, setSettingsOpen] = useState(false);
    // §27.3 / G072 — pinned tokens. Loaded from Settings on unlock; toggled
    // optimistically in the UI then persisted via messaging.updateSettings.
    const [pinnedTokens, setPinnedTokens] = useState(/** @type {string[]} */ ([]));
    // §27.4 / G073 — hidden tokens. Same pattern as pinned. Hidden rows
    // collapse into the "Show N hidden tokens" footer of each tab.
    const [hiddenTokens, setHiddenTokens] = useState(/** @type {string[]} */ ([]));
    const { showToast } = useToast();
    // Cluster I FOLLOWUP 2 — auto-hide-spam toast. We only ever nudge
    // once per (wallet, mount) tuple. Re-prompting on every balance
    // refresh would be noisy; the user explicitly opting Hide / dismissing
    // the toast counts as "they decided" for the rest of the session.
    const spamNudgedForWalletRef = useRef(/** @type {string | null} */ (null));

    // §27.3 + §27.4 / G072 + G073 — load pinnedTokens + hiddenTokens from Settings on mount.
    useEffect(() => {
        let cancelled = false;
        if (typeof messaging?.getSettings !== 'function') return undefined;
        messaging.getSettings().then((s) => {
            if (cancelled) return;
            const pins = Array.isArray(s?.pinnedTokens) ? s.pinnedTokens.filter((k) => typeof k === 'string') : [];
            const hides = Array.isArray(s?.hiddenTokens) ? s.hiddenTokens.filter((k) => typeof k === 'string') : [];
            setPinnedTokens(pins);
            setHiddenTokens(hides);
        }).catch(() => { /* tolerate — empty pin list is a fine default */ });
        return () => { cancelled = true; };
    }, [messaging]);

    const handleTogglePin = useCallback((key, nextPinned) => {
        if (typeof key !== 'string' || !key) return;
        setPinnedTokens((prev) => {
            const set = new Set(prev);
            if (nextPinned) set.add(key);
            else set.delete(key);
            const next = Array.from(set);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings({ pinnedTokens: next }).catch(() => { /* best-effort */ });
            }
            return next;
        });
    }, [messaging]);

    const handleToggleHide = useCallback((key, nextHidden) => {
        if (typeof key !== 'string' || !key) return;
        setHiddenTokens((prev) => {
            const set = new Set(prev);
            if (nextHidden) set.add(key);
            else set.delete(key);
            const next = Array.from(set);
            if (typeof messaging?.updateSettings === 'function') {
                messaging.updateSettings({ hiddenTokens: next }).catch(() => { /* best-effort */ });
            }
            return next;
        });
    }, [messaging]);

    // Cluster I FOLLOWUP 2 — auto-hide-spam nudge. After the first
    // balance load that yields candidate spam rows, surface a one-shot
    // toast with a Hide-all action. The candidate set excludes anything
    // the user already hid; if it's empty after that filter, we say
    // nothing. Nudge fires at most once per (wallet, mount) tuple so a
    // mid-session rebalance doesn't re-prompt.
    useEffect(() => {
        if (!balances || !activeWalletId) return;
        if (spamNudgedForWalletRef.current === activeWalletId) return;
        const rows = buildBalanceRows(balances, chainRegistry);
        const candidates = detectSpamCandidates(rows);
        const hiddenSet = new Set(hiddenTokens);
        const fresh = candidates.filter((k) => !hiddenSet.has(k));
        if (fresh.length === 0) return;
        spamNudgedForWalletRef.current = activeWalletId;
        showToast({
            message: `${fresh.length} likely-spam token${fresh.length === 1 ? '' : 's'} detected — bulk-hide?`,
            actionLabel: `Hide ${fresh.length}`,
            durationMs: 12000,
            onAction: () => {
                setHiddenTokens((prev) => {
                    const merged = Array.from(new Set([...prev, ...fresh]));
                    if (typeof messaging?.updateSettings === 'function') {
                        messaging.updateSettings({ hiddenTokens: merged }).catch(() => { /* best-effort */ });
                    }
                    return merged;
                });
            },
        });
    }, [balances, activeWalletId, hiddenTokens, messaging, showToast]);

    // Load the wallets list once. The user picks the active one via
    // HeaderSettingsButton → onSwitchWallet → setActiveWalletId →
    // the per-wallet effect below refetches everything.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await messaging.listWallets();
                if (cancelled) return;
                setWallets(list);
                if (!Array.isArray(list) || list.length === 0) {
                    setLoadError('No wallets found.');
                    return;
                }
                if (!activeWalletId) setActiveWalletId(list[0].id);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallets.');
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messaging]);

    // Load BIP44 accounts for the active wallet so the gear popover can
    // render them. When the host owns `activeAccountId` (App-level), it
    // also picks the initial account; this effect only updates Home's
    // local fallback to keep the popover usable in shells that don't
    // wire the prop.
    useEffect(() => {
        if (!activeWalletId) {
            setAccounts(null);
            if (!onSwitchAccount) setActiveAccountIdLocal(null);
            return undefined;
        }
        if (typeof messaging.listAccounts !== 'function') {
            setAccounts([]);
            if (!onSwitchAccount) setActiveAccountIdLocal(null);
            return undefined;
        }
        let cancelled = false;
        const walletId = activeWalletId;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                const sorted = Array.isArray(list)
                    ? [...list].sort((a, b) => a.index - b.index)
                    : [];
                setAccounts(sorted);
                if (!onSwitchAccount) {
                    setActiveAccountIdLocal((prev) => {
                        if (prev && sorted.some((a) => a.id === prev)) return prev;
                        return sorted[0]?.id || null;
                    });
                }
            })
            .catch(() => {
                if (cancelled) return;
                setAccounts([]);
                if (!onSwitchAccount) setActiveAccountIdLocal(null);
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWalletId, messaging]);

    // Per-wallet load: balances, multisig indicator, pending airdrops,
    // pending COINPAY obligations. Reruns when the active wallet OR
    // active BIP44 account changes — switching either flushes stale
    // state and refetches. When `activeAccountId` is null (data layer
    // returned no accounts for this wallet, or pre-load), the calls
    // fall back to wallet-wide aggregation.
    useEffect(() => {
        if (!activeWalletId) return undefined;
        let cancelled = false;
        setBalances(null);
        setMultisig(null);
        setPendingAirdrops([]);
        setPendingCoinpays([]);
        setLoadError(null);
        const walletId = activeWalletId;
        const accountId = activeAccountId || undefined;

        (async () => {
            try {
                const b = await messaging.getWalletBalances(walletId, accountId);
                if (!cancelled) setBalances(b);
            } catch (err) {
                if (!cancelled) setLoadError(err?.message || 'Failed to load balances.');
            }

            if (typeof messaging.getMultisigReceiveAddress === 'function') {
                const btcChain = chainRegistry.byCoin('bitcoin')[0]?.id;
                if (btcChain) {
                    messaging.getMultisigReceiveAddress({ walletId, chainId: btcChain })
                        .then((r) => {
                            if (cancelled) return;
                            if (r && Number.isInteger(r.threshold)) {
                                setMultisig({
                                    threshold: r.threshold,
                                    cosignerCount: r.cosignerCount,
                                    scheme: r.scheme,
                                });
                            }
                        })
                        .catch(() => { /* no multisig configured */ });
                }
            }

            if (typeof messaging.listPendingAirdropsForWallet === 'function') {
                try {
                    const records = await messaging.listPendingAirdropsForWallet({ walletId });
                    if (!cancelled) {
                        const resumable = (records || []).filter(
                            (r) => r.stage === 'waiting-index' || r.stage === 'ready-to-airdrop',
                        );
                        setPendingAirdrops(resumable);
                    }
                } catch { /* non-fatal */ }
            }

            if (typeof messaging.getCoinpayObligationsForAddress === 'function') {
                try {
                    const byChain = await messaging.getAddressesByChain(walletId, accountId);
                    const pairs = [];
                    for (const [cId, addrs] of Object.entries(byChain || {})) {
                        for (const a of addrs) pairs.push({ chainId: cId, address: a.address });
                    }
                    const results = await Promise.all(pairs.map((p) =>
                        messaging.getCoinpayObligationsForAddress({
                            chainId: p.chainId, address: p.address,
                        })
                            .then((resp) => ({ ...p, rows: extractObligationRows(resp) }))
                            .catch(() => ({ ...p, rows: [] }))
                    ));
                    if (cancelled) return;
                    const obligations = [];
                    for (const r of results) {
                        for (const row of r.rows) {
                            if (!isPendingForPayer(row, r.address)) continue;
                            obligations.push({
                                chainId: r.chainId,
                                address: r.address,
                                orderMatchActionIndex: String(row.action_index ?? row.actionIndex),
                                coinAmount: row.coin_amount,
                                payeeAddress: row.payee_address || row.payeeAddress,
                                expiration: row.expiration,
                            });
                        }
                    }
                    setPendingCoinpays(obligations);
                } catch { /* non-fatal */ }
            }
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeWalletId, activeAccountId, messaging]);

    const handleLock = useCallback(async () => {
        if (locking) return;
        setLocking(true);
        try {
            await messaging.lockWallet();
            onLocked?.();
        } catch (err) {
            setLoadError(err?.message || 'Lock failed.');
            setLocking(false);
        }
    }, [locking, onLocked, messaging]);

    // Read autolockMinutes from settings; clamp to a sane floor (1 min)
    // and ceiling (1440 min / 24h) so a corrupt or out-of-range value
    // can't disable the hook by overflowing or underflowing. The
    // Settings UI already only offers values inside that range; this
    // guard handles a hand-edited storage record.
    const settings = useSettings();
    const autolockMinutes = Math.max(
        1,
        Math.min(1440, Number(settings?.autolockMinutes) || 5),
    );
    // §20 / G041 — wallet-mode aware. The hook's return is the wrapper
    // `{ settings, loading, error, refresh, update }`, so the actual
    // Settings record lives at `.settings`. Read with the explicit
    // default so v2 records without the field behave like 'full'.
    const walletMode = settings.settings?.walletMode || WALLET_MODE_DEFAULT;
    const isSignerMode = walletMode === 'signer';
    // §26 / G064 — auto-lock runs in every shell. The hook listens for
    // user-input events on `window`, which is identical in the Electron
    // renderer and the browser, so a user-idle desktop wallet now locks
    // on the same cadence as web + popup. Cluster O FOLLOWUP 1 closes
    // here. Future hardening could complement this with a
    // `powerMonitor.getSystemIdleTime()` driver in the desktop main
    // process so the wallet locks on OS-level lock / sleep too.
    useAutoLock(handleLock, {
        enabled: (shell === 'popup' || shell === 'web' || shell === 'desktop') && !locking,
        idleMs: autolockMinutes * 60 * 1000,
    });

    const activeWallet = wallets && activeWalletId
        ? wallets.find((w) => w.id === activeWalletId)
        : null;

    // Wallet-level alerts surfaced in the pancake's Alerts panel.
    // Computed each render from the available signals; future alerts
    // (incoming message, order match settled, MuSig2 round needs
    // attention, etc.) drop into this array as they wire through
    // their own sources.
    const alerts = [];
    if (activeWallet?.format === 'counterwallet-legacy' && onMigrateToBip39) {
        alerts.push({
            id: 'legacy-format',
            severity: 'info',
            title: 'Legacy FreeWallet format',
            message: 'This wallet uses the 12-word Counterwallet format. Migrate to BIP39 for broader interop and stronger derivation.',
            action: { label: 'Migrate to BIP39', onSelect: onMigrateToBip39 },
        });
    }

    const brandBlock = (
        <img
            src={branding.logoUrl()}
            alt={branding.PRODUCT_NAME}
            className={isFull ? styles.brandLogoFull : styles.brandLogoPopup}
        />
    );

    // Coin families surfaced in the dataset, in canonical order.
    // Drives both the network filter and the per-tab "no balances on
    // this network" empty messages.
    const coinFamilies = (() => {
        const seen = new Set();
        if (balances) {
            for (const cid of Object.keys(balances)) {
                const desc = chainRegistry.get(cid);
                if (desc) seen.add(desc.coin);
            }
        }
        const ordered = ['bitcoin', 'litecoin', 'dogecoin'].filter((c) => seen.has(c));
        for (const c of seen) if (!ordered.includes(c)) ordered.push(c);
        return ordered;
    })();

    const accountList = Array.isArray(accounts) ? [...accounts].sort((a, b) => a.index - b.index) : [];
    const activeAccount = accountList.find((a) => a.id === activeAccountId) || null;
    const walletList = Array.isArray(wallets) ? wallets : [];
    const walletNonDefault = walletList.length > 1 && walletList[0] && activeWalletId !== walletList[0].id;
    const accountNonDefault = accountList.length > 1
        && accountList[0]
        && activeAccountId
        && activeAccountId !== accountList[0].id;

    const settingsButton = (
        <HeaderSettingsButton
            activeWallet={activeWallet}
            activeAccount={activeAccount}
            walletNonDefault={walletNonDefault}
            accountNonDefault={accountNonDefault}
            onOpenWalletPicker={onOpenWalletPicker}
            onOpenAccountPicker={onOpenAccountPicker}
            chainRegistry={chainRegistry}
            coinFamilies={coinFamilies}
            networkFilter={networkFilter}
            onNetworkFilterChange={setNetworkFilter}
        />
    );

    const headerInner = isFull ? (
        <div className={styles.headerFull}>
            {brandBlock}
            <div className={styles.headerRight}>
                {settingsButton}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLock}
                    loading={locking}
                    icon={<Icon.LockIcon />}
                >
                    Lock
                </Button>
            </div>
        </div>
    ) : (
        <div className={styles.headerPopup}>
            {brandBlock}
            <div className={styles.headerRight}>
                <HeaderNetworkButton
                    chainRegistry={chainRegistry}
                    coinFamilies={coinFamilies}
                    networkFilter={networkFilter}
                    onNetworkFilterChange={setNetworkFilter}
                />
                <button
                    type="button"
                    className={styles.menuBtn}
                    onClick={() => setMenuOpen(true)}
                    aria-label="Open menu"
                    aria-haspopup="dialog"
                    aria-expanded={menuOpen ? 'true' : 'false'}
                >
                    <Icon.MenuIcon />
                </button>
            </div>
        </div>
    );

    if (settingsOpen) {
        return (
            <Settings
                onBack={() => setSettingsOpen(false)}
                activeWallet={activeWallet}
                activeAccount={activeAccount}
                onOpenWalletPicker={onOpenWalletPicker}
                onOpenAccountPicker={onOpenAccountPicker}
            />
        );
    }

    // §20 / G041 — signer-mode home variant. The wallet only signs PSBTs
    // pasted in from a paired Watcher wallet; balances, history, send,
    // and receive are not relevant. Render a stripped-down body with the
    // sign / verify CTAs and a banner explaining the role. Header stays
    // shared so the user can still lock / switch wallets / open Settings.
    if (isSignerMode) {
        return (
            <Screen variant={variant} header={headerInner}>
                <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                    {loadError ? (
                        <div role="alert" className={styles.error}>{loadError}</div>
                    ) : null}
                    {activeWalletId ? (
                        <DemoBanner
                            activeWalletId={activeWalletId}
                            onExited={onLocked}
                        />
                    ) : null}
                    <SignerHomeBody
                        onSignPsbt={onSignPsbt}
                        onSignMessage={onSignMessage}
                        onVerifySignature={onVerifySignature}
                    />
                </div>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={headerInner}>
            <div className={isFull ? styles.bodyFull : styles.bodyPopup}>
                {loadError ? (
                    <div role="alert" className={styles.error}>{loadError}</div>
                ) : null}

                {balances === null && !loadError ? (
                    <div role="status" aria-label="Loading balances">
                        <Skeleton.List rows={5} />
                    </div>
                ) : null}

                {/* Inline notice removed — surfaces in the Alerts panel
                    of the pancake menu instead so the main view stays
                    focused on balances + work, not status banners. */}

                {pendingAirdrops.length > 0 && onResumeAirdrop ? (
                    <div role="group" aria-label="Pending airdrops">
                        {pendingAirdrops.map((rec) => (
                            <button
                                key={rec.id}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeAirdrop(rec.id)}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    Resume airdrop: {rec.amountPer} {rec.token} × {rec.recipients.length}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    {rec.stage === 'waiting-index'
                                        ? 'LIST broadcast — waiting for index'
                                        : 'Ready to sign AIRDROP'}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {pendingCoinpays.length > 0 && onResumeCoinpay ? (
                    <div role="group" aria-label="Pending COINPAY obligations">
                        {pendingCoinpays.map((rec) => (
                            <button
                                key={`${rec.chainId}-${rec.orderMatchActionIndex}`}
                                type="button"
                                className={styles.pendingAirdropCard}
                                onClick={() => onResumeCoinpay({
                                    chainId: rec.chainId,
                                    address: rec.address,
                                    orderMatchActionIndex: rec.orderMatchActionIndex,
                                })}
                            >
                                <span className={styles.pendingAirdropTitle}>
                                    Pending COINPAY: pay {rec.coinAmount} for ORDER_MATCH #{rec.orderMatchActionIndex}
                                </span>
                                <span className={styles.pendingAirdropHint}>
                                    Sign COINPAY to settle the native-coin leg of your matched order.
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}

                {activeWalletId ? (
                    <DemoBanner
                        activeWalletId={activeWalletId}
                        onExited={onLocked}
                    />
                ) : null}
                {activeWalletId ? (
                    <BackupReminderCard
                        walletId={activeWalletId}
                        walletCreatedAt={activeWallet?.createdAt}
                        onAction={() => setSettingsOpen(true)}
                    />
                ) : null}

                {balances ? (
                    <HomeTabs
                        chainRegistry={chainRegistry}
                        balances={balances}
                        networkFilter={networkFilter}
                        multisig={multisig}
                        multisigChainId={chainRegistry.byCoin('bitcoin')[0]?.id}
                        onReceive={onReceive}
                        onSelectToken={onSelectToken}
                        pinnedKeys={new Set(pinnedTokens)}
                        onTogglePin={handleTogglePin}
                        hiddenKeys={new Set(hiddenTokens)}
                        onToggleHide={handleToggleHide}
                        actions={(
                            <div className={styles.quickActions} role="group" aria-label="Quick actions">
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onSend}
                                    disabled={!onSend}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
                                    <span>Send</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onReceive}
                                    disabled={!onReceive}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.ReceiveIcon /></span>
                                    <span>Receive</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onSwap}
                                    disabled={!onSwap}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SwapIcon /></span>
                                    <span>Swap</span>
                                </button>
                                <button
                                    type="button"
                                    className={styles.quickAction}
                                    onClick={onBuy}
                                    disabled={!onBuy}
                                >
                                    <span className={styles.quickActionIcon} aria-hidden="true"><Icon.DollarIcon /></span>
                                    <span>Buy</span>
                                </button>
                            </div>
                        )}
                    />
                ) : null}


                {balances && Object.keys(balances).length === 0 ? (
                    <p className={styles.hint}>
                        No addresses yet. Use Receive to generate one.
                    </p>
                ) : null}

                {/* Action button grid is full-mode only. In small mode the
                    actions live in the pancake menu, freeing the body for
                    the balance list. */}
                {isFull ? (
                <div className={styles.actionsFull}>
                    <Button
                        variant="primary"
                        block={!isFull}
                        onClick={onSend}
                        disabled={!onSend}
                        icon={<Icon.SendIcon />}
                    >
                        Send
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onReceive}
                        disabled={!onReceive}
                        icon={<Icon.ReceiveIcon />}
                    >
                        Receive
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onCreateToken}
                        disabled={!onCreateToken}
                        icon={<Icon.TokenIcon />}
                    >
                        Create token
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMarkets}
                        disabled={!onMarkets}
                        icon={<Icon.MarketIcon />}
                    >
                        Markets
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onMessaging}
                        disabled={!onMessaging}
                        icon={<Icon.MessageIcon />}
                    >
                        Messaging
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onHistory}
                        disabled={!onHistory}
                        icon={<Icon.HistoryIcon />}
                    >
                        History
                    </Button>
                    <Button
                        variant="secondary"
                        block={!isFull}
                        onClick={onAddresses}
                        disabled={!onAddresses}
                        icon={<Icon.AddressIcon />}
                    >
                        Addresses
                    </Button>
                    {onContracts ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onContracts}
                            icon={<Icon.ContractIcon />}
                        >
                            Contracts
                        </Button>
                    ) : null}
                    {onStaking ? (
                        <Button
                            variant="secondary"
                            block={!isFull}
                            onClick={onStaking}
                            icon={<Icon.StakeIcon />}
                        >
                            Staking
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        block={!isFull}
                        onClick={onActions}
                        disabled={!onActions}
                        icon={<Icon.MoreIcon />}
                    >
                        More actions
                    </Button>
                </div>
                ) : null}
            </div>
            {/* Pancake menu lives at the route level (not inside Screen)
                so it overlays the entire viewport. */}
            {!isFull && menuOpen ? (
                <HeaderActionMenu
                    onClose={() => setMenuOpen(false)}
                    onAlerts={() => setAlertsOpen(true)}
                    alertCount={alerts.length}
                    onMarkets={onMarkets}
                    onTokens={onActions}
                    onMessaging={onMessaging}
                    onCrossChain={onCrossChain}
                    onContacts={onContacts}
                    onAddresses={onAddresses}
                    onContracts={onContracts}
                    onStaking={onStaking}
                    onMultisig={onMultisig}
                    onLock={handleLock}
                    locking={locking}
                    onSettings={() => setSettingsOpen(true)}
                />
            ) : null}
            {alertsOpen ? (
                <AlertsOverlay
                    alerts={alerts}
                    onClose={() => setAlertsOpen(false)}
                />
            ) : null}
        </Screen>
    );
}

function isPendingForPayer(row, address) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.coinpay_status || row.status || '').toLowerCase();
    if (status !== 'pending_coinpay') return false;
    const payer = row.payer_address || row.payerAddress;
    return typeof payer === 'string' && payer === address;
}

function extractObligationRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.obligations)) return resp.obligations;
    if (Array.isArray(resp.coinpay_obligations)) return resp.coinpay_obligations;
    return [];
}

/**
 * §20 / G041 — Signer-mode landing body. Renders an explanatory banner
 * and three role-appropriate CTAs (Sign a PSBT / Sign a message / Verify
 * a signature). Send + Receive + balances are intentionally absent — a
 * signer-mode wallet doesn't broadcast, watch chains, or expose receive
 * addresses; its sole role is to sign PSBTs pasted in from a paired
 * Watcher wallet (cf. G040 — Send.jsx watcher branch).
 *
 * @param {object} props
 * @param {() => void} [props.onSignPsbt]
 * @param {() => void} [props.onSignMessage]
 * @param {() => void} [props.onVerifySignature]
 */
function SignerHomeBody({ onSignPsbt, onSignMessage, onVerifySignature }) {
    return (
        <div role="region" aria-label="Signer-mode home">
            <div
                role="status"
                aria-live="polite"
                style={{
                    padding: 'var(--xc-space-3) var(--xc-space-4)',
                    background: 'var(--xc-surface-raised)',
                    border: '1px dashed var(--xc-border)',
                    borderRadius: 'var(--xc-radius-md)',
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-sm)',
                    marginBottom: 'var(--xc-space-3)',
                    lineHeight: 1.4,
                }}
            >
                <strong style={{ color: 'var(--xc-text)' }}>Signer mode</strong>
                <span> — this wallet only signs PSBTs from a paired Watcher
                wallet. Send / Receive / balances are not available.
                Switch the wallet's mode in Settings → Wallet Mode if you
                want full-wallet behaviour back.</span>
            </div>
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--xc-space-2)',
                }}
            >
                <Button
                    variant="primary"
                    onClick={onSignPsbt}
                    disabled={!onSignPsbt}
                >
                    Sign a PSBT
                </Button>
                <Button
                    variant="secondary"
                    onClick={onSignMessage}
                    disabled={!onSignMessage}
                >
                    Sign a message
                </Button>
                <Button
                    variant="ghost"
                    onClick={onVerifySignature}
                    disabled={!onVerifySignature}
                >
                    Verify a signature
                </Button>
            </div>
        </div>
    );
}
