// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, InfoTip } from '@xchain-wallet/core/ui';
import styles from './DurationSlider.module.css';

const THUMB = 'var(--duration-thumb)';

/** Tick position under the matching range-thumb centre, for any stop count. */
function tickStart(index, count) {
    if (count < 2) return `calc(${THUMB} / 2)`;
    const p = index / (count - 1);
    return `calc(${(p * 100).toFixed(4)}% + ${THUMB} * ${(0.5 - p).toFixed(4)})`;
}

/**
 * A labelled stop slider in the Duration slider's style: a header with the
 * label and the current value, a range input over named stops, tick buttons
 * under each stop, and a slot (children) for the Custom entry.
 *
 * stops: [{ id, label }]. activeId picks the thumb; onPick(id) fires for the
 * range input and for a tick click. The caller owns the value and what each
 * stop means.
 */
export function StopSlider({
    label,
    infoLabel = null,
    infoAria = null,
    stops,
    activeId,
    onPick,
    valueText = null,
    pill = null,
    disabled = false,
    children = null,
}) {
    const count = stops.length;
    const activeIndex = Math.max(0, stops.findIndex((stop) => stop.id === activeId));
    const tickWidth = `${Math.floor(100 / count) - 1}%`;
    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <span className={styles.label}>
                    {label}
                    {infoLabel ? <InfoTip aria={infoAria || label} label={infoLabel} /> : null}
                </span>
                {pill ? <span className={styles.durationPill}>{pill}</span> : null}
            </div>
            <div className={styles.sliderBlock}>
                <input
                    type="range"
                    min={0}
                    max={count - 1}
                    step={1}
                    value={activeIndex}
                    onChange={(event) => {
                        const next = stops[Number(event.target.value)];
                        if (next) onPick(next.id);
                    }}
                    disabled={disabled}
                    aria-label={label}
                    aria-valuetext={valueText || stops[activeIndex].label}
                    className={styles.slider}
                />
                <div className={styles.sliderTicks} aria-hidden="true">
                    {stops.map((stop, index) => (
                        <Button
                            key={stop.id}
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={null}
                            className={`${styles.sliderTick} ${stop.id === activeId ? styles.sliderTickActive : ''}`.trim()}
                            style={{ insetInlineStart: tickStart(index, count), maxWidth: tickWidth }}
                            onClick={() => onPick(stop.id)}
                            disabled={disabled}
                            tabIndex={-1}
                        >
                            <span className={styles.sliderTickTime}>{stop.label}</span>
                        </Button>
                    ))}
                </div>
                {children}
            </div>
        </div>
    );
}
