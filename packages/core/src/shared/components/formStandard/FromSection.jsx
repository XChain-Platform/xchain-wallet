// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The required source section of the Wallet Form Standard, first on
// every transaction form: Network, then the From address.

import { AddressField } from '../../../ui/AddressField.jsx';
import { NetworkField } from '../../../ui/NetworkField.jsx';
import { WalletIcon } from '../../../ui/icons/index.jsx';
import { usePickedFieldError } from '../../../ui/formErrors.js';
import { FormSection } from './FormSection.jsx';
import { SummaryAddress, joinSummaryParts } from './SummaryAddress.jsx';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';
import styles from './formStandard.module.css';

/**
 * The "From" section (or "Signing with" on a form that signs rather than
 * sends). It is required, so it never carries the Optional tag, and it starts
 * closed with the summary "Bitcoin, <address>": the whole address when the
 * row has room, cut in the middle only as much as it needs (G99).
 *
 * It is presentational: the host keeps the source state it already has (the
 * active wallet address and its network by default) and passes it in. The
 * address-book icon calls `onOpenPicker`; the host then renders the shared
 * OwnAddressPickerScreen in place of the form, as every form does today,
 * never a radio list of addresses.
 *
 * With no source address the section shows `missing` (the host's notice
 * saying why) and opens, so the gap is never hidden behind a chevron. Pass
 * `missing` only once the addresses have loaded; while they load pass null.
 *
 * @param {object} props
 * @param {string} [props.id]                         default 'from'
 * @param {string} [props.title]                      default 'From'; 'Signing with' on signing forms
 * @param {import('react').ElementType} [props.icon]  default the wallet icon; a form about the address itself passes its own
 * @param {string} props.chainId                     the form's network
 * @param {string[]} [props.chainIds]                 networks offered; default [chainId]
 * @param {import('../../../registry/index.js').ChainRegistry} props.chainRegistry
 * @param {(chainId: string) => void} [props.onNetworkChange]  report a network pick up
 * @param {boolean} [props.lockNetwork]               the asset decides the network: the field shows it but cannot change it
 * @param {boolean} [props.disabled]                  the form is busy: neither the network nor the address can change
 * @param {string} [props.networkLabel]               default 'Network' ("Publishing network")
 * @param {import('react').ReactNode} [props.networkHelp]
 * @param {string | null} [props.address]             the source address
 * @param {() => void} [props.onOpenPicker]           open the host's address picker page; without it the address is fixed and the picker icon shows locked
 * @param {string} [props.addressLabel]               default 'From address'
 * @param {string} [props.pickerLabel]                accessible name of the address-book icon
 * @param {string} [props.pickerLockedReason]         why a fixed address cannot be changed, the locked icon's title ("The delegation's own address signs this clear")
 * @param {import('react').ReactNode} [props.addressHelp]
 * @param {import('react').ReactNode} [props.detail]  one muted line under the address ("0.4821 BTC available")
 * @param {import('react').ReactNode} [props.missing] shown in place of the address field when there is none
 * @param {string} [props.addressId]                  id of the address input, for an error summary to focus
 * @param {import('react').ReactNode} [props.summary] override the closed summary
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} [props.onOpenChange]
 * @param {boolean} [props.defaultOpen]
 * @param {unknown} [props.revealKey]
 * @param {string} [props.formErrorKey]               the entry of the form's error map (useFormErrors) about the source,
 *                                                    e.g. 'form:from': it outlines the From address red with its line
 *                                                    under it, reopens the section on every press, and leaves the map
 *                                                    when the network or the address changes
 * @param {import('react').ReactNode} [props.children] extra source fields after the address
 */
export function FromSection({
    id = 'from',
    title: titleProp,
    icon = WalletIcon,
    chainId,
    chainIds,
    chainRegistry,
    onNetworkChange,
    lockNetwork = false,
    disabled = false,
    networkLabel,
    networkHelp,
    address,
    onOpenPicker,
    addressLabel = t('send.fromSection.addressLabel'),
    pickerLabel,
    pickerLockedReason = t('send.fromSection.pickerLockedReason'),
    addressHelp,
    detail,
    missing,
    addressId,
    summary,
    open,
    onOpenChange,
    defaultOpen = false,
    revealKey,
    formErrorKey,
    children,
}) {
    // A pick on the address page or the network field reaches this section
    // as a new value, so the source entry leaves the map when either moves.
    const sourceError = usePickedFieldError(formErrorKey, `${chainId || ''}|${address || ''}`);
    const networkName = chainId ? (chainRegistry?.get?.(chainId)?.displayName || chainId) : '';
    // G99: the address in "Bitcoin, bc1q…7c1c" shows whole when the row has room.
    const closedSummary = summary ?? joinSummaryParts([
        networkName,
        address ? <SummaryAddress address={address} /> : null,
    ]);
    const offered = Array.isArray(chainIds) && chainIds.length ? chainIds : (chainId ? [chainId] : []);
    return (
        <FormSection
            id={id}
            title={titleProp ?? t('send.fields.from')}
            icon={icon}
            summary={closedSummary}
            open={open}
            onOpenChange={onOpenChange}
            defaultOpen={defaultOpen}
            // No source address and a reason to show: open so it shows. While
            // the addresses still load the host passes no `missing`, so a
            // slow first read does not open the section for good.
            revealKey={!address && missing
                ? `missing:${chainId || ''}`
                // A source refusal reopens the section on every press.
                : (sourceError.error ? `source-error:${sourceError.errorKey}` : revealKey)}
        >
            {chainId ? (
                <NetworkField
                    size="md"
                    value={chainId}
                    onChange={(next) => { if (!lockNetwork && !disabled) onNetworkChange?.(next); }}
                    chainIds={offered}
                    chainRegistry={chainRegistry}
                    disabled={disabled || lockNetwork || !onNetworkChange}
                    // A host label ("Publishing network"); the field's
                    // own default ("Network") otherwise.
                    {...(networkLabel ? { label: networkLabel } : {})}
                    help={networkHelp}
                />
            ) : null}
            {address ? (
                <>
                    <AddressField
                        size="md"
                        id={addressId}
                        label={addressLabel}
                        // Every From address shows its picker icon. With no
                        // picker to open (the address is fixed by the
                        // action) the icon stays, locked, and says why.
                        icon="addresses"
                        value={address}
                        readOnly
                        disabled={disabled}
                        onChange={() => {}}
                        onIconClick={onOpenPicker}
                        iconLabel={pickerLabel}
                        iconLockedReason={onOpenPicker ? undefined : pickerLockedReason}
                        help={addressHelp}
                        error={sourceError.error}
                        errorKey={sourceError.errorKey}
                    />
                    {detail ? <p className={styles.fieldNote}>{detail}</p> : null}
                </>
            ) : (missing ?? null)}
            {children}
        </FormSection>
    );
}
