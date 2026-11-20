// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Add network for a hardware wallet account: read one network's address from
// the device through the app open now and fill it into an existing account.
// Account Details' Addresses tab (the shared account page, G131) offers it
// for each network a hardware account does not have; Add Account offers it
// for each network left waiting for its Ledger app. A wrong-app answer shows
// the connect step's line ("Open the Litecoin app on your Ledger") with Try
// again beside it.
//
// The read goes through `wallet.activateChain` with the device's signerId and
// the account's id, which every shell's host bridge carries to the same host
// route. The first read of a network on a Ledger records that network's
// identity; every later read and sign on it is checked against it.

import { useCallback, useRef, useState } from 'react';
import { ActionListItem } from '../ActionList.jsx';
import { AssetMark } from '../../../ui/AssetMark.jsx';
import { tickerForDescriptor } from '../../../registry/coinTicker.js';
import { isWrongAppError } from '../../../signers/hardwareSession.js';
import { ledgerAppNameFor } from '../../../signers/ledgerIdentity.js';
import { hardwareVendorName } from './HardwareDeviceCard.jsx';
import { hardwareNetworkSupport } from '../../../flows/hardwareWallet.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/hardwareConnect.js';
import '../../../i18n/locales/en/hardwareManage.js';

/**
 * @typedef {'reading' | 'app' | 'failed'} AddNetworkState
 *   reading: the device is being read; app: a Ledger has another app open
 *   than the network needs; failed: any other device answer
 */

/** The key one account's network is tracked under. */
export function addNetworkKey(accountId, chainId) {
    return `${accountId}:${chainId}`;
}

/** The account number a BIP44 path names (m/84'/0'/2'/0/0 is account 3). */
function accountNumber(derivationPath) {
    const match = /^m\/\d+'\/\d+'\/(\d+)'/.exec(String(derivationPath || ''));
    return match ? Number(match[1]) + 1 : 1;
}

/**
 * The networks each account could add: every network of the wallet's network
 * setting that the device's vendor signs and the account has no address on.
 * Accounts in number order, networks in registry order.
 *
 * @param {{
 *   accounts: Array<{id: string, index?: number}> | null,
 *   byChain: Record<string, any[]> | null,
 *   chains: Array<{id: string, networkKind?: string}>,
 *   vendor: string | null | undefined,
 *   network: string,
 * }} input
 * @returns {Array<{key: string, accountId: string, number: number, descriptor: any}>}
 */
export function hardwareNetworksToAdd({ accounts, byChain, chains, vendor, network }) {
    if (!vendor || !Array.isArray(accounts) || !accounts.length) return [];
    const candidates = (chains || []).filter((descriptor) => (descriptor.networkKind || 'mainnet') === network
        && hardwareNetworkSupport(vendor, descriptor.id)?.supported);
    const out = [];
    const ordered = [...accounts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const account of ordered) {
        const number = (Number.isInteger(account.index) ? account.index : 0) + 1;
        for (const descriptor of candidates) {
            const list = Array.isArray(byChain?.[descriptor.id]) ? byChain[descriptor.id] : [];
            // An address names its account by id; one that does not is
            // matched by the account number its path carries.
            const held = list.some((address) => (address?.accountId
                ? address.accountId === account.id
                : accountNumber(address?.derivationPath) === number));
            if (held) continue;
            out.push({ key: addNetworkKey(account.id, descriptor.id), accountId: account.id, number, descriptor });
        }
    }
    return out;
}

/**
 * The one line under a network row: what to do, or what is happening.
 * @param {AddNetworkState | undefined} state
 * @param {string} chainId
 * @param {string} vendor  'trezor' | 'ledger'
 * @returns {string}
 */
