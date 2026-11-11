package com.elfo170.cuepoint.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.media.SoundCloudLinks
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.elfo170.cuepoint.data.Category
import com.elfo170.cuepoint.data.Research
import com.elfo170.cuepoint.data.Track

val Orange = Color(0xFFF97316)
val Approve = Color(0xFF10B981)
val Reject = Color(0xFFEF4444)

@Composable
fun CuePointTheme(content: @Composable () -> Unit) {
    val scheme = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = Orange, secondary = Orange, onPrimary = Color.White)
    } else {
        lightColorScheme(primary = Color(0xFFEA580C), secondary = Orange, onPrimary = Color.White)
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

/** Botões ✓ / ✗ (ícones vetoriais). Tocar no estado ativo volta para "não avaliada". */
@Composable
fun DecisionButtons(value: Boolean?, onChange: (Boolean?) -> Unit, size: Int = 44, enabled: Boolean = true) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledIconToggleButton(
            checked = value == false,
            onCheckedChange = { onChange(if (value == false) null else false) },
            enabled = enabled,
            modifier = Modifier.size(size.dp).semantics { contentDescription = "Rejeitar" },
            colors = IconButtonDefaults.filledIconToggleButtonColors(
                checkedContainerColor = Reject, checkedContentColor = Color.White, contentColor = Reject,
            ),
        ) { Icon(Icons.Filled.Close, contentDescription = null) }
        FilledIconToggleButton(
            checked = value == true,
            onCheckedChange = { onChange(if (value == true) null else true) },
            enabled = enabled,
            modifier = Modifier.size(size.dp).semantics { contentDescription = "Aprovar" },
            colors = IconButtonDefaults.filledIconToggleButtonColors(
                checkedContainerColor = Approve, checkedContentColor = Color.White, contentColor = Approve,
            ),
        ) { Icon(Icons.Filled.Check, contentDescription = null) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CategoryChips(categories: List<Category>, selected: Collection<String>, onToggle: (String) -> Unit) {
    if (categories.isEmpty()) {
        Text("Nenhuma categoria criada.", style = MaterialTheme.typography.bodySmall)
        return
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        categories.forEach { c ->
            FilterChip(selected = c.id in selected, onClick = { onToggle(c.id) }, label = { Text(c.name) })
        }
    }
}

/**
 * Linha de faixa: capa (ou ícone), título, artista e, se [openable], o botão "Abrir no SoundCloud".
 */
@Composable
fun TrackLine(track: Track, modifier: Modifier = Modifier, openable: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        TrackArtwork(track.id, track.artworkUrl, 40.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(track.artist.ifBlank { "—" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                if (track.provisional) {
                    Spacer(Modifier.width(6.dp))
                    ProvisionalBadge()
                }
            }
        }
        if (openable && SoundCloudLinks.canOpen(track.urn, track.url)) {
            OpenInSoundCloudIcon(track.urn, track.url)
        }
    }
}

/**
 * Capa da faixa: a imagem guardada da MediaSession ou, como reserva, o `artwork_url` sincronizado.
 * Sem capa, mostra o ícone de nota musical.
 */
@Composable
fun TrackArtwork(trackId: String?, artworkUrl: String?, size: Dp) {
    val cache = LocalContext.current.container.artwork
    val version by cache.version.collectAsStateWithLifecycle()
    val bitmap by produceState(cache.peek(trackId, artworkUrl), trackId, artworkUrl, version) {
        value = cache.load(trackId, artworkUrl)
    }
    Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(size)) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.MusicNote, contentDescription = null) }
        }
    }
}

private fun openOrWarn(context: Context, urn: String?, url: String?) {
    if (!SoundCloudLinks.open(context, urn, url)) {
        Toast.makeText(context, "Instale o app do SoundCloud para abrir esta faixa.", Toast.LENGTH_SHORT).show()
    }
}

@Composable
fun OpenInSoundCloudIcon(urn: String?, url: String?) {
    val context = LocalContext.current
    IconButton(onClick = { openOrWarn(context, urn, url) }, modifier = Modifier.size(36.dp)) {
        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Abrir no SoundCloud", modifier = Modifier.size(20.dp))
    }
}

@Composable
fun OpenInSoundCloudButton(urn: String?, url: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    OutlinedButton(onClick = { openOrWarn(context, urn, url) }, modifier = modifier) {
        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Abrir no SoundCloud")
    }
}

@Composable
fun ProvisionalBadge() {
    Surface(shape = RoundedCornerShape(4.dp), color = Color(0xFFFEF3C7)) {
        Text("provisória", color = Color(0xFF92400E), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 4.dp))
    }
}

@Composable
fun EmptyState(text: String) {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Diálogo com um campo de texto (criar/renomear). */
@Composable
fun TextDialog(title: String, initial: String = "", label: String, confirm: String = "Salvar", onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, label = { Text(label) }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(text.trim()) }, enabled = text.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String = "Excluir", onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm, color = Reject) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

/** Seletor de pesquisa (com opção "Nova pesquisa…"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResearchPicker(
    researches: List<Research>,
    activeId: String?,
    onSelect: (String) -> Unit,
    onCreate: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    val current = researches.firstOrNull { it.id == activeId }
    ExposedDropdownMenuBox(expanded, { expanded = it }, modifier) {
        OutlinedTextField(
            value = current?.name ?: "Escolha uma pesquisa",
            onValueChange = {},
            readOnly = true,
            label = { Text("Pesquisa ativa") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded, { expanded = false }) {
            researches.forEach { r ->
                DropdownMenuItem(text = { Text(r.name) }, onClick = { expanded = false; onSelect(r.id) })
            }
            DropdownMenuItem(text = { Text("+ Nova pesquisa…") }, onClick = { expanded = false; creating = true })
        }
    }
    if (creating) {
        TextDialog("Nova pesquisa", label = "Nome", confirm = "Criar", onDismiss = { creating = false }) {
            creating = false
            onCreate(it)
        }
    }
}

@Suppress("unused")
private val circle = CircleShape
