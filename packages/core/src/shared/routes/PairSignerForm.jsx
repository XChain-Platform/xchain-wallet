// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    AddressText,
    Button,
    EmptyState,
    FormPage,
    Input,
    Icon,
    ListRow,
    OptionSwitch,
    StatusMessage,
    Tabs,
    useFormErrors,
} from '@xchain-wallet/core/ui';
import {
    signers as signersLib,
} from '@xchain-wallet/core';
import { signerVendorLogoUrl } from '../../branding/branding.js';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';
import { hardwareNetworkSupport } from '../../flows/hardwareWallet.js';
import { getActiveNetwork } from '../../flows/effectiveNetwork.js';
import { NAME_MAX_LENGTH, hasVisibleText } from '../../util/display_name.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { safeHttpUrl } from '../utils/externalUrl.js';
import { activeNetworkLabel } from '../utils/activeNetworkSwitch.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { isWebHidSupported, detectBrowserFamilyForWebHidHint } from '../utils/webhidSupport.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import {
    accountRowsByIndex, addressRows, indexesMissingChain, selectedAccountEntries,
} from '../utils/accountViews.js';
import { isWrongAppError } from '../../signers/hardwareSession.js';
import { pairedSessionSigner } from '../../signers/hardwareReconnect.js';
import {
    checkLedgerIdentity,
    ledgerAppNameFor,
    ledgerIdentitiesFromAccounts,
} from '../../signers/ledgerIdentity.js';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { TickerIcon } from '../components/TickerIcon.jsx';
import {
    HardwareDeviceCard, HardwareStatusLine, hardwareModelName, hardwareVendorName,
} from '../components/hardware/index.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/hardwareConnect.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/home.js';
import styles from './PairSignerForm.module.css';

const { checkFirmware } = signersLib;
const chainRegistry = defaultRegistry();

// The three steps, in order; the header names the current one.
const STEPS = ['choose', 'connect', 'accounts'];
const STEP_NAME_KEY = {
    choose: 'hardwareConnect.step.choose',
    connect: 'hardwareConnect.step.connect',
    accounts: 'hardwareConnect.step.accounts',
};
// The connect step's three statuses; a failure marks the one that broke.
const PLUGGED_IN = 0;
const UNLOCK = 1;
const ALLOW = 2;
// The form-level error key for "nothing is on to save".
const SELECTION_ERROR = 'hardware-accounts';

/**
 * Connect a hardware wallet (Trezor or Ledger) as its own wallet, in three
 * steps under one "Hardware Wallet" header:
 *
 *   1 Choose:   Trezor or Ledger rows, under the keys-stay-on-the-device notice.
 *   2 Connect:  the device card, the Plugged in / Unlock / Allow XChain
 *               statuses, Try again and Help with connecting, and a green
 *               Continue once all three are done. The shell's pairing factory
 *               (Trezor Connect popup or Ledger WebHID) runs here.
 *   3 Accounts: the device card, the Wallet name, and a Networks | Accounts |
 *               Addresses toggle (G131: one account per account number across
 *               networks, three views of it). Networks lists every network of
 *               the wallet's current environment (Mainnet or Testnet, Regtest
 *               with Developer mode): each one the device signs (from
 *               `hardwareNetworkSupport`) is a switch row, on by default, and
 *               one it cannot sign keeps its red X and reason. Accounts is one
 *               switch row per account number ("3 addresses on 3 networks"),
 *               plus Add Account, which adds the next number on every network
 *               that is on. Addresses lists what was read in one list, by
 *               network and then account, with each balance. Turning a network or an
 *               account off leaves it out of the counts, the Addresses view
 *               and the save; turning a network on reads it for every account
 *               asked for so far. The green Add Wallet saves.
 *
 * A Ledger runs one app per coin and the open app answers only its own
 * coin, so step 3 reads each network through whichever app is open and
 * keeps what it read. A network whose app is not open waits in its row
 * with "Open the Litecoin app on your Ledger" and Try again, which reopens
 * the Ledger in the app now open (the same device, checked by the keys
 * already read) and reads every waiting network that app serves. Add Wallet
 * saves the networks read so far. After setup the shared Add Account page
 * reads the same way (createAccount keeps the networks the open app reads)
 * and adds one new account number; a network left waiting is filled into
 * its account later from that account's Account Details, Addresses tab.
 *
 * Saving: in `add` mode (a vault is open) Add Wallet saves through
 * `messaging.addHardwareWallet` and reports the new wallet id to
 * `onCreated`. In `first` mode (a fresh install, no vault) there is nothing
 * to save into yet, so Add Wallet hands the collected wallet to
 * `onDeviceReady`; the shell shows the Set Password page and then calls
 * `messaging.createHardwareWallet` with that payload plus the password.
 *
 * Back leaves each step for the one before it, and leaves the flow from
 * step 1; there is no Cancel or "choose another device" button.
 *
 * @param {object} props
 * @param {'first' | 'add'} [props.mode]  defaults to `add` with a walletId (an open vault), else `first`
 * @param {string} [props.walletId]       the open wallet, when the flow starts from inside one
 * @param {null | (() => Promise<{ signer: any, pairingInfo: PairingInfo }>)} [props.pairTrezor]
 * @param {null | (() => Promise<{ signer: any, pairingInfo: PairingInfo }>)} [props.pairLedger]
 * @param {() => void} props.onBack
 * @param {(walletId: string) => void} [props.onCreated]  add mode: the new hardware wallet was saved
 * @param {(payload: HardwareWalletDraft) => void} [props.onDeviceReady]  first mode: the wallet to create after Set Password
 * @param {(signerId: string, signer: any) => void} [props.onSignerPaired]  add mode: the saved signer record id and the live signer, for the shell's signer bridge
 * @param {() => void} [props.onPaired]   legacy finish callback, used when onCreated is absent
 * @param {() => void} [props.onOpenInTab]
 * @param {'mainnet' | 'testnet' | 'regtest'} [props.activeNetwork]  the environment to list; read from settings when absent
 *
 * @typedef {{ vendor: 'trezor' | 'ledger', model: string, deviceIdentifier: string, firmwareVersion: string | null,
 *   appName?: string, chainIds?: string[] }} PairingInfo  a Ledger also names its open app and the chains that app serves
 * @typedef {{ chainId: string, accountIndex: number, address: string, publicKey: string, derivationPath: string, addressType: string }} HardwareAccount
 * @typedef {{ name: string, device: PairingInfo, accounts: HardwareAccount[], signer: any }} HardwareWalletDraft
 */
