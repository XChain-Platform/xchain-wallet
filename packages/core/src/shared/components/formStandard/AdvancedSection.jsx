// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one Advanced section of the Wallet Form Standard, directly above
// Speed and Fees on every form that has one: "Allow a higher network fee
// later" (RBF), coin control (choose the inputs) and the change address.
// FeeSection renders it, so no form places it by hand; the choices live in
// advancedOptions.js and reach compose through withAdvancedOptions.

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/common.js';
import '../../../i18n/locales/en/send.js';
import '../../../i18n/locales/en/ui.js';
import { defaultRegistry } from '../../../registry/index.js';
import { formatNativeBaseUnits, tickerForDescriptor } from '../../../registry/coinTicker.js';
import { dustThresholdForCoin } from '../../../sdk/nativeFeePreflight.js';
import { AddressField } from '../../../ui/AddressField.jsx';
import { AddressText } from '../../../ui/AddressText.jsx';
import { Button } from '../../../ui/Button.jsx';
import { Checkbox } from '../../../ui/Checkbox.jsx';
import { EmptyState } from '../../../ui/EmptyState.jsx';
import { InfoTip } from '../../../ui/InfoTip.jsx';
import screenStyles from '../../../ui/Screen.module.css';
import { Switch } from '../../../ui/Switch.jsx';
import { OwnAddressPickerScreen } from '../OwnAddressPickerScreen.jsx';
import { CheckIcon, GearIcon, TrashIcon } from '../../../ui/icons/index.jsx';
import { MessagingContext } from '../../MessagingContext.js';
import { useSettings } from '../../hooks/useSettings.js';
import { resolveFeeConfig } from '../../../schemas/settings.js';
import { formatWithThousands } from '../../utils/amountFormat.js';
import {
    advancedCaps,
    advancedKey,
    advancedSummary,
    COIN_CONTROL_ROW_LIMIT,
    selectedUtxosOf,
    updateAdvanced,
    useAdvancedEntry,
    utxoKey,
} from './advancedOptions.js';
import styles from './AdvancedSection.module.css';
import { FormSection } from './FormSection.jsx';

const chainRegistry = defaultRegistry();

/**
 * What FormFrame knows that the Advanced section needs: which form this is,
 * the source network and address (read from its FromSection), the wallet
 * (from its demo guard) and the form's capability flags. Null outside a
 * FormFrame, where no Advanced section renders.
 *
 * @type {import('react').Context<null | {
 *   formKey: string,
 *   chainId: string | null,
 *   address: string | null,
 *   walletId: string | null,
 *   demo: boolean,
 *   advanced: any,
 * }>}
 */
export const FormAdvancedContext = createContext(null);

function sats(utxo) {
    try {
        const value = BigInt(utxo?.value ?? 0);
        return value >= 0n ? value : null;
    } catch {
        return null;
    }
}

function coinAmount(value, descriptor) {
    if (value === null) return '0';
    return formatNativeBaseUnits(value < 0n ? 0n : value, descriptor) || '0';
}

/**
 * The slot FeeSection renders first: the Advanced section when the form
 * sits in a FormFrame and allows at least one option, else nothing.
 *
 * @param {object} props
 * @param {string} [props.chainId]          the fee's network, used when FromSection names none
 * @param {any} [props.advanced]            the form's capability flags (see advancedCaps)
 * @param {boolean} [props.disabled]
 */
export function AdvancedSlot({ chainId: feeChainId, advanced, disabled = false }) {
    const frame = useContext(FormAdvancedContext);
    if (!frame || advanced === false || frame.advanced === false) return null;
    // A flag on FeeSection narrows the frame's; either one can turn an option off.
    const frameCaps = advancedCaps(frame.advanced);
    const feeCaps = advancedCaps(advanced);
    const caps = {
        rbf: frameCaps.rbf && feeCaps.rbf,
        coins: frameCaps.coins && feeCaps.coins,
        change: frameCaps.change && feeCaps.change,
    };
    const rbfDefault = advanced?.rbfDefault ?? frame.advanced?.rbfDefault ?? null;
    return (
        <AdvancedSection
            formKey={frame.formKey}
            chainId={frame.chainId || feeChainId || null}
            address={frame.address}
            walletId={frame.walletId}
            demo={frame.demo}
            caps={caps}
            rbfDefault={rbfDefault}
            coinsNote={advanced?.coinsNote ?? frame.advanced?.coinsNote ?? null}
            disabled={disabled}
        />
    );
}

