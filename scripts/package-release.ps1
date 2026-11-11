# Monta os arquivos de uma release em release\<tag>\ (fora do git):
#   cuepoint-extensao-<versao>.zip    extensão do Chrome (carregar sem compactação)
#   cuepoint-servico-pc-<versao>.zip  serviço do Windows (Instalar.cmd), necessário para sincronizar
#   cuepoint-<versao>.apk             app Android assinado com a chave de release
#   SHA256SUMS.txt e RELEASE_NOTES.md (de docs\releases\<tag>.md)
#
# Uso:  npm run release:package            (ou: powershell -File scripts/package-release.ps1 -Tag v1.0)
# Requer android\keystore.properties (chave de release) e o JBR do Android Studio.
param([string]$Tag = 'v1.0', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$notes = Join-Path $root "docs\releases\$Tag.md"
if (-not (Test-Path $notes)) { throw "Notas da release não encontradas: $notes" }
if (-not (Test-Path (Join-Path $root 'android\keystore.properties'))) { throw 'android\keystore.properties ausente: o APK não seria assinado.' }

if (-not $SkipBuild) {
    Push-Location $root
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build falhou' }
        $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
        & (Join-Path $root 'android\gradlew.bat') -p android assembleRelease --console=plain -q
        if ($LASTEXITCODE -ne 0) { throw 'assembleRelease falhou' }
    } finally { Pop-Location }
}

$out = Join-Path $root "release\$Tag"
$stage = Join-Path $out '_stage'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

function New-Zip([string]$folder, [string]$zip) {
    [System.IO.Compression.ZipFile]::CreateFromDirectory($folder, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
}

# Extensão: a pasta extraída é a que o Chrome carrega (o ID é fixo pelo "key" do manifesto)
$ext = Join-Path $stage 'CuePoint-extensao'
Copy-Item (Join-Path $root 'packages\extension\dist') $ext -Recurse
$manifestVersion = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
if ($manifestVersion -ne $version) { throw "manifest.json está na versão $manifestVersion (esperado $version)" }
New-Zip $ext (Join-Path $out "cuepoint-extensao-$version.zip")

# Serviço do PC: o serviço empacotado + instalador que não depende do repositório
$svc = Join-Path $stage 'CuePoint-servico-pc'
New-Item -ItemType Directory -Force $svc | Out-Null
Copy-Item (Join-Path $root 'packages\helper\dist\cuepoint-helper.mjs') $svc
Copy-Item (Join-Path $root 'scripts\install-helper.ps1') $svc
Copy-Item (Join-Path $root 'scripts\uninstall-helper.ps1') $svc
Set-Content -Path (Join-Path $svc 'Instalar.cmd') -Encoding ascii -Value @(
    '@echo off',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-helper.ps1" %*',
    'pause'
)
Set-Content -Path (Join-Path $svc 'Desinstalar.cmd') -Encoding ascii -Value @(
    '@echo off',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-helper.ps1" %*',
    'pause'
)
$leia = @"
CuePoint $version - servico do PC (Windows)

Necessario para sincronizar o celular com o PC. A extensao funciona sem ele.

1. Instale o Node.js LTS (22.13 ou mais novo): https://nodejs.org
2. Instale a extensao do CuePoint no Chrome antes.
3. Mantenha esta pasta onde quiser e de dois cliques em Instalar.cmd (nao precisa de administrador).
   O servico e copiado para %LOCALAPPDATA%\CuePoint\app e inicia junto com o Windows.
4. Recarregue a extensao em chrome://extensions e abra Biblioteca > Dispositivos.

Na primeira conexao do celular, o Windows pergunta sobre o firewall: permita em redes privadas.
Para remover: Desinstalar.cmd (os dados ficam em %LOCALAPPDATA%\CuePoint).
"@
Set-Content -Path (Join-Path $svc 'LEIA-ME.txt') -Encoding utf8 -Value $leia
New-Zip $svc (Join-Path $out "cuepoint-servico-pc-$version.zip")

# App Android
Copy-Item (Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk') (Join-Path $out "cuepoint-$version.apk")

Copy-Item $notes (Join-Path $out 'RELEASE_NOTES.md')
Remove-Item $stage -Recurse -Force

$sums = Get-ChildItem $out -File | Where-Object { $_.Name -ne 'RELEASE_NOTES.md' } | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
}
Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii -Value $sums

Write-Host ''
Write-Host "Release $Tag ($version) em $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0,-38} {1,10:N0} bytes" -f $_.Name, $_.Length) }
