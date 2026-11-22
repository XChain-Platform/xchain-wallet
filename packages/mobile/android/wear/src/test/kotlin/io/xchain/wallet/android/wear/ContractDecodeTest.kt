// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.Detail
import io.xchain.wallet.android.wear.data.Snapshot
import java.io.File
import kotlinx.serialization.json.Json
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractDecodeTest {
    private val json = Json

    @Test
    fun decodesEverySnapshotFixture() {
        fixtures("snapshot-").forEach { file ->
            json.decodeFromString<Snapshot>(file.readText())
        }
    }

    @Test
    fun decodesEveryDetailFixture() {
        fixtures("detail-").forEach { file ->
            json.decodeFromString<Detail>(file.readText())
        }
    }

    private fun fixtures(prefix: String): List<File> {
        val classLoader = requireNotNull(javaClass.classLoader)
        val directory = requireNotNull(classLoader.getResource("snapshot-empty.json"))
            .toURI()
            .let(::File)
            .let { requireNotNull(it.parentFile) }
        val fixtures = requireNotNull(directory.listFiles())
            .filter { it.isFile && it.name.startsWith(prefix) && it.extension == "json" }
            .sortedBy { it.name }

        assertTrue("No $prefix fixtures found", fixtures.isNotEmpty())
        return fixtures
    }
}
