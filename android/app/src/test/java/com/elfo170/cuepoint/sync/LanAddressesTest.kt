package com.elfo170.cuepoint.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanAddressesTest {
    private val phone = listOf("192.168.1.7" to 24)

    @Test
    fun sameSubnetFirstAndDropsIpv6() {
        // Ordem do anúncio de um PC com placa do VirtualBox: a virtual veio antes da real.
        val announced = listOf("192.168.56.1", "fe80::8456:4f99:c12b:c742", "192.168.1.14", "192.168.56.1")
        assertEquals(listOf("192.168.1.14", "192.168.56.1"), LanAddresses.preferSameSubnet(announced, phone))
    }

    @Test
    fun keepsOriginalOrderWhenNothingMatches() {
        val announced = listOf("10.0.0.5", "172.16.0.9")
        assertEquals(announced, LanAddresses.preferSameSubnet(announced, phone))
        assertEquals(announced, LanAddresses.preferSameSubnet(announced, emptyList()))
    }

    @Test
    fun subnetUsesThePrefixLength() {
        assertTrue(LanAddresses.sameSubnet("10.1.200.3", "10.1.0.1", 16))
        assertFalse(LanAddresses.sameSubnet("10.2.0.3", "10.1.0.1", 16))
        assertTrue(LanAddresses.sameSubnet("192.168.1.7", "192.168.1.7", 32))
        assertFalse(LanAddresses.sameSubnet("192.168.1.7", "x.y", 24))
        assertFalse(LanAddresses.sameSubnet("192.168.1.7", "192.168.1.8", 0))
    }
}
