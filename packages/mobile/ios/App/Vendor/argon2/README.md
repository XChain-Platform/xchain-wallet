# Argon2 reference implementation (vendored)

The portable C reference implementation of Argon2, compiled into the iOS App
target so the XChainVault `argon2id` plugin method derives wallet keys natively
instead of in the WebView's JavaScript.

## Source

- Upstream: https://github.com/P-H-C/phc-winner-argon2  
- Release tag: `20190702` (commit `62358ba2123abd17fccf2a108a301d4b52c01a7c`)  
- Licence: CC0 1.0 or Apache-2.0, at the user's option; full text in `LICENSE`.  

Only the files the portable build needs are copied, byte for byte and
unmodified. `src/opt.c` (SSE, x86 only) is left out so the same sources build
for arm64 devices and simulators. `module.modulemap` and this README are local
additions.

## Files and SHA-256

| File | SHA-256 |
|---|---|
| `LICENSE` | `220f8736a89ff51c92ef3d497f413b48e6cf1df3d6278bc909c6308c78e1718e` |
| `include/argon2.h` | `df20cb726a2fe6bccc736b81ea0d86219766a0d17f1794c19e048a34830ca1cc` |
| `src/argon2.c` | `72a93deebc5fd76bec0c6d300a2d92b500fb354b26babbddbc6d8b88681e663d` |
| `src/core.c` | `0f53eb2370f8971f04fcf043b8083bf81d1530c48b2ead71c0b6c4e22a01aeec` |
| `src/core.h` | `c9665623cb3d306f63b6a3effd87bcfab971c28253c77e111445e42c1523235e` |
| `src/encoding.c` | `e20124ec0f780f88527e79cf00825e839624ed1f469c7e231596bf070f8c7b14` |
| `src/encoding.h` | `42f283d12ec445cfb423ac2f1f5a5d1a7f152ce2b9363f6ec3e1d5b61cd4ee6d` |
| `src/ref.c` | `4ec47b080c22f4ee416b9dbcfae70ee6007fcfba427f870d7b84395846fa1bc7` |
| `src/thread.c` | `1402085e2f54b021ea31b0d301f4b689a8b300832e2d11901502e62835185e3e` |
| `src/thread.h` | `9eab7f9ff356862a00a3075478dd0059344953ed79daab8b29185be2010efe78` |
| `src/blake2/blake2.h` | `3c2de197dd23179f78c57deac7b73a6049778bf651c5db57e508b2cfce5e7559` |
| `src/blake2/blake2-impl.h` | `8ac91f1f57d94235f8de0069b7809be1deb365c3b37adb8e30423cd364aff09a` |
| `src/blake2/blake2b.c` | `52519ccbc1e48f489ff444091f630d05dadcc8f1ee61c5b7361e3a9618299c9a` |
| `src/blake2/blamka-round-ref.h` | `bcfdcf785218cf897f05b144e80b659e611188fee3887d533bdcb7a6aa4c336b` |

Recompute them from this directory with `shasum -a 256` and compare against the table.

## Wiring

- The six `.c` files are in the App target's Sources phase.  
- `HEADER_SEARCH_PATHS` points at `include/` so the C sources find `argon2.h`.  
- `SWIFT_INCLUDE_PATHS` points here, so Swift reaches the API as `import Argon2`
  through `module.modulemap`.  
- `App/vault/VaultArgon2id.swift` calls `argon2id_hash_raw`, and
  `AppTests/VaultArgon2idTests.swift` holds it to
  `test/fixtures/crypto/argon2id-vectors.json`.  

## Updating

Copy the same file list from a newer upstream tag, update the tag, commit and
hashes above, and run the AppTests target: every golden vector must still match.
