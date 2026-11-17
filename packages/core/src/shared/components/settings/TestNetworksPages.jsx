// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Test Networks (operator picks 2026-11-14), opened from Advanced >
// Developer options. Five pages, each a Settings page of its own:
//
//   - Test Networks: only the networks this wallet uses (activated regtest
//     networks and added custom networks), one Add Network row, and the
//     Regtest Faucet under Tools.
//   - Add Network: the built-in regtest networks not active yet, one list
//     card; Add Custom Network is the plus in its title bar (operator walk
//     2026-11-15). Choosing a built-in asks for the wallet password in place (one
//     field and the green Activate Network button on this page, no screen or
//     confirm of its own), activates it and returns to the list.
//   - A network's page: identity card, then the Actions and Details toggle
//     (G102). Actions holds Get test coins, Switch wallet, and for a custom
//     network Edit and Remove; an action that cannot run stays listed with
//     its reason in words.
//   - Add Custom Network (and Edit Network): the Form Standard form that
//     copies a built-in regtest network and changes its name, ID, endpoints
//     and look, or takes a pasted descriptor for any other family.
//   - Regtest Faucet: a framed Get Test Coins | History toggle, the history
//     searchable from the filter button in the title bar (G04).
//
// Activation needs the wallet password for a software wallet because
// flows/activateChain.js unlocks the seed (unlockWalletRecord) to derive
// each account's first address on the new chain when no signer is handed to
// it; a paired hardware signer derives on the device instead, so that path
// asks for the device and no password.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    AddressText,
    Button,
    EmptyState,
    FormPage,
    Icon,
    Input,
    ListRow,
    NetworkField,
    PageHeader,
    PageNotice as Status,
    Screen,
    Select,
    Tabs,
    Textarea,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import { DEFAULT_MINER_URL } from '../../../branding/branding.js';
import * as branding from '../../../branding/branding.js';
import { fundActiveWalletFromMiner } from '../../../flows/regtestFaucet.js';
import { MAX_CUSTOM_DESCRIPTOR_CHARS } from '../../../flows/customChains.js';
import { useMessaging, screenVariantFor } from '../../useMessaging.js';
import { useSettings } from '../../hooks/useSettings.js';
import { useSignerReady } from '../../hooks/useSignerReady.js';
import { useToast } from '../ToastHost.jsx';
import { ActionList, ActionListItem } from '../ActionList.jsx';
import { ActionsDetailsToggle } from '../ActionsDetailsToggle.jsx';
import { ListFilterMenu } from '../ListFilterMenu.jsx';
import { FormAction, FormFrame, FormSection } from '../formStandard/index.js';
import { SignerSelectForm } from '../../routes/SignerSelectForm.jsx';
import { normalizeActiveNetwork } from '../../utils/activeNetworkSwitch.js';
import { formatActivityTime, formatLocalDateTime } from '../../utils/dateTime.js';
import { readFaucetHistory, recordFaucetRequest } from '../../utils/faucetHistory.js';
import { titleCase } from '../../utils/titleCase.js';
import { userFacingMessage } from '../../utils/userFacingMessage.js';
import { SettingsLoadError } from './SettingsInlineRow.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/history.js';
import '../../../i18n/locales/en/renameAccount.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/settings.js';
import pickerStyles from '../../routes/WalletPicker.module.css';
import styles from './TestNetworksPages.module.css';

// Page ids. A network's own page, its edit form and the faucet opened from it
// carry the network id after the prefix.
export const TEST_NETWORKS_PAGE_ID = 'developer-test-networks';
export const ADD_NETWORK_PAGE_ID = 'developer-add-network';
export const ADD_CUSTOM_NETWORK_PAGE_ID = 'developer-add-custom-network';
export const FAUCET_PAGE_ID = 'developer-faucet';
export const TEST_NETWORK_PAGE_PREFIX = 'developer-test-network:';
export const EDIT_CUSTOM_NETWORK_PAGE_PREFIX = 'developer-edit-custom-network:';
export const FAUCET_PAGE_PREFIX = 'developer-faucet:';

const COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

const chainRegistry = () => registryLib.defaultRegistry();

const kindLabel = (kind) => {
    if (kind === 'mainnet') return t('settings.testNetworks.kind.mainnet');
    if (kind === 'testnet') return t('settings.testNetworks.kind.testnet');
    return t('settings.testNetworks.kind.regtest');
};
// Built per call so a locale switch applies.
const ENDPOINT_LABELS = {
    explorer: () => t('settings.testNetworks.explorerEndpoint'),
    encoder: () => t('settings.testNetworks.encoderEndpoint'),
    hub: () => t('settings.testNetworks.hubEndpoint'),
};
/**
 * A network's name as these pages show it. The built-in descriptors name only
 * their family ("Bitcoin") on every network kind, so a built-in test network
 * gains its kind ("Bitcoin Regtest"); a custom network keeps its own name.
 *
 * @param {{ id?: string, displayName?: string, networkKind?: string, isUserAdded?: boolean } | null | undefined} d
 * @param {boolean} [custom]
 */
export const networkName = (d, custom = Boolean(d?.isUserAdded)) => {
    if (!d) return '';
    const base = d.displayName || d.id || '';
    if (custom || d.networkKind === 'mainnet') return base;
    const kind = kindLabel(d.networkKind);
    return base.toLowerCase().includes(kind.toLowerCase()) ? base : `${base} ${kind}`;
};
const tickerOf = (d) => d?.nativeTicker || COIN_TICKER[d?.coin] || String(d?.coin || '').toUpperCase();
const isActiveOn = (settings, chainId) => Boolean(settings?.fees && settings.fees[chainId]);
const isBuiltInRegtest = (d) => d?.networkKind === 'regtest' && !d?.isUserAdded;
const builtInRegtests = () => chainRegistry().supportedChains()
    .filter(isBuiltInRegtest)
    .sort((a, b) => a.coin.localeCompare(b.coin));

// The Test Networks page sits on Settings' flat page surface, which is still
// a card, so the shared nested-card rule strips a class border from the list
// cards; the surface is set inline, as Settings' own group lists do.
const LIST_SURFACE = { border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', background: 'var(--xc-surface)' };

/**
 * The Settings page for a page id this file owns (Add Network, Add Custom
 * Network, a network's page, its edit form, the faucet for one network), or
 * null. Settings resolves every id it cannot find in its own list here.
 *
 * @param {string | null} pageId
 * @param {object} props   the Developer section props plus the page openers
 */
export function testNetworkSectionFor(pageId, props = {}) {
    if (typeof pageId !== 'string') return null;
    const base = { id: pageId, kind: 'internal-drill' };
    if (pageId === ADD_NETWORK_PAGE_ID) {
        // Its title bar carries the Add Custom Network plus (G95).
        return { ...base, title: t('settings.developer.addChain'), ownsScreen: true, Component: AddNetworkPage, props };
    }
    if (pageId === ADD_CUSTOM_NETWORK_PAGE_ID) {
        return { ...base, title: t('settings.testNetworks.form.addTitle'), ownsScreen: true, Component: CustomNetworkFormPage, props };
    }
    if (pageId.startsWith(TEST_NETWORK_PAGE_PREFIX)) {
        const chainId = pageId.slice(TEST_NETWORK_PAGE_PREFIX.length);
        const d = chainRegistry().get(chainId);
        return { ...base, title: networkName(d) || chainId, ownsScreen: true, Component: TestNetworkPage, props: { ...props, chainId } };
    }
    if (pageId.startsWith(EDIT_CUSTOM_NETWORK_PAGE_PREFIX)) {
        const editChainId = pageId.slice(EDIT_CUSTOM_NETWORK_PAGE_PREFIX.length);
        return { ...base, title: t('settings.testNetworks.form.editTitle'), ownsScreen: true, Component: CustomNetworkFormPage, props: { ...props, editChainId } };
    }
    if (pageId.startsWith(FAUCET_PAGE_PREFIX)) {
        const chainId = pageId.slice(FAUCET_PAGE_PREFIX.length);
        return { ...base, title: t('settings.testNetworks.faucet.title'), ownsScreen: true, Component: FaucetPage, props: { ...props, chainId } };
    }
    return null;
}

/**
 * Turn a custom-network mutation failure into a plain sentence: the host and
 * the flows lead their messages with the function name, which the user never
 * sees anywhere else.
 *
 * @param {unknown} err
 * @param {string} fallback
 * @returns {string}
 */
export function customChainErrorText(err, fallback) {
    const raw = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : '';
    const stripped = raw.replace(/^(?:chainRegistry\.)?(?:add|remove)CustomChain:\s*/, '').trim();
    if (!stripped) return fallback;
    const bundled = stripped.match(/^"([^"]+)" is a bundled chain and cannot be removed$/);
    const text = bundled ? `"${bundled[1]}" is a built-in network and can't be removed` : stripped;
    const sentence = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The custom networks the vault holds, re-read on demand. */
function useCustomNetworks() {
    const { messaging } = useMessaging();
    const [state, setState] = useState({ chains: [], loading: true, error: null });
    const load = useCallback(async () => {
        if (typeof messaging?.listCustomChains !== 'function') {
            setState({ chains: [], loading: false, error: null });
            return;
        }
        try {
            const r = await messaging.listCustomChains();
            setState({ chains: Array.isArray(r?.descriptors) ? r.descriptors : [], loading: false, error: null });
        } catch (err) {
            setState({ chains: [], loading: false, error: userFacingMessage(err, t('settings.testNetworks.loadFailed')) });
        }
    }, [messaging]);
    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load };
}

