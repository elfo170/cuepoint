# Remove o serviço auxiliar do CuePoint (registro e inicialização). Os dados são mantidos em
# %LOCALAPPDATA%\CuePoint (log, chaves, backups) — apague a pasta manualmente se quiser.
param([ValidateSet('Chrome', 'Chromium', 'Edge', 'All')][string]$Browser = 'All')
$ErrorActionPreference = 'Continue'
$hostName = 'com.cuepoint.helper'
$keys = @{
    Chrome   = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
    Chromium = 'HKCU:\Software\Chromium\NativeMessagingHosts'
    Edge     = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
}
foreach ($b in $keys.Keys) {
    if ($Browser -ne 'All' -and $Browser -ne $b) { continue }
    $k = Join-Path $keys[$b] $hostName
    if (Test-Path $k) { Remove-Item $k -Force; Write-Host "Removido: $k" }
}
if ($Browser -eq 'All') {
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'CuePointHelper' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like '*cuepoint-helper.mjs*daemon*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Serviço encerrado (pid $($_.ProcessId))." }
}
Write-Host 'Pronto. Os dados continuam em' (Join-Path $env:LOCALAPPDATA 'CuePoint')
