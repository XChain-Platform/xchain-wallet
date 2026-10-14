// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import styles from './Chip.module.css';

/**
 * @param {object} props
 * @param {boolean} [props.pressed]
 * @param {(pressed: boolean) => void} [props.onPressedChange]
 * @param {(event: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {boolean} [props.disabled]
 * @param {'button' | 'submit' | 'reset'} [props.type]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function Chip({
    pressed,
    onPressedChange,
    onClick,
    disabled = false,
    type = 'button',
    className,
    children,
    ...rest
}) {
    const isToggle = typeof pressed === 'boolean';
    const classes = [
        styles.chip,
        isToggle ? styles.toggle : styles.staticChip,
        pressed ? styles.pressed : null,
        className,
    ].filter(Boolean).join(' ');

    if (!isToggle) {
        return <span className={classes} {...rest}>{children}</span>;
    }

    function handleClick(event) {
        onClick?.(event);
        if (!event.defaultPrevented) onPressedChange?.(!pressed);
    }

    return (
        <button
            {...rest}
            type={type}
            className={classes}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={handleClick}
        >
            {children}
        </button>
    );
}
