// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { ConfirmModal } from './ConfirmModal.jsx';
import { OverlaySurface } from './OverlaySurface.jsx';
import { useAnchoredPopover } from '../hooks/useViewportClamp.js';
import { useConfirmModal } from '../hooks/useConfirmModal.js';
import {
    activeNetworkLabel,
    activeNetworkOptions,
    activeNetworkSwitchCopy,
    normalizeActiveNetwork,
} from '../utils/activeNetworkSwitch.js';
import styles from './HeaderSettingsButton.module.css';
import menuStyles from './AppHeader.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { t } from '../../i18n/index.js';

// The chain filter renders only inside the open popover, so it loads with the
// header menu rather than in the startup bundle. The component starts the
// fetch when it mounts, so the chunk is ready before the popover opens.
const loadNetworkFilter = () => import('./NetworkFilter.jsx');
const NetworkFilter = lazy(() => loadNetworkFilter().then((module) => ({ default: module.NetworkFilter })));

/**
 * Header gear-icon → settings popover. Four sections:
 *
 *   ▸ Wallet     summary row showing the active wallet name; click
 *                navigates to the WalletPicker route (full list +
 *                Add Wallet affordance)
 *   ▸ Account    same shape; click navigates to AccountPicker
 *   ▸ Network    active Mainnet / Testnet / Regtest switch
 *   ▸ Chain filter inline coin-family filter (quick toggle, no nav)
 *
 * Every section is opt-in: a host that only wires the pickers gets a
 * pure wallet/account switcher, and a host that only wires a network
 * control gets a network-only button. Sections whose handlers are missing
 * are omitted rather than rendered inert.
 *
 * Keeping the popover compact: full lists + add affordances belong on
 * dedicated pages where there's room for labels, descriptions, and
 * confirmation. The popover is just "what's active" + "tap to change".
 *
 * The gear icon shows a small dot when ANY non-default setting is
 * active (non-Mainnet network, non-`all` chain filter, non-first wallet,
 * or non-first account). Click outside / Escape closes.
 *
 * @param {object} props
 * @param {{ id: string, name: string } | null} [props.activeWallet]      the wallet to display in the summary row
 * @param {{ id: string, name: string, index: number } | null} [props.activeAccount]
 * @param {() => void} [props.onOpenWalletPicker]                          host navigates to the wallet picker route
 * @param {() => void} [props.onOpenAccountPicker]                         host navigates to the account picker route
 * @param {() => void} [props.onOpenSettings]                              host navigates to the full settings route
 * @param {boolean} [props.walletNonDefault]   used by the gear's status dot (caller knows whether the active wallet is the "first" one in the list)
 * @param {boolean} [props.accountNonDefault]
 * @param {import('../../registry/index.js').ChainRegistry} [props.chainRegistry]
 * @param {string[]} [props.coinFamilies]
 * @param {string} [props.networkFilter]
 * @param {(coin: string) => void} [props.onNetworkFilterChange]   omit (or omit the registry / families) to drop the Network section entirely
 * @param {'mainnet'|'testnet'|'regtest'} [props.activeNetwork]
 * @param {boolean} [props.developerMode]
 * @param {(network: 'mainnet'|'testnet'|'regtest') => Promise<void>} [props.onActiveNetworkChange]
 * @param {boolean} [props.menuRow] renders the trigger as a labelled overflow-menu row
 * @param {() => void} [props.onNavigate] closes an owning menu before destination navigation
 */