/** A network's icon: its bundled image, or its first letter on its colour. */
export function NetworkMark({ descriptor, large = false }) {
    const url = descriptor ? branding.chainIconSmallUrl(descriptor.id) : null;
    const letter = String(descriptor?.displayName || descriptor?.id || '?').slice(0, 1).toUpperCase();
    return (
        <span
            className={[styles.mark, large ? styles.markLarge : null].filter(Boolean).join(' ')}
            style={{ '--net-color': descriptor?.color || undefined }}
            aria-hidden="true"
        >
            {url ? <img src={url} alt="" /> : letter}
        </span>
    );
}

/**
 * A network row's leading icon: the mark in the same 36px box an action
 * row's icon fills, so network rows and action rows in one card line up.
 */
function RowIcon({ descriptor }) {
    return <span className={styles.rowIcon} aria-hidden="true"><NetworkMark descriptor={descriptor} /></span>;
}

function ActiveBadge() {
    return <span className={pickerStyles.activeBadge}>{t('settings.developer.active')}</span>;
}

function DevModeOffNotice({ settings }) {
    if (settings?.developerMode === true) return null;
    return <Status text={t('settings.testNetworks.devModeOff')} tone="warning" />;
}

// --------------------------------------------------------------------------
// Test Networks: the networks this wallet uses.
// --------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {(pageId: string) => void} props.onOpen   opens a page from this one
 */
export function TestNetworksPage({ onOpen = () => {} }) {
    const { settings, error } = useSettings();
    const custom = useCustomNetworks();
    if (error) return <SettingsLoadError error={error} />;
    // Until the first read lands there is no Developer mode or fee state to
    // judge by, so nothing reads as off or inactive.
    if (!settings) return <Status text={t('common.loading')} />;
    const devOn = settings?.developerMode === true;
    const customIds = new Set(custom.chains.map((d) => d?.id));
    const activeBuiltIns = builtInRegtests().filter((d) => isActiveOn(settings, d.id) && !customIds.has(d.id));
    const customRows = custom.chains
        .filter((d) => typeof d?.id === 'string')
        .map((d) => chainRegistry().get(d.id) || d);
    const activeRegtest = chainRegistry().supportedChains()
        .some((d) => d.networkKind === 'regtest' && isActiveOn(settings, d.id));
    const rows = [
        ...activeBuiltIns.map((d) => ({ d, name: networkName(d, false), line: t('settings.testNetworks.builtInLine', { kind: kindLabel(d.networkKind) }), active: true })),
        ...customRows.map((d) => {
            const active = isActiveOn(settings, d.id);
            const line = t('settings.testNetworks.customLine', { kind: kindLabel(d.networkKind) });
            return { d, name: networkName(d, true), line: active ? line : `${line} · ${t('settings.testNetworks.notOnWallet')}`, active };
        }),
    ];
    return (
        <div className={styles.page} aria-label={t('settings.testNetworks.title')}>
            <DevModeOffNotice settings={settings} />
            {custom.error ? <Status text={t('settings.testNetworks.loadError', { error: custom.error })} tone="error" /> : null}
            <div className={styles.group}>
                <div className={styles.groupLabel}>{t('settings.testNetworks.networksGroup')}</div>
                {/* Safari needs an explicit list role because this class removes list styling. */}
                <ul className={styles.card} role="list" aria-label={t('settings.testNetworks.networksGroup')} style={LIST_SURFACE} data-test-networks-card="">
                    {rows.map(({ d, name, line, active }) => (
                        <li key={d.id} data-test-network={d.id}>
                            <ListRow
                                onClick={() => onOpen(`${TEST_NETWORK_PAGE_PREFIX}${d.id}`)}
                                leading={<RowIcon descriptor={d} />}
                                title={name}
                                subtitle={line}
                                trailing={active ? <ActiveBadge /> : undefined}
                                chevron
                            />
                        </li>
                    ))}
                    {/* The one Add Network row ends the card (an ActionListItem is its own li). */}
                    <ActionListItem
                        data-add-network-row=""
                        icon={<Icon.PlusIcon />}
                        title={t('settings.developer.addChain')}
                        description={t('settings.testNetworks.addNetworkLine')}
                        disabled={!devOn}
                        disabledReason={t('settings.testNetworks.needsDevMode')}
                        onClick={() => onOpen(ADD_NETWORK_PAGE_ID)}
                    />
                </ul>
                {rows.length === 0 && !custom.loading ? (
                    <p className={styles.note}>{t('settings.testNetworks.emptyBody')}</p>
                ) : null}
            </div>
            <div className={styles.group}>
                <div className={styles.groupLabel}>{t('settings.testNetworks.toolsGroup')}</div>
                <ActionList label={t('settings.testNetworks.toolsGroup')} style={LIST_SURFACE} data-test-networks-tools="">
                    <ActionListItem
                        icon={<Icon.CoinsIcon />}
                        title={t('settings.testNetworks.faucet.title')}
                        description={t('settings.testNetworks.faucetLine')}
                        disabled={!devOn || !activeRegtest}
                        disabledReason={!devOn ? t('settings.testNetworks.needsDevMode') : t('settings.testNetworks.needsActiveRegtest')}
                        onClick={() => onOpen(FAUCET_PAGE_ID)}
                    />
                </ActionList>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------------
// Activation in place: the wallet password (or the paired device) and the
// green Activate Network button, on the page that asked for it.
// --------------------------------------------------------------------------

// The host's refusal when neither a signer nor a password reached it: the
// session's pooled signer expired between the page's read and the request.
const NO_SIGNER_RE = /either `signer` or `password` is required/;

/**
 * Activation state for one page. A software wallet derives the new addresses
 * from its seed: while the session's signer pool holds the wallet's unlocked
 * signer (useSignerReady, the host's wallet.signerReady), the host derives
 * with it and no password is asked (operator preference 2026-11-14); with the
 * pool empty (a fresh window, an expired pool) the password field shows in
 * place. A paired hardware signer derives on the device and never asks.
 */
function useActivation({ walletId, descriptor, onActivated }) {
    const { messaging } = useMessaging();
    const signerReady = useSignerReady(walletId);
    const [password, setPassword] = useState('');
    const [signerId, setSignerId] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    // Set once the host says the pool emptied after the page read it.
    const [poolGone, setPoolGone] = useState(false);
    const isHardware = Boolean(signerId);
    const askPassword = !signerReady || poolGone;

    const activate = async (event, target = descriptor) => {
        event?.preventDefault?.();
        if (busy || !target) return;
        if (!walletId) {
            setErrorText(t('settings.testNetworks.needsWallet'));
            return;
        }
        if (typeof messaging?.activateChainRequest !== 'function') {
            setErrorText(t('settings.testNetworks.activationUnwired'));
            return;
        }
        const sendPassword = askPassword && !isHardware;
        if (sendPassword && password.length === 0) {
            setErrorText(t('settings.testNetworks.passwordRequired'));
            return;
        }
        setBusy(true);
        setErrorText(null);
        try {
            const r = await messaging.activateChainRequest({
                walletId,
                chainId: target.id,
                password: sendPassword ? password : undefined,
                signerId: signerId || undefined,
            });
            setPassword('');
            onActivated?.(r, target);
        } catch (err) {
            if (!sendPassword && NO_SIGNER_RE.test(String(err?.message || ''))) {
                // The pool emptied since the page read it: ask in place now.
                setPoolGone(true);
                setErrorText(t('settings.testNetworks.passwordRequired'));
                return;
            }
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setErrorText(isBadPassword ? t('settings.testNetworks.badPassword') : (err?.message || t('settings.testNetworks.activateFailed')));
        } finally {
            setBusy(false);
        }
    };

    const reset = () => {
        setPassword('');
        setSignerId(null);
        setErrorText(null);
    };

    return { password, setPassword, signerId, setSignerId, busy, errorText, isHardware, askPassword, activate, reset };
}

/**
 * What a finished activation says, as a toast: how many addresses it made,
 * and by name each account it left alone because it already had one.
 */
export function activationMessage(descriptor, result) {
    const created = Array.isArray(result?.addresses) ? result.addresses.length : 0;
    const skipped = Array.isArray(result?.skippedAccountDetails) ? result.skippedAccountDetails : [];
    const name = networkName(descriptor);
    const lead = created > 0
        ? t('settings.testNetworks.activated', { name, count: created })
        : t('settings.testNetworks.alreadyActive', { name });
    if (skipped.length === 0 || created === 0) return lead;
    const names = skipped.map((account) => account?.name || account?.accountId).filter(Boolean).join(', ');
    return `${lead} ${t('settings.testNetworks.skippedAccounts', { names })}`;
}

function ActivateInPlace({ activation, descriptor, walletId }) {
    const name = networkName(descriptor);
    return (
        <FormPage
            onSubmit={activation.activate}
            submitFromAnyField
            label={t('settings.testNetworks.activateFormLabel', { name })}
            status={activation.errorText ? <Status text={activation.errorText} tone="error" /> : null}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    block
                    icon={<Icon.PlayIcon />}
                    disabled={activation.busy}
                >
                    {activation.busy
                        ? (activation.isHardware ? t('settings.developer.checkYourDevice') : t('settings.developer.activating'))
                        : t('settings.testNetworks.activateNetwork')}
                </Button>
            )}
        >
            <div className={styles.activate} data-activate-in-place={descriptor.id}>
                {/* Nothing renders here for a wallet with no paired hardware
                    signer, so a software wallet sees only the password. */}
                {walletId ? (
                    <SignerSelectForm
                        walletId={walletId}
                        value={activation.signerId}
                        onChange={activation.setSignerId}
                        disabled={activation.busy}
                    />
                ) : null}
                {activation.isHardware ? (
                    <p className={styles.note} role="note">{t('settings.testNetworks.deviceNote', { name })}</p>
                ) : (
                    <Input
                        type="password"
                        label={t('send.gated.passwordLabel')}
                        help={t('settings.testNetworks.walletPasswordHelp', { name })}
                        hint={t('settings.testNetworks.activateNote', { name })}
                        enterKeyHint="go"
                        value={activation.password}
                        onChange={(e) => activation.setPassword(e.target.value)}
                        autoComplete="current-password"
                        autoFocus
                        revealable
                        disabled={activation.busy}
                    />
                )}
            </div>
        </FormPage>
    );
}

