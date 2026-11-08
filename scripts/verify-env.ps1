# Verifica o ambiente de desenvolvimento do CuePoint (Node, Chrome, JDK/JBR, Android SDK, Gradle).
# Uso: npm run verify:env   (ou: powershell -File scripts/verify-env.ps1 [-Build])
param([switch]$Build)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$failures = 0

function Check([string]$name, [bool]$ok, [string]$detail) {
    if ($ok) {
        Write-Host ("[ OK ] {0} - {1}" -f $name, $detail) -ForegroundColor Green
    } else {
        Write-Host ("[FALHA] {0} - {1}" -f $name, $detail) -ForegroundColor Red
        $script:failures++
    }
}

# Node e npm
$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($node) {
    $nodeVersion = (node --version).TrimStart('v')
    Check 'Node' ([int]($nodeVersion.Split('.')[0]) -ge 22) "v$nodeVersion (requer >= 22)"
} else { Check 'Node' $false 'node não encontrado no PATH' }

$npm = (Get-Command npm -ErrorAction SilentlyContinue)
if ($npm) { Check 'npm' $true (npm --version) } else { Check 'npm' $false 'npm não encontrado' }

# Chrome
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
Check 'Chrome' ([bool]$chrome) ($(if ($chrome) { $chrome } else { 'Google Chrome não encontrado' }))

# JDK: JBR do Android Studio (o java do sistema pode ser antigo)
$jbr = if ($env:CUEPOINT_JAVA_HOME) { $env:CUEPOINT_JAVA_HOME } else { "$env:ProgramFiles\Android\Android Studio\jbr" }
$javaExe = Join-Path $jbr 'bin\java.exe'
if (Test-Path $javaExe) {
    $javaVersionLine = (& cmd /c "`"$javaExe`" -version 2>&1" | Select-Object -First 1)
    $major = if ($javaVersionLine -match '"(\d+)') { [int]$Matches[1] } else { 0 }
    Check 'JDK (JBR)' ($major -ge 17) "$javaVersionLine em $jbr"
} else { Check 'JDK (JBR)' $false "java.exe não encontrado em $jbr (defina CUEPOINT_JAVA_HOME)" }

# Android SDK
$localProps = Join-Path $root 'android\local.properties'
$sdk = $env:ANDROID_HOME
if (-not $sdk -and (Test-Path $localProps)) {
    $line = Get-Content $localProps | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if ($line) { $sdk = ($line -replace '^sdk\.dir=', '') -replace '\\:', ':' -replace '\\\\', '\' }
}
if (-not $sdk) { $sdk = "$env:LOCALAPPDATA\Android\Sdk" }
Check 'Android SDK' (Test-Path $sdk) $sdk
Check 'Plataforma android-35' (Test-Path (Join-Path $sdk 'platforms\android-35')) 'platforms\android-35'
$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
Check 'Build-tools' ([bool]$buildTools) (($buildTools -join ', '))
$adb = Join-Path $sdk 'platform-tools\adb.exe'
Check 'adb' (Test-Path $adb) $adb
$emulator = Join-Path $sdk 'emulator\emulator.exe'
if (Test-Path $emulator) {
    $avds = (& $emulator -list-avds 2>$null) -join ', '
    Check 'Emulador / AVD' ([bool]$avds) ($(if ($avds) { $avds } else { 'nenhum AVD criado' }))
} else { Check 'Emulador / AVD' $false 'emulator.exe não encontrado' }

if (-not (Test-Path $localProps)) {
    $escaped = ($sdk -replace '\\', '/') -replace ':', '\:'
    Set-Content -Path $localProps -Value "sdk.dir=$escaped" -Encoding ascii
    Write-Host "       android/local.properties criado com sdk.dir" -ForegroundColor Yellow
}

# Gradle wrapper
$wrapperProps = Join-Path $root 'android\gradle\wrapper\gradle-wrapper.properties'
$wrapperOk = (Test-Path (Join-Path $root 'android\gradlew.bat')) -and (Test-Path $wrapperProps)
$gradleVersion = if ($wrapperOk) { (Get-Content $wrapperProps | Where-Object { $_ -match '^distributionUrl' }) -replace '.*gradle-([\d.]+)-.*', '$1' } else { '' }
Check 'Gradle wrapper' $wrapperOk "gradle $gradleVersion"

if ($Build -and $failures -eq 0) {
    Write-Host 'Executando assembleDebug...' -ForegroundColor Cyan
    $env:JAVA_HOME = $jbr
    Push-Location (Join-Path $root 'android')
    & .\gradlew.bat assembleDebug --console=plain -q
    Check 'assembleDebug' ($LASTEXITCODE -eq 0) 'android/app/build/outputs/apk/debug'
    Pop-Location
}

Write-Host ''
if ($failures -gt 0) {
    Write-Host "$failures verificação(ões) falharam." -ForegroundColor Red
    exit 1
}
Write-Host 'Ambiente pronto.' -ForegroundColor Green
exit 0