/**
 * The Advanced section: closed by default, marked Optional, its summary
 * "Default" until a choice differs ("RBF on · 2 coins · custom change").
 * An option the form cannot honour is not shown; one the network cannot
 * (fee bumping on Dogecoin) is shown off and locked with the reason.
 *
 * @param {object} props
 * @param {string} props.formKey
 * @param {string | null} props.chainId
 * @param {string | null} [props.address]   the source address; coin control needs it
 * @param {string | null} [props.walletId]  the change address list needs it
 * @param {boolean} [props.demo]            a demo wallet has no coins to choose
 * @param {{ rbf: boolean, coins: boolean, change: boolean }} props.caps
 * @param {boolean | null} [props.rbfDefault]  a default the form sends itself (Send)
 * @param {import('react').ReactNode} [props.coinsNote]  a line after Selected total (Send's Approx. change)
 * @param {boolean} [props.disabled]
 */
export function AdvancedSection(props) {
    // Settings come through messaging, as in FeeSection: a form rendered
    // outside the wallet shell (the style guide, an isolated test) has none
    // and takes the chain's own default.
    const hasMessaging = Boolean(useContext(MessagingContext));
    return hasMessaging
        ? <AdvancedSectionWithSettings {...props} />
        : <AdvancedSectionBody {...props} fees={null} settingsLoading={false} />;
}

function AdvancedSectionWithSettings(props) {
    const { settings, loading } = useSettings();
    return <AdvancedSectionBody {...props} fees={settings?.fees ?? null} settingsLoading={loading} />;
}

function AdvancedSectionBody({
    formKey,
    chainId,
    address = null,
    walletId = null,
    demo = false,
    caps,
    rbfDefault = null,
    coinsNote = null,
    disabled = false,
    fees,
    settingsLoading,
}) {
    const messaging = useContext(MessagingContext)?.messaging || null;
    const key = advancedKey({ formKey, chainId, address });
    const entry = useAdvancedEntry(key);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const rbfSupported = descriptor?.feeStrategy?.rbfSupported === true;
    // RBF is on by default on every network that supports it (operator
    // 2026-11-13): a form that sends no default of its own takes the chain's
    // Fees setting (true unless the user turned it off), and compose sends
    // that same value. A network without RBF keeps the switch off and locked.
    // While settings are still loading after a remount (back from a picker
    // page) the default stored by the earlier mount stands, so the switch
    // does not flip on and back off for a user who turned RBF off in Fees.
    const settingsRbfDefault = settingsLoading && typeof entry.rbfDefault === 'boolean'
        ? entry.rbfDefault
        : resolveFeeConfig(fees?.[chainId], descriptor).rbfByDefault;
    const effectiveRbfDefault = rbfSupported ? (rbfDefault ?? settingsRbfDefault) : false;
    const ticker = descriptor ? tickerForDescriptor(descriptor) : '';

    const canLoadCoins = typeof messaging?.getAddressUtxos === 'function';
    const shown = useMemo(() => ({
        rbf: Boolean(caps.rbf && chainId),
        coins: Boolean(caps.coins && chainId && address && !demo && canLoadCoins),
        change: Boolean(caps.change && chainId && walletId && !demo && messaging),
    }), [caps.rbf, caps.coins, caps.change, chainId, address, demo, walletId, canLoadCoins, messaging]);

    // What the section shows is what compose may honour, so the store learns
    // it. A network without RBF stores no default, so its untouched (locked)
    // switch sends nothing and compose stays exactly as it was.
    const storedRbfDefault = rbfSupported ? effectiveRbfDefault : null;
    useEffect(() => {
        updateAdvanced(key, (current) => (
            current.shown.rbf === shown.rbf && current.shown.coins === shown.coins
                && current.shown.change === shown.change && current.rbfDefault === storedRbfDefault
                ? {}
                : { shown, rbfDefault: storedRbfDefault }
        ));
    }, [key, shown, storedRbfDefault]);

    // The coins load when the section opens, each time, so a choice is made
    // from the address's current coins rather than a list from an earlier visit.
    const { open } = entry;
    useEffect(() => {
        if (!open || !shown.coins) return undefined;
        let cancelled = false;
        updateAdvanced(key, { loadState: 'loading' });
        Promise.resolve(messaging.getAddressUtxos(chainId, address))
            .then((answer) => {
                if (cancelled) return;
                const rows = Array.isArray(answer) ? answer : (Array.isArray(answer?.utxos) ? answer.utxos : []);
                const present = new Set(rows.map(utxoKey));
                updateAdvanced(key, (current) => ({
                    available: rows,
                    loadState: 'ready',
                    selectedKeys: current.selectedKeys.filter((k) => present.has(k)),
                }));
            })
            .catch(() => {
                if (cancelled) return;
                updateAdvanced(key, { available: [], loadState: 'error', coinControl: false, selectedKeys: [] });
            });
        return () => { cancelled = true; };
    }, [open, shown.coins, key, chainId, address, messaging]);

    if (!shown.rbf && !shown.coins && !shown.change) return null;

    const rbfChecked = rbfSupported && (entry.rbf ?? effectiveRbfDefault);
    const summaryEntry = { ...entry, shown, rbfDefault: effectiveRbfDefault };

    return (
        <FormSection
            id="advanced"
            title={t('send.advanced')}
            icon={GearIcon}
            optional
            open={open}
            onOpenChange={(next) => updateAdvanced(key, { open: next })}
            summary={advancedSummary(summaryEntry, { rbfSupported })}
        >
            {shown.rbf ? (
                <Switch
                    label={(
                        <>
                            {t('send.rbf.label')}
                            <InfoTip aria={t('send.rbf.helpLabel')} label={t('send.rbf.help')} />
                        </>
                    )}
                    description={rbfSupported
                        ? t('send.rbf.enabledHint')
                        : t('send.rbf.unsupported', { chain: t('send.rbf.thisChain') })}
                    aria-label={t('send.rbf.label')}
                    checked={rbfChecked}
                    disabled={disabled || !rbfSupported}
                    onChange={(event) => updateAdvanced(key, { rbf: event.target.checked })}
                    data-advanced-option="rbf"
                />
            ) : null}
            {shown.coins ? (
                <CoinControl
                    entry={entry}
                    entryKey={key}
                    descriptor={descriptor}
                    ticker={ticker}
                    disabled={disabled}
                    coinsNote={coinsNote}
                />
            ) : null}
            {shown.change ? (
                <ChangeAddress
                    entry={entry}
                    entryKey={key}
                    chainId={chainId}
                    address={address}
                    walletId={walletId}
                    disabled={disabled}
                />
            ) : null}
        </FormSection>
    );
}