export function HeaderSettingsButton({
    activeWallet,
    activeAccount,
    onOpenWalletPicker,
    onOpenAccountPicker,
    onOpenSettings,
    walletNonDefault = false,
    accountNonDefault = false,
    chainRegistry,
    coinFamilies,
    networkFilter,
    onNetworkFilterChange,
    activeNetwork,
    developerMode = false,
    onActiveNetworkChange,
    menuRow = false,
    onNavigate,
}) {
    const [open, setOpen] = useState(false);
    const [switchingNetwork, setSwitchingNetwork] = useState(false);
    const confirmDialog = useConfirmModal();
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    // The system Back gesture and Escape close this before it leaves the
    // screen; the shared stack consumes Escape, so focus goes back here.
    const closePopover = useCallback(() => {
        setOpen(false);
        triggerRef.current?.querySelector('button')?.focus();
    }, []);
    useBackHandler(open ? closePopover : undefined);
    // Flex wrapping can move the gear independently of the header slot, so
    // the open panel derives its viewport coordinates from the gear itself.
    const popoverPlacement = useAnchoredPopover(open, triggerRef);
    useEffect(() => { loadNetworkFilter().catch(() => {}); }, []);
    const popoverRef = popoverPlacement.ref;
    // The popover is portaled to the body, so Tab from its trigger walked the
    // page behind it (and closed an owning menu) and its controls were out of
    // keyboard reach. Opening moves focus to its first control; closing hands
    // it back to the trigger.
    useEffect(() => {
        if (!open) return undefined;
        const frame = requestAnimationFrame(() => {
            popoverRef.current?.querySelector(
                'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open, popoverRef]);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            closePopover();
        };
        const onFocusIn = (event) => {
            if (event.target.closest?.('#xc-main')) setOpen(false);
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('focusin', onFocusIn);
        };
    }, [closePopover, open]);

    // The Network section needs all four pieces to render anything
    // useful; NetworkFilter dereferences the registry and maps over the
    // families, so a partially-wired host must get no section at all
    // rather than a crash.
    const showNetwork = Boolean(chainRegistry)
        && Array.isArray(coinFamilies)
        && coinFamilies.length > 0
        && typeof onNetworkFilterChange === 'function';
    const hasActiveNetwork = activeNetwork === 'mainnet'
        || activeNetwork === 'testnet'
        || activeNetwork === 'regtest';
    const showActiveNetwork = hasActiveNetwork && typeof onActiveNetworkChange === 'function';
    const currentNetwork = normalizeActiveNetwork(activeNetwork);
    const networkOptions = activeNetworkOptions({ developerMode, current: currentNetwork });

    const filterActive = showNetwork && networkFilter && networkFilter !== 'all';
    const anyNonDefault = Boolean(filterActive)
        || (hasActiveNetwork && currentNetwork !== 'mainnet')
        || walletNonDefault
        || accountNonDefault;

    const walletLabel = activeWallet?.name || null;
    const accountLabel = activeAccount?.name
        || (Number.isInteger(activeAccount?.index) ? `Account ${activeAccount.index + 1}` : null);
    const navigate = (handler) => {
        closePopover();
        onNavigate?.();
        handler();
    };

    const switchNetwork = async (next) => {
        if (next === currentNetwork) return;
        const copy = activeNetworkSwitchCopy(currentNetwork, next);
        const confirmed = await confirmDialog.confirm({
            ...copy,
            confirmLabel: 'Switch network',
        });
        if (!confirmed) return;
        setSwitchingNetwork(true);
        try {
            await onActiveNetworkChange(next);
        } catch (err) {
            // Keep the current badge and selection when persistence fails.
            setSwitchingNetwork(false);
            // eslint-disable-next-line no-console
            console.error('activeNetwork update failed:', err);
        }
    };

    return (
        <>
            <div ref={wrapRef} className={`${styles.wrap} ${menuRow ? menuStyles.settingsWrap : ''}`.trim()}>
                <span ref={triggerRef} className={styles.trigger}>
                    {menuRow ? (
                        <button
                            type="button"
                            role="menuitem"
                            className={menuStyles.actionRow}
                            onClick={() => setOpen((v) => !v)}
                            aria-haspopup="dialog"
                            aria-expanded={open ? 'true' : 'false'}
                            data-active={anyNonDefault ? 'true' : undefined}
                        >
                            <span className={menuStyles.rowIcon} aria-hidden="true">
                                <Icon.GearIcon />
                                {anyNonDefault ? <span className={styles.dot} /> : null}
                            </span>
                            <span className={menuStyles.rowLabel}>{t('home.settings')}</span>
                            <span className={menuStyles.rowIcon} aria-hidden="true"><Icon.ForwardIcon /></span>
                        </button>
                    ) : (
                        <Button
                            variant="secondary"
                            icon={(
                                <>
                                    <Icon.GearIcon />
                                    {anyNonDefault ? <span className={styles.dot} /> : null}
                                </>
                            )}
                            onClick={() => setOpen((v) => !v)}
                            aria-haspopup="dialog"
                            aria-expanded={open ? 'true' : 'false'}
                            aria-label={t('home.settings')}
                            title={t('home.settings')}
                            data-active={anyNonDefault ? 'true' : undefined}
                        />
                    )}
                </span>
                {open && typeof document !== 'undefined' ? createPortal(
                    <OverlaySurface
                        variant="popover"
                        surfaceRef={popoverPlacement.ref}
                        style={popoverPlacement.style}
                        title={t('shell.settingsButton.walletSettings')}
                        titleId="xc-wallet-settings-title"
                        aria-labelledby="xc-wallet-settings-title"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                    {/* Picker destinations stay native buttons to preserve full-row navigation semantics. */}
                    {onOpenWalletPicker ? (
                        <Section title={t('settings.thisWallet.wallet')}>
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => navigate(onOpenWalletPicker)}
                                title={walletLabel || t('shell.settingsButton.chooseWallet')}
                            >
                                <span className={`${styles.summaryName} ${walletLabel ? '' : styles.summaryEmpty}`}>
                                    {walletLabel || t('shell.settingsButton.noWallet')}
                                </span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </Section>
                    ) : null}

                    {onOpenAccountPicker && activeWallet ? (
                        <Section title={t('shell.settingsButton.account')}>
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => navigate(onOpenAccountPicker)}
                                title={accountLabel || t('shell.settingsButton.chooseAccount')}
                            >
                                <span className={`${styles.summaryName} ${accountLabel ? '' : styles.summaryEmpty}`}>
                                    {accountLabel || t('shell.settingsButton.account1')}
                                </span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </Section>
                    ) : null}

                    {showActiveNetwork ? (
                        <Section title={t('settings.network.label')}>
                            <select
                                className={styles.networkSelect}
                                value={currentNetwork}
                                disabled={switchingNetwork || Boolean(confirmDialog.request)}
                                onChange={(event) => switchNetwork(event.target.value)}
                                aria-label={t('shell.settingsButton.activeNetworkInHeader')}
                            >
                                {networkOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </Section>
                    ) : null}

                    {showNetwork ? (
                        <Suspense fallback={null}>
                            <Section title={t('shell.settingsButton.chainFilter')}>
                                <NetworkFilter
                                    chainRegistry={chainRegistry}
                                    coinFamilies={coinFamilies}
                                    value={networkFilter || 'all'}
                                    onChange={(next) => { onNetworkFilterChange(next); /* keep popover open */ }}
                                />
                            </Section>
                        </Suspense>
                    ) : null}

                    {onOpenSettings ? (
                        <div className={styles.section}>
                            <button
                                type="button"
                                className={styles.summaryRow}
                                onClick={() => navigate(onOpenSettings)}
                                title={t('shell.settingsButton.allSettings')}
                            >
                                <span className={styles.summaryName}>{t('shell.settingsButton.allSettings')}</span>
                                <span className={styles.summaryChevron} aria-hidden="true">›</span>
                            </button>
                        </div>
                    ) : null}
                    </OverlaySurface>,
                    document.body,
                ) : null}
            </div>
            {/* Rendered in place, the confirm sat inside the header's stacking
                context and the body-level popover painted over it. Portaled
                beside the popover it stacks on top; like the popover, its
                presses stop at the portal so the open menu and popover
                underneath do not read them as outside clicks and unmount it. */}
            {confirmDialog.request && typeof document !== 'undefined' ? createPortal(
                <div data-header-settings-confirm="" onMouseDown={(event) => event.stopPropagation()}>
                    <ConfirmModal
                        {...confirmDialog.request}
                        onConfirm={confirmDialog.onConfirm}
                        onCancel={confirmDialog.onCancel}
                    />
                </div>,
                document.body,
            ) : null}
        </>
    );
}

function Section({ title, children }) {
    return (
        <div className={styles.section}>
            <div className={styles.sectionLabel}>{title}</div>
            {children}
        </div>
    );
}
