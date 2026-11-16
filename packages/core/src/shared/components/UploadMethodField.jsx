// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Upload method field shared by Publish file, Gated publish and Attach
// artwork, and the hook that owns its state. The hook is the single place the
// three forms read the method from, so the size ceiling, the compose request
// and the review rows cannot follow different methods.

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSelect } from '../../ui/IconSelect.jsx';
import inputStyles from '../../ui/Input.module.css';
import { DocumentIcon, GridIcon } from '../../ui/icons/index.jsx';
import {
    estimateUploadMethodFees,
    resolveUploadMethod,
    standardUnavailableReason,
    taprootUnavailableReason,
    uploadMethodCeilingOpts,
    uploadMethodEncoderOpts,
    UPLOAD_METHOD_TAPROOT,
    UPLOAD_METHODS,
} from '../../flows/uploadMethod.js';
import { satsToCoinDecimal } from '../../flows/feeEstimate.js';
import { formatBytes } from '../utils/formatBytes.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/uploadMethod.js';

/** How long typed metadata must sit still before the fee estimates follow it. */
export const UPLOAD_METADATA_SETTLE_MS = 400;

/** The value once it has stopped changing for `delay` ms. */
function useSettled(value, delay) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        if (settled === value) return undefined;
        const id = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(id);
    }, [value, delay, settled]);
    return settled;
}

/**
 * The upload method state of one file form.
 *
 * Fee estimates are recomputed only when the file, the settled metadata, the
 * From address, the network or the fee rate change. Title, memo and a Custom
 * fee rate are typed a character at a time, so they reach the estimate only
 * after typing pauses; the size ceiling still follows every character, since
 * it is exact.
 *
 * @param {object} args
 * @param {object | null} args.descriptor              the network's chain descriptor
 * @param {object | null} args.fromAddress             the spending Address record
 * @param {boolean} [args.isWatcherMode]
 * @param {{ unit?: string, rateValue?: number | string } | null} args.feeEstimate  the form's selected fee (flows/feeEstimate.js)
 * @param {string} [args.coinTicker]
 * @param {{ name: string, type: string, bytes: Uint8Array } | null} args.file
 * @param {Record<string, string | null | undefined>} args.metadata   typed fields that ride the action string (settled first)
 * @param {Record<string, string | null | undefined>} [args.context]  picked, never typed, fields that ride it
 *   (a gate token, a coin, an address): they re-estimate at once
 * @param {(file: { name: string, type: string, bytes: Uint8Array }, metadata: Record<string, any>) => number} args.compiledBytesFor
 *   this form's compiled action-plus-file push size for a file and its metadata and context
 * @param {number | null} args.standardCap              the legacy ceiling for this file and metadata
 * @param {string | null} [args.picked]                 controlled explicit pick (Publish file shares it across modes)
 * @param {(method: string | null) => void} [args.onPick]
 */
