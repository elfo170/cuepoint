package com.elfo170.cuepoint.ui

import com.elfo170.cuepoint.core.BackupException
import com.elfo170.cuepoint.core.FOREIGN_USER_MESSAGE
import com.elfo170.cuepoint.core.Protocol
import com.elfo170.cuepoint.ui.screens.BACKUP_INVALID
import com.elfo170.cuepoint.ui.screens.BACKUP_OPEN_FAILED
import com.elfo170.cuepoint.ui.screens.BACKUP_WRITE_FAILED
import com.elfo170.cuepoint.ui.screens.PAIR_FAILED
import com.elfo170.cuepoint.ui.screens.PC_UNREACHABLE
import com.elfo170.cuepoint.ui.screens.backupErrorText
import com.elfo170.cuepoint.ui.screens.pairErrorText
import com.elfo170.cuepoint.ui.screens.peerStatusText
import org.junit.Assert.assertEquals
import org.junit.Test

/** Mensagens de erro e de estado mostradas ao usuário: nada de códigos ou textos técnicos. */
class FriendlyTextsTest {
    private val fallback = "fallback"

    @Test
    fun backupErrorsKeepClearMessagesAndHideTechnicalOnes() {
        for (clear in listOf("Não é um backup do CuePoint.", "Versão de backup não suportada: 9.", BACKUP_OPEN_FAILED,
            "A pasta de backup não está acessível. Escolha a pasta de novo.")) {
            assertEquals(clear, backupErrorText(IllegalStateException(clear), fallback))
        }
        for (technical in listOf("Checksum não confere: o arquivo está corrompido ou foi alterado.", "Backup sem a tabela track.",
            "Referência quebrada: decision.track_id → track x.", "Id duplicado em track: x.", "Arquivo de backup inválido.",
            "Backup incompleto.", "O arquivo não é um JSON válido (pode estar truncado).")) {
            assertEquals(BACKUP_INVALID, backupErrorText(BackupException(technical), fallback))
        }
        for (write in listOf("já existe um backup chamado a.json", "não foi possível gravar a.json", "não foi possível renomear a.json")) {
            assertEquals(BACKUP_WRITE_FAILED, backupErrorText(IllegalStateException(write), fallback))
        }
        assertEquals(fallback, backupErrorText(java.io.IOException("EACCES"), fallback))
    }

    @Test
    fun pairingErrorsNeverShowRawCodes() {
        assertEquals("Código de pareamento inválido.", pairErrorText(runCatching { Protocol.parsePairingUri("http://x") }.exceptionOrNull()!!))
        assertEquals(PAIR_FAILED, pairErrorText(runCatching { Protocol.parsePairingUri("cuepoint://pair?v=1") }.exceptionOrNull()!!))
        assertEquals(PAIR_FAILED, pairErrorText(IllegalStateException("http_403")))
        assertEquals(PAIR_FAILED, pairErrorText(javax.net.ssl.SSLHandshakeException("Chain validation failed")))
        assertEquals(FOREIGN_USER_MESSAGE, pairErrorText(IllegalStateException(FOREIGN_USER_MESSAGE)))
        val expired = "Código expirado ou já usado. Gere um novo no PC."
        assertEquals(expired, pairErrorText(IllegalStateException(expired)))
    }

    @Test
    fun peerStatusLines() {
        assertEquals("Aguardando sincronizar" to false, peerStatusText(null, null, null, null))
        assertEquals("Aguardando sincronizar" to false, peerStatusText(3, "2026-11-16T10:00:00.000Z", "ok", null))
        assertEquals("Sincronizado em 2026-11-16 10:00" to false, peerStatusText(0, "2026-11-16T10:00:00.000Z", "ok", null))
        assertEquals(PC_UNREACHABLE to true, peerStatusText(0, null, "skipped", null))
        assertEquals(PC_UNREACHABLE to true, peerStatusText(0, null, "error", "java.net.ConnectException: failed"))
        assertEquals(FOREIGN_USER_MESSAGE to true, peerStatusText(0, null, "error", "foreign_user"))
        assertEquals(true, peerStatusText(0, null, "approval_required", null).first.startsWith("Aguardando aprovação no PC"))
    }
}
