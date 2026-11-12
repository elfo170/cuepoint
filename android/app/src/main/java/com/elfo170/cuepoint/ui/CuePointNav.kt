package com.elfo170.cuepoint.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.elfo170.cuepoint.container
import com.elfo170.cuepoint.ui.screens.BackupScreen
import com.elfo170.cuepoint.ui.screens.CategoriesScreen
import com.elfo170.cuepoint.ui.screens.ConflictsScreen
import com.elfo170.cuepoint.ui.screens.CurateScreen
import com.elfo170.cuepoint.ui.screens.DevicesScreen
import com.elfo170.cuepoint.ui.screens.PlaylistDetailScreen
import com.elfo170.cuepoint.ui.screens.PlaylistsScreen
import com.elfo170.cuepoint.ui.screens.ResearchDetailScreen
import com.elfo170.cuepoint.ui.screens.ResearchesScreen
import com.elfo170.cuepoint.ui.screens.SoundCloudScreen
import com.elfo170.cuepoint.ui.screens.TracksScreen
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

private data class Dest(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Dest("curate", "Curar", Icons.Filled.PlayCircle),
    Dest("researches", "Pesquisas", Icons.Filled.Folder),
    Dest("tracks", "Músicas", Icons.Filled.LibraryMusic),
    Dest("categories", "Categorias", Icons.Filled.Sell),
    Dest("playlists", "Playlists", Icons.AutoMirrored.Filled.QueueMusic),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CuePointNav(curateTop: @Composable () -> Unit = {}) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val isTab = TABS.any { it.route == route }
    val pendingPair by LocalContext.current.container.pendingPairUri.collectAsStateWithLifecycle()
    val dao = LocalContext.current.container.db.dao()
    val conflicts by remember { dao.observeConflicts().map { it.size } }.collectAsStateWithLifecycle(0)
    LaunchedEffect(pendingPair) { if (pendingPair != null && route != "devices") nav.navigate("devices") }
    val app = LocalContext.current.container
    val pendingSc by app.pendingSoundCloud.collectAsStateWithLifecycle()
    LaunchedEffect(pendingSc) {
        if (pendingSc) {
            app.pendingSoundCloud.value = false
            if (route != "soundcloud") nav.navigate("soundcloud") { launchSingleTop = true }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("CuePoint") },
                navigationIcon = {
                    if (!isTab && route != null) {
                        IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Voltar") }
                    }
                },
                actions = {
                    if (conflicts > 0 && route != "conflicts") {
                        IconButton(onClick = { nav.navigate("conflicts") }) {
                            BadgedBox(badge = { Badge { Text("$conflicts") } }) {
                                Icon(Icons.Filled.CallSplit, contentDescription = "Conflitos: $conflicts")
                            }
                        }
                    }
                    IconButton(onClick = { nav.navigate("settings") }) { Icon(Icons.Filled.Settings, contentDescription = "Configurações") }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                TABS.forEach { tab ->
                    NavigationBarItem(
                        selected = route == tab.route,
                        onClick = {
                            // Destino inicial já está na pilha: basta voltar até ele.
                            if (tab.route == "curate") {
                                nav.popBackStack("curate", inclusive = false)
                                return@NavigationBarItem
                            }
                            nav.navigate(tab.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "curate", modifier = Modifier.padding(padding)) {
            composable("curate") { CurateScreen(curateTop) }
            composable("researches") { ResearchesScreen(onOpen = { nav.navigate("research/$it") }) }
            composable("research/{id}") { ResearchDetailScreen(it.arguments?.getString("id")!!, onBack = { nav.popBackStack() }) }
            composable("tracks") { TracksScreen() }
            composable("categories") { CategoriesScreen() }
            composable("playlists") { PlaylistsScreen(onOpen = { nav.navigate("playlist/$it") }) }
            composable("playlist/{id}") { PlaylistDetailScreen(it.arguments?.getString("id")!!, onBack = { nav.popBackStack() }) }
            composable("settings") {
                SettingsScreen(
                    onDevices = { nav.navigate("devices") },
                    onConflicts = { nav.navigate("conflicts") },
                    onBackup = { nav.navigate("backup") },
                    onSoundCloud = { nav.navigate("soundcloud") },
                )
            }
            composable("backup") { BackupScreen() }
            composable("soundcloud") { SoundCloudScreen() }
            composable("devices") { DevicesScreen() }
            composable("conflicts") { ConflictsScreen() }
        }
    }
}

@Composable
fun SettingsScreen(onDevices: () -> Unit = {}, onConflicts: () -> Unit = {}, onBackup: () -> Unit = {}, onSoundCloud: () -> Unit = {}) {
    val app = LocalContext.current.container
    val scope = rememberCoroutineScope()
    val ops by app.db.dao().observeEventCount().collectAsStateWithLifecycle(0)
    val pending by app.db.dao().observePendingCount().collectAsStateWithLifecycle(0)
    val conflicts by remember { app.db.dao().observeConflicts().map { it.size } }.collectAsStateWithLifecycle(0)
    var name by remember { mutableStateOf("") }
    var deviceId by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val id = app.store.init()
        deviceId = id.deviceId
        name = app.db.dao().observeDevice(id.deviceId).first()?.device_name ?: id.deviceName
    }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Configurações", style = MaterialTheme.typography.headlineSmall)
        Button(onClick = onDevices, modifier = Modifier.fillMaxWidth()) { Text("Dispositivos e sincronização") }
        OutlinedButton(onClick = onConflicts, modifier = Modifier.fillMaxWidth()) {
            Text(if (conflicts == 0) "Conflitos: nenhum" else "Resolver conflitos ($conflicts)")
        }
        OutlinedButton(onClick = onBackup, modifier = Modifier.fillMaxWidth()) { Text("Backup e restauração") }
        OutlinedButton(onClick = onSoundCloud, modifier = Modifier.fillMaxWidth()) { Text("Exportar para o SoundCloud") }
        OutlinedTextField(name, { name = it; saved = false }, label = { Text("Nome do aparelho") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(onClick = { scope.launch { app.store.renameDevice(name); saved = true } }, enabled = name.isNotBlank()) { Text("Salvar") }
        if (saved) Text("Nome salvo.")
        Text("Id do aparelho: $deviceId", style = MaterialTheme.typography.bodySmall)
        Text("Operações registradas: $ops · ainda não sincronizadas: $pending", style = MaterialTheme.typography.bodySmall)
        var anyPlayer by remember { mutableStateOf(app.acceptAnyPlayer) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Ler outros players")
                Text("Além do app do SoundCloud (ex.: variantes do app ou testes).", style = MaterialTheme.typography.bodySmall)
            }
            Switch(anyPlayer, { v -> anyPlayer = v; scope.launch { app.setAcceptAnyPlayer(v) } })
        }
        DebugTools.Section()
    }
}
