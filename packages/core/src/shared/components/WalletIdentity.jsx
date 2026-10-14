// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import styles from './WalletIdentity.module.css';

export const WALLET_TONES = [
    'var(--xc-accent-primary)',
    'var(--xc-success)',
    'var(--xc-warning)',
    'var(--xc-danger)',
];

export function walletIdentityTone(walletId = '') {
    let hash = 0;
    for (const character of String(walletId)) {
        hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    }
    return hash % WALLET_TONES.length;
}

export function initialsFor(name) {
    const words = String(name || 'Wallet').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'W';
}

const AVATAR_CONTEXT = Object.freeze({
    header: {
        size: 'var(--xc-avatar-size-header)',
        fontSize: 'var(--xc-avatar-initials-header)',
    },
    list: {
        size: 'var(--xc-avatar-size-list)',
        fontSize: 'var(--xc-avatar-initials-list)',
    },
    hero: {
        size: 'var(--xc-avatar-size-hero)',
        fontSize: 'var(--xc-avatar-initials-hero)',
    },
});

/**
 * Circular identity or asset artwork with a stable initials fallback.
 * Context selects the shared header, list-row, or detail-hero dimensions.
 */
export function IdentityAvatar({
    name,
    seed = '',
    context = 'list',
    tone,
    variant = 'identity',
    src = null,
    srcSet,
    imagePixels,
    className = '',
}) {
    const [failedSrc, setFailedSrc] = useState(null);
    const sizing = AVATAR_CONTEXT[context] || AVATAR_CONTEXT.list;
    const resolvedTone = tone || WALLET_TONES[walletIdentityTone(seed)];
    const identity = variant === 'identity';
    const showImage = Boolean(src) && failedSrc !== src;
    const style = {
        '--xc-avatar-tone': resolvedTone,
        position: 'relative',
        display: 'inline-grid',
        placeItems: 'center',
        flex: `0 0 ${sizing.size}`,
        width: sizing.size,
        height: sizing.size,
        boxSizing: 'border-box',
        overflow: 'hidden',
        verticalAlign: 'middle',
        border: identity ? '2px solid var(--xc-avatar-tone)' : '0',
        borderRadius: 'var(--xc-avatar-shape)',
        background: identity
            ? 'color-mix(in srgb, var(--xc-avatar-tone) 14%, var(--xc-surface))'
            : 'var(--xc-avatar-tone)',
        color: identity ? 'var(--xc-text)' : 'var(--xc-on-accent)',
        fontFamily: 'var(--xc-font-sans)',
        fontSize: sizing.fontSize,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1,
    };

    return (
        <span
            className={className}
            style={style}
            data-xc-avatar=""
            data-xc-avatar-context={context}
            aria-hidden="true"
        >
            {initialsFor(name)}
            {showImage ? (
                <img
                    src={src}
                    srcSet={srcSet}
                    sizes={srcSet && imagePixels ? `${imagePixels}px` : undefined}
                    width={imagePixels}
                    height={imagePixels}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    onError={() => setFailedSrc(src)}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'block',
                        width: '100%',
                        height: '100%',
                        borderRadius: 'inherit',
                        objectFit: 'contain',
                    }}
                />
            ) : null}
        </span>
    );
}

/**
 * Stable visual identity for a wallet. The wallet ID selects a semantic theme
 * token, while the initials keep wallets recognizable without relying on color.
 *
 * @param {object} props
 * @param {{ id: string, name?: string } | null} props.wallet
 * @param {string} [props.label]
 * @param {string} [props.namePrefix]
 * @param {boolean} [props.active]
 * @param {'header'|'list'|'hero'} [props.context]
 */
export function WalletIdentity({ wallet, label = '', namePrefix = '', active = false, context }) {
    if (!wallet) return null;
    const name = wallet.name || 'Unnamed wallet';
    const tone = walletIdentityTone(wallet.id);
    const avatarContext = context || (namePrefix ? 'header' : 'list');

    return (
        <span
            className={`${styles.identity} ${label ? styles.context : ''}`.trim()}
            style={{ '--xc-wallet-identity': WALLET_TONES[tone] }}
            data-wallet-tone={tone}
            data-testid="wallet-identity"
            title={name}
        >
            {label ? <span className={styles.label}>{label}</span> : null}
            <IdentityAvatar
                name={name}
                seed={wallet.id}
                context={avatarContext}
                tone={WALLET_TONES[tone]}
                className={`${styles.avatar} ${active ? styles.active : ''}`.trim()}
            />
            <span className={styles.name}>{namePrefix}{name}</span>
        </span>
    );
}
