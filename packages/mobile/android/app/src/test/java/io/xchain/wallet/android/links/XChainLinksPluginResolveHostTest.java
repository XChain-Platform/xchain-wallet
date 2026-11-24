/*
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.links;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.UnknownHostException;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class XChainLinksPluginResolveHostTest {

    @Test
    public void declaresResolveHostAndDefaultsToSystemLookup() throws Exception {
        Method method = XChainLinksPlugin.class.getDeclaredMethod("resolveHost", PluginCall.class);
        assertNotNull(method.getAnnotation(PluginMethod.class));

        XChainLinksPlugin plugin = new XChainLinksPlugin();
        assertSame(CallbackResolve.SYSTEM, plugin.callbackLookup);
    }

    @Test
    public void resolvesAddressesInLookupOrder() throws Exception {
        RecordingLookup lookup = new RecordingLookup(new InetAddress[] {
                address("callback.example", 8, 8, 8, 8),
                address("callback.example", 1, 1, 1, 1),
        });
        TestCall call = resolve("callback.example", lookup);

        assertNull(call.rejection);
        assertNotNull(call.result);
        assertEquals(2, call.result.getJSONArray("addresses").length());
        assertEquals("8.8.8.8", call.result.getJSONArray("addresses").getString(0));
        assertEquals("1.1.1.1", call.result.getJSONArray("addresses").getString(1));
        assertEquals(1, lookup.calls);
        assertEquals("callback.example", lookup.host);
    }

    @Test
    public void removesIpv6BracketsBeforeLookup() throws Exception {
        RecordingLookup lookup = new RecordingLookup(new InetAddress[] {
                InetAddress.getByAddress("2001:db8::1", new byte[] {
                        0x20, 0x01, 0x0d, (byte) 0xb8, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 1,
                }),
        });
        TestCall call = resolve("[2001:db8::1]", lookup);

        assertNull(call.rejection);
        assertEquals(1, call.result.getJSONArray("addresses").length());
        assertEquals("2001:db8:0:0:0:0:0:1",
                call.result.getJSONArray("addresses").getString(0));
        assertEquals(1, lookup.calls);
        assertEquals("2001:db8::1", lookup.host);
    }

    @Test
    public void hidesUnknownHostSecurityAndEmptyLookupFailures() {
        assertLookupFailure(host -> {
            throw new UnknownHostException("callback.example was not found");
        });
        assertLookupFailure(host -> {
            throw new SecurityException("blocked callback.example");
        });
        assertLookupFailure(host -> new InetAddress[0]);
    }

    @Test
    public void rejectsMissingAndBlankHostsWithoutLookup() {
        RecordingLookup lookup = new RecordingLookup(new InetAddress[0]);

        assertFailure(resolve(null, lookup));
        assertFailure(resolve("   ", lookup));
        assertEquals(0, lookup.calls);
    }

    private static void assertLookupFailure(CallbackResolve.Lookup lookup) {
        assertFailure(resolve("callback.example", lookup));
    }

    private static void assertFailure(TestCall call) {
        assertNull(call.result);
        assertEquals("Callback host lookup failed", call.rejection);
        assertNull(call.rejectionCause);
    }

    private static TestCall resolve(String host, CallbackResolve.Lookup lookup) {
        XChainLinksPlugin plugin = new XChainLinksPlugin();
        plugin.callbackExecutor = Runnable::run;
        plugin.callbackLookup = lookup;
        JSObject data = new JSObject();
        if (host != null) data.put("host", host);
        TestCall call = new TestCall(data);

        plugin.resolveHost(call);
        return call;
    }

    private static InetAddress address(String host, int... bytes) throws UnknownHostException {
        byte[] address = new byte[bytes.length];
        for (int index = 0; index < bytes.length; index++) {
            address[index] = (byte) bytes[index];
        }
        return InetAddress.getByAddress(host, address);
    }

    private static final class RecordingLookup implements CallbackResolve.Lookup {
        final InetAddress[] answers;
        int calls;
        String host;

        RecordingLookup(InetAddress[] answers) {
            this.answers = answers;
        }

        @Override
        public InetAddress[] lookup(String host) {
            calls++;
            this.host = host;
            return answers;
        }
    }

    private static final class TestCall extends PluginCall {
        JSObject result;
        String rejection;
        Exception rejectionCause;

        TestCall(JSObject data) {
            super(null, "XChainLinks", "test", "resolveHost", data);
        }

        @Override
        public void resolve(JSObject data) {
            result = data;
        }

        @Override
        public void reject(String message) {
            rejection = message;
        }

        @Override
        public void reject(String message, Exception error) {
            rejection = message;
            rejectionCause = error;
        }
    }
}
