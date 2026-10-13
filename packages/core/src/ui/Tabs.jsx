// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useRef } from 'react';
import styles from './Tabs.module.css';

/**
 * @param {object} props
 * @param {Array<{ id: string, label: import('react').ReactNode, count?: number, controls?: string }>} props.items
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.id]
 * @param {string | ((item: { id: string }) => string)} [props.panelId]
 * @param {string} [props.className]
 */
export function Tabs({
    items,
    value,
    onChange,
    id: idProp,
    panelId,
    className,
    ...rest
}) {
    const generatedId = useId();
    const tabsId = idProp || generatedId;
    const buttonRefs = useRef([]);
    const selectedIndex = items.findIndex((item) => item.id === value);
    const rovingIndex = selectedIndex < 0 ? 0 : selectedIndex;

    const selectAt = (index) => {
        const item = items[index];
        if (!item) return;
        onChange(item.id);
        buttonRefs.current[index]?.focus();
    };

    const handleKeyDown = (event) => {
        const focusedIndex = buttonRefs.current.indexOf(event.target);
        if (focusedIndex < 0 || items.length === 0) return;

        let nextIndex;
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                nextIndex = (focusedIndex + 1) % items.length;
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                nextIndex = (focusedIndex - 1 + items.length) % items.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = items.length - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        selectAt(nextIndex);
    };

    const rootClassName = [styles.tabs, className].filter(Boolean).join(' ');

    return (
        <div
            {...rest}
            id={tabsId}
            className={rootClassName}
            role="tablist"
            onKeyDown={handleKeyDown}
        >
            {items.map((item, index) => {
                const selected = index === rovingIndex;
                const controls = item.controls
                    || (typeof panelId === 'function' ? panelId(item) : panelId)
                    || `${tabsId}-panel-${item.id}`;
                return (
                    <button
                        key={item.id}
                        ref={(node) => { buttonRefs.current[index] = node; }}
                        id={`${tabsId}-tab-${item.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={controls}
                        tabIndex={selected ? 0 : -1}
                        className={styles.tab}
                        onClick={() => onChange(item.id)}
                    >
                        <span className={styles.label}>{item.label}</span>
                        {typeof item.count === 'number' ? (
                            <span className={styles.count}>{item.count}</span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
