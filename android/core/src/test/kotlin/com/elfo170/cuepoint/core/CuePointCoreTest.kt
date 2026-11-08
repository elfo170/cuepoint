package com.elfo170.cuepoint.core

import org.junit.Assert.assertEquals
import org.junit.Test

class CuePointCoreTest {
    @Test
    fun schemaVersionMatchesTypeScript() {
        assertEquals(1, CuePointCore.SCHEMA_VERSION)
    }
}
