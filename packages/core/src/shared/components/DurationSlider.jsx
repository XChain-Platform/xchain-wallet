// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, InfoTip, Input } from '@xchain-wallet/core/ui';
import { targetBlockSecondsForCoin } from '../utils/blockDateEstimate.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/ui.js';
import styles from './DurationSlider.module.css';

const PRESETS = [
    { id: 'hour', seconds: 60 * 60 },
    { id: 'day', seconds: 24 * 60 * 60 },
    { id: 'week', seconds: 7 * 24 * 60 * 60 },
    { id: 'month', seconds: 30 * 24 * 60 * 60 },
];
const STOPS = [...PRESETS.map(({ id }) => id), 'custom'];
const CUSTOM_STOP = STOPS.length - 1;
const TICK_CLASSES = [styles.tick0, styles.tick1, styles.tick2, styles.tick3, styles.tick4];

function presetLabel(id) {
    if (id === 'hour') return t('settings.developer.1Hour');
    if (id === 'day') return t('components.durationSlider.oneDay');
    if (id === 'week') return t('components.durationSlider.oneWeek');
    return t('components.durationSlider.oneMonth');
}

function roundedSpan(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Format an estimated duration without implying more than one decimal of precision. */
export function humanSpan(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    if (minutes < 60) return t('components.durationSlider.minutes', {
        value: roundedSpan(minutes),
    });
    const hours = minutes / 60;
    if (hours < 24) return t('components.durationSlider.hours', {
        count: hours,
        value: roundedSpan(hours),
    });
    const days = hours / 24;
    return t('components.durationSlider.days', {
        count: days,
        value: roundedSpan(days),
    });
}

/** Convert the wall-clock presets to whole blocks for a chain's target interval. */
export function durationStopBlocks(coin) {
    const blockSeconds = targetBlockSecondsForCoin(coin) || 600;
    return Object.fromEntries(PRESETS.map(({ id, seconds }) => [
        id,
        Math.max(1, Math.ceil(seconds / blockSeconds)),
    ]));
}

function presetForValue(value, presetBlocks) {
    return PRESETS.find(({ id }) => String(presetBlocks[id]) === String(value))?.id || null;
}

/** Pick a block-count duration from chain-aware presets or enter a custom count. */
export function DurationSlider({
    coin,
    value,
    onChange,
    wakeText = null,
    disabled = false,
    label = t('components.durationSlider.duration'),
}) {
    const blockSeconds = targetBlockSecondsForCoin(coin) || 600;
    const blockMinutes = blockSeconds / 60;
    const presetBlocks = useMemo(() => durationStopBlocks(coin), [coin]);
    const [stop, setStop] = useState(
        () => presetForValue(value, presetBlocks) || (value ? 'custom' : 'day'),
    );
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Keep a selected wall-clock preset stable when the network changes.
    useEffect(() => {
        if (stop !== 'custom') onChangeRef.current(String(presetBlocks[stop]));
    }, [presetBlocks, stop]);

    const stopIndex = STOPS.indexOf(stop);
    const positiveBlocks = /^[1-9]\d*$/.test(String(value).trim())
        ? Number(value)
        : null;
    const span = Number.isSafeInteger(positiveBlocks)
        ? humanSpan(positiveBlocks * blockMinutes)
        : null;
    const perBlock = humanSpan(blockMinutes);
    const activePreset = PRESETS[stopIndex];

    const pickStop = (nextStop) => {
        if (!STOPS.includes(nextStop)) return;
        setStop(nextStop);
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <span className={styles.label}>
                    {label}
                    <InfoTip
                        aria={t('components.durationSlider.howDurationIsCounted')}
                        label={t('components.durationSlider.durationInfo', { perBlock })}
                    />
                </span>
                {span ? <span className={styles.durationPill}>~{span}</span> : null}
            </div>
            <div className={styles.sliderBlock}>
                <input
                    type="range"
                    min={0}
                    max={CUSTOM_STOP}
                    step={1}
                    value={stopIndex}
                    onChange={(event) => pickStop(STOPS[Number(event.target.value)])}
                    disabled={disabled}
                    aria-label={label}
                    aria-valuetext={stop === 'custom'
                        ? t('ui.feeSelector.custom')
                        : t('components.durationSlider.presetValue', {
                            label: presetLabel(activePreset.id),
                            blocks: presetBlocks[stop].toLocaleString('en-US'),
                        })}
                    className={styles.slider}
                />
                <div className={styles.sliderTicks} aria-hidden="true">
                    {STOPS.map((id, index) => {
                        const preset = PRESETS[index];
                        return (
                            <Button
                                key={id}
                                type="button"
                                variant="ghost"
                                size="sm"
                                icon={null}
                                className={`${styles.sliderTick} ${TICK_CLASSES[index]} ${stop === id ? styles.sliderTickActive : ''}`.trim()}
                                onClick={() => pickStop(id)}
                                disabled={disabled}
                                tabIndex={-1}
                            >
                                <span className={styles.sliderTickTime}>{preset
                                    ? presetLabel(preset.id)
                                    : t('ui.feeSelector.custom')}</span>
                                {preset ? (
                                    <span className={styles.sliderTickBlocks}>
                                        <span className={styles.blocksFull}>
                                            {t('components.durationSlider.blocks', {
                                                count: presetBlocks[id],
                                                value: presetBlocks[id].toLocaleString('en-US'),
                                            })}
                                        </span>
                                        <span className={styles.blocksShort}>
                                            {presetBlocks[id].toLocaleString('en-US')}
                                        </span>
                                    </span>
                                ) : null}
                            </Button>
                        );
                    })}
                </div>
                {stop === 'custom' ? (
                    <Input
                        label={t('components.durationSlider.blocksLabel')}
                        help={t('components.durationSlider.blocksHelp')}
                        inputMode="numeric"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        autoComplete="off"
                        disabled={disabled}
                        hint={span
                            ? t('components.durationSlider.customHint', {
                                blocks: positiveBlocks.toLocaleString('en-US'),
                                span,
                                perBlock,
                            })
                            : t('components.durationSlider.emptyCustomHint', { perBlock })}
                    />
                ) : null}
                {wakeText ? (
                    <div className={styles.wakeText} role="status" aria-live="polite">
                        {wakeText}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
