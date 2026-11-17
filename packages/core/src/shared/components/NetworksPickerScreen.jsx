// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ListPage, Notice, OptionSwitch, OptionSwitchList, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { AssetMark } from '../../ui/AssetMark.jsx';

/**
 * One network row on the picker page.
 *
 * @typedef {object} NetworksPickerOption
 * @property {string} value          what the host stores (a coin ticker, a chain id)
 * @property {string} title          the network's name, e.g. Bitcoin
 * @property {string} [chainId]      the chain whose icon the row draws
 * @property {string} [ticker]       drawn in the mark when the chain has no icon
 * @property {string} [description]  the muted line under the name, e.g. BTC · Mainnet
 */

/**
 * NetworksPickerScreen: the page a NetworksField opens (G117). The standard
 * page header with Back over one list card of every network the field can
 * hold, each row the network's icon and name with a switch on the right
 * (G110 green when on, the G118 OptionSwitch row). A switch changes the host's
 * selection at once, so Back returns to the form already showing the new
 * choice; there is no separate save step to forget.
 *
 * @param {object} props
 * @param {'small' | 'full'} [props.variant]
 * @param {string} props.title                     the page title, in Title Case
 * @param {NetworksPickerOption[]} props.options
 * @param {string[]} props.selected                the chosen option values
 * @param {(value: string, on: boolean) => void} props.onToggle
 * @param {() => void} props.onBack
 * @param {import('react').ReactNode} [props.notice] what the page is for, an info Notice at the top of the page (G120), never bare text over the list
 * @param {boolean} [props.disabled]
 */
export function NetworksPickerScreen({
    variant,
    title,
    options,
    selected,
    onToggle,
    onBack,
    notice,
    disabled = false,
}) {
    const chosen = new Set(selected || []);
    return (
        <Screen
            variant={variant}
            header={<PageHeader nested onBack={onBack} title={title} />}
        >
            <ListPage
                notices={notice ? (
                    <Notice tone="info" role="note" data-networks-picker-notice="">{notice}</Notice>
                ) : null}
            >
                <OptionSwitchList role="group" aria-label={title} data-networks-picker-list="">
                    {(options || []).map((option) => (
                        <OptionSwitch
                            key={option.value}
                            id={`networks-picker-${option.value}`}
                            icon={(
                                <AssetMark
                                    chainId={option.chainId || option.value}
                                    tick={option.ticker || option.title}
                                    isNative
                                />
                            )}
                            label={option.title}
                            description={option.description || undefined}
                            checked={chosen.has(option.value)}
                            disabled={disabled}
                            onChange={(event) => onToggle(option.value, event.target.checked)}
                            data-network-value={option.value}
                        />
                    ))}
                </OptionSwitchList>
            </ListPage>
        </Screen>
    );
}
