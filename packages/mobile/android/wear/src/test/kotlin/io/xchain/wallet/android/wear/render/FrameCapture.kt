// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear.render

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import java.nio.file.Files

fun captureFrame(activity: ComponentActivity): Bitmap {
    val window = activity.window.decorView
    check(window.width > 0 && window.height > 0) { "Activity window has no drawable area" }
    return Bitmap.createBitmap(window.width, window.height, Bitmap.Config.ARGB_8888).also {
        window.draw(Canvas(it))
    }
}

fun writeFrame(bitmap: Bitmap, frame: String) {
    val directory = WearRenderFrames.outDir(System.getenv("WEAR_RENDER_OUT")) ?: return
    Files.createDirectories(directory)
    Files.newOutputStream(directory.resolve(frame)).use { output ->
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "Failed to encode $frame" }
    }
}
