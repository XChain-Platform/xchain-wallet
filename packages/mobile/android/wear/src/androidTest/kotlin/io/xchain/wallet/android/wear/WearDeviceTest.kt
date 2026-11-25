// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import android.content.pm.PackageManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WearDeviceTest {
    private val targetContext
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun targetPackageIsDebugWearApp() {
        assertEquals("io.xchain.wallet.android.debug", targetContext.packageName)
    }

    @Test
    fun deviceReportsWatchFeature() {
        assertTrue(targetContext.packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH))
    }

    @Test
    fun deviceScreenIsRound() {
        assertTrue(targetContext.resources.configuration.isScreenRound)
    }
}
