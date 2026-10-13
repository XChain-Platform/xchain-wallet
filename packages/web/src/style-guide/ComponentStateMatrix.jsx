// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as UI from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { ViewportFrame } from './frames.jsx';

export const MATRIX_SIZES = Object.freeze(['sm', 'md', 'lg']);
export const MATRIX_STATES = Object.freeze(['default', 'hover', 'focus', 'disabled', 'error']);
export const MATRIX_THEMES = Object.freeze(['light', 'dark']);

const ALL_SIZES = MATRIX_SIZES;
const FIELD_SIZES = Object.freeze(['md', 'lg']);
const BADGE_SIZES = Object.freeze(['sm', 'md']);
const FIXED_SIZE = Object.freeze([]);

const componentSizes = {
    Screen: FIXED_SIZE,
    PageHeader: FIXED_SIZE,
    FormPage: FIXED_SIZE,
    FormErrorSummary: FIXED_SIZE,
    FormSection: FIXED_SIZE,
    ListPage: FIXED_SIZE,
    EmptyState: FIXED_SIZE,
    SectionHeader: FIXED_SIZE,
    StatusMessage: FIXED_SIZE,
    Button: ALL_SIZES,
    Input: FIELD_SIZES,
    Select: FIELD_SIZES,
    Textarea: FIELD_SIZES,
    IconSelect: FIXED_SIZE,
    AddressCombobox: FIELD_SIZES,
    AddressField: FIELD_SIZES,
    ChainBadge: BADGE_SIZES,
    FeeSelector: FIXED_SIZE,
    AddressText: BADGE_SIZES,
    CopyButton: FIXED_SIZE,
    AnimatedQrFrames: ALL_SIZES,
    MultisigBadge: BADGE_SIZES,
    VerifiedBadge: BADGE_SIZES,
    QrScanner: FIXED_SIZE,
    ChainPicker: ALL_SIZES,
    NetworkField: FIELD_SIZES,
    Skeleton: ALL_SIZES,
    InfoTip: FIXED_SIZE,
    Icon: ALL_SIZES,
};

export const COMPONENT_MATRIX = Object.freeze(Object.fromEntries(
    Object.entries(componentSizes).map(([name, nativeSizes]) => [
        name,
        Object.freeze({
            nativeSizes,
            sizes: MATRIX_SIZES,
            states: MATRIX_STATES,
            themes: MATRIX_THEMES,
        }),
    ]),
));

const chainRegistry = registryLib.defaultRegistry();
const chainIds = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const bitcoin = chainRegistry.get('bitcoin-mainnet');
const sampleAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const sampleOptions = [
    { value: 'send', label: 'Send', sub: 'Transfer funds', icon: <UI.Icon.SendIcon /> },
    { value: 'receive', label: 'Receive', sub: 'Show an address', icon: <UI.Icon.ReceiveIcon /> },
];
const sampleSuggestions = [{
    address: sampleAddress,
    label: 'Treasury',
    sublabel: 'Bitcoin',
    source: 'contact',
}];
const sampleTiers = {
    low: { coinAmount: '0.00001500', etaMinutes: 60, rate: '1 sat/vB', rateValue: 1 },
    normal: { coinAmount: '0.00003000', etaMinutes: 20, rate: '2 sat/vB', rateValue: 2 },
    fast: { coinAmount: '0.00007500', etaMinutes: 10, rate: '5 sat/vB', rateValue: 5 },
    unit: 'sat/vB',
};
const qrFrames = ['xcw:1/2:style-guide', 'xcw:2/2:matrix'];
const noop = () => {};

function nearestSize(name, requestedSize) {
    const nativeSizes = COMPONENT_MATRIX[name].nativeSizes;
    if (nativeSizes.includes(requestedSize)) return requestedSize;
    if (nativeSizes.includes('md')) return 'md';
    return nativeSizes[0];
}