export function useUploadMethod({
    descriptor,
    fromAddress,
    isWatcherMode = false,
    feeEstimate,
    coinTicker = '',
    file,
    metadata,
    context = null,
    compiledBytesFor,
    standardCap,
    picked: pickedProp,
    onPick,
}) {
    const [ownPicked, setOwnPicked] = useState(/** @type {string | null} */ (null));
    const controlled = typeof onPick === 'function';
    const picked = controlled ? (pickedProp ?? null) : ownPicked;
    const setPicked = controlled ? onPick : setOwnPicked;

    const reasons = {
        taproot: taprootUnavailableReason({ descriptor, fromAddress, isWatcherMode }),
        standard: standardUnavailableReason({ fileBytes: file?.bytes?.length ?? null, standardCap }),
    };
    const method = resolveUploadMethod({ picked, reasons });

    // The estimate's inputs, each reduced to a stable key so a re-render with
    // the same values never re-estimates.
    const metadataKey = useSettled(JSON.stringify(metadata || {}), UPLOAD_METADATA_SETTLE_MS);
    const contextKey = JSON.stringify(context || {});
    const fromKey = fromAddress ? `${fromAddress.id || ''}|${fromAddress.address || ''}|${fromAddress.source || ''}` : '';
    const networkKey = descriptor ? `${descriptor.id || ''}|${descriptor.coin || ''}` : '';
    // A tier click re-estimates at once; a Custom rate (source 'user') is typed,
    // so it re-estimates once typing pauses, like the metadata. A half-typed
    // rate ("12.") prices to no estimate at all, so that settles too.
    const liveRateKey = feeEstimate ? `${feeEstimate.unit || ''}|${feeEstimate.rateValue ?? ''}` : '';
    const settledRateKey = useSettled(liveRateKey, UPLOAD_METADATA_SETTLE_MS);
    const typedRate = !feeEstimate || feeEstimate.source === 'user';
    const rateKey = typedRate ? settledRateKey : liveRateKey;
    const latest = useRef({ compiledBytesFor, descriptor, feeEstimate });
    latest.current = { compiledBytesFor, descriptor, feeEstimate };

    const fees = useMemo(() => {
        const { compiledBytesFor: sizeOf, descriptor: desc, feeEstimate: rate } = latest.current;
        if (!file || typeof sizeOf !== 'function') return { taproot: null, standard: null };
        const compiledBytes = sizeOf(file, { ...JSON.parse(metadataKey), ...JSON.parse(contextKey) });
        return estimateUploadMethodFees({ compiledBytes, descriptor: desc, feeEstimate: rate });
        // A new From re-estimates even where the payload ignores it, so every
        // form refreshes its fees on the same four triggers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, metadataKey, contextKey, fromKey, networkKey, rateKey]);

    const label = methodName(method);
    const fee = fees[method] || null;
    return {
        method,
        picked,
        setPicked,
        reasons,
        fees,
        fee,
        label,
        coinTicker,
        standardCap,
        ceilingOpts: uploadMethodCeilingOpts(method),
        encoderOpts: uploadMethodEncoderOpts(method, fromAddress),
        // An amount and its ticker, the figure the review's fee row shows.
        feeText: fee ? `${fee.coinAmount} ${coinTicker}`.trim() : null,
        confirmLine: t('uploadMethod.confirmLine', { method: label }),
    };
}

// Copy is looked up by literal keys, so the key checkers can see every one.
function methodName(method) {
    return method === UPLOAD_METHOD_TAPROOT ? t('uploadMethod.taproot') : t('uploadMethod.standard');
}

function methodDescription(method) {
    return method === UPLOAD_METHOD_TAPROOT
        ? t('uploadMethod.taprootDescription')
        : t('uploadMethod.standardDescription');
}

const REASON_COPY = Object.freeze({
    hardware: () => t('uploadMethod.reason.hardware'),
    watcher: () => t('uploadMethod.reason.watcher'),
    watchOnly: () => t('uploadMethod.reason.watchOnly'),
    signer: () => t('uploadMethod.reason.signer'),
    litecoinPending: () => t('uploadMethod.reason.litecoinPending'),
    noTaproot: () => t('uploadMethod.reason.noTaproot'),
    chain: () => t('uploadMethod.reason.chain'),
});

function reasonText(reason, standardCap, multipartCap) {
    if (!reason) return null;
    if (reason === 'tooLarge') {
        if (Number.isFinite(multipartCap)) {
            return t('uploadMethod.reason.tooLargeFor', {
                cap: formatBytes(multipartCap, { limit: true }),
            });
        }
        return t('uploadMethod.reason.tooLarge', {
            cap: Number.isFinite(standardCap) ? formatBytes(standardCap, { limit: true }) : '',
        });
    }
    return (REASON_COPY[reason] || REASON_COPY.signer)();
}

function singleFeeLine(upload, value) {
    const fee = upload.fees[value];
    return fee
        ? t('uploadMethod.fee', { amount: fee.coinAmount, ticker: upload.coinTicker }).trim()
        : null;
}

function optionCopy(upload, value) {
    const multipart = upload.multipart?.options?.[value] ?? null;
    const reason = reasonText(upload.reasons[value], upload.standardCap, multipart?.cap);
    if (reason) return { description: reason, feeLine: singleFeeLine(upload, value) };
    if (multipart?.pending) {
        return { description: t('uploadMethod.multipartPending'), feeLine: null };
    }
    if (multipart?.multipart && multipart.summary) {
        const feeLine = Number.isFinite(multipart.fee)
            ? t('uploadMethod.fee', {
                amount: satsToCoinDecimal(multipart.fee), ticker: upload.coinTicker,
            }).trim()
            : null;
        return { description: multipart.summary, feeLine };
    }
    return { description: methodDescription(value), feeLine: singleFeeLine(upload, value) };
}

function fieldOption(upload, value) {
    const name = methodName(value);
    const { description, feeLine } = optionCopy(upload, value);
    return {
        value,
        text: name,
        label: value === UPLOAD_METHOD_TAPROOT ? (
            <>
                {name}{' '}
                <span className={inputStyles.optionalPill} data-upload-cheapest>{t('uploadMethod.cheapest')}</span>
            </>
        ) : name,
        icon: value === UPLOAD_METHOD_TAPROOT ? <DocumentIcon /> : <GridIcon />,
        disabled: Boolean(upload.reasons[value]),
        sub: (
            <>
                <span data-upload-description>{description}</span>
                {feeLine ? <span data-upload-fee={value}>{` ${feeLine}`}</span> : null}
            </>
        ),
    };
}

/**
 * The review rows that name the picked method and its estimated fee, as
 * `<dt>`/`<dd>` pairs for the review's details list.
 *
 * @param {object} props
 * @param {ReturnType<typeof useUploadMethod>} props.upload
 * @param {string} [props.labelClassName]
 * @param {string} [props.valueClassName]
 */
export function UploadMethodReviewRows({ upload, labelClassName, valueClassName }) {
    return (
        <>
            <dt className={labelClassName}>{t('uploadMethod.label')}</dt>
            <dd className={valueClassName} data-testid="review-upload-method">{upload.label}</dd>
            {upload.feeText ? (
                <>
                    <dt className={labelClassName}>{t('uploadMethod.review.fee')}</dt>
                    <dd className={valueClassName} data-testid="review-upload-fee">{upload.feeText}</dd>
                </>
            ) : null}
        </>
    );
}

/**
 * The Upload method dropdown: the themed select with an icon per option
 * (G119), Taproot envelope first and marked Cheapest, each option's secondary
 * line its description (or, when it cannot be used, its one-line reason) and
 * its estimated total network fee for the current file and fee rate.
 *
 * @param {object} props
 * @param {ReturnType<typeof useUploadMethod>} props.upload
 * @param {boolean} [props.disabled]
 */
export function UploadMethodField({ upload, disabled = false }) {
    const options = UPLOAD_METHODS.map((value) => fieldOption(upload, value));
    return (
        <IconSelect
            label={t('uploadMethod.label')}
            help={t('uploadMethod.help')}
            value={upload.method}
            onChange={(next) => upload.setPicked(next)}
            options={options}
            disabled={disabled}
        />
    );
}
