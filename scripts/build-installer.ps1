$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $projectRoot "dist"
$issPath = Join-Path $projectRoot "installer\windows.iss"

if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

$exePath = Join-Path $distDir "pngtuber-bot.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "[build-installer] Exécutable absent, build en cours..."
    Push-Location $projectRoot
    try {
        npm run build:exe
    }
    finally {
        Pop-Location
    }
}

$isccCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
)

$iscc = $isccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) {
    throw "Inno Setup non trouvé. Installe 'Inno Setup 6' puis relance npm run build:installer"
}

Write-Host "[build-installer] Compilation Inno Setup..."
& $iscc "/O$distDir" "/Fpngtuber-bot-setup" $issPath

Write-Host "[build-installer] OK -> $distDir\pngtuber-bot-setup.exe"
