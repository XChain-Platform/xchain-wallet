# Play listing assets

Generated 2026-08-01 ( §8). The STRINGS live in the listing-collateral
section of the [Play submission doc](https://docs.xchain.io/components/wallet/release/mobile/android-play)
and are the source of truth; this directory holds only the images.

## What is here

| File | Play field | Notes |
|---|---|---|
| `icon-512.png` | App icon, 512x512 | Rendered from the vector brand mark and cropped to **exactly the shipped launcher icon's composition**: the mark spans 77.6% of the canvas (149/192, measured off `mipmap-xxxhdpi/ic_launcher.png`), centred, on white. A store icon that does not match the launcher icon looks like a different app. |
| `feature-graphic-1024x500.png` | Feature graphic | Brand gradient `#017BB5` to `#6E377C`, both sampled from the mark itself, with the white lockup that ships in the brand kit (`XChain White Logo.pdf`). No alpha, which Play requires. |
| `screenshots/01-balances.png` | Phone screenshot | |
| `screenshots/02-receive.png` | Phone screenshot | Address + QR |
| `screenshots/03-confirm.png` | Phone screenshot | The Approve/Reject signing screen |
| `screenshots/04-biometric.png` | Phone screenshot | Safety settings: biometric unlock enabled, panic mode, duress passphrase |

All four screenshots are 1080x1920 (9:16), captured off the API 36 emulator
with the system UI in demo mode so the status bar reads a clean 9:30 with no
notification clutter.

## Provenance, stated because it matters for review

- **The wallet in these shots is a regtest wallet**, holding 3 LTC on the local
  regtest chain. No screenshot shows a mainnet address and none shows real
  funds, per the demo-data convention.
- They were taken from a **`store`-profile build**, which is what Play users
  get: that is why there is no Exchange tile on the balances screen. Screenshots
  from a `default` build would show a surface the store build does not ship.
- The fiat total reads **$0.00** because regtest coins carry no price feed. It
  is honest for this build and it is not what a mainnet user sees. If the
  listing wants fiat figures, the shots need re-taking against a priced chain;
  that is a deliberate open choice, not an oversight.

## Still missing before submission

- **Tablet screenshots** (7-inch and 10-inch) IF the listing claims tablet
  support. It should not claim it until someone has actually run the shell on a
  tablet.
- Nothing here is affected by D8 (country availability), which blocks listing
  TEXT only.

## Regenerating

The icon and feature graphic are derived, not hand-drawn, so they can be
rebuilt exactly:

```bash
# 1. render the vector at high resolution (ImageMagick's PDF delegate is not
#    installed on the release Mac, so sips does the rasterising)
sips -s format png --resampleWidth 2400 "XChain Logo.pdf"       --out logo-raw.png
sips -s format png --resampleWidth 2400 "XChain White Logo.pdf" --out white-raw.png

# 2. the lockup is mark-over-wordmark with a transparent gap at rows 431-493 of
#    the 655-tall trimmed image; the icon uses the MARK ALONE
magick logo-raw.png -trim +repage -crop 1058x431+0+0 +repage -trim +repage mark.png
magick mark.png -resize 397x -background white -gravity center -extent 512x512 icon-512.png

# 3. feature graphic: horizontal brand gradient + the full white lockup
magick -size 500x1024 gradient:'#017BB5'-'#6E377C' -rotate -90 fg-bg.png
magick fg-bg.png \( white-raw.png -trim +repage -resize x250 \) \
  -gravity center -geometry +0-30 -composite \
  -font /System/Library/Fonts/HelveticaNeue.ttc -pointsize 30 \
  -fill 'rgba(255,255,255,0.92)' -gravity center \
  -annotate +0+150 'Self-custody wallet for Bitcoin, Litecoin and Dogecoin' \
  -alpha off feature-graphic-1024x500.png
```
