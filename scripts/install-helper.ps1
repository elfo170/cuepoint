# Instala o serviço auxiliar do CuePoint para o usuário atual (sem administrador).
#
#  - copia o serviço para %LOCALAPPDATA%\CuePoint\app
#  - registra o host de Native Messaging "com.cuepoint.helper" para a extensão
#  - inicia o serviço no logon (chave HKCU\...\Run) e agora
#  - opcional: -Firewall cria a regra de entrada no Firewall do Windows (pede administrador)
#
# Uso:  npm run helper:install            (ou: powershell -File scripts/install-helper.ps1)
#       -Browser Chrome|Chromium|Edge     (padrão: Chrome)
#       -DataDir <pasta>  -AppDir <pasta>  -Pipe <nome>  -Port <n>  -NoAutostart  -Firewall
param(
    [ValidateSet('Chrome', 'Chromium', 'Edge')][string]$Browser = 'Chrome',
    [string]$ExtensionId = 'daaemjinbpmlbffnjbbonliiglbmjjmn',
    [string]$DataDir = '',
    [string]$AppDir = '',
    [string]$Pipe = '',
    [int]$Port = 47800,
    [switch]$NoAutostart,
    [switch]$Firewall
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$hostName = 'com.cuepoint.helper'

$node = (Get-Command node -ErrorAction Stop).Source
$bundle = Join-Path $root 'packages\helper\dist\cuepoint-helper.mjs'
if (-not (Test-Path $bundle)) {
    Write-Host 'Gerando o serviço (npm run build -w @cuepoint/helper)...'
    Push-Location $root; npm run build -w '@cuepoint/helper' | Out-Null; Pop-Location
}

$base = Join-Path $env:LOCALAPPDATA 'CuePoint'
$app = if ($AppDir) { $AppDir } else { Join-Path $base 'app' }
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item $bundle (Join-Path $app 'cuepoint-helper.mjs') -Force

$extra = @()
if ($DataDir) { $extra += @('--data-dir', "`"$DataDir`"") }
if ($Pipe) { $extra += @('--pipe', "`"$Pipe`"") }
$extra += @('--port', "$Port")
$extraArgs = $extra -join ' '

# Host de Native Messaging (o Chrome acrescenta a origem como argumento)
$cmd = Join-Path $app "cuepoint-nm-$Browser.cmd"
Set-Content -Path $cmd -Encoding ascii -Value @(
    '@echo off',
    "`"$node`" --no-warnings `"$app\cuepoint-helper.mjs`" nm $extraArgs %*"
)
$manifestPath = Join-Path $app "$hostName.$Browser.json"
$manifest = [ordered]@{
    name            = $hostName
    description     = 'Serviço auxiliar do CuePoint'
    path            = $cmd
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding utf8

$regBase = switch ($Browser) {
    'Chrome' { 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
    'Chromium' { 'HKCU:\Software\Chromium\NativeMessagingHosts' }
    'Edge' { 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
}
$regKey = Join-Path $regBase $hostName
New-Item -Path $regKey -Force | Out-Null
Set-Item -Path $regKey -Value $manifestPath
Write-Host "Native Messaging registrado: $regKey"

# Serviço em segundo plano (janela oculta) no logon
$vbs = Join-Path $app 'start-daemon.vbs'
Set-Content -Path $vbs -Encoding ascii -Value @(
    'Set sh = CreateObject("WScript.Shell")',
    "sh.Run """"""$node"""" --no-warnings """"$app\cuepoint-helper.mjs"""" daemon $($extraArgs.Replace('"', '""'))"", 0, False"
)
if (-not $NoAutostart) {
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CuePointHelper' -Value "wscript.exe `"$vbs`""
    Start-Process wscript.exe -ArgumentList "`"$vbs`""
    Write-Host 'Serviço iniciado e configurado para iniciar no logon.'
}

if ($Firewall) {
    $rule = "New-NetFirewallRule -DisplayName 'CuePoint (sincronização)' -Direction Inbound -Program '$node' -Action Allow -Profile Private | Out-Null"
    Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile', '-Command', $rule -Wait
    Write-Host 'Regra de firewall criada (rede privada).'
}

Write-Host ''
Write-Host "Pronto. Dados do serviço: $(if ($DataDir) { $DataDir } else { $base })"
Write-Host 'Recarregue a extensão em chrome://extensions e veja Biblioteca → Dispositivos.'