export function addNetworkLine(state, chainId, vendor) {
    const vendorName = hardwareVendorName(vendor);
    if (state === 'reading') return t('hardwareManage.addNetworkReading', { vendor: vendorName });
    if (state === 'app') {
        const app = ledgerAppNameFor(chainId);
        return app
            ? t('hardwareConnect.accounts.openApp', { app })
            : t('hardwareConnect.accounts.openAppAny');
    }
    if (state === 'failed') return t('hardwareManage.addNetworkFailed', { vendor: vendorName });
    return t('hardwareManage.addNetworkLine', { vendor: vendorName });
}

/**
 * Run Add network reads for one hardware wallet and keep each row's state.
 *
 * @param {{
 *   messaging: any,
 *   walletId: string,
 *   signerId: string | null | undefined,
 *   onAdded?: (accountId: string, chainId: string) => void,
 * }} opts
 * @returns {{
 *   states: Record<string, AddNetworkState>,
 *   add: (accountId: string, chainId: string) => Promise<boolean>,
 *   wait: (accountId: string, chainIds: string[]) => void,
 *   available: boolean,
 * }}
 */
export function useAddHardwareNetwork({ messaging, walletId, signerId, onAdded }) {
    const [states, setStates] = useState(/** @type {Record<string, AddNetworkState>} */ ({}));
    const inFlight = useRef(new Set());
    const available = Boolean(signerId) && typeof messaging?.activateChainRequest === 'function';

    const setState = useCallback((key, state) => {
        setStates((current) => {
            const next = { ...current };
            if (state) next[key] = state;
            else delete next[key];
            return next;
        });
    }, []);

    // Mark networks a flow already left waiting for their Ledger app.
    const wait = useCallback((accountId, chainIds) => {
        setStates((current) => {
            const next = { ...current };
            for (const chainId of chainIds) next[addNetworkKey(accountId, chainId)] = 'app';
            return next;
        });
    }, []);

    const add = useCallback(async (accountId, chainId) => {
        const key = addNetworkKey(accountId, chainId);
        if (!available || inFlight.current.has(key)) return false;
        inFlight.current.add(key);
        setState(key, 'reading');
        try {
            const result = await messaging.activateChainRequest({ walletId, chainId, signerId, accountId });
            if (result?.hardwareSkipped === 'wrong-app') {
                setState(key, 'app');
                return false;
            }
            const added = Array.isArray(result?.addresses)
                && result.addresses.some((entry) => entry?.accountId === accountId);
            const already = Array.isArray(result?.skippedAccountDetails)
                && result.skippedAccountDetails.some((entry) => (
                    entry?.accountId === accountId && entry?.reason !== 'custody-mismatch'
                ));
            if (!added && !already) {
                setState(key, 'failed');
                return false;
            }
            setState(key, null);
            onAdded?.(accountId, chainId);
            return true;
        } catch (err) {
            setState(key, isWrongAppError(err) ? 'app' : 'failed');
            return false;
        } finally {
            inFlight.current.delete(key);
        }
    }, [available, messaging, walletId, signerId, onAdded, setState]);

    return { states, add, wait, available };
}

/**
 * One network row: an Add row that reads the device on press, or, once a read
 * is under way or has to wait, a plain row with its line and Try again.
 *
 * @param {object} props
 * @param {any} props.descriptor             the network's chain descriptor
 * @param {string} props.title               the row's name
 * @param {string} props.vendor              'trezor' | 'ledger'
 * @param {AddNetworkState | undefined} props.state
 * @param {() => void} props.onAdd
 * @param {boolean} [props.disabled]
 */
export function HardwareNetworkRow({ descriptor, title, vendor, state, onAdd, disabled = false }) {
    const icon = <AssetMark chainId={descriptor.id} tick={tickerForDescriptor(descriptor)} isNative />;
    const line = addNetworkLine(state, descriptor.id, vendor);
    const reading = state === 'reading';
    return (
        <ActionListItem
            icon={icon}
            title={title}
            description={line}
            onClick={onAdd}
            disabled={disabled || reading}
            chevron={!reading}
            data-chain-id={descriptor.id}
            data-wait={state || undefined}
        />
    );
}