function CoinControl({ entry, entryKey, descriptor, ticker, disabled, coinsNote }) {
    const { available, loadState, coinControl, selectedKeys } = entry;
    const selected = selectedUtxosOf(entry);
    const selectedSet = new Set(selectedKeys);
    const selectedTotal = selected.reduce((total, utxo) => total + (sats(utxo) ?? 0n), 0n);
    const dustFloor = dustThresholdForCoin(descriptor?.coin);
    return (
        <>
            <Switch
                label={(
                    <>
                        <span aria-hidden="true">{t('send.advanced.coinControl')}</span>
                        <span className="sr-only">{t('send.advanced.coinControlEnabled')}</span>
                    </>
                )}
                description={loadState === 'loading'
                    ? t('send.advanced.loadingInputs')
                    : loadState === 'ready'
                        ? t('send.advanced.coinControlReady')
                        : t('send.advanced.coinControlUnavailable')}
                aria-label={t('send.advanced.coinControlEnabled')}
                help={t('send.advanced.coinControlHelp')}
                checked={coinControl}
                disabled={disabled || loadState !== 'ready'}
                onChange={(event) => updateAdvanced(entryKey, { coinControl: event.target.checked })}
                data-advanced-option="coins"
            />
            {coinControl ? (
                <fieldset className={styles.coinControlList}>
                    <legend>
                        {t('send.advanced.inputs')}
                        <InfoTip
                            aria={t('ui.field.about', { label: t('send.advanced.inputs') })}
                            label={t('send.advanced.inputsHelp')}
                        />
                    </legend>
                    <div className={styles.coinControlToolbar}>
                        <span>{t('send.advanced.availableCount', { count: available.length })}</span>
                        <span className={styles.coinControlActions}>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                icon={<CheckIcon />}
                                disabled={available.length === 0 || selected.length === available.length}
                                onClick={() => updateAdvanced(entryKey, { selectedKeys: available.map(utxoKey) })}
                            >
                                {t('send.advanced.selectAll')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                icon={<TrashIcon />}
                                disabled={selected.length === 0}
                                onClick={() => updateAdvanced(entryKey, { selectedKeys: [] })}
                            >
                                {t('common.clear')}
                            </Button>
                        </span>
                    </div>
                    {available.length > 0 ? (
                        <div className={styles.coinControlRows}>
                            {available.slice(0, COIN_CONTROL_ROW_LIMIT).map((utxo) => {
                                const k = utxoKey(utxo);
                                const value = sats(utxo);
                                const isDust = value !== null && dustFloor !== null && value < BigInt(dustFloor);
                                return (
                                    <Checkbox
                                        key={k}
                                        className={styles.coinControlRow}
                                        checked={selectedSet.has(k)}
                                        onChange={(event) => updateAdvanced(entryKey, (current) => {
                                            const next = new Set(current.selectedKeys);
                                            if (event.target.checked) next.add(k);
                                            else next.delete(k);
                                            return { selectedKeys: [...next] };
                                        })}
                                        label={(
                                            <span className={styles.coinControlValue}>
                                                <span>
                                                    {coinAmount(value, descriptor)} {ticker}
                                                    {isDust ? (
                                                        <span
                                                            className={styles.coinControlDust}
                                                            title={t('send.advanced.dustTitle', { sats: formatWithThousands(String(dustFloor)) })}
                                                        >
                                                            {t('send.advanced.dust')}
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <small>
                                                    <AddressText address={String(utxo?.txid || 'Unknown transaction')} size="sm" />
                                                    :{utxo?.vout ?? '?'}
                                                </small>
                                            </span>
                                        )}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <EmptyState title={t('send.advanced.noInputsTitle')} titleAs="p" body={t('send.advanced.noInputs')} />
                    )}
                    {available.length > COIN_CONTROL_ROW_LIMIT ? (
                        <p>
                            {t('send.advanced.rowsCapped', { shown: COIN_CONTROL_ROW_LIMIT, count: available.length })}
                        </p>
                    ) : null}
                    <dl className={styles.coinControlSummary} aria-label={t('send.advanced.summaryLabel')} aria-live="polite">
                        <div>
                            <dt>{t('send.advanced.selectedTotal')}</dt>
                            <dd>{coinAmount(selectedTotal, descriptor)} {ticker}</dd>
                        </div>
                        {coinsNote ? (
                            <div>
                                <dt>{t('send.advanced.approxChange')}</dt>
                                <dd>{coinsNote}</dd>
                            </div>
                        ) : null}
                    </dl>
                </fieldset>
            ) : null}
        </>
    );
}

/**
 * The change address, as every field that picks one of the wallet's own
 * addresses is (ruling U60): the read-only address field whose picker icon
 * opens the own-address picker page, locked to the form's network, with
 * "Automatic" as its first row.
 */
function ChangeAddress({ entry, entryKey, chainId, address, walletId, disabled }) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const anchorRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    // Automatic change goes back to the paying address, or to a fresh one
    // when the wallet rotates change (the host applies the rotation).
    const { settings } = useSettings();
    const rotates = settings?.privacy?.changeAddressRotation === true;
    const automatic = t('send.advanced.automaticChange', {
        address: rotates || !address ? t('send.advanced.freshChange') : address,
    });
    const close = () => setPickerOpen(false);
    return (
        <div ref={anchorRef} data-advanced-option="change">
            <AddressField
                label={t('send.advanced.changeAddress')}
                icon="addresses"
                value={entry.change}
                placeholder={automatic}
                readOnly
                onChange={() => {}}
                onIconClick={disabled ? undefined : () => setPickerOpen(true)}
                iconLabel={t('send.advanced.changeAddress')}
                help={t('send.advanced.changeHelp')}
                // Inside an optional section: never required, and no pill of its own.
                aria-required="false"
            />
            {pickerOpen ? (
                <PickerPage anchorRef={anchorRef} onBack={close}>
                    <OwnAddressPickerScreen
                        title={t('send.advanced.changeAddressTitle')}
                        walletId={walletId}
                        chainId={chainId}
                        lockNetwork
                        pickerActions={[{
                            key: 'automatic-change',
                            label: automatic,
                            onSelect: () => {
                                updateAdvanced(entryKey, { change: '' });
                                close();
                            },
                        }]}
                        onPick={(picked) => {
                            updateAdvanced(entryKey, { change: String(picked?.address || '') });
                            close();
                        }}
                        onBack={close}
                    />
                </PickerPage>
            ) : null}
        </div>
    );
}

/**
 * The own-address picker as a page over the form's screen. A form shows a
 * picker page by returning it in place of the form; the Advanced section
 * sits deep inside the form, so it lays the page over the screen the form
 * is on instead (the same area, the same page), and hands focus back to
 * the field when it closes.
 */
function PickerPage({ anchorRef, onBack, children }) {
    const layerRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [box, setBox] = useState(/** @type {null | { top: number, left: number, width: number, height: number, inScreen: boolean }} */ (null));
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const screenRoot = (screenStyles.screen && anchor?.closest(`.${screenStyles.screen.split(' ')[0]}`)) || null;
        const measure = () => {
            const rect = screenRoot?.getBoundingClientRect();
            setBox(rect && rect.width > 0
                ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, inScreen: true }
                : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, inScreen: false });
        };
        measure();
        window.addEventListener('resize', measure);
        const returnFocus = anchor?.querySelector('input');
        return () => {
            window.removeEventListener('resize', measure);
            returnFocus?.focus?.();
        };
    }, [anchorRef]);
    useEffect(() => {
        layerRef.current?.querySelector('button, [tabindex]')?.focus?.();
    }, []);
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
            ref={layerRef}
            className={box?.inScreen ? `${styles.pickerPage} ${styles.inScreen}` : styles.pickerPage}
            style={box ? { top: box.top, left: box.left, width: box.width, height: box.height } : undefined}
            data-advanced-picker=""
            // React carries a portal's events to the form behind it; Enter in
            // the picker's search must never reach the form's submit handling.
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') onBack();
            }}
        >
            {children}
        </div>,
        document.body,
    );
}