function ComponentPreview({ name, size, state }) {
    const nativeSize = nearestSize(name, size);
    const disabled = state === 'disabled';
    const error = state === 'error' ? 'Check this value' : undefined;
    const statusVariant = state === 'error' ? 'error' : 'status';

    switch (name) {
    case 'Screen':
        return <UI.Screen bodyAs="section" header="Header" footer="Footer">Screen body</UI.Screen>;
    case 'PageHeader':
        return <UI.PageHeader title="Send" onBack={noop} backDisabled={disabled} />;
    case 'FormPage':
        return <UI.FormPage as="div" intro="Form introduction" actions={<UI.Button size="sm">Continue</UI.Button>}>Form body</UI.FormPage>;
    case 'FormErrorSummary':
        return <UI.FormErrorSummary errors={[{ message: 'Check this value' }]} />;
    case 'FormSection':
        return <UI.FormSection title="Details" description="Supporting information">Section body</UI.FormSection>;
    case 'ListPage':
        return <UI.ListPage intro="Saved items" toolbar={<UI.Input aria-label="Search" placeholder="Search" />}>List row</UI.ListPage>;
    case 'EmptyState':
        return <UI.EmptyState title="No activity" body="New activity appears here." actionLabel="Refresh" onAction={noop} />;
    case 'SectionHeader':
        return <UI.SectionHeader title="Accounts" description="Three available" trailing={<UI.Button size="sm">Add</UI.Button>} />;
    case 'StatusMessage':
        return <UI.StatusMessage variant={statusVariant}>{state === 'error' ? error : 'Wallet is ready'}</UI.StatusMessage>;
    case 'Button':
        return <UI.Button size={nativeSize} variant={state === 'error' ? 'danger' : 'primary'} disabled={disabled}>Continue</UI.Button>;
    case 'Input':
        return <UI.Input label="Amount" size={nativeSize} value="1.00" readOnly disabled={disabled} error={error} />;
    case 'Select':
        return <UI.Select label="Network" size={nativeSize} defaultValue="btc" disabled={disabled} error={error}><option value="btc">Bitcoin</option></UI.Select>;
    case 'Textarea':
        return <UI.Textarea label="Message" size={nativeSize} defaultValue="Hello" rows={2} disabled={disabled} error={error} />;
    case 'IconSelect':
        return <UI.IconSelect label="Action" value="send" onChange={noop} options={sampleOptions} disabled={disabled} />;
    case 'AddressCombobox':
        return <UI.AddressCombobox label="To" value="" onChange={noop} suggestions={sampleSuggestions} size={nativeSize} disabled={disabled} error={error} />;
    case 'AddressField':
        return <UI.AddressField label="To" icon="contacts" value="" onChange={noop} onIconClick={noop} size={nativeSize} disabled={disabled} error={error} />;
    case 'ChainBadge':
        return <UI.ChainBadge descriptor={bitcoin} size={nativeSize} />;
    case 'FeeSelector':
        return <UI.FeeSelector label="Network fee" tiers={sampleTiers} value={{ mode: 'normal' }} onChange={noop} coinTicker="BTC" disabled={disabled} />;
    case 'AddressText':
        return <UI.AddressText address={sampleAddress} size={nativeSize} />;
    case 'CopyButton':
        return <UI.CopyButton value={sampleAddress} label="Copy address" />;
    case 'AnimatedQrFrames':
        return <UI.AnimatedQrFrames frames={qrFrames} fps={1} size={{ sm: 72, md: 96, lg: 120 }[size]} alt="Sample animated QR" announceLoading={false} />;
    case 'MultisigBadge':
        return <UI.MultisigBadge threshold={2} cosignerCount={3} scheme="p2wsh-multisig" size={nativeSize} />;
    case 'VerifiedBadge':
        return <UI.VerifiedBadge status={state === 'error' ? 'failed' : 'verified'} size={nativeSize} />;
    case 'QrScanner':
        return <UI.QrScanner previewState={state === 'error' ? 'denied' : 'unsupported'} onFrame={noop} alt="QR scanner preview" />;
    case 'ChainPicker':
        return <UI.ChainPicker label="Chain" value="bitcoin-mainnet" onChange={noop} chainIds={chainIds} chainRegistry={chainRegistry} size={nativeSize} disabled={disabled} />;
    case 'NetworkField':
        return <UI.NetworkField value="bitcoin-mainnet" onChange={noop} chainIds={chainIds} chainRegistry={chainRegistry} size={nativeSize} disabled={disabled} />;
    case 'Skeleton':
        return <UI.Skeleton shape="card" width={{ sm: 96, md: 128, lg: 160 }[size]} height={{ sm: 48, md: 64, lg: 80 }[size]} />;
    case 'InfoTip':
        return <UI.InfoTip label="More information about this setting." />;
    case 'Icon': {
        return (
            <span style={{ '--xc-icon-size': `var(--xc-icon-${size})` }}>
                <UI.Icon.SendIcon />
            </span>
        );
    }
    default:
        return null;
    }
}

function MatrixGrid({ name }) {
    const { nativeSizes } = COMPONENT_MATRIX[name];
    return (
        <div className="sg-matrix-grid">
            <span className="sg-matrix-corner">Size</span>
            {MATRIX_STATES.map((state) => <span key={state} className="sg-matrix-column-label">{state}</span>)}
            {MATRIX_SIZES.map((size) => (
                <div className="sg-matrix-row" key={size} data-size={size}>
                    <span className="sg-matrix-row-label">
                        {size}
                        <small>{nativeSizes.includes(size) ? 'native' : 'nearest'}</small>
                    </span>
                    {MATRIX_STATES.map((state) => (
                        <div
                            className="sg-matrix-cell"
                            data-state={state}
                            data-size={size}
                            key={state}
                        >
                            <div className="sg-matrix-target">
                                <ComponentPreview name={name} size={size} state={state} />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

export function ComponentStateMatrix({ name }) {
    if (!COMPONENT_MATRIX[name]) return null;
    return (
        <div className="sg-component-matrix" data-component={name}>
            <h3>{name} size, state, and theme matrix</h3>
            <p className="sg-matrix-note">
                Each size row keeps default, hover, focus, disabled, and error side by side.
                Nearest marks a fixed-size component or a size its public API does not expose.
            </p>
            <div className="sg-matrix-themes">
                {MATRIX_THEMES.map((theme) => (
                    <div className="sg-matrix-theme" data-theme={theme} key={theme}>
                        <h4>{theme} theme</h4>
                        <div className="sg-matrix-scroll">
                            <ViewportFrame
                                width={1080}
                                minHeight={280}
                                title={`${name}, ${theme} theme component matrix`}
                                theme={theme}
                            >
                                <MatrixGrid name={name} />
                            </ViewportFrame>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
