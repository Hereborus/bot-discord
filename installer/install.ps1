# PNGTuber Bot - Script d'installation automatique
# ===================================================

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PNGTuber Bot - Installation" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Chemins d'installation
$InstallDir = "$env:ProgramFiles\PNGTuberBot"
$StartMenuDir = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\PNGTuberBot"
$DesktopShortcut = "$env:Public\Desktop\PNGTuber Bot.lnk"

# Créer le dossier d'installation
Write-Host "[1/5] Création du dossier d'installation..." -ForegroundColor Yellow
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Copier les fichiers
Write-Host "[2/5] Copie des fichiers..." -ForegroundColor Yellow
$SourceDir = Split-Path -Parent $PSScriptRoot
Copy-Item "$SourceDir\dist\pngtuber-bot.exe" -Destination "$InstallDir\" -Force
Copy-Item "$SourceDir\*.html" -Destination "$InstallDir\" -Force
Copy-Item "$SourceDir\*.js" -Destination "$InstallDir\" -Force -Exclude "index.js"
Copy-Item "$SourceDir\*.css" -Destination "$InstallDir\" -Force

# Créer dossier images et copier les assets
if (Test-Path "$SourceDir\images") {
    Copy-Item "$SourceDir\images" -Destination "$InstallDir\" -Recurse -Force
}
if (Test-Path "$SourceDir\obs-widget") {
    Copy-Item "$SourceDir\obs-widget" -Destination "$InstallDir\" -Recurse -Force
}

# Créer le raccourci menu Démarrer
Write-Host "[3/5] Création du raccourci Menu Démarrer..." -ForegroundColor Yellow
if (!(Test-Path $StartMenuDir)) {
    New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$StartMenuDir\PNGTuber Bot.lnk")
$Shortcut.TargetPath = "$InstallDir\pngtuber-bot.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "PNGTuber Bot Discord"
$Shortcut.Save()

# Créer le raccourci Bureau (facultatif)
Write-Host "[4/5] Création du raccourci Bureau..." -ForegroundColor Yellow
$Shortcut = $WshShell.CreateShortcut($DesktopShortcut)
$Shortcut.TargetPath = "$InstallDir\pngtuber-bot.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "PNGTuber Bot Discord"
$Shortcut.Save()

# Créer un désinstalleur
Write-Host "[5/5] Création du désinstalleur..." -ForegroundColor Yellow
$UninstallScript = @"
`$InstallDir = "$InstallDir"
`$StartMenuDir = "$StartMenuDir"
`$DesktopShortcut = "$DesktopShortcut"

Write-Host "Désinstallation de PNGTuber Bot..." -ForegroundColor Yellow
Get-Process -Name pngtuber-bot -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if (Test-Path `$InstallDir) { Remove-Item `$InstallDir -Recurse -Force }
if (Test-Path `$StartMenuDir) { Remove-Item `$StartMenuDir -Recurse -Force }
if (Test-Path `$DesktopShortcut) { Remove-Item `$DesktopShortcut -Force }

Write-Host "Désinstallation terminée !" -ForegroundColor Green
pause
"@

Set-Content -Path "$InstallDir\uninstall.ps1" -Value $UninstallScript -Encoding UTF8

# Créer un raccourci pour le désinstalleur
$Shortcut = $WshShell.CreateShortcut("$StartMenuDir\Désinstaller PNGTuber Bot.lnk")
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Désinstaller PNGTuber Bot"
$Shortcut.Save()

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Installation terminée avec succès !" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green
Write-Host "Raccourcis créés :" -ForegroundColor White
Write-Host "  - Menu Démarrer > PNGTuberBot" -ForegroundColor Gray
Write-Host "  - Bureau > PNGTuber Bot" -ForegroundColor Gray
Write-Host "`nDonnées utilisateur : $env:APPDATA\PNGTuberBot" -ForegroundColor Gray

# Proposer de lancer l'application
$Launch = Read-Host "`nLancer PNGTuber Bot maintenant ? (O/N)"
if ($Launch -eq "O" -or $Launch -eq "o" -or $Launch -eq "Y" -or $Launch -eq "y") {
    Start-Process "$InstallDir\pngtuber-bot.exe"
    Write-Host "`nApplication lancée !" -ForegroundColor Green
}

Write-Host "`nAppuyez sur Entrée pour fermer..." -ForegroundColor Gray
Read-Host
