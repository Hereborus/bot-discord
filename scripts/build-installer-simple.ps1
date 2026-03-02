# Build d'un installateur PowerShell autonome (tout-en-un)
# ==========================================================

param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Build Installateur Autonome" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Build l'exe si nécessaire
if (-not $SkipBuild) {
    Write-Host "[1/3] Build de l'application..." -ForegroundColor Yellow
    npm run build:exe
    if ($LASTEXITCODE -ne 0) { exit 1 }
} else {
    Write-Host "[1/3] Skip build" -ForegroundColor Gray
}

if (!(Test-Path "dist\pngtuber-bot.exe")) {
    Write-Host "Erreur : dist\pngtuber-bot.exe introuvable" -ForegroundColor Red
    exit 1
}

# Préparer les fichiers
Write-Host "[2/3] Compression des fichiers..." -ForegroundColor Yellow
$TempZip = "dist\app-payload.zip"
if (Test-Path $TempZip) { Remove-Item $TempZip -Force }

# Créer l'archive
Add-Type -Assembly System.IO.Compression.FileSystem
$Compression = [System.IO.Compression.CompressionLevel]::Optimal
$Archive = [System.IO.Compression.ZipFile]::Open($TempZip, 'Create')

# Ajouter les fichiers
@(
    "dist\pngtuber-bot.exe",
    "index.html",
    "viewer.html",
    "positioner.html",
    "script.js",
    "viewer.js",
    "positioner.js",
    "styles.css"
) | ForEach-Object {
    if (Test-Path $_) {
        $FileName = Split-Path $_ -Leaf
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $_, $FileName, $Compression) | Out-Null
    }
}

# Ajouter les dossiers
if (Test-Path "images") {
    Get-ChildItem "images" -Recurse -File | ForEach-Object {
        $RelPath = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $_.FullName, $RelPath, $Compression) | Out-Null
    }
}
if (Test-Path "obs-widget") {
    Get-ChildItem "obs-widget" -Recurse -File | ForEach-Object {
        $RelPath = $_.FullName.Substring((Get-Location).Path.Length + 1).Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $_.FullName, $RelPath, $Compression) | Out-Null
    }
}

$Archive.Dispose()

# Encoder en Base64
$ZipBytes = [System.IO.File]::ReadAllBytes($TempZip)
$Base64 = [Convert]::ToBase64String($ZipBytes)

# Créer le script d'installation autonome
Write-Host "[3/3] Génération de l'installateur..." -ForegroundColor Yellow

# Partie 1 : Header du script
$InstallerPart1 = @'
# PNGTuber Bot - Installateur Autonome
# ====================================
$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PNGTuber Bot - Installation" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Vérifier les droits admin
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Host "[ERREUR] Droits administrateur requis !" -ForegroundColor Red
    Write-Host "`nFaites un clic-droit sur ce fichier" -ForegroundColor Yellow
    Write-Host "et choisissez 'Executer en tant qu'administrateur'" -ForegroundColor Yellow
    Write-Host "`nAppuyez sur Entree pour fermer..." -ForegroundColor Gray
    Read-Host
    exit 1
}

$InstallDir = "$env:ProgramFiles\PNGTuberBot"
$StartMenuDir = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PNGTuberBot"
$DesktopShortcut = "$env:Public\Desktop\PNGTuber Bot.lnk"
$TempDir = "$env:TEMP\pngtuber-install-$(Get-Random)"

