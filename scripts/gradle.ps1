# Executa o Gradle do projeto Android com o JBR do Android Studio.
# Uso: npm run android -- testDebugUnitTest assembleDebug
$jbr = if ($env:CUEPOINT_JAVA_HOME) { $env:CUEPOINT_JAVA_HOME } else { "$env:ProgramFiles\Android\Android Studio\jbr" }
$env:JAVA_HOME = $jbr
Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'android')
& .\gradlew.bat --console=plain @args
$code = $LASTEXITCODE
Pop-Location
exit $code
