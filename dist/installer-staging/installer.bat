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
