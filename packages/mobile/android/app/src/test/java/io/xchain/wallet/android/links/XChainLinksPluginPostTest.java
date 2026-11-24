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

import static org.junit.Assert.assertArrayEquals;
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

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;

import javax.net.ssl.HttpsURLConnection;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class XChainLinksPluginPostTest {

    @Test
    public void declaresPostAndDefaultsToSystemOpener() throws Exception {
        Method method = XChainLinksPlugin.class.getDeclaredMethod("post", PluginCall.class);
        assertNotNull(method.getAnnotation(PluginMethod.class));

        XChainLinksPlugin plugin = new XChainLinksPlugin();
        assertSame(CallbackPinnedOpen.SYSTEM, plugin.callbackOpener);
    }

    @Test
    public void postsToPinnedAddressAndResolvesEveryStatus() {
        assertSuccessfulPost(204);
        assertSuccessfulPost(500);
    }

    @Test
    public void refusesInvalidRequestsBeforeOpeningAConnection() {
        JSObject redirect = validData().put("redirect", "follow");
        assertRefused(redirect);

        JSObject credentials = validData().put("credentials", "include");
        assertRefused(credentials);

        JSObject missingTimeout = validData();
        missingTimeout.remove("timeoutMs");
        assertRefused(missingTimeout);

        assertRefused(validData().put("address", "127.0.0.1"));
        assertRefused(validData().put("address", "example.com"));
    }

    @Test
    public void hidesIoFailureDetails() {
        XChainLinksPlugin plugin = directPlugin();
        plugin.callbackOpener = url -> {
            throw new IOException("failed for https://example.com/cb?x=1");
        };
        TestCall call = new TestCall(validData());

        plugin.post(call);

        assertNull(call.result);
        assertEquals("Callback POST failed", call.rejection);
    }

    private static void assertSuccessfulPost(int status) {
        RecordingOpener opener = new RecordingOpener(status);
        XChainLinksPlugin plugin = directPlugin();
        plugin.callbackOpener = opener;
        TestCall call = new TestCall(validData());

        plugin.post(call);

        assertNull(call.rejection);
        assertNotNull(call.result);
        assertEquals(status, call.result.optInt("status"));
        assertEquals(1, opener.calls);
        assertEquals("https://8.8.8.8/cb?x=1", opener.openedUrl.toString());
        assertEquals("example.com", opener.connection.getRequestProperty("Host"));
        assertArrayEquals("{\"ok\":true}".getBytes(StandardCharsets.UTF_8),
                opener.connection.output.toByteArray());
        assertEquals(0, opener.connection.connects);
        assertEquals(1, opener.connection.disconnects);
    }

    private static void assertRefused(JSObject data) {
        RecordingOpener opener = new RecordingOpener(204);
        XChainLinksPlugin plugin = directPlugin();
        plugin.callbackOpener = opener;
        TestCall call = new TestCall(data);

        plugin.post(call);

        assertNull(call.result);
        assertEquals("Callback request refused", call.rejection);
        assertEquals(0, opener.calls);
    }

    private static XChainLinksPlugin directPlugin() {
        XChainLinksPlugin plugin = new XChainLinksPlugin();
        plugin.callbackExecutor = Runnable::run;
        return plugin;
    }

    private static JSObject validData() {
        return new JSObject()
                .put("href", "https://example.com/cb?x=1")
                .put("address", "8.8.8.8")
                .put("body", "{\"ok\":true}")
                .put("timeoutMs", 10000.0)
                .put("redirect", "manual")
                .put("credentials", "omit");
    }

    private static final class RecordingOpener implements CallbackPinnedOpen.Opener {
        final int status;
        int calls;
        URL openedUrl;
        RecordingConnection connection;

        RecordingOpener(int status) {
            this.status = status;
        }

        @Override
        public RecordingConnection open(URL url) {
            calls++;
            openedUrl = url;
            connection = new RecordingConnection(url, status);
            return connection;
        }
    }

    private static final class RecordingConnection extends HttpsURLConnection {
        final int status;
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        int connects;
        int disconnects;

        RecordingConnection(URL url, int status) {
            super(url);
            this.status = status;
        }

        @Override
        public OutputStream getOutputStream() {
            return output;
        }

        @Override
        public int getResponseCode() {
            return status;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(new byte[0]);
        }

        @Override
        public void connect() {
            connects++;
        }

        @Override
        public void disconnect() {
            disconnects++;
        }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public String getCipherSuite() {
            return null;
        }

        @Override
        public Certificate[] getLocalCertificates() {
            return null;
        }

        @Override
        public Certificate[] getServerCertificates() {
            return null;
        }
    }

    private static final class TestCall extends PluginCall {
        JSObject result;
        String rejection;

        TestCall(JSObject data) {
            super(null, "XChainLinks", "test", "post", data);
        }

        @Override
        public void resolve(JSObject data) {
            result = data;
        }

        @Override
        public void reject(String message, Exception error) {
            rejection = message;
        }
    }
}
