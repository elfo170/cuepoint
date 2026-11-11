package com.elfo170.cuepoint.sync

import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Escolha do endereço do PC encontrado por mDNS. O anúncio traz todos os endereços do PC,
 * inclusive de placas virtuais (VirtualBox, Hyper-V, VPN) que o celular não alcança: os IPv4 da
 * mesma sub-rede do celular vêm primeiro, e a sincronização tenta os endereços nessa ordem.
 */
object LanAddresses {
    /** IPv4 das placas ativas do aparelho, com o tamanho do prefixo de rede (ex.: 192.168.1.7/24). */
    fun local(): List<Pair<String, Int>> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { ni ->
                ni.interfaceAddresses
                    .filter { it.address is Inet4Address }
                    .mapNotNull { a -> a.address.hostAddress?.let { it to a.networkPrefixLength.toInt() } }
            }
    }.getOrDefault(emptyList())

    /** Só os IPv4 dos candidatos, sem repetir: primeiro os da mesma sub-rede, na ordem original. */
    fun preferSameSubnet(candidates: List<String>, local: List<Pair<String, Int>>): List<String> {
        val ipv4 = candidates.filter { toInt(it) != null }.distinct()
        val (same, other) = ipv4.partition { c -> local.any { (addr, prefix) -> sameSubnet(c, addr, prefix) } }
        return same + other
    }

    internal fun sameSubnet(a: String, b: String, prefix: Int): Boolean {
        val x = toInt(a) ?: return false
        val y = toInt(b) ?: return false
        if (prefix !in 1..32) return false
        val mask = if (prefix == 32) -1 else -1 shl (32 - prefix)
        return (x and mask) == (y and mask)
    }

    private fun toInt(ip: String): Int? {
        val parts = ip.split('.')
        if (parts.size != 4) return null
        var value = 0
        for (p in parts) {
            val n = p.toIntOrNull() ?: return null
            if (n !in 0..255) return null
            value = (value shl 8) or n
        }
        return value
    }
}
