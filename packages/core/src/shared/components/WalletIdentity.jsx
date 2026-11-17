// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
// The wallet tile saved by Edit wallet (colour, image, shape).
import { readWalletTile, tileRadius, WALLET_TILE_EVENT, walletTileText } from '../utils/walletTile.js';
// The look Edit Contact stores on the contact record.
import { contactAvatarSeed, readContactLook } from '../utils/contactLook.js';
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
    // The tile's text when it is not the initials of name.
    text,
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
        // Forced-colors mode repaints the tone fill as Canvas, so the stylesheet
        // swaps the letter ink to CanvasText there.
        color: identity ? 'var(--xc-text)' : 'var(--xc-avatar-ink, var(--xc-on-accent))',
        fontFamily: 'var(--xc-font-sans)',
        // Three or four characters (JW1, 1234) set smaller to fit.
        fontSize: text && String(text).length >= 3 ? `calc(${sizing.fontSize} * ${({ 3: 0.75, 4: 0.6 })[String(text).length] || 0.5})` : sizing.fontSize,
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
            {/* No letters behind an image, so a transparent image shows clean. */}
            {showImage ? null : (text ?? initialsFor(name))}
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
    const [, setTileTick] = useState(0);
    useEffect(() => {
        const onTile = () => setTileTick((n) => n + 1);
        window.addEventListener(WALLET_TILE_EVENT, onTile);
        return () => window.removeEventListener(WALLET_TILE_EVENT, onTile);
    }, []);
    if (!wallet) return null;
    const tile = readWalletTile(wallet.id);
    const name = wallet.name || 'Unnamed wallet';
    const tone = walletIdentityTone(wallet.id);
    const avatarContext = context || (namePrefix ? 'header' : 'list');

    return (
        <span
            className={`${styles.identity} ${label ? styles.context : ''}`.trim()}
            style={{ '--xc-wallet-identity': tile.colour || WALLET_TONES[tone], '--xc-avatar-shape': tile.shape ? tileRadius(tile.shape) : undefined }}
            data-wallet-tone={tone}
            data-testid="wallet-identity"
            title={name}
        >
            {label ? <span className={styles.label}>{label}</span> : null}
            <IdentityAvatar
                name={name}
                seed={wallet.id}
                context={avatarContext}
                tone={tile.colour || WALLET_TONES[tone]}
                src={tile.image || null}
                text={walletTileText(name)}
                className={`${styles.avatar} ${active ? styles.active : ''}`.trim()}
            />
            <span className={styles.name}>{namePrefix}{name}</span>
        </span>
    );
}

/** The colour a contact with no saved colour shows, picked from its seed. */
export function contactDefaultTone(contact) {
    return WALLET_TONES[walletIdentityTone(contactAvatarSeed(contact))];
}

/**
 * A contact's identity tile: the IdentityAvatar View Contact always drew
 * (initials, the seed-picked colour), with the look Edit Contact saved on the
 * record laid over it (colour, shape, image). Contacts list rows, View
 * Contact, its Edit form and the Messaging rows and thread header all draw
 * it, so they show one look.
 *
 * @param {object} props
 * @param {{ id?: string, name?: string, avatarSeed?: string, look?: object } | null} props.contact
 * @param {'header'|'list'|'hero'} [props.context]
 * @param {string} [props.className]
 */
export function ContactAvatar({ contact, context = 'list', className = '' }) {
    const look = readContactLook(contact);
    const avatar = (
        <IdentityAvatar
            name={contact?.name}
            seed={contactAvatarSeed(contact)}
            context={context}
            tone={look.colour || undefined}
            src={look.image}
            className={className}
        />
    );
    // No saved shape: the token default (a circle), exactly as before.
    if (!look.shape) return avatar;
    return (
        <span aria-hidden="true" data-contact-shape={look.shape} style={{ '--xc-avatar-shape': tileRadius(look.shape), display: 'inline-flex', flex: '0 0 auto' }}>
            {avatar}
        </span>
    );
}
