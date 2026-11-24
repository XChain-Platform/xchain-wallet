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

package io.xchain.wallet.android.activity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;

import io.xchain.wallet.android.notify.NotifyChannels;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.TIRAMISU)
public class BackgroundActivityWorkerTest {

    private Context context;
    private ActivityCheckFiles files;
    private NotificationManager notifications;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        files = new ActivityCheckFiles(context.getFilesDir());
        files.clear();
        notifications = context.getSystemService(NotificationManager.class);
        notifications.cancelAll();
        notifications.createNotificationChannel(new NotificationChannel(
                NotifyChannels.channelId(BackgroundActivityWorker.FAMILY),
                "Activity",
                NotificationManager.IMPORTANCE_DEFAULT));
    }

    @After
    public void tearDown() {
        notifications.cancelAll();
        files.clear();
    }

    @Test
    public void periodicRequestRunsEverySixHoursOnlyWithNetwork() {
        PeriodicWorkRequest request = BackgroundActivityWorker.periodicRequest();

        assertEquals(
                TimeUnit.HOURS.toMillis(6),
                request.getWorkSpec().intervalDuration);
        assertEquals(
                NetworkType.CONNECTED,
                request.getWorkSpec().constraints.getRequiredNetworkType());
    }

    @Test
    public void disabledConfigDoesNothing() throws Exception {
        files.writeConfig(config(false, false).toString());
        AtomicInteger reads = new AtomicInteger();

        assertFalse(BackgroundActivityWorker.runOnce(context, address -> {
            reads.incrementAndGet();
            return Arrays.asList("1", "0");
        }, 1000));

        assertEquals(0, reads.get());
        assertTrue(files.runLog().isEmpty());
        assertEquals(0, notifications.getActiveNotifications().length);
    }

    @Test
    public void firstSightStoresBaselineAndOneChangedRunPostsOneNotice() throws Exception {
        files.writeConfig(config(true, false).toString());

        assertTrue(BackgroundActivityWorker.runOnce(
                context, address -> Arrays.asList("1", "0"), 1000));
        assertEquals(0, notifications.getActiveNotifications().length);
        JSONObject stored = new JSONObject(files.readConfig());
        assertEquals("1", stored.getJSONArray("targets").getJSONObject(0).getString("confirmed"));
        assertEquals("0", stored.getJSONArray("targets").getJSONObject(0).getString("pending"));

        assertTrue(BackgroundActivityWorker.runOnce(
                context, address -> Arrays.asList("1", "2"), 2000));

        assertEquals(Arrays.asList(1000L, 2000L), files.runLog());
        assertEquals(1, notifications.getActiveNotifications().length);
        Notification notice = notifications.getActiveNotifications()[0].getNotification();
        assertEquals(
                NotifyChannels.channelId(BackgroundActivityWorker.FAMILY),
                notice.getChannelId());
        assertEquals("New activity", notice.extras.getString(Notification.EXTRA_TITLE));
        assertEquals(
                "Open XChain Wallet to see what changed.",
                notice.extras.getString(Notification.EXTRA_TEXT));
    }

    @Test
    public void failedReadKeepsBaselineAndLogsTheRun() throws Exception {
        files.writeConfig(config(true, true).toString());
        String before = files.readConfig();

        assertTrue(BackgroundActivityWorker.runOnce(context, address -> null, 3000));

        JSONObject stored = new JSONObject(files.readConfig());
        JSONObject target = stored.getJSONArray("targets").getJSONObject(0);
        assertEquals("1", target.getString("confirmed"));
        assertEquals("0", target.getString("pending"));
        assertFalse(target.has("lastCheckedAt"));
        assertEquals(before, files.readConfig());
        assertEquals(Arrays.asList(3000L), files.runLog());
        assertEquals(0, notifications.getActiveNotifications().length);
    }

    @Test
    public void productionReaderGetsUrlAndExtractsConfiguredPaths() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<Throwable> serverFailure = new AtomicReference<>();
        byte[] response = ("{\"balances\":{\"confirmed\":\"wrong\",\"pending\":\"wrong\"},"
                + "\"result\":{\"settled\":{\"value\":\"17\"},"
                + "\"waiting\":{\"value\":\"4\"}}}")
                .getBytes(StandardCharsets.UTF_8);
        ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        Thread serverThread = new Thread(() -> {
            try (Socket socket = server.accept();
                    BufferedReader input = new BufferedReader(new InputStreamReader(
                            socket.getInputStream(), StandardCharsets.US_ASCII));
                    OutputStream output = socket.getOutputStream()) {
                String[] requestLine = input.readLine().split(" ");
                requests.incrementAndGet();
                method.set(requestLine[0]);
                path.set(requestLine[1]);
                for (String line; !(line = input.readLine()).isEmpty(); ) {
                }
                output.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                        + "Content-Length: " + response.length
                        + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                output.write(response);
                output.flush();
            } catch (Throwable error) {
                serverFailure.set(error);
            }
        });
        serverThread.start();

        try {
            JSONObject configured = config(true, false);
            JSONObject target = configured.getJSONArray("targets").getJSONObject(0);
            target.put("url", "http://127.0.0.1:" + server.getLocalPort()
                    + "/activity/address-1?view=wallet");
            target.put("confirmedPath", "result.settled.value");
            target.put("pendingPath", "result.waiting.value");
            files.writeConfig(configured.toString());

            assertTrue(BackgroundActivityWorker.runOnce(context, null, 4000));

            JSONObject stored = new JSONObject(files.readConfig());
            JSONObject storedTarget = stored.getJSONArray("targets").getJSONObject(0);
            assertEquals(1, requests.get());
            assertEquals("GET", method.get());
            assertEquals("/activity/address-1?view=wallet", path.get());
            assertEquals("17", storedTarget.getString("confirmed"));
            assertEquals("4", storedTarget.getString("pending"));
            assertEquals(4000L, storedTarget.getLong("lastCheckedAt"));
            assertEquals(Arrays.asList(4000L), files.runLog());
            assertEquals(0, notifications.getActiveNotifications().length);
        } finally {
            server.close();
            serverThread.join(5000);
        }
        assertFalse(serverThread.isAlive());
        assertNull(serverFailure.get());
    }

    private static JSONObject config(boolean enabled, boolean baseline) throws Exception {
        JSONObject target = new JSONObject()
                .put("address", "address-1")
                .put("url", "https://example.invalid/address/address-1")
                .put("confirmedPath", "balances.confirmed")
                .put("pendingPath", "balances.pending");
        if (baseline) target.put("confirmed", "1").put("pending", "0");
        JSONObject config = new JSONObject()
                .put("enabled", enabled)
                .put("targets", new JSONArray().put(target))
                .put("notice", new JSONObject()
                        .put("title", "New activity")
                        .put("body", "Open XChain Wallet to see what changed."))
                .put("openOnPhoneTitle", "Open on phone");
        assertNotNull(config);
        return config;
    }
}
