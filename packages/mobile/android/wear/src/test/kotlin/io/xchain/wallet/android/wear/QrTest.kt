// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.SnapshotQr
import io.xchain.wallet.android.wear.ui.InscribedSquare
import io.xchain.wallet.android.wear.ui.QrModules
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QrTest {
    @Test
    fun decodesSnapshotQrAndFitsItsModulesInsideTheRoundScreen() {
        val snapshot = Json.parseToJsonElement(SNAPSHOT_FIXTURE).jsonObject
        val qrElement = snapshot.getValue("receive").jsonArray[0].jsonObject.getValue("qr")
        val qr = Json.decodeFromJsonElement<SnapshotQr>(qrElement)

        val modules = requireNotNull(QrModules.unpack(qr.size, qr.bits))
        assertEquals(441, modules.size)
        assertTrue(modules.first())
        assertFalse(modules[1])
        assertTrue(modules.last())

        val square = requireNotNull(InscribedSquare.fit(200.0, 0.0))
        assertEquals(29.289, square[0], 0.001)
        assertEquals(141.421, square[2], 0.001)
    }

    private companion object {
        const val SNAPSHOT_FIXTURE = """{
            "receive": [{
                "qr": {
                    "size": 21,
                    "bits": "gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA="
                }
            }]
        }"""
    }
}