// --------------------------------------------------------------------------
// Add Network: the built-in regtest networks not active yet, one list card;
// Add Custom Network is the plus in the title bar (G95, operator walk
// 2026-11-15).
// --------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {{ id: string } | null} [props.activeWallet]
 * @param {(pageId: string) => void} [props.onOpen]
 * @param {(pageId: string) => void} [props.onReturnTo]   back to Test Networks
 * @param {() => void} [props.onBack]
 * @param {string} [props.backLabel]
 * @param {boolean} [props.nested]
 * @param {string} [props.variant]
 */
export function AddNetworkPage({
    activeWallet,
    onOpen = () => {},
    onReturnTo = () => {},
    onBack,
    backLabel,
    nested = true,
    variant: variantProp,
}) {
    const { shell } = useMessaging();
    const variant = variantProp || screenVariantFor(shell);
    const { settings, error } = useSettings();
    const { showToast } = useToast();
    const [chosenId, setChosenId] = useState(/** @type {string | null} */ (null));
    const walletId = activeWallet?.id || null;
    const inactive = builtInRegtests().filter((d) => !isActiveOn(settings, d.id));
    const chosen = inactive.find((d) => d.id === chosenId) || null;
    const activation = useActivation({
        walletId,
        descriptor: chosen,
        onActivated: (r, target) => {
            showToast({ message: activationMessage(target, r), variant: 'success' });
            // Back to the list, which reads the settings again and shows it.
            onReturnTo(TEST_NETWORKS_PAGE_ID);
        },
    });
    const devOn = settings?.developerMode === true;
    const addCustomLabel = t('settings.testNetworks.form.addTitle');
    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={titleCase(t('settings.developer.addChain'))}
            trailing={settings ? (
                <Button
                    type="button"
                    variant="secondary"
                    icon={<Icon.PlusIcon />}
                    aria-label={addCustomLabel}
                    title={devOn ? addCustomLabel : t('settings.testNetworks.needsDevMode')}
                    disabled={!devOn}
                    data-add-custom-network=""
                    onClick={() => onOpen(ADD_CUSTOM_NETWORK_PAGE_ID)}
                >
                    {null}
                </Button>
            ) : null}
        />
    );
    const screen = (body) => (
        <Screen variant={variant} header={header} scrollKey={ADD_NETWORK_PAGE_ID} restoreScroll={false}>
            {body}
        </Screen>
    );
    if (error) return screen(<SettingsLoadError error={error} />);
    // Until the first read lands there is no Developer mode or fee state to
    // judge by, so nothing reads as off or inactive.
    if (!settings) return screen(<Status text={t('common.loading')} />);
    const unavailable = !devOn ? t('settings.testNetworks.needsDevMode') : !walletId ? t('settings.testNetworks.needsWallet') : null;
    // With the unlocked signer pooled, a tap activates at once; otherwise it
    // opens the password field in place under the list.
    const choose = (d) => {
        if (unavailable || activation.busy) return;
        activation.reset();
        if (!activation.askPassword) {
            setChosenId(d.id);
            activation.activate(undefined, d);
            return;
        }
        setChosenId(d.id === chosenId ? null : d.id);
    };
    const rowLine = (d) => {
        if (unavailable) return <span className={styles.reason}>{unavailable}</span>;
        if (activation.busy && d.id === chosenId) return t('settings.developer.activating');
        return activation.askPassword ? t('settings.testNetworks.activateLine') : t('settings.testNetworks.activateOnWallet');
    };
    // The page is only its list (G04): no group label over it, and the custom
    // network form opens from the title bar's plus.
    return screen(
        <div className={styles.page}>
            <DevModeOffNotice settings={settings} />
            {activation.errorText && !activation.askPassword ? <Status text={activation.errorText} tone="error" /> : null}
            {inactive.length === 0 ? (
                <p className={styles.note}>{t('settings.testNetworks.allActive')}</p>
            ) : (
                /* Safari needs an explicit list role because this class removes list styling. */
                <ul className={styles.card} role="list" aria-label={t('settings.developer.addChain')} data-add-network-card="">
                    {inactive.map((d) => (
                        <li key={d.id} data-add-network={d.id} className={d.id === chosenId ? styles.selectedRow : undefined}>
                            <ListRow
                                onClick={() => choose(d)}
                                aria-pressed={d.id === chosenId}
                                aria-disabled={unavailable || activation.busy ? 'true' : undefined}
                                leading={<RowIcon descriptor={d} />}
                                title={networkName(d, false)}
                                subtitle={rowLine(d)}
                                chevron={!unavailable}
                            />
                        </li>
                    ))}
                </ul>
            )}
            {chosen && !unavailable && activation.askPassword ? (
                <ActivateInPlace activation={activation} descriptor={chosen} walletId={walletId} />
            ) : null}
        </div>,
    );
}