try {
    Write-Host "[1/6] Arrêt des instances en cours..." -ForegroundColor Yellow
    Get-Process -Name "pngtuber-bot" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1

    Write-Host "[2/6] Extraction des fichiers..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    
    $Base64Data = @"
'@

# Partie 2 : après les données Base64
$InstallerPart2 = @'
"@
    $ZipBytes = [Convert]::FromBase64String($Base64Data)
    $ZipPath = "$TempDir\app.zip"
    [System.IO.File]::WriteAllBytes($ZipPath, $ZipBytes)
    
    Add-Type -Assembly System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $TempDir)
    
    Write-Host "[3/6] Installation dans $InstallDir..." -ForegroundColor Yellow
    if (!(Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    
    Get-ChildItem $TempDir -Exclude "*.zip" | Copy-Item -Destination $InstallDir -Recurse -Force
    
    Write-Host "[4/6] Creation des raccourcis..." -ForegroundColor Yellow
    if (!(Test-Path $StartMenuDir)) {
        New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
    }
    
    $WshShell = New-Object -ComObject WScript.Shell
    
    $Shortcut = $WshShell.CreateShortcut("$StartMenuDir\PNGTuber Bot.lnk")
    $Shortcut.TargetPath = "$InstallDir\pngtuber-bot.exe"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "PNGTuber Bot Discord"
    $Shortcut.Save()
    
    $Shortcut = $WshShell.CreateShortcut($DesktopShortcut)
    $Shortcut.TargetPath = "$InstallDir\pngtuber-bot.exe"
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "PNGTuber Bot Discord"
    $Shortcut.Save()
    
    Write-Host "[5/6] Creation du desinstalleur..." -ForegroundColor Yellow
    $UninstallScript = @"
`$InstallDir = "$InstallDir"
`$StartMenuDir = "$StartMenuDir"
`$DesktopShortcut = "$DesktopShortcut"

Write-Host "Desinstallation de PNGTuber Bot..." -ForegroundColor Yellow
Get-Process -Name pngtuber-bot -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if (Test-Path `$InstallDir) { Remove-Item `$InstallDir -Recurse -Force }
if (Test-Path `$StartMenuDir) { Remove-Item `$StartMenuDir -Recurse -Force }
if (Test-Path `$DesktopShortcut) { Remove-Item `$DesktopShortcut -Force }

Write-Host "Desinstallation terminee !" -ForegroundColor Green
pause
"@
    
    Set-Content -Path "$InstallDir\uninstall.ps1" -Value $UninstallScript -Encoding UTF8
    
    $Shortcut = $WshShell.CreateShortcut("$StartMenuDir\Desinstaller PNGTuber Bot.lnk")
    $Shortcut.TargetPath = "powershell.exe"
    $Shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
    $Shortcut.WorkingDirectory = $InstallDir
    $Shortcut.Description = "Desinstaller PNGTuber Bot"
    $Shortcut.Save()
    
    Write-Host "[6/6] Nettoyage..." -ForegroundColor Yellow
    Remove-Item $TempDir -Recurse -Force
    
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  Installation terminee avec succes !" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    Write-Host "Raccourcis crees :" -ForegroundColor White
    Write-Host "  - Menu Demarrer > PNGTuberBot" -ForegroundColor Gray
    Write-Host "  - Bureau > PNGTuber Bot" -ForegroundColor Gray
    Write-Host "`nDonnees utilisateur : $env:APPDATA\PNGTuberBot" -ForegroundColor Gray
    
    Write-Host ""
    $Launch = Read-Host "Lancer PNGTuber Bot maintenant ? (O/N)"
    if ($Launch -eq "O" -or $Launch -eq "o" -or $Launch -eq "Y" -or $Launch -eq "y") {
        Start-Process "$InstallDir\pngtuber-bot.exe"
        Write-Host "`nApplication lancee !" -ForegroundColor Green
    }
    
} catch {
    Write-Host "`n[ERREUR] $($_.Exception.Message)" -ForegroundColor Red
    if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
    Write-Host "`nAppuyez sur Entree pour fermer..." -ForegroundColor Gray
    Read-Host
    exit 1
}

Write-Host "`nAppuyez sur Entree pour fermer..." -ForegroundColor Gray
Read-Host
'@

$InstallerScript = $InstallerPart1 + "`n" + $Base64 + "`n" + $InstallerPart2

$OutputFile = "dist\PNGTuberBot-Setup.ps1"
Set-Content -Path $OutputFile -Value $InstallerScript -Encoding UTF8

# Créer aussi un .bat launcher (fallback)
$BatLauncher = @"
@echo off
title Installation PNGTuber Bot
powershell.exe -ExecutionPolicy Bypass -File "%~dp0PNGTuberBot-Setup.ps1"
"@

Set-Content -Path "dist\PNGTuberBot-Setup.bat" -Value $BatLauncher -Encoding ASCII

# Tenter de produire un vrai installateur .exe autonome
$SetupExe = "dist\PNGTuberBot-Setup.exe"
$ExeBuilt = $false
try {
    if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
        Write-Host "Installation du module ps2exe (CurrentUser)..." -ForegroundColor Yellow
        Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
        Import-Module ps2exe -ErrorAction Stop
    }
    Write-Host "Conversion de l'installateur en .exe..." -ForegroundColor Yellow
    Invoke-ps2exe -inputFile $OutputFile -outputFile $SetupExe -x64 -title "PNGTuber Bot Setup" -description "Installateur autonome PNGTuber Bot" | Out-Null
    if (Test-Path $SetupExe) { $ExeBuilt = $true }
} catch {
    Write-Host "⚠ Conversion .exe indisponible: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

# Nettoyer
Remove-Item $TempZip -Force

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Installateur genere avec succes !" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green
Write-Host "Fichiers crees :" -ForegroundColor White
if ($ExeBuilt) {
    Write-Host "  - dist\PNGTuberBot-Setup.exe" -ForegroundColor Gray
    Write-Host "  - dist\PNGTuberBot-Setup.ps1 (source)" -ForegroundColor Gray
    Write-Host "  - dist\PNGTuberBot-Setup.bat (fallback)" -ForegroundColor Gray
    Write-Host "`nPour installer :" -ForegroundColor Yellow
    Write-Host "  1. Clic-droit sur PNGTuberBot-Setup.exe" -ForegroundColor Yellow
    Write-Host "  2. Choisir 'Executer en tant qu'administrateur'" -ForegroundColor Yellow
    Write-Host "  3. Suivre les instructions" -ForegroundColor Yellow
} else {
    Write-Host "  - dist\PNGTuberBot-Setup.ps1" -ForegroundColor Gray
    Write-Host "  - dist\PNGTuberBot-Setup.bat" -ForegroundColor Gray
    Write-Host "`nPour installer :" -ForegroundColor Yellow
    Write-Host "  1. Clic-droit sur PNGTuberBot-Setup.bat" -ForegroundColor Yellow
    Write-Host "  2. Choisir 'Executer en tant qu'administrateur'" -ForegroundColor Yellow
    Write-Host "  3. Suivre les instructions" -ForegroundColor Yellow
}
