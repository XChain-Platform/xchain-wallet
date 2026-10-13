// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { useConfirmModal } from '../../../packages/core/src/shared/hooks/useConfirmModal.js';
import { useDispenserDestination } from '../../../packages/core/src/shared/hooks/useDispenserDestination.js';
import { useDocumentTitle } from '../../../packages/core/src/shared/hooks/useDocumentTitle.js';
import { useDropZone } from '../../../packages/core/src/shared/hooks/useDropZone.js';
import { useGatedTickNotice } from '../../../packages/core/src/shared/hooks/useGatedTickNotice.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('shared hook lifecycle cleanup', () => {
    it('invalidates a gated-content response when the lookup becomes disabled', async () => {
        vi.useFakeTimers();
        const lookup = deferred();
        const messaging = { listGatedContent: vi.fn(() => lookup.promise) };
        const hook = renderHook(
            ({ enabled }) => useGatedTickNotice({
                messaging,
                chainId: 'bitcoin-regtest',
                tick: 'ART',
                enabled,
            }),
            { initialProps: { enabled: true } },
        );

        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        hook.rerender({ enabled: false });
        await act(async () => {
            lookup.resolve([{ files: [{ actionIndex: '101' }] }]);
            await lookup.promise;
        });

        expect(hook.result.current).toEqual({ gated: false, packCount: 0, fileCount: 0 });
    });

    it('stops a dispenser lookup before follow-up reads after unmount', async () => {
        vi.useFakeTimers();
        const lookup = deferred();
        const messaging = {
            getDispensersForAddress: vi.fn(() => lookup.promise),
            getDispenserByActionIndex: vi.fn(),
        };
        const hook = renderHook(() => useDispenserDestination({
            messaging,
            chainId: 'bitcoin-regtest',
            to: 'bc1qdestination',
            paymentTick: 'BTC',
            isNativePayment: true,
            enabled: true,
        }));

        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        hook.unmount();
        await act(async () => {
            lookup.resolve({ data: [{
                action_index: '7',
                address: 'bc1qdestination',
                current_status: 'open',
            }] });
            await lookup.promise;
        });

        expect(messaging.getDispenserByActionIndex).not.toHaveBeenCalled();
    });

    it('clears drag state when a mounted drop zone becomes disabled', () => {
        const hook = renderHook(
            ({ disabled }) => useDropZone({ onFile: vi.fn(), disabled }),
            { initialProps: { disabled: false } },
        );

        act(() => hook.result.current.rootProps.onDragOver({
            preventDefault: vi.fn(),
            dataTransfer: { dropEffect: 'none' },
        }));
        expect(hook.result.current.isDragOver).toBe(true);

        hook.rerender({ disabled: true });
        expect(hook.result.current.isDragOver).toBe(false);
    });

    it('does not deliver a file read after the drop zone unmounts', async () => {
        let reader;
        class ControlledFileReader {
            readAsText() { reader = this; }
        }
        vi.stubGlobal('FileReader', ControlledFileReader);
        const onFile = vi.fn();
        const hook = renderHook(() => useDropZone({ onFile }));

        act(() => hook.result.current.rootProps.onDrop({
            preventDefault: vi.fn(),
            dataTransfer: { files: [new File(['data'], 'draft.txt')] },
        }));
        hook.unmount();
        await act(async () => {
            reader.result = 'data';
            reader.onload();
            await Promise.resolve();
        });

        expect(onFile).not.toHaveBeenCalled();
    });

    it('restores the title when document-title ownership ends', () => {
        document.title = 'Host title';
        const hook = renderHook(
            ({ enabled }) => useDocumentTitle({
                statusState: 'unlocked',
                onboardingStep: 'welcome',
                unlockedView: 'send',
                enabled,
            }),
            { initialProps: { enabled: true } },
        );

        expect(document.title).toBe('Send - XChain Wallet');
        hook.rerender({ enabled: false });
        expect(document.title).toBe('Host title');
    });

    it('settles an open modal as cancelled when its owner unmounts', async () => {
        const hook = renderHook(() => useConfirmModal());
        let answer;
        act(() => { answer = hook.result.current.confirm({ title: 'Leave?' }); });

        hook.unmount();

        await expect(answer).resolves.toBe(false);
    });

    it('settles and clears an active action confirmation on unmount', async () => {
        const preflight = deferred();
        const session = { put: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
        const releaseEncoderInputs = vi.fn(async () => {});
        const hook = renderHook(() => useConfirmAction());
        let confirmation;
        act(() => {
            confirmation = hook.result.current.confirm({
                chainId: 'bitcoin-regtest',
                compose: vi.fn(async () => ({
                    psbt: 'psbt',
                    actionString: 'MINT',
                    releaseEncoderInputsToken: 'release-1',
                })),
                preflight: vi.fn(() => preflight.promise),
                onApprove: vi.fn(),
                releaseEncoderInputs,
                session,
                resume: { software: 'mintToken', base: {} },
            });
        });
        const rejected = expect(confirmation).rejects.toMatchObject({ reason: 'user-rejected' });

        await waitFor(() => expect(hook.result.current.phase).toBe('preflighting'));
        hook.unmount();

        await rejected;
        await waitFor(() => {
            expect(releaseEncoderInputs).toHaveBeenCalledWith('release-1');
            expect(session.clear).toHaveBeenCalledWith(expect.stringMatching(/^cs:/));
        });
    });
});