// --------------------------------------------------------------------------
// A network's own page.
// --------------------------------------------------------------------------

function endpointText(endpoint) {
    if (!endpoint || typeof endpoint.defaultUrl !== 'string') return '';
    try {
        const url = new URL(endpoint.defaultUrl);
        const standard = url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80;
        if (Number.isInteger(endpoint.defaultPort) && endpoint.defaultPort !== standard) url.port = String(endpoint.defaultPort);
        const text = url.toString();
        return text.endsWith('/') && !endpoint.defaultUrl.endsWith('/') ? text.slice(0, -1) : text;
    } catch {
        return endpoint.defaultPort ? `${endpoint.defaultUrl}:${endpoint.defaultPort}` : endpoint.defaultUrl;
    }
}

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {{ id: string } | null} [props.activeWallet]
 * @param {(pageId: string) => void} [props.onOpen]
 * @param {(pageId: string) => void} [props.onReturnTo]   back to an earlier page in one step
 */
export function TestNetworkPage({
    chainId,
    activeWallet,
    onOpen = () => {},
    onReturnTo = () => {},
    onBack,
    backLabel,
    nested = true,
    variant: variantProp,
}) {
    const { messaging, shell } = useMessaging();
    // Settings always hands this owned Screen its variant. The shell fallback
    // keeps direct mounts useful without requiring their messaging adapter to
    // provide the route-level screen helper.
    const variant = variantProp || (shell === 'popup' ? 'small' : 'full');
    const { showToast } = useToast();
    const { settings, error, refresh } = useSettings();
    const [activating, setActivating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const descriptor = chainRegistry().get(chainId) || null;
    const walletId = activeWallet?.id || null;
    const activation = useActivation({
        walletId,
        descriptor,
        onActivated: (r) => {
            showToast({ message: activationMessage(descriptor, r), variant: 'success' });
            setActivating(false);
            refresh?.();
        },
    });
    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={titleCase(networkName(descriptor) || chainId)}
        />
    );
    const screen = (body) => (
        <Screen variant={variant} header={header} scrollKey={`${TEST_NETWORK_PAGE_PREFIX}${chainId}`} restoreScroll={false}>
            {body}
        </Screen>
    );
    if (error) return screen(<SettingsLoadError error={error} />);
    if (!settings) return screen(<Status text={t('common.loading')} />);
    if (!descriptor) {
        return screen(<EmptyState title={t('settings.testNetworks.gone')} titleAs="h3" body={t('settings.testNetworks.goneBody')} />);
    }
    const name = networkName(descriptor);
    const custom = Boolean(descriptor.isUserAdded);
    const devOn = settings?.developerMode === true;
    const active = isActiveOn(settings, descriptor.id);
    const kind = descriptor.networkKind;
    const walletKind = normalizeActiveNetwork(settings?.activeNetwork);

    const faucetReason = !devOn ? t('settings.testNetworks.needsDevMode')
        : kind !== 'regtest' ? t('settings.testNetworks.faucetOnlyRegtest')
            : !active ? t('settings.testNetworks.activateFirst') : null;
    // Addresses name a network by coin and kind, not by id, so a custom
    // network that kept a built-in's coin (a guided copy of Bitcoin Regtest)
    // shares that network's addresses: the host refuses to remove it while
    // they exist, and activating it makes no new ones.
    const sharedWith = custom
        ? chainRegistry().supportedChains().find((o) => o.id !== descriptor.id
            && o.coin === descriptor.coin
            && o.networkKind === kind
            && isActiveOn(settings, o.id)) || null
        : null;
    const changeReason = !devOn ? t('settings.testNetworks.needsDevMode')
        : active ? t('settings.testNetworks.inUse')
            : sharedWith ? t('settings.testNetworks.sharesAddresses', { name: networkName(sharedWith) }) : null;

    const onRemove = async () => {
        if (busy) return;
        if (typeof messaging?.removeCustomChain !== 'function') {
            setErrorText(t('settings.testNetworks.removeUnwired'));
            return;
        }
        setBusy(true);
        setErrorText(null);
        try {
            await messaging.removeCustomChain({ chainId: descriptor.id });
            // Mirror the removal into this realm's registry; only a
            // user-added entry is touched (removeCustom throws for bundled ids).
            try {
                if (chainRegistry().get(descriptor.id)?.isUserAdded) chainRegistry().removeCustom(descriptor.id);
            } catch { /* bundled or already gone: nothing to mirror */ }
            showToast({ message: t('settings.testNetworks.removed', { name }), variant: 'success' });
            onReturnTo(TEST_NETWORKS_PAGE_ID);
        } catch (err) {
            setErrorText(customChainErrorText(err, t('settings.testNetworks.removeFailed')));
        } finally {
            setBusy(false);
        }
    };

    const details = [
        [t('settings.testNetworks.networkName'), name],
        [t('settings.testNetworks.networkId'), descriptor.id],
        [t('settings.testNetworks.detail.type'), kindLabel(kind)],
        [t('settings.testNetworks.detail.source'), custom ? t('settings.testNetworks.customNetwork') : t('settings.testNetworks.detail.builtIn')],
        [t('settings.testNetworks.detail.status'), active ? t('settings.testNetworks.detail.activeOnWallet') : t('settings.testNetworks.detail.notActive')],
        [ENDPOINT_LABELS.explorer(), endpointText(descriptor.explorer)],
        [ENDPOINT_LABELS.encoder(), endpointText(descriptor.encoder)],
        [ENDPOINT_LABELS.hub(), endpointText(descriptor.hub)],
    ].filter(([, v]) => v);

    return screen(
        <div className={styles.page} data-test-network-page={descriptor.id}>
            <DevModeOffNotice settings={settings} />
            {errorText ? <Status text={errorText} tone="error" /> : null}
            {activating && !activation.askPassword && activation.errorText ? <Status text={activation.errorText} tone="error" /> : null}
            {!custom ? <Status text={t('settings.testNetworks.builtInNote')} /> : null}
            {/* The identity card (Wallet Details' shape, G80): icon, name, type line. */}
            <div className={styles.identity} data-identity-card="">
                <NetworkMark descriptor={descriptor} large />
                <div className={pickerStyles.identityText}>
                    <strong className={pickerStyles.identityName}>{name}</strong>
                    <span className={pickerStyles.identityMeta}>
                        <span>{custom ? t('settings.testNetworks.customLine', { kind: kindLabel(kind) }) : t('settings.testNetworks.builtInLine', { kind: kindLabel(kind) })}</span>
                        {active ? <ActiveBadge /> : null}
                    </span>
                </div>
            </div>
            <ActionsDetailsToggle
                actions={(
                    <>
                        <ActionList label={t('settings.testNetworks.actionsLabel')}>
                            {custom && !active ? (
                                <ActionListItem
                                    icon={<Icon.PlayIcon />}
                                    title={t('settings.testNetworks.activateOnWallet')}
                                    description={t('settings.testNetworks.activateOnWalletLine', { name })}
                                    disabled={!devOn || !walletId || activation.busy}
                                    disabledReason={!devOn ? t('settings.testNetworks.needsDevMode') : !walletId ? t('settings.testNetworks.needsWallet') : t('settings.developer.activating')}
                                    onClick={() => {
                                        activation.reset();
                                        // With the unlocked signer pooled it activates at once;
                                        // otherwise the password field opens in place below.
                                        if (!activation.askPassword) {
                                            setActivating(true);
                                            activation.activate(undefined, descriptor);
                                            return;
                                        }
                                        setActivating((v) => !v);
                                    }}
                                    aria-expanded={activation.askPassword ? activating : undefined}
                                />
                            ) : null}
                            <ActionListItem
                                icon={<Icon.CoinsIcon />}
                                title={t('settings.testNetworks.getTestCoins')}
                                description={t('settings.testNetworks.getTestCoinsLine', { ticker: tickerOf(descriptor) })}
                                disabled={Boolean(faucetReason)}
                                disabledReason={faucetReason}
                                onClick={() => onOpen(`${FAUCET_PAGE_PREFIX}${descriptor.id}`)}
                            />
                            <ActionListItem
                                icon={<Icon.BroadcastIcon />}
                                title={t('settings.testNetworks.switchWallet', { kind: kindLabel(kind) })}
                                description={t('settings.testNetworks.switchWalletLine', { current: kindLabel(walletKind), kind: kindLabel(kind) })}
                                disabled={walletKind === kind}
                                disabledReason={t('settings.testNetworks.walletOnKind', { kind: kindLabel(kind) })}
                                onClick={() => onOpen('network-active')}
                            />
                            {custom ? (
                                <ActionListItem
                                    icon={<Icon.PencilIcon />}
                                    title={t('settings.testNetworks.editNetwork')}
                                    description={t('settings.testNetworks.editNetworkLine')}
                                    disabled={Boolean(changeReason) || busy}
                                    disabledReason={changeReason}
                                    onClick={() => onOpen(`${EDIT_CUSTOM_NETWORK_PAGE_PREFIX}${descriptor.id}`)}
                                />
                            ) : null}
                            {custom ? (
                                // Never red (ruling 2026-11-14).
                                <ActionListItem
                                    icon={<Icon.TrashIcon />}
                                    title={t('settings.testNetworks.removeNetwork')}
                                    description={t('settings.testNetworks.removeNetworkLine')}
                                    disabled={Boolean(changeReason) || busy}
                                    disabledReason={changeReason}
                                    onClick={onRemove}
                                />
                            ) : null}
                        </ActionList>
                        {activating && custom && !active && activation.askPassword ? (
                            <ActivateInPlace activation={activation} descriptor={descriptor} walletId={walletId} />
                        ) : null}
                    </>
                )}
                details={(
                    <dl className={pickerStyles.detailList} aria-label={t('settings.testNetworks.detailsLabel')}>
                        {details.map(([k, v]) => (
                            <div key={k} className={pickerStyles.detailRow}>
                                <dt className={pickerStyles.detailLabel}>{k}</dt>
                                <dd className={pickerStyles.detailValue}>{v}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            />
        </div>
    );
}

// --------------------------------------------------------------------------
// Add Custom Network and Edit Network.
// --------------------------------------------------------------------------

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Read "http://localhost:18080" into a descriptor endpoint
 * ({ defaultUrl: 'http://localhost', defaultPort: 18080 }), or null.
 *
 * @param {string} text
 */
export function parseEndpoint(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname) return null;
    const secure = url.protocol === 'https:' || url.protocol === 'wss:';
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return {
        defaultUrl: `${url.protocol}//${url.hostname}${path}`,
        defaultPort: url.port ? Number(url.port) : (secure ? 443 : 80),
    };
}

/**
 * The descriptor the guided form makes: the base network's keys, address
 * types and fee rules, with the name, ID, endpoints and look changed.
 *
 * @param {object} base   a built-in network (Add) or the network being edited (Edit)
 * @param {{ name: string, id: string, explorer: object, encoder: object, hub?: object | null, color?: string, ticker?: string, keepIcon?: boolean }} fields
 */
export function buildCustomDescriptor(base, { name, id, explorer, encoder, hub, color, ticker, keepIcon = false }) {
    const { isUserAdded: _isUserAdded, ...rest } = base || {};
    const out = {
        ...rest,
        id,
        displayName: name,
        icon: keepIcon && typeof rest.icon === 'string' ? rest.icon : '',
        color: color || rest.color,
        explorer,
        encoder,
    };
    if (hub) out.hub = hub;
    else delete out.hub;
    if (ticker) out.nativeTicker = ticker;
    else delete out.nativeTicker;
    return out;
}

function suggestId(id) {
    const stem = String(id || 'network').replace(/-(regtest|testnet|mainnet)$/, '');
    return `${stem}-lab-regtest`;
}

/**
 * @param {object} props
 * @param {string} [props.editChainId]   set on Edit Network: the custom network being changed
 * @param {(pageId: string) => void} [props.onReturnTo]
 */
export function CustomNetworkFormPage({
    editChainId = null,
    onReturnTo = () => {},
    onBack,
    backLabel,
    nested = true,
    variant: variantProp,
}) {
    const { shell } = useMessaging();
    const variant = variantProp || (shell === 'popup' ? 'small' : 'full');
    const { settings, error } = useSettings();
    const editing = typeof editChainId === 'string' && editChainId.length > 0;
    const title = editing ? t('settings.testNetworks.form.editTitle') : t('settings.testNetworks.form.addTitle');
    const header = <PageHeader nested={nested} onBack={onBack} backLabel={backLabel} title={titleCase(title)} />;
    const screen = (body) => (
        <Screen variant={variant} header={header} scrollKey={editing ? `${EDIT_CUSTOM_NETWORK_PAGE_PREFIX}${editChainId}` : ADD_CUSTOM_NETWORK_PAGE_ID} restoreScroll={false}>
            {body}
        </Screen>
    );
    if (error) return screen(<SettingsLoadError error={error} />);
    // The first settings read also installs this realm's custom networks, so
    // the form (and an edited network's values) mounts only once it lands.
    if (!settings) return screen(<Status text={t('common.loading')} />);
    if (editing && !chainRegistry().get(editChainId)) {
        return screen(<EmptyState title={t('settings.testNetworks.gone')} titleAs="h3" body={t('settings.testNetworks.goneBody')} />);
    }
    return screen(<CustomNetworkForm key={editChainId || 'add'} editChainId={editing ? editChainId : null} onReturnTo={onReturnTo} settings={settings} />);
}

function CustomNetworkForm({ editChainId, onReturnTo, settings }) {
    const { messaging } = useMessaging();
    const { showToast } = useToast();
    const bases = builtInRegtests();
    const editing = Boolean(editChainId);
    const original = editing ? chainRegistry().get(editChainId) || null : null;
    const [baseId, setBaseId] = useState(() => bases[0]?.id || '');
    const base = editing ? original : (bases.find((d) => d.id === baseId) || bases[0] || null);
    const [name, setName] = useState(() => (editing ? original?.displayName || '' : ''));
    const [id, setId] = useState(() => (editing ? original?.id || '' : ''));
    const [endpoints, setEndpoints] = useState(() => ({
        explorer: endpointText(base?.explorer),
        encoder: endpointText(base?.encoder),
        hub: endpointText(base?.hub),
    }));
    const [color, setColor] = useState(() => base?.color || '');
    const [ticker, setTicker] = useState(() => (editing ? original?.nativeTicker || '' : ''));
    const [json, setJson] = useState('');
    const formErrors = useFormErrors();
    const [busy, setBusy] = useState(false);

    // A new base fills the endpoints and colour from it.
    const chooseBase = (next) => {
        setBaseId(next);
        const d = bases.find((b) => b.id === next);
        if (!d) return;
        setEndpoints({ explorer: endpointText(d.explorer), encoder: endpointText(d.encoder), hub: endpointText(d.hub) });
        setColor(d.color || '');
    };

    const devOn = settings?.developerMode === true;
    const usingJson = json.trim().length > 0;

    const validate = () => {
        const next = {};
        if (usingJson) return next;
        if (!name.trim()) next['custom-network-name'] = t('settings.testNetworks.form.nameRequired');
        else if (name.trim().length > 64) next['custom-network-name'] = t('settings.testNetworks.form.nameTooLong');
        const cleanId = id.trim();
        if (!cleanId || cleanId.length > 64 || !ID_RE.test(cleanId)) {
            next['custom-network-id'] = t('settings.testNetworks.form.idInvalid');
        } else if (chainRegistry().has(cleanId) && cleanId !== editChainId) {
            next['custom-network-id'] = t('settings.testNetworks.form.idTaken', { name: networkName(chainRegistry().get(cleanId)) || cleanId, suggestion: suggestId(cleanId) });
        }
        for (const key of ['explorer', 'encoder']) {
            if (!parseEndpoint(endpoints[key])) next[`custom-network-${key}`] = t('settings.testNetworks.form.endpointInvalid');
        }
        if (endpoints.hub.trim() && !parseEndpoint(endpoints.hub)) next['custom-network-hub'] = t('settings.testNetworks.form.endpointInvalid');
        if (color.trim() && !COLOR_RE.test(color.trim())) next['custom-network-color'] = t('settings.testNetworks.form.colorInvalid');
        if (ticker.trim().length > 12) next['custom-network-ticker'] = t('settings.testNetworks.form.tickerInvalid');
        return next;
    };

    const descriptorFromForm = () => {
        if (usingJson) {
            if (json.length > MAX_CUSTOM_DESCRIPTOR_CHARS) throw new Error(t('settings.testNetworks.form.jsonTooLarge'));
            try {
                return JSON.parse(json);
            } catch (err) {
                throw new Error(t('settings.testNetworks.form.jsonInvalid', { error: err?.message || '' }));
            }
        }
        return buildCustomDescriptor(base, {
            name: name.trim(),
            id: id.trim(),
            explorer: parseEndpoint(endpoints.explorer),
            encoder: parseEndpoint(endpoints.encoder),
            hub: endpoints.hub.trim() ? parseEndpoint(endpoints.hub) : null,
            color: color.trim(),
            ticker: ticker.trim(),
            keepIcon: editing,
        });
    };

    // The host registered the network in ITS realm; in the popup and desktop
    // renderer this realm's registry is a separate instance, so install the
    // accepted descriptor here too or the pickers keep omitting it until the
    // next settings read. The web shell shares one instance (has() no-op).
    const mirrorAdd = (accepted) => {
        try {
            if (typeof accepted?.id === 'string' && !chainRegistry().has(accepted.id)) chainRegistry().addCustom(accepted);
        } catch { /* the host already accepted it; the next read re-hydrates */ }
    };
    const mirrorRemove = (chainId) => {
        try {
            if (chainRegistry().get(chainId)?.isUserAdded) chainRegistry().removeCustom(chainId);
        } catch { /* bundled or already gone */ }
    };

    const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const fieldErrors = validate();
        if (!formErrors.validate(fieldErrors)) return;
        if (typeof messaging?.addCustomChain !== 'function' || (editing && typeof messaging?.removeCustomChain !== 'function')) {
            formErrors.fail(t('settings.testNetworks.form.addUnwired'));
            return;
        }
        let descriptor;
        try {
            descriptor = descriptorFromForm();
        } catch (err) {
            formErrors.fail(err?.message || t('settings.testNetworks.form.addFailed'));
            return;
        }
        setBusy(true);
        try {
            if (editing) {
                // No host call replaces a network in one step: remove the old
                // descriptor, add the new one, and put the old one back if
                // the new one is refused.
                const { isUserAdded: _flag, ...previous } = original;
                await messaging.removeCustomChain({ chainId: original.id });
                mirrorRemove(original.id);
                try {
                    const r = await messaging.addCustomChain({ descriptor });
                    mirrorAdd(r?.descriptor ?? descriptor);
                } catch (err) {
                    try {
                        const back = await messaging.addCustomChain({ descriptor: previous });
                        mirrorAdd(back?.descriptor ?? previous);
                    } catch { /* the error below still names the refusal */ }
                    throw err;
                }
                showToast({ message: t('settings.testNetworks.form.saved', { name: descriptor.displayName || descriptor.id }), variant: 'success' });
            } else {
                const r = await messaging.addCustomChain({ descriptor });
                mirrorAdd(r?.descriptor ?? descriptor);
                const shownId = r?.descriptor?.id || descriptor?.id || '';
                // Say which descriptor the vault now holds, since a same-id add may keep the saved one.
                const message = r?.restored
                    ? t('settings.testNetworks.form.restored', { id: shownId })
                    : r?.replaced
                        ? t('settings.testNetworks.form.replaced', { id: shownId })
                        : t('settings.testNetworks.form.added', { name: descriptor?.displayName || shownId });
                showToast({ message, variant: 'success' });
            }
            onReturnTo(TEST_NETWORKS_PAGE_ID);
        } catch (err) {
            formErrors.fail(customChainErrorText(err, t('settings.testNetworks.form.addFailed')));
        } finally {
            setBusy(false);
        }
    };

    const shortEndpoint = (text) => {
        const p = parseEndpoint(text);
        return p ? `${p.defaultUrl.replace(/^[a-z]+:\/\//, '')}:${p.defaultPort}` : '';
    };
    const endpointSummary = [shortEndpoint(endpoints.explorer), shortEndpoint(endpoints.encoder)].filter(Boolean).join(', ');
    const lookSummary = [color.trim(), ticker.trim()].filter(Boolean).join(', ');
    const baseOptions = bases.map((d) => ({ value: d.id, label: networkName(d, false), icon: <NetworkMark descriptor={d} /> }));
    const disabled = busy || !devOn;

    return (
        <FormFrame
            id={editing ? 'edit-custom-network' : 'add-custom-network'}
            label={editing ? t('settings.testNetworks.form.editTitle') : t('settings.testNetworks.form.addTitle')}
            onSubmit={onSubmit}
            lead={(
                <>
                    <DevModeOffNotice settings={settings} />
                    {editing ? <Status text={t('settings.testNetworks.form.editNote')} /> : null}
                    {!editing && bases.length === 0 ? <Status text={t('settings.testNetworks.form.noBase')} /> : null}
                </>
            )}
            errors={formErrors}
            action={(
                <FormAction icon={editing ? <Icon.SaveIcon /> : <Icon.PlusIcon />} disabled={disabled}>
                    {busy
                        ? (editing ? t('send.saveRecipient.saving') : t('settings.developer.adding'))
                        : (editing ? t('settings.testNetworks.form.save') : t('settings.developer.addChain'))}
                </FormAction>
            )}
        >
            <FormSection id="custom-network-basics" main defaultOpen title={t('settings.testNetworks.form.network')} icon={Icon.DocumentIcon} summary={name} revealKey={(formErrors.errorFor('custom-network-name') || formErrors.errorFor('custom-network-id')) ? formErrors.attempt : 0}>
                {editing ? (
                    null
                ) : bases.length > 0 ? (
                    <Select
                        label={t('settings.testNetworks.form.startFrom')}
                        help={t('settings.testNetworks.form.startFromHelp')}
                        value={baseId}
                        onChange={(e) => chooseBase(e.target.value)}
                        options={baseOptions}
                        disabled={disabled || usingJson}
                    />
                ) : (
                    null
                )}
                <Input
                    id="custom-network-name"
                    label={t('settings.testNetworks.networkName')}
                    help={t('settings.testNetworks.form.nameHelp')}
                    placeholder={t('settings.testNetworks.form.namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={64}
                    disabled={disabled || usingJson}
                />
                <Input
                    id="custom-network-id"
                    label={t('settings.testNetworks.networkId')}
                    help={t('settings.testNetworks.form.idHelp')}
                    placeholder={t('settings.testNetworks.form.idPlaceholder')}
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={64}
                    className={styles.mono}
                    disabled={disabled || usingJson}
                />
            </FormSection>
            <FormSection id="custom-network-endpoints" title={t('settings.testNetworks.form.endpoints')} icon={Icon.LinkIcon} summary={endpointSummary} revealKey={['explorer', 'encoder', 'hub'].some((key) => formErrors.errorFor(`custom-network-${key}`)) ? formErrors.attempt : 0}>
                {['explorer', 'encoder', 'hub'].map((key) => (
                    <Input
                        key={key}
                        id={`custom-network-${key}`}
                        label={ENDPOINT_LABELS[key]()}
                        help={t('settings.testNetworks.form.endpointHelp')}
                        value={endpoints[key]}
                        onChange={(e) => setEndpoints((prev) => ({ ...prev, [key]: e.target.value }))}
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        optional={key === 'hub'}
                        disabled={disabled || usingJson}
                    />
                ))}
            </FormSection>
            <FormSection id="custom-network-look" optional title={t('renameAccount.look')} icon={Icon.PaletteIcon} summary={lookSummary} revealKey={(formErrors.errorFor('custom-network-color') || formErrors.errorFor('custom-network-ticker')) ? formErrors.attempt : 0}>
                <Input
                    id="custom-network-color"
                    label={t('settings.testNetworks.form.color')}
                    help={t('settings.testNetworks.form.colorHelp')}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    autoCapitalize="off"
                    spellCheck={false}
                    disabled={disabled || usingJson}
                />
                <Input
                    id="custom-network-ticker"
                    label={t('settings.testNetworks.form.ticker')}
                    help={t('settings.testNetworks.form.tickerHelp')}
                    placeholder={tickerOf(base)}
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    maxLength={12}
                    optional
                    disabled={disabled || usingJson}
                />
            </FormSection>
            <FormSection id="custom-network-json" optional title={t('settings.testNetworks.form.json')} icon={Icon.PasteIcon} summary={usingJson ? t('settings.testNetworks.form.jsonInUse') : t('settings.testNetworks.form.jsonSummary')}>
                <Textarea
                    id="custom-chain-descriptor"
                    label={t('settings.testNetworks.form.json')}
                    help={t('settings.testNetworks.form.jsonHelp')}
                    value={json}
                    onChange={(e) => setJson(e.target.value)}
                    rows={8}
                    maxLength={MAX_CUSTOM_DESCRIPTOR_CHARS}
                    spellCheck={false}
                    disabled={disabled}
                    className={styles.descriptor}
                />
            </FormSection>
        </FormFrame>
    );
}

// --------------------------------------------------------------------------
// Regtest Faucet.
// --------------------------------------------------------------------------

/**
 * The faucet page draws its own header so the History filter can sit in the
 * title bar (G04).
 *
 * @param {object} props
 * @param {string} [props.chainId]   the network to start on (from a network's page)
 * @param {{ id: string } | null} [props.activeWallet]
 * @param {{ id: string } | null} [props.activeAccount]
 * @param {(sel: { chainId: string, tick: string }) => void} [props.onNavigateToMint]
 * @param {() => void} [props.onBack]
 * @param {string} [props.backLabel]
 * @param {boolean} [props.nested]
 * @param {string} [props.variant]
 */
export function FaucetPage({
    chainId: startChainId = null,
    activeWallet,
    activeAccount,
    onNavigateToMint,
    onBack,
    backLabel,
    nested = true,
    variant: variantProp,
}) {
    const { shell } = useMessaging();
    const variant = variantProp || screenVariantFor(shell);
    const { settings, error } = useSettings();
    const [view, setView] = useState('request');
    const [query, setQuery] = useState('');
    const walletId = activeWallet?.id || null;
    const [history, setHistory] = useState(() => readFaucetHistory(walletId));
    useEffect(() => { setHistory(readFaucetHistory(walletId)); }, [walletId]);

    const header = (
        <PageHeader
            nested={nested}
            onBack={onBack}
            backLabel={backLabel}
            title={t('settings.testNetworks.faucet.title')}
            trailing={view === 'history' ? (
                <ListFilterMenu
                    query={query}
                    onQueryChange={setQuery}
                    label={t('settings.testNetworks.faucet.filter')}
                    searchPlaceholder={t('settings.testNetworks.faucet.searchPlaceholder')}
                    searchLabel={t('settings.testNetworks.faucet.search')}
                />
            ) : null}
        />
    );

    let body;
    if (error) {
        body = <SettingsLoadError error={error} />;
    } else if (!settings) {
        // No fee state yet, so no network can read as active or inactive.
        body = <Status text={t('common.loading')} />;
    } else {
        const tabsId = 'regtest-faucet-views';
        body = (
            <div className={styles.page}>
                <DevModeOffNotice settings={settings} />
                <Tabs
                    id={tabsId}
                    items={[
                        { id: 'request', label: t('settings.testNetworks.faucet.getCoins'), icon: <Icon.CoinsIcon />, controls: `${tabsId}-panel` },
                        { id: 'history', label: t('history.title'), icon: <Icon.HistoryIcon />, controls: `${tabsId}-panel` },
                    ]}
                    value={view}
                    onChange={setView}
                    aria-label={t('settings.testNetworks.faucet.tabsLabel')}
                />
                <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${view}`} data-view={view} className={styles.page}>
                    {view === 'request' ? (
                        <FaucetRequest
                            settings={settings}
                            startChainId={startChainId}
                            activeWallet={activeWallet}
                            activeAccount={activeAccount}
                            onNavigateToMint={onNavigateToMint}
                            lastEntry={history[0] || null}
                            onRecorded={() => setHistory(readFaucetHistory(walletId))}
                        />
                    ) : (
                        <FaucetHistoryList entries={history} query={query} />
                    )}
                </div>
            </div>
        );
    }
    return (
        <Screen variant={variant} header={header} scrollKey={`faucet-${view}`}>
            {body}
        </Screen>
    );
}

function FaucetRequest({ settings, startChainId, activeWallet, activeAccount, onNavigateToMint, lastEntry, onRecorded }) {
    const { messaging } = useMessaging();
    const devOn = settings?.developerMode === true;
    const activeRegtests = chainRegistry().supportedChains()
        .filter((d) => d.networkKind === 'regtest' && isActiveOn(settings, d.id));
    const defaultChainId = (activeRegtests.find((d) => d.id === startChainId)
        || activeRegtests.find((d) => d.coin === 'bitcoin')
        || activeRegtests[0])?.id || '';
    const [chosenChainId, setChainId] = useState(defaultChainId);
    const chainId = activeRegtests.some((d) => d.id === chosenChainId) ? chosenChainId : defaultChainId;
    const descriptor = activeRegtests.find((d) => d.id === chainId) || null;
    const ticker = tickerOf(descriptor);
    const [minerUrl, setMinerUrl] = useState(DEFAULT_MINER_URL);
    const [amount, setAmount] = useState('10');
    const [address, setAddress] = useState(/** @type {string | null} */ (null));
    const [addressState, setAddressState] = useState('idle');
    const [busy, setBusy] = useState(false);
    const [statusText, setStatusText] = useState(/** @type {string | null} */ (null));
    const [errorText, setErrorText] = useState(/** @type {string | null} */ (null));
    const walletId = activeWallet?.id || null;
    const accountId = activeAccount?.id || null;

    // The miner pays the active account's newest address on this network.
    useEffect(() => {
        let cancelled = false;
        setAddress(null);
        if (!descriptor || !walletId || !accountId || typeof messaging?.getNewestAddress !== 'function') {
            setAddressState('none');
            return undefined;
        }
        setAddressState('loading');
        Promise.resolve(messaging.getNewestAddress(walletId, descriptor.id, accountId))
            .then((r) => {
                if (cancelled) return;
                setAddress(r?.address || null);
                setAddressState(r?.address ? 'ready' : 'none');
            })
            .catch(() => { if (!cancelled) setAddressState('none'); });
        return () => { cancelled = true; };
    }, [messaging, walletId, accountId, descriptor?.id]);

    if (activeRegtests.length === 0) {
        return <EmptyState title={t('settings.testNetworks.faucet.noNetworks')} titleAs="h3" body={t('settings.testNetworks.faucet.noNetworksBody')} />;
    }

    const onSubmit = async (event) => {
        event.preventDefault();
        if (busy || !descriptor) return;
        const amountNumber = Number(amount);
        if (amount.trim() === '' || !Number.isFinite(amountNumber) || amountNumber <= 0) {
            setErrorText(t('settings.testNetworks.faucet.amountInvalid', { ticker }));
            return;
        }
        setBusy(true);
        setStatusText(null);
        setErrorText(null);
        let result;
        try {
            result = await fundActiveWalletFromMiner({
                messaging,
                walletId,
                accountId,
                chainId: descriptor.id,
                chainDisplayName: networkName(descriptor),
                minerUrl,
                amount: amountNumber,
            });
        } catch (err) {
            result = { ok: false, error: err?.message };
        }
        const failure = result?.ok ? null : (result?.error || t('settings.testNetworks.faucet.failed'));
        if (walletId) {
            recordFaucetRequest({
                walletId,
                accountId: accountId || undefined,
                chainId: descriptor.id,
                amount: amount.trim(),
                ticker,
                address: result?.address || address || undefined,
                txid: result?.txid || undefined,
                status: failure ? 'failed' : 'sent',
                error: failure || undefined,
            });
            onRecorded?.();
        }
        if (failure) setErrorText(failure);
        else setStatusText(t('settings.testNetworks.faucet.sent', { amount: amount.trim(), ticker, address: result.address, transactionId: result.txid }));
        setBusy(false);
    };

    const unavailable = !devOn ? t('settings.testNetworks.needsDevMode') : null;
    const disabled = busy || Boolean(unavailable);
    const mintable = typeof onNavigateToMint === 'function' && descriptor?.coin === 'bitcoin';
    return (
        <>
            <FormFrame
                id="regtest-faucet"
                // Enter in Amount asks the miner, as the old faucet form did;
                // the closed Miner section's field follows it.
                submitFromAnyField
                label={t('settings.testNetworks.faucet.title')}
                onSubmit={onSubmit}
                walletId={walletId}
                status={[
                    errorText ? <Status key="error" text={errorText} tone="error" /> : null,
                    statusText ? <Status key="ok" text={statusText} tone="success" /> : null,
                ]}
                action={(
                    <FormAction icon={<Icon.CoinsIcon />} disabled={disabled || !descriptor}>
                        {busy ? t('settings.developer.sending') : t('settings.testNetworks.faucet.getCoins')}
                    </FormAction>
                )}
            >
                <FormSection id="faucet-request" main defaultOpen title={t('settings.testNetworks.faucet.requestSection')} icon={Icon.CoinsIcon} summary={`${amount} ${ticker}`}>
                    <NetworkField
                        value={chainId}
                        onChange={setChainId}
                        chainIds={activeRegtests.map((d) => d.id)}
                        chainRegistry={chainRegistry()}
                        help={t('settings.testNetworks.faucet.networkHelp')}
                        disabled={disabled}
                        notSource
                    />
                    <div className={styles.field}>
                        <span className={styles.fieldLabel}>{t('send.fields.to')}</span>
                        <span className={styles.fieldValue} data-faucet-address="">
                            {addressState === 'ready' && address ? (
                                <AddressText address={address} />
                            ) : addressState === 'loading' ? (
                                t('settings.testNetworks.faucet.toLoading')
                            ) : (
                                <span className={styles.reason}>{t('settings.testNetworks.faucet.noAddress', { name: networkName(descriptor) || chainId })}</span>
                            )}
                        </span>
                        <span className={styles.note}>{t('settings.testNetworks.faucet.toNote')}</span>
                    </div>
                    <Input
                        type="text"
                        label={t('settings.developer.amount', { coinTicker: ticker })}
                        help={t('settings.help.developer.faucetAmount', { coinTicker: ticker })}
                        inputMode="decimal"
                        enterKeyHint="go"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={disabled}
                    />
                </FormSection>
                <FormSection id="faucet-miner" title={t('settings.testNetworks.faucet.miner')} icon={Icon.GearIcon} summary={minerUrl.replace(/^[a-z]+:\/\//, '')}>
                    <Input
                        type="text"
                        label={t('settings.developer.minerUrl')}
                        help={t('settings.help.developer.minerUrl')}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={minerUrl}
                        onChange={(e) => setMinerUrl(e.target.value)}
                        disabled={disabled}
                    />
                </FormSection>
            </FormFrame>
            {lastEntry ? (
                <div className={styles.group}>
                    <div className={styles.groupLabel}>{t('settings.testNetworks.faucet.lastRequest')}</div>
                    {/* Safari needs an explicit list role because this class removes list styling. */}
                    <ul className={styles.card} role="list" aria-label={t('settings.testNetworks.faucet.lastRequest')}>
                        <FaucetHistoryRow entry={lastEntry} />
                    </ul>
                </div>
            ) : null}
            {mintable ? (
                <ActionList label={t('settings.testNetworks.faucet.mintLabel')}>
                    <ActionListItem
                        icon={<Icon.MintIcon />}
                        title={t('settings.testNetworks.faucet.mint')}
                        description={t('settings.testNetworks.faucet.mintLine')}
                        disabled={Boolean(unavailable) || busy}
                        disabledReason={unavailable}
                        onClick={() => onNavigateToMint({ chainId: descriptor.id, tick: 'XCHAIN' })}
                    />
                </ActionList>
            ) : null}
        </>
    );
}

function FaucetHistoryRow({ entry }) {
    const descriptor = chainRegistry().get(entry.chainId) || { id: entry.chainId, displayName: entry.chainId };
    const failed = entry.status === 'failed';
    return (
        <li data-faucet-entry={entry.id}>
            <ListRow
                leading={<NetworkMark descriptor={descriptor} />}
                title={t('settings.testNetworks.faucet.amountLine', { amount: entry.amount, ticker: entry.ticker })}
                subtitle={entry.address ? (
                    <span className={styles.historyAddress}><AddressText address={entry.address} size="sm" /></span>
                ) : (failed && entry.error ? entry.error : networkName(descriptor))}
                trailing={(
                    <span className={styles.historyTrailing}>
                        <span title={formatLocalDateTime(entry.at) || undefined}>{formatActivityTime(entry.at)}</span>
                        <span className={failed ? styles.statusFailed : styles.statusSent}>
                            {failed ? t('history.status.failed') : t('settings.testNetworks.faucet.statusSent')}
                        </span>
                    </span>
                )}
                tooltip={failed && entry.error ? entry.error : undefined}
            />
        </li>
    );
}

function FaucetHistoryList({ entries, query }) {
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return entries;
        return entries.filter((entry) => {
            const name = networkName(chainRegistry().get(entry.chainId)) || entry.chainId;
            return [name, entry.chainId, entry.address, entry.txid, entry.amount, entry.ticker, entry.error,
                entry.status === 'failed' ? t('history.status.failed') : t('settings.testNetworks.faucet.statusSent')]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q));
        });
    }, [entries, query]);
    if (entries.length === 0) {
        return <EmptyState title={t('settings.testNetworks.faucet.historyEmpty')} titleAs="h3" body={t('settings.testNetworks.faucet.historyEmptyBody')} />;
    }
    if (shown.length === 0) {
        return <EmptyState title={t('settings.testNetworks.faucet.noMatches')} titleAs="h3" body={t('settings.testNetworks.faucet.noMatchesBody', { query })} />;
    }
    return (
        /* Safari needs an explicit list role because this class removes list styling. */
        <ul className={styles.card} role="list" aria-label={t('settings.testNetworks.faucet.historyLabel')}>
            {shown.map((entry) => <FaucetHistoryRow key={entry.id} entry={entry} />)}
        </ul>
    );
}