export function PairSignerForm({
    mode: modeProp,
    walletId,
    pairTrezor,
    pairLedger,
    onBack,
    onCreated,
    onDeviceReady,
    onSignerPaired,
    onPaired,
    onOpenInTab,
    activeNetwork: activeNetworkProp,
}) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const mode = modeProp === 'first' || modeProp === 'add' ? modeProp : (walletId ? 'add' : 'first');

    const [step, setStep] = useState(/** @type {'choose' | 'connect' | 'accounts'} */ ('choose'));
    const [helpOpen, setHelpOpen] = useState(false);
    const [vendor, setVendor] = useState(/** @type {'trezor' | 'ledger' | null} */ (null));
    // working: the factory is running; ready: all three statuses done; failed: one broke.
    const [connection, setConnection] = useState(
        /** @type {{ state: 'working' | 'ready' | 'failed', failedAt?: number, message?: string }} */ ({ state: 'working' }),
    );
    // The first pairing names the device (card, saved identifier); a later
    // Try again in another Ledger app replaces only the live signer and the
    // chains that app serves.
    const [pairingInfo, setPairingInfo] = useState(/** @type {PairingInfo | null} */ (null));
    const [liveSigner, setLiveSigner] = useState(/** @type {any | null} */ (null));
    // The chains the open Ledger app serves (pairingInfo.chainIds); null when
    // the device signs every chain from one session, as a Trezor does.
    const [servedChainIds, setServedChainIds] = useState(/** @type {string[] | null} */ (null));
    const [name, setName] = useState('');
    const formErrors = useFormErrors();
    const [view, setView] = useState('networks');
    const [accounts, setAccounts] = useState(/** @type {HardwareAccount[]} */ ([]));
    // A Ledger network whose app is not open: 'app' waits for the user to
    // open it, 'reading' is its Try again in progress. A network read, or
    // not tried yet, has no entry.
    const [chainWait, setChainWait] = useState(/** @type {Record<string, 'app' | 'reading'>} */ ({}));
    // The account numbers asked for so far (Add Account adds one), which a
    // network read late through Try again, or turned on later, reads too.
    const [accountIndexes, setAccountIndexes] = useState(/** @type {number[]} */ ([0]));
    // The networks and account numbers switched off: left out of the counts,
    // the Addresses view and the save, but what was read is kept, so turning
    // one back on needs no new device read.
    const [offChains, setOffChains] = useState(/** @type {string[]} */ ([]));
    const [offIndexes, setOffIndexes] = useState(/** @type {number[]} */ ([]));
    // Networks switched on while a read was running, read once it settles.
    const [pendingChains, setPendingChains] = useState(/** @type {string[]} */ ([]));
    const accountsRef = useRef(/** @type {HardwareAccount[]} */ ([]));
    accountsRef.current = accounts;
    const [balances, setBalances] = useState(/** @type {Record<string, { balance?: any, fiat?: any, currency?: string }>} */ ({}));
    const [finding, setFinding] = useState(false);
    const [findError, setFindError] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(/** @type {any} */ (null));
    const pairingAttempt = useRef(0);
    const findAttempt = useRef(0);
    // Bumped each time the account list starts over; a late answer for an
    // older list (a balance, a reopened Ledger) is dropped.
    const listSession = useRef(0);
    const reading = Object.values(chainWait).includes('reading');
    const tabsId = useId();

    const webHidSupported = isWebHidSupported();
    const browserFamily = detectBrowserFamilyForWebHidHint();

    // The environment decides which networks the flow offers. Before a vault
    // exists there are no settings, so a fresh install reads as Mainnet.
    useEffect(() => {
        if (activeNetworkProp || typeof messaging.getSettings !== 'function') return undefined;
        let cancelled = false;
        Promise.resolve()
            .then(() => messaging.getSettings())
            .then((record) => { if (!cancelled) setSettings(record || null); })
            .catch(() => { /* locked or no vault: Mainnet and USD */ });
        return () => { cancelled = true; };
    }, [messaging, activeNetworkProp]);
    const network = activeNetworkProp || getActiveNetwork(settings);
    const fiatCurrency = typeof settings?.fiatCurrency === 'string' && settings.fiatCurrency.trim()
        ? settings.fiatCurrency.trim()
        : 'USD';

    const vendorName = hardwareVendorName(vendor);
    const verdict = useMemo(() => (pairingInfo
        ? checkFirmware({
            vendor: pairingInfo.vendor,
            model: pairingInfo.model,
            version: pairingInfo.firmwareVersion ?? '',
        })
        : null), [pairingInfo]);
    const deviceName = verdict?.displayName || hardwareModelName(vendor, pairingInfo?.model);

    // Every network of the current environment, each with its support verdict.
    const chains = useSupportedChains(chainRegistry);
    const networks = useMemo(() => (vendor
        ? chains
            .filter((descriptor) => (descriptor.networkKind || 'mainnet') === network)
            .map((descriptor) => ({
                descriptor,
                support: hardwareNetworkSupport(vendor, descriptor.id) || { supported: false, reason: null },
            }))
        : []), [chains, network, vendor]);
    const supportedChainIds = useMemo(
        () => networks.filter((row) => row.support.supported).map((row) => row.descriptor.id),
        [networks],
    );
    // The supported networks that are on, in the list's order.
    const enabledChainIds = useMemo(
        () => supportedChainIds.filter((id) => !offChains.includes(id)),
        [supportedChainIds, offChains],
    );

    const runPairing = useCallback(async (v) => {
        const factory = v === 'trezor' ? pairTrezor : pairLedger;
        const attempt = ++pairingAttempt.current;
        setConnection({ state: 'working' });
        setPairingInfo(null);
        setLiveSigner(null);
        setServedChainIds(null);
        setError(null);
        try {
            const { pairingInfo: info, signer } = await factory();
            if (attempt !== pairingAttempt.current) return;
            const found = checkFirmware({
                vendor: info.vendor,
                model: info.model,
                version: info.firmwareVersion ?? '',
            });
            setPairingInfo(info);
            setLiveSigner(signer);
            setServedChainIds(servedBy(v, info));
            if (found?.status === 'unsupported') {
                // The device answered, but XChain may not use this firmware.
                setConnection({
                    state: 'failed',
                    failedAt: ALLOW,
                    message: firmwareUpdateAdvice(v, found.recommended),
                });
                return;
            }
            setConnection({ state: 'ready' });
        } catch (err) {
            if (attempt !== pairingAttempt.current) return;
            setConnection({ state: 'failed', ...pairingFailure(err, v) });
        }
    }, [pairTrezor, pairLedger]);

    function handlePickVendor(v) {
        const factory = v === 'trezor' ? pairTrezor : pairLedger;
        if (!factory || (v === 'ledger' && !webHidSupported)) return;
        setVendor(v);
        setName(t('hardwareConnect.accounts.defaultName', { vendor: hardwareVendorName(v) }));
        formErrors.reset();
        setHelpOpen(false);
        setStep('connect');
        runPairing(v);
    }

    // Accounts: read the given account numbers on the given networks, one
    // device request at a time. A Ledger network whose app is not open (not
    // among the open app's chains, or refused as the wrong app) waits for its
    // app; every network read is kept whatever happens to the others.
    const readAccounts = useCallback(async ({ chainIds, indexes, signer, served }) => {
        if (!signer || typeof signer.getAddresses !== 'function') return;
        const attempt = ++findAttempt.current;
        const session = listSession.current;
        setFinding(true);
        setFindError(null);
        const found = [];
        const read = [];
        const waiting = [];
        let failed = false;
        for (const chainId of chainIds) {
            if (vendor === 'ledger' && Array.isArray(served) && !served.includes(chainId)) {
                waiting.push(chainId);
                continue;
            }
            const descriptor = chainRegistry.get(chainId);
            // Ask for the type the wallet records, the same default the
            // software signer and createAccount use (Litecoin p2wpkh at
            // 84'). Left out, each device picks its own default (legacy
            // 44' for Litecoin), and the record would name the wrong type.
            const addressType = descriptor?.defaultAddressType || undefined;
            try {
                for (const accountIndex of indexes) {
                    // eslint-disable-next-line no-await-in-loop -- one device request at a time
                    const [derived] = await signer.getAddresses({
                        chainId,
                        accountIndex,
                        change: 0,
                        startIndex: 0,
                        count: 1,
                        addressType,
                    });
                    if (attempt !== findAttempt.current) return;
                    if (!derived?.address) continue;
                    found.push({
                        chainId,
                        accountIndex,
                        address: derived.address,
                        publicKey: derived.publicKey,
                        derivationPath: derived.path,
                        addressType: addressType || '',
                    });
                }
                read.push(chainId);
            } catch (err) {
                if (attempt !== findAttempt.current) return;
                if (vendor === 'ledger' && isWrongAppError(err)) {
                    waiting.push(chainId);
                    continue;
                }
                failed = true;
                break;
            }
        }
        setAccounts((current) => mergeAccounts(current, found));
        setChainWait((current) => {
            const next = { ...current };
            for (const chainId of read) delete next[chainId];
            for (const chainId of waiting) next[chainId] = 'app';
            // A Try again cut short by another failure keeps waiting.
            for (const [chainId, state] of Object.entries(next)) {
                if (state === 'reading') next[chainId] = 'app';
            }
            return next;
        });
        setFinding(false);
        if (failed) {
            setFindError(t('hardwareConnect.accounts.findFailed', { vendor: hardwareVendorName(vendor) }));
        }
        if (found.length && typeof messaging.hardwareBalances === 'function') {
            try {
                const rows = await messaging.hardwareBalances({
                    items: found.map(({ chainId, address }) => ({ chainId, address })),
                });
                if (session !== listSession.current || !Array.isArray(rows)) return;
                setBalances((current) => {
                    const next = { ...current };
                    for (const row of rows) {
                        if (row?.chainId && row?.address) next[balanceKey(row.chainId, row.address)] = row;
                    }
                    return next;
                });
            } catch {
                // A balance the indexer cannot give yet leaves the row without an amount.
            }
        }
    }, [messaging, vendor]);

    const networkKey = supportedChainIds.join(',');
    useEffect(() => {
        if (step !== 'accounts') return;
        listSession.current += 1;
        setAccounts([]);
        setBalances({});
        setChainWait({});
        setAccountIndexes([0]);
        // Every network the device signs starts on, as does Account 1.
        setOffChains([]);
        setOffIndexes([]);
        setPendingChains([]);
        readAccounts({ chainIds: supportedChainIds, indexes: [0], signer: liveSigner, served: servedChainIds });
        // Re-read when the step opens, the device is paired again from step 2,
        // or the environment's networks change; a per-network Try again swaps
        // the live signer without starting the list over.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, pairingInfo, networkKey]);

    // Add Account: exactly one new account, the next account number, read on
    // every network that is on.
    function handleAddAccount() {
        if (finding || reading) return;
        const next = Math.max(-1, ...accountIndexes) + 1;
        setAccountIndexes((current) => [...current, next]);
        if (enabledChainIds.length) {
            readAccounts({ chainIds: enabledChainIds, indexes: [next], signer: liveSigner, served: servedChainIds });
        }
    }

    // A network switched on is read for every account number that has no
    // address on it yet; switched off, it only drops out of the views and the
    // save. While a read is running the switch still moves and the network
    // waits in pendingChains, read as soon as the running read settles (a new
    // read started mid-read would drop the running one's answers).
    function handleToggleNetwork(chainId, on) {
        setOffChains((current) => (on ? current.filter((id) => id !== chainId) : [...new Set([...current, chainId])]));
        setPendingChains((current) => current.filter((id) => id !== chainId));
        // Changing what is on answers the "turn something on" error, as typing
        // into a field answers its own.
        formErrors.clear(SELECTION_ERROR);
        if (!on) return;
        if (finding || reading) {
            setPendingChains((current) => [...current, chainId]);
            return;
        }
        const missing = indexesMissingChain({ chainId, indexes: accountIndexes, addresses: accountsRef.current });
        if (missing.length) {
            readAccounts({ chainIds: [chainId], indexes: missing, signer: liveSigner, served: servedChainIds });
        }
    }

    useEffect(() => {
        if (finding || reading || saving || !pendingChains.length) return;
        const chainIds = pendingChains.filter((id) => !offChains.includes(id));
        setPendingChains([]);
        const indexes = [...new Set(chainIds.flatMap((chainId) => indexesMissingChain({
            chainId, indexes: accountIndexes, addresses: accountsRef.current,
        })))];
        if (chainIds.length && indexes.length) {
            readAccounts({ chainIds, indexes, signer: liveSigner, served: servedChainIds });
        }
        // Runs when a read settles or a network is queued; the rest is read fresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [finding, reading, saving, pendingChains]);

    function handleToggleAccount(index, on) {
        setOffIndexes((current) => (on ? current.filter((n) => n !== index) : [...new Set([...current, index])]));
        formErrors.clear(SELECTION_ERROR);
    }

    // Read everything again after a failed read, through the device as it is.
    function handleRetryAll() {
        if (finding || reading) return;
        readAccounts({ chainIds: enabledChainIds, indexes: accountIndexes, signer: liveSigner, served: servedChainIds });
    }

    // Try again on a network waiting for its Ledger app: reopen the Ledger in
    // the app open now (a click, which WebHID may need), make sure it is the
    // same device, then read every waiting network that app serves, this one
    // first, at every account number asked for so far.
    async function handleRetryChain(chainId) {
        if (finding || reading || saving) return;
        if (vendor !== 'ledger' || typeof pairLedger !== 'function') {
            readAccounts({ chainIds: [chainId], indexes: accountIndexes, signer: liveSigner, served: servedChainIds });
            return;
        }
        const waitingIds = Object.keys(chainWait)
            .filter((id) => id !== chainId && chainWait[id] === 'app' && !offChains.includes(id));
        const session = listSession.current;
        setChainWait((current) => ({ ...current, [chainId]: 'reading' }));
        setError(null);
        const backToWaiting = () => setChainWait((current) => ({ ...current, [chainId]: 'app' }));
        let live;
        try {
            live = await pairLedger();
        } catch (err) {
            if (session !== listSession.current) return;
            backToWaiting();
            setError(pairingFailure(err, 'ledger').message);
            return;
        }
        if (session !== listSession.current) return;
        let same;
        try {
            same = await isSameLedger(pairingInfo, accountsRef.current, live);
        } catch (err) {
            // A key read that fails proves nothing: the network keeps waiting.
            if (session !== listSession.current) return;
            backToWaiting();
            setError(pairingFailure(err, 'ledger').message);
            return;
        }
        if (session !== listSession.current) return;
        if (!same) {
            backToWaiting();
            setError(t('hardwareConnect.accounts.differentDevice'));
            return;
        }
        const served = servedBy('ledger', live?.pairingInfo);
        setLiveSigner(live.signer);
        setServedChainIds(served);
        await readAccounts({
            chainIds: [chainId, ...waitingIds],
            indexes: accountIndexes,
            signer: live.signer,
            served,
        });
    }

    async function handleAddWallet(event) {
        event.preventDefault();
        if (!pairingInfo || !vendor || saving || finding || reading) return;
        const trimmed = name.trim();
        // Only what is on is saved: one Account per account number that is
        // on, with an address on each network that is on (addHardwareWallet).
        const selected = selectedAccountEntries({ addresses: accounts, enabledChainIds, offIndexes });
        if (!formErrors.validate({
            'hardware-wallet-name': hasVisibleText(trimmed)
                ? null
                : t('hardwareConnect.accounts.nameRequired'),
            [SELECTION_ERROR]: selected.length ? null : t('hardwareConnect.accounts.nothingSelected'),
        })) return;
        const device = {
            vendor: pairingInfo.vendor,
            model: pairingInfo.model,
            deviceIdentifier: pairingInfo.deviceIdentifier,
            firmwareVersion: pairingInfo.firmwareVersion,
        };
        if (mode === 'first') {
            onDeviceReady?.({ name: trimmed, device, accounts: selected, signer: liveSigner });
            return;
        }
        if (typeof messaging.addHardwareWallet !== 'function') {
            setError(t('hardwareConnect.accounts.saveUnavailable'));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const result = await messaging.addHardwareWallet({ name: trimmed, device, accounts: selected });
            const signerId = result?.signer?.id;
            if (onSignerPaired && signerId && liveSigner) {
                // The saved record rides along, so the shell's bridge has the
                // Ledger's per-chain identities before it lists signers again.
                try { onSignerPaired(signerId, pairedSessionSigner(result.signer, liveSigner)); } catch { /* the shell's bridge is best effort */ }
            }
            setSaving(false);
            if (onCreated) onCreated(result?.wallet?.id);
            else (onPaired || onBack)();
        } catch (err) {
            setSaving(false);
            setError(userFacingMessage(err, t('hardwareConnect.accounts.saveFailed')));
        }
    }

    function handleBack() {
        if (saving) return;
        if (helpOpen) {
            setHelpOpen(false);
            return;
        }
        if (step === 'accounts') {
            findAttempt.current += 1;
            listSession.current += 1;
            setFinding(false);
            setChainWait({});
            setError(null);
            setStep('connect');
            return;
        }
        if (step === 'connect') {
            // A result that arrives after Back is dropped.
            pairingAttempt.current += 1;
            setVendor(null);
            setPairingInfo(null);
            setLiveSigner(null);
            setError(null);
            setStep('choose');
            return;
        }
        onBack();
    }

    const stepNumber = STEPS.indexOf(step) + 1;
    const pageHeader = (
        <PageHeader
            onBack={handleBack}
            backDisabled={saving}
            title={t('hardwareConnect.title')}
            subtitle={(
                <span aria-current="step">
                    {t('hardwareConnect.step', { step: stepNumber, name: t(STEP_NAME_KEY[step]) })}
                </span>
            )}
            trailing={onOpenInTab && step === 'choose' ? (
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon.ExternalLinkIcon />}
                    onClick={onOpenInTab}
                    aria-label={t('hardwareConnect.openInTab')}
                    title={t('hardwareConnect.openInTab')}
                />
            ) : null}
        />
    );
    // Before a wallet exists, onboarding shows only this page header. In add
    // mode the unlocked shell supplies its app header above the same page header.
    const header = pageHeader;
    // Every step and its responsive FormPage share one form-width column.
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={styles.column} data-hardware-connect-column="">
                {children}
            </div>
        </Screen>
    );

    if (step === 'choose') {
        const ledgerReason = !pairLedger
            ? t('hardwareConnect.vendor.unavailable')
            : !webHidSupported
                ? webHidReason(browserFamily)
                : null;
        return wrap(
            <FormPage
                label={t('hardwareConnect.choose.formLabel')}
                status={(
                    <StatusMessage variant="info" role="note" title={t('hardwareConnect.choose.noticeLead')}>
                        {t('hardwareConnect.choose.notice')}
                    </StatusMessage>
                )}
            >
                <section className={styles.group}>
                    <ActionList label={t('hardwareConnect.choose.listLabel')}>
                        <ActionListItem
                            icon={<VendorLogo vendor="trezor" />}
                            title={t('hardwareConnect.vendor.trezor')}
                            description={t('hardwareConnect.vendor.trezorModels')}
                            disabled={!pairTrezor}
                            disabledReason={t('hardwareConnect.vendor.unavailable')}
                            onClick={() => handlePickVendor('trezor')}
                            data-vendor="trezor"
                        />
                        <ActionListItem
                            icon={<VendorLogo vendor="ledger" />}
                            title={t('hardwareConnect.vendor.ledger')}
                            description={t('hardwareConnect.vendor.ledgerModels')}
                            disabled={Boolean(ledgerReason)}
                            disabledReason={ledgerReason}
                            onClick={() => handlePickVendor('ledger')}
                            data-vendor="ledger"
                        />
                    </ActionList>
                </section>
            </FormPage>,
        );
    }

    if (step === 'connect' && helpOpen) {
        const lines = [
            t('hardwareConnect.help.cable'),
            t('hardwareConnect.help.pin', { vendor: vendorName }),
            vendor === 'ledger'
                ? t('hardwareConnect.help.ledgerApp')
                : t('hardwareConnect.help.trezorPopup'),
            t('hardwareConnect.help.otherApps'),
            t('hardwareConnect.help.browser'),
        ];
        return wrap(
            <FormPage
                label={t('hardwareConnect.help.formLabel')}
                status={(
                    <StatusMessage
                        variant="info"
                        role="note"
                        title={t('hardwareConnect.help.lead', { vendor: vendorName })}
                    >
                        {lines.map((line) => <p key={line}>{line}</p>)}
                    </StatusMessage>
                )}
            />,
        );
    }

    if (step === 'connect') {
        const working = connection.state === 'working';
        const ready = connection.state === 'ready';
        const failedAt = connection.state === 'failed' ? connection.failedAt ?? PLUGGED_IN : null;
        const statusSteps = [
            t('hardwareConnect.connect.pluggedIn'),
            t('hardwareConnect.connect.unlock'),
            t('hardwareConnect.connect.allow'),
        ].map((label, index) => ({ label, state: connectStepState(connection.state, failedAt, index) }));
        const cardStatus = ready || (failedAt !== null && failedAt > UNLOCK)
            ? 'found'
            : failedAt === UNLOCK ? 'unlock' : 'not-connected';
        const failedMessage = connection.state === 'failed' ? connection.message : null;
        return wrap(
            <FormPage
                label={t('hardwareConnect.connect.formLabel')}
                status={[
                    failedMessage ? <StatusMessage key="connection-error" variant="error">{failedMessage}</StatusMessage> : null,
                    verdict ? <FirmwareBanner key="firmware" verdict={verdict} vendor={vendor} /> : null,
                ]}
                actions={ready ? (
                    <Button
                        type="button"
                        variant="success"
                        block
                        icon={<Icon.ArrowRightIcon />}
                        onClick={() => setStep('accounts')}
                    >
                        {t('hardwareConnect.connect.continue')}
                    </Button>
                ) : null}
            >
                <HardwareDeviceCard
                    vendor={vendor}
                    model={pairingInfo?.model}
                    name={pairingInfo ? deviceName : undefined}
                    status={cardStatus}
                />
                <HardwareStatusLine label={t('hardwareConnect.connect.statusLabel')} steps={statusSteps} />
                <section className={styles.group}>
                    <ActionList label={t('hardwareConnect.connect.optionsLabel')}>
                        <ActionListItem
                            icon={<Icon.RefreshIcon />}
                            title={t('hardwareConnect.connect.tryAgain')}
                            description={t('hardwareConnect.connect.tryAgainLine')}
                            disabled={working}
                            onClick={() => runPairing(vendor)}
                        />
                        <ActionListItem
                            icon={<Icon.InfoIcon />}
                            title={t('hardwareConnect.connect.help')}
                            description={t('hardwareConnect.connect.helpLine')}
                            onClick={() => setHelpOpen(true)}
                        />
                    </ActionList>
                </section>
            </FormPage>,
        );
    }

    // Step 3: Accounts.
    const panelId = `${tabsId}-panel`;
    return wrap(
        <FormPage
            label={t('hardwareConnect.accounts.formLabel')}
            onSubmit={handleAddWallet}
            errors={formErrors}
            status={[
                error ? <StatusMessage key="account-error" variant="error">{error}</StatusMessage> : null,
                findError ? (
                    <StatusMessage
                        key="find-error"
                        variant="error"
                        recovery={{
                            label: t('common.tryAgain'),
                            onAction: handleRetryAll,
                        }}
                    >
                        {findError}
                    </StatusMessage>
                ) : null,
                finding ? (
                    <StatusMessage key="finding" variant="status" busy>
                        {t('hardwareConnect.accounts.finding', { vendor: vendorName })}
                    </StatusMessage>
                ) : null,
                supportedChainIds.length === 0 ? (
                    <StatusMessage key="no-networks" variant="info" role="note">
                        {t('hardwareConnect.accounts.none', { device: deviceName })}
                    </StatusMessage>
                ) : null,
            ]}
            actions={(
                <Button
                    type="submit"
                    variant="success"
                    block
                    icon={<Icon.PlusIcon />}
                    loading={saving}
                    disabled={finding || reading}
                >
                    {t('hardwareConnect.accounts.addWallet')}
                </Button>
            )}
        >
            <HardwareDeviceCard vendor={vendor} model={pairingInfo?.model} name={deviceName} status="found" />
            <Input
                id="hardware-wallet-name"
                label={t('hardwareConnect.accounts.name')}
                help={t('hardwareConnect.accounts.nameHelp')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                maxLength={NAME_MAX_LENGTH}
            />
            <div className={styles.tabbed}>
                <Tabs
                    id={tabsId}
                    aria-label={t('hardwareConnect.accounts.tabsLabel')}
                    items={[
                        { id: 'networks', label: t('hardwareConnect.accounts.networksTab'), icon: <Icon.ForkIcon /> },
                        { id: 'accounts', label: t('hardwareConnect.accounts.accountsTab'), icon: <Icon.WalletIcon /> },
                        { id: 'addresses', label: t('home.addresses'), icon: <Icon.AddressIcon /> },
                    ]}
                    value={view}
                    onChange={setView}
                    panelId={panelId}
                />
                <div id={panelId} role="tabpanel" aria-labelledby={`${tabsId}-tab-${view}`}>
                    {view === 'networks' ? (
                        <NetworkList
                            rows={networks}
                            deviceName={deviceName}
                            vendorName={vendorName}
                            chainWait={chainWait}
                            offChains={offChains}
                            busy={finding || reading || saving}
                            onRetryChain={handleRetryChain}
                            onToggle={handleToggleNetwork}
                        />
                    ) : null}
                    {view === 'accounts' ? (
                        <AccountList
                            rows={accountRowsByIndex({ indexes: accountIndexes, addresses: accounts, enabledChainIds })}
                            offIndexes={offIndexes}
                            vendorName={vendorName}
                            hasNetworks={supportedChainIds.length > 0}
                            onAddAccount={handleAddAccount}
                            onToggle={handleToggleAccount}
                            waiting={networks
                                .filter((row) => row.support.supported
                                    && !offChains.includes(row.descriptor.id)
                                    && chainWait[row.descriptor.id])
                                .map((row) => ({ descriptor: row.descriptor, state: chainWait[row.descriptor.id] }))}
                            busy={finding || reading || saving}
                            onRetryChain={handleRetryChain}
                        />
                    ) : null}
                    {view === 'addresses' ? (
                        <AddressList
                            rows={addressRows({ indexes: accountIndexes, addresses: accounts, enabledChainIds, offIndexes })}
                            balances={balances}
                            fiatCurrency={fiatCurrency}
                        />
                    ) : null}
                </div>
            </div>
        </FormPage>,
    );
}

function VendorLogo({ vendor }) {
    const src = signerVendorLogoUrl(vendor);
    return src ? <img className={styles.vendorLogo} src={src} alt="" width="28" height="28" /> : null;
}

// Each connect status before the failed one is done; the failed one is red;
// later ones wait. While the factory runs the first status is in progress.
function connectStepState(state, failedAt, index) {
    if (state === 'ready') return 'done';
    if (state === 'working') return index === PLUGGED_IN ? 'active' : 'todo';
    if (index < failedAt) return 'done';
    if (index === failedAt) return 'failed';
    return 'todo';
}

function balanceKey(chainId, address) {
    return `${chainId}|${address}`;
}

function networkTitle(descriptor) {
    const kind = descriptor.networkKind || 'mainnet';
    if (kind === 'mainnet') return descriptor.displayName;
    return t('hardwareConnect.accounts.networkName', {
        name: descriptor.displayName,
        network: activeNetworkLabel(kind),
    });
}

// The one-line status of a network waiting for its Ledger app.
function waitLine(state, descriptor, vendorName) {
    if (state === 'reading') return t('hardwareConnect.accounts.finding', { vendor: vendorName });
    const app = ledgerAppNameFor(descriptor.id);
    return app
        ? t('hardwareConnect.accounts.openApp', { app })
        : t('hardwareConnect.accounts.openAppAny');
}

// A network waiting for its Ledger app: one chevron row whose tap is Try
// again. It becomes a switch row once the network is read.
function WaitingRow({ descriptor, state, vendorName, busy, onRetryChain }) {
    return (
        <ListRow
            className={styles.row}
            leading={<TickerIcon chainId={descriptor.id} tick={tickerForDescriptor(descriptor)} context="list" />}
            title={networkTitle(descriptor)}
            subtitle={waitLine(state, descriptor, vendorName)}
            chevron
            disabled={busy ? true : undefined}
            aria-label={t('hardwareConnect.accounts.tryAgainOn', { network: networkTitle(descriptor) })}
            onClick={() => onRetryChain(descriptor.id)}
        />
    );
}

/**
 * Networks: each network the device signs is a switch row (G118), on unless
 * switched off; one it cannot sign keeps its red X and the reason; a Ledger
 * network waiting for its app is its Try again row.
 */
function NetworkList({
    rows, deviceName, vendorName, chainWait = {}, offChains = [], busy = false, onRetryChain, onToggle,
}) {
    return (
        <ul className={styles.list} aria-label={t('hardwareConnect.accounts.networksLabel')}>
            {rows.map(({ descriptor, support }) => {
                const ok = Boolean(support.supported);
                const wait = ok ? chainWait[descriptor.id] : undefined;
                const on = ok && !offChains.includes(descriptor.id);
                const icon = <TickerIcon chainId={descriptor.id} tick={tickerForDescriptor(descriptor)} context="list" />;
                let row;
                if (wait && on) {
                    row = <WaitingRow descriptor={descriptor} state={wait} vendorName={vendorName} busy={busy} onRetryChain={onRetryChain} />;
                } else if (ok) {
                    row = (
                        <OptionSwitch
                            icon={icon}
                            label={networkTitle(descriptor)}
                            description={support.reason || t('hardwareConnect.accounts.supportedBy', { device: deviceName })}
                            checked={on}
                            onChange={(event) => onToggle(descriptor.id, event.target.checked)}
                        />
                    );
                } else {
                    row = (
                        <ListRow
                            className={styles.row}
                            leading={icon}
                            title={networkTitle(descriptor)}
                            subtitle={support.reason || t('hardwareConnect.accounts.notSupportedBy', { device: deviceName })}
                            trailing={(
                                <span
                                    className={styles.verdict}
                                    data-supported="false"
                                    role="img"
                                    aria-label={t('hardwareConnect.accounts.notSupported')}
                                >
                                    <Icon.XIcon />
                                </span>
                            )}
                        />
                    );
                }
                return (
                    <li
                        key={descriptor.id}
                        className={styles.item}
                        data-chain-id={descriptor.id}
                        data-supported={ok ? 'true' : 'false'}
                        data-on={ok ? String(on) : undefined}
                        data-wait={wait && on ? wait : undefined}
                    >
                        {row}
                    </li>
                );
            })}
        </ul>
    );
}

/** "3 addresses on 3 networks" for one account row. */
function accountCountsLine(addressCount, networkCount) {
    const addresses = addressCount === 1
        ? t('hardwareConnect.accounts.addressCountOne')
        : t('hardwareConnect.accounts.addressCountMany', { count: formatWithThousands(String(addressCount)) });
    const networks = networkCount === 1
        ? t('hardwareConnect.accounts.networkCountOne')
        : t('hardwareConnect.accounts.networkCountMany', { count: formatWithThousands(String(networkCount)) });
    return t('hardwareConnect.accounts.accountCounts', { addresses, networks });
}

/**
 * Accounts: one switch row per account number, never one per network, then
 * any network waiting for its Ledger app and the one Add Account row.
 */
function AccountList({
    rows,
    offIndexes = [],
    vendorName,
    hasNetworks,
    onAddAccount,
    onToggle,
    waiting = [],
    busy = false,
    onRetryChain,
}) {
    if (!hasNetworks) return null;
    return (
        <ul className={styles.list} aria-label={t('hardwareConnect.accounts.accountsLabel')}>
            {rows.map((row) => (
                <li key={`account:${row.index}`} className={styles.item} data-account-index={row.index}>
                    <OptionSwitch
                        icon={<Icon.WalletIcon />}
                        label={t('hardwareConnect.accounts.accountName', { number: row.index + 1 })}
                        description={accountCountsLine(row.addressCount, row.networkCount)}
                        checked={!offIndexes.includes(row.index)}
                        onChange={(event) => onToggle(row.index, event.target.checked)}
                    />
                </li>
            ))}
            {waiting.map(({ descriptor, state }) => (
                <li
                    key={`wait:${descriptor.id}`}
                    className={styles.item}
                    data-chain-id={descriptor.id}
                    data-wait={state}
                >
                    <WaitingRow descriptor={descriptor} state={state} vendorName={vendorName} busy={busy} onRetryChain={onRetryChain} />
                </li>
            ))}
            <li className={styles.item}>
                <ListRow
                    className={styles.row}
                    leading={<span className={styles.addIcon} aria-hidden="true"><Icon.PlusIcon /></span>}
                    title={t('accountPicker.add')}
                    subtitle={t('hardwareConnect.accounts.addAccountLine')}
                    chevron
                    aria-disabled={busy ? 'true' : undefined}
                    onClick={onAddAccount}
                />
            </li>
        </ul>
    );
}

/**
 * Addresses: one flat list ordered by network, then account number. Each row
 * shows the account, the full address where it fits (G99), and its balance.
 */
function AddressList({ rows, balances, fiatCurrency }) {
    if (!rows.length) {
        return (
            <EmptyState
                title={t('hardwareConnect.accounts.addressesEmpty')}
                body={t('hardwareConnect.accounts.addressesEmptyBody')}
            />
        );
    }
    return (
        <ul className={styles.list} aria-label={t('home.addresses')} data-hardware-address-list="">
            {rows.map((entry) => {
                const { chainId } = entry;
                const descriptor = chainRegistry.get(chainId);
                const ticker = descriptor ? tickerForDescriptor(descriptor) : '';
                const row = balances[balanceKey(chainId, entry.address)];
                const hasBalance = row && row.balance !== null && row.balance !== undefined && row.balance !== '';
                const fiat = row ? formatFiatAmount(row.fiat, row.currency || fiatCurrency) : '';
                const accountName = t('hardwareConnect.accounts.accountName', { number: entry.accountIndex + 1 });
                return (
                    <li
                        key={`${chainId}:${entry.accountIndex}:${entry.address}`}
                        className={styles.item}
                        data-chain-id={chainId}
                        data-account-index={entry.accountIndex}
                    >
                        <ListRow
                            className={styles.row}
                            leading={<TickerIcon chainId={chainId} tick={ticker} context="list" />}
                            title={<AddressText address={entry.address} size="sm" />}
                            subtitle={accountName}
                            trailingClassName={styles.amounts}
                            trailing={hasBalance ? (
                                <>
                                    <span className={styles.amount}>
                                        {t('hardwareConnect.accounts.amount', {
                                            amount: formatWithThousands(String(row.balance)),
                                            ticker,
                                        })}
                                    </span>
                                    {fiat ? <span className={styles.fiat}>{fiat}</span> : null}
                                </>
                            ) : null}
                        />
                    </li>
                );
            })}
        </ul>
    );
}

/** Accounts merged by network and account number; a new read replaces an old one. */
function mergeAccounts(current, found) {
    if (!found.length) return current;
    const key = (a) => `${a.chainId}:${a.accountIndex}`;
    const fresh = new Map(found.map((a) => [key(a), a]));
    const kept = current.map((a) => fresh.get(key(a)) || a);
    const have = new Set(current.map(key));
    return [...kept, ...found.filter((a) => !have.has(key(a)))];
}

/**
 * The chains the open device app serves, or null when one session serves
 * every chain (a Trezor, or a Ledger factory that does not say).
 * @param {string | null} vendor
 * @param {{ chainIds?: string[] } | null | undefined} info
 */
function servedBy(vendor, info) {
    return vendor === 'ledger' && Array.isArray(info?.chainIds) ? [...info.chainIds] : null;
}

/**
 * Whether the Ledger reopened in another app is the one this flow started
 * with. The keys already read are the proof when the open app serves one of
 * their chains; with nothing read yet, the same app must give the same
 * identifier, and another app cannot be checked (each app answers only its
 * own coin), so it is taken as the same device.
 *
 * @param {{ deviceIdentifier?: string, appName?: string } | null} first  the first pairing
 * @param {HardwareAccount[]} accounts  the accounts read so far
 * @param {{ signer?: any, pairingInfo?: { deviceIdentifier?: string, appName?: string, chainIds?: string[] } }} live
 * @returns {Promise<boolean>}
 */
async function isSameLedger(first, accounts, live) {
    const identities = ledgerIdentitiesFromAccounts(accounts);
    if (Object.keys(identities).length) {
        const { verdict } = await checkLedgerIdentity(
            { deviceIdentifier: first?.deviceIdentifier, identities },
            live,
        );
        return verdict !== 'different';
    }
    const app = live?.pairingInfo?.appName;
    if (first?.appName && app && first.appName === app) {
        return first.deviceIdentifier === live?.pairingInfo?.deviceIdentifier;
    }
    return true;
}

function webHidReason(browserFamily) {
    if (browserFamily === 'firefox') return t('hardwareConnect.vendor.webHidFirefox');
    if (browserFamily === 'safari') return t('hardwareConnect.vendor.webHidSafari');
    return t('hardwareConnect.vendor.webHidOther');
}

function isPairingCancellation(err) {
    if (err?.name === 'AbortError') return true;
    const message = String(err?.message || err || '');
    return /\bcancel(?:led|ed)?\b|\babort(?:ed)?\b|popup closed/i.test(message);
}

/**
 * Which connect status broke, and the plain advice for it. The pairing
 * factories throw function-prefixed precondition errors and Trezor Connect
 * hands back library internals, so the raw text never reaches the page.
 */
function pairingFailure(err, vendor) {
    const raw = String(
        err && typeof err === 'object' ? err.message || err.name || '' : err || '',
    );
    const v = hardwareVendorName(vendor);
    const tool = vendor === 'trezor' ? 'Trezor Suite' : 'Ledger Live';
    if (/firmware.*(?:too old|outdated|unsupported)|(?:too old|unsupported).*firmware/i.test(raw)) {
        return { failedAt: ALLOW, message: firmwareUpdateAdvice(vendor) };
    }
    if (/wrong app|app.*(?:not|isn't).*open|app is open|0x6a82|0x6e00|0x6d00|0x6511|cla_not_supported|ins_not_supported|(?:bitcoin test|testnet).*app/i.test(raw)) {
        return { failedAt: ALLOW, message: t('hardwareConnect.error.ledgerApp') };
    }
    if (/locked device|device (?:is )?locked|pin locked|0x5515|LockedDevice/i.test(raw)) {
        return { failedAt: UNLOCK, message: t('hardwareConnect.error.locked', { vendor: v }) };
    }
    if (/already open|failed to open the device|device is busy|in use by another/i.test(raw)) {
        return { failedAt: PLUGGED_IN, message: t('hardwareConnect.error.busy', { vendor: v, tool }) };
    }
    if (isPairingCancellation(err) || /reject|denied|declined|user.*closed|popup.*closed/i.test(raw)) {
        return { failedAt: ALLOW, message: t('hardwareConnect.error.cancelled', { vendor: v }) };
    }
    if (/no (?:compatible )?device|device.*not found|not found.*device|device.*disconnected|not connected|unable to claim|transport.*(?:unavailable|missing)|hid.*not found|no device selected/i.test(raw)) {
        return { failedAt: PLUGGED_IN, message: t('hardwareConnect.error.notFound', { vendor: v }) };
    }
    return { failedAt: PLUGGED_IN, message: t('hardwareConnect.error.generic', { vendor: v }) };
}

function firmwareUpdateAdvice(vendor, recommended) {
    const tool = vendor === 'trezor' ? 'Trezor Suite' : 'Ledger Live';
    const v = hardwareVendorName(vendor);
    return recommended
        ? t('hardwareConnect.error.firmwareVersion', { vendor: v, version: recommended, tool })
        : t('hardwareConnect.error.firmware', { vendor: v, tool });
}

// A firmware note that still lets the user continue (an advisory or an
// update that is due); a firmware XChain refuses is the Allow XChain failure.
function FirmwareBanner({ verdict, vendor }) {
    if (verdict.status === 'ok' || verdict.status === 'unsupported') return null;
    const tone = verdict.status === 'vulnerable' ? 'error' : 'warning';
    const updateUrl = safeHttpUrl(verdict.updateUrl);
    return (
        <StatusMessage variant={tone} role="alert">
            <p className={styles.bannerDetail}>{verdict.detail || firmwareUpdateAdvice(vendor, verdict.recommended)}</p>
            {updateUrl ? (
                <a
                    className={styles.updateLink}
                    href={updateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {t('hardwareConnect.updateLink')} <span aria-hidden="true">↗</span>
                </a>
            ) : null}
        </StatusMessage>
    );
}
