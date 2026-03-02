# Script de build pour créer l'installateur auto-extractible
# ============================================================

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build Installateur PNGTuber Bot" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Étape 1 : Build de l'exe si nécessaire
if (-not $SkipBuild) {
    Write-Host "[1/4] Build de l'application..." -ForegroundColor Yellow
    npm run build:exe
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Erreur lors du build de l'exe" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "[1/4] Skip build (exe existant)" -ForegroundColor Gray
}

# Vérifier que l'exe existe
if (!(Test-Path "dist\pngtuber-bot.exe")) {
    Write-Host "Erreur : dist\pngtuber-bot.exe n'existe pas" -ForegroundColor Red
    exit 1
}

# Étape 2 : Préparer le dossier de staging
Write-Host "[2/4] Préparation des fichiers..." -ForegroundColor Yellow
$StagingDir = "dist\installer-staging"
if (Test-Path $StagingDir) {
    Remove-Item $StagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

# Copier les fichiers nécessaires
Copy-Item "dist\pngtuber-bot.exe" -Destination "$StagingDir\" -Force
Copy-Item "*.html" -Destination "$StagingDir\" -Force
Copy-Item "script.js" -Destination "$StagingDir\" -Force
Copy-Item "positioner.js" -Destination "$StagingDir\" -Force
Copy-Item "viewer.js" -Destination "$StagingDir\" -Force
Copy-Item "styles.css" -Destination "$StagingDir\" -Force
Copy-Item "installer\install.ps1" -Destination "$StagingDir\" -Force

# Copier les dossiers
if (Test-Path "images") {
    Copy-Item "images" -Destination "$StagingDir\" -Recurse -Force
}
if (Test-Path "obs-widget") {
    Copy-Item "obs-widget" -Destination "$StagingDir\" -Recurse -Force
}

# Étape 3 : Créer le wrapper batch qui lance PowerShell
Write-Host "[3/4] Création du launcher..." -ForegroundColor Yellow
$BatchContent = @"
@echo off
title Installation PNGTuber Bot
echo.
echo ==========================================
echo   PNGTuber Bot - Installation
echo ==========================================
echo.
echo Verification des privileges administrateur...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo [ERREUR] Droits administrateur requis !
    echo.
    echo Faites un clic-droit sur l'installateur
    echo et choisissez "Executer en tant qu'administrateur"
    echo.
    pause
    exit /b 1
)

echo Lancement de l'installation...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0install.ps1"
"@

Set-Content -Path "$StagingDir\installer.bat" -Value $BatchContent -Encoding ASCII

# Étape 4 : Créer la configuration IExpress
Write-Host "[4/4] Création de l'installateur .exe..." -ForegroundColor Yellow

$SedFile = "dist\iexpress-config.sed"
$OutputExe = "dist\PNGTuberBot-Setup.exe"
$OutputExeFullPath = Join-Path (Get-Location) $OutputExe
$SedFileFullPath = Join-Path (Get-Location) $SedFile

# Récupérer la liste des fichiers
$Files = Get-ChildItem -Path $StagingDir -Recurse -File | ForEach-Object {
    $_.FullName.Replace((Get-Item $StagingDir).FullName + "\", "")
}

# Construire les sections du fichier .sed
$FileSection = @()
$FileCount = 0
foreach ($File in $Files) {
    $FileCount++
    $FileSection += "FILE${FileCount}=`"$File`""
}

$InstallSection = @()
$InstallCount = 0
foreach ($File in $Files) {
    $InstallCount++
    $TargetDir = Split-Path -Parent $File
    if ($TargetDir) {
        $InstallSection += "FILE${InstallCount}=`"$TargetDir`""
    } else {
        $InstallSection += "FILE${InstallCount}=`"`""
    }
}

$SedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$OutputExeFullPath
FriendlyName=PNGTuber Bot Installer
AppLaunched=cmd /c installer.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0=$((Get-Item $StagingDir).FullName)
[SourceFiles0]
$($FileSection -join "`r`n")
"@

Set-Content -Path $SedFile -Value $SedContent -Encoding ASCII

# Lancer IExpress
Write-Host "`nCréation de l'archive auto-extractible..." -ForegroundColor Cyan
$IExpress = "$env:SystemRoot\System32\iexpress.exe"
Start-Process -FilePath $IExpress -ArgumentList "/N `"$SedFileFullPath`"" -Wait -NoNewWindow

if (Test-Path $OutputExe) {
    $Size = [math]::Round((Get-Item $OutputExe).Length / 1MB, 2)
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  Installateur créé avec succès !" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    Write-Host "Fichier : $OutputExe" -ForegroundColor White
    Write-Host "Taille  : $Size MB" -ForegroundColor White
    Write-Host "`nPour installer :" -ForegroundColor Gray
    Write-Host "  1. Faites un clic-droit sur le fichier" -ForegroundColor Gray
    Write-Host "  2. Choisissez 'Executer en tant qu'administrateur'" -ForegroundColor Gray
    Write-Host "  3. Suivez les instructions" -ForegroundColor Gray
    
    # Nettoyer
    Remove-Item $StagingDir -Recurse -Force
    Remove-Item $SedFile -Force
} else {
    Write-Host "`nErreur lors de la création de l'installateur" -ForegroundColor Red
    exit 1
}
