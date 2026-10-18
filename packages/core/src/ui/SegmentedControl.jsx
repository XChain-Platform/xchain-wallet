// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import styles from './SegmentedControl.module.css';

/**
 * @param {object} props
 * @param {Array<{ id: string, label: import('react').ReactNode, disabled?: boolean, tone?: 'accent' | 'success' | 'danger' }>} props.items
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.className]
 */
export function SegmentedControl({ items, value, onChange, className, ...rest }) {
    const buttonRefs = useRef([]);
    const enabledIndices = items
        .map((item, index) => (item.disabled ? -1 : index))
        .filter((index) => index >= 0);
    const selectedIndex = items.findIndex((item) => item.id === value && !item.disabled);
    const rovingIndex = selectedIndex >= 0 ? selectedIndex : enabledIndices[0];

    function selectAt(index) {
        const item = items[index];
        if (!item || item.disabled) return;
        onChange(item.id);
        buttonRefs.current[index]?.focus();
    }

    function handleKeyDown(event) {
        const focusedIndex = buttonRefs.current.indexOf(event.target);
        const enabledPosition = enabledIndices.indexOf(focusedIndex);
        if (enabledPosition < 0) return;

        let nextIndex;
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                nextIndex = enabledIndices[(enabledPosition + 1) % enabledIndices.length];
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                nextIndex = enabledIndices[
                    (enabledPosition - 1 + enabledIndices.length) % enabledIndices.length
                ];
                break;
            case 'Home':
                nextIndex = enabledIndices[0];
                break;
            case 'End':
                nextIndex = enabledIndices[enabledIndices.length - 1];
                break;
            default:
                return;
        }

        event.preventDefault();
        selectAt(nextIndex);
    }

    const rootClassName = [styles.segmented, className].filter(Boolean).join(' ');

    return (
        <div
            {...rest}
            className={rootClassName}
            role="radiogroup"
            onKeyDown={handleKeyDown}
        >
            {items.map((item, index) => {
                const selected = index === rovingIndex;
                return (
                    <button
                        key={item.id}
                        ref={(node) => { buttonRefs.current[index] = node; }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        disabled={item.disabled}
                        data-tone={item.tone || 'accent'}
                        className={styles.segment}
                        onClick={() => onChange(item.id)}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
