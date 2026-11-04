// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Imported ahead of Chip's own sheet so the shared button base always loads
// first and the chip's rules follow it. A CSS-file `composes` would inline a
// second copy of Button.module.css into Chip's sheet, and that copy re-asserts
// .btn over every module loaded before it, real buttons included.
import buttonStyles from './Button.module.css';
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
        // A toggle is a button, so it carries the shared button base.
        isToggle ? buttonStyles.btn : null,
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
