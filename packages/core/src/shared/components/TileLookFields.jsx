// The icon colour, shape and image controls shared by Edit Wallet and Edit
// Account, so both forms look and behave the same.
import { useState } from 'react';
import { IconSelect, InfoTip } from '@xchain-wallet/core/ui';
import { FileField } from './FileField.jsx';
import { tileRadius } from '../utils/walletTile.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

// Tile colours offered (brand purple and blue first).
/* raw-color-ok: literal swatch values, not yet expressed as design tokens. */
// The image dialog's default filter; any other file is still refused below.
const TILE_IMAGE_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const TILE_COLOURS = ['#7B2C8F', '#1E90C7', '#2E7D32', '#E8A33D', '#D93838', '#0F9D8F', '#D6409F', '#5B6170'];

// An uploaded image is drawn onto a 64x64 canvas (cover crop), so the
// stored icon is small whatever the source size.
export async function scaleTo64(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 64, 64);
        return canvas.toDataURL('image/png');
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Colour swatches, shape picker and image picker for a tile look.
 * @param {object} props
 * @param {string} [props.kind]  'wallet' or 'account', used in the help copy
 * @param {string} [props.noun]  older spelling of kind
 * @param {string} props.colour
 * @param {(c: string) => void} props.onColour
 * @param {string} props.shape
 * @param {(s: string) => void} props.onShape
 * @param {string | null} props.image
 * @param {(i: string | null) => void} props.onImage
 */
export function TileLookFields({ kind, noun: legacyNoun, colour, onColour, shape, onShape, image, onImage }) {
    const noun = t((kind || legacyNoun) === 'account' ? 'components.tileLook.nounAccount' : 'components.tileLook.nounWallet');
    const [imageError, setImageError] = useState(/** @type {string | null} */ (null));
    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-1)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--xc-space-1)' }}>
                    <span id="icon-colour-label" style={{ fontSize: 'var(--xc-text-sm)', fontWeight: 600, color: 'var(--xc-text)' }}>{t('components.tileLook.iconColour')}</span>
                    <InfoTip aria={t('components.tileLook.iconColourAbout')} label={t('components.tileLook.iconColourHelp', { noun })} />
                </span>
                {/* data-form-swatch marks a colour picker; its options show the colour, not an icon. */}
                <div role="radiogroup" aria-labelledby="icon-colour-label" data-form-swatch="" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)' }}>
                    {TILE_COLOURS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={colour === c}
                            aria-label={t('components.tileLook.colourValue', { colour: c })}
                            onClick={() => onColour(c)}
                            disabled={Boolean(image)}
                            style={{
                                width: 36, height: 36, borderRadius: 10, background: c, cursor: 'pointer',
                                border: colour === c ? '3px solid var(--xc-text)' : '1px solid var(--xc-border)',
                                opacity: image ? 0.4 : 1,
                            }}
                        />
                    ))}
                </div>
            </div>
            <IconSelect
                label={t('components.tileLook.iconShape')}
                help={t('components.tileLook.iconShapeHelp', { noun })}
                value={shape}
                onChange={onShape}
                options={[
                    { value: 'circle', label: t('components.tileLook.circle'), icon: <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 18, background: colour, borderRadius: tileRadius('circle') }} /> },
                    { value: 'rounded', label: t('components.tileLook.roundedSquare'), icon: <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 18, background: colour, borderRadius: tileRadius('rounded') }} /> },
                ]}
            />
            {/* The standard file field; a dropped image is taken the same way
                as a picked one. */}
            <FileField
                label={t('components.tileLook.iconImage')}
                optional
                help={t('components.tileLook.iconImageHelp')}
                fileName={image ? t('components.tileLook.imageSet') : ''}
                placeholder={t('components.tileLook.chooseImage')}
                accept={TILE_IMAGE_ACCEPT}
                onFile={async (file) => {
                    setImageError(null);
                    if (!file.type.startsWith('image/')) { setImageError(t('components.tileLook.notAnImage')); return; }
                    try { onImage(await scaleTo64(file)); } catch { setImageError(t('components.tileLook.unreadable')); }
                }}
                onClear={() => { setImageError(null); onImage(null); }}
                inputLabel={t('components.tileLook.imageFileInput')}
                chooseLabel={t('components.tileLook.chooseImage')}
                clearLabel={t('components.tileLook.removeImage')}
                error={imageError}
            />
        </>
    );
}
