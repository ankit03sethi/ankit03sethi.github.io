@echo off
chcp 65001 >nul 2>&1
title Cursive PD Tracker - Installer

color 0B
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║         CURSIVE PD TRACKER - INSTALLER               ║
echo  ║                                                      ║
echo  ║         Public Data Marketplace Insights             ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  This will:
echo    1. Download the latest extension to your PC
echo    2. Open Chrome's Extensions page
echo    3. Show you how to enable it (one click)
echo.
pause
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\Cursive\PDTracker"
set "DOWNLOAD_URL=https://cursive.world/pdtracker/cursive-pd-tracker.zip"
set "ZIP_PATH=%TEMP%\cursive-pd-tracker.zip"

echo [1/4] Creating install folder...
if not exist "%LOCALAPPDATA%\Cursive" mkdir "%LOCALAPPDATA%\Cursive"
if exist "%INSTALL_DIR%" (
    echo       Removing previous version...
    rmdir /s /q "%INSTALL_DIR%"
)
mkdir "%INSTALL_DIR%"

echo [2/4] Downloading extension (small, ~25 KB)...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%ZIP_PATH%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo.
    color 0C
    echo  ERROR: Could not download. Check your internet connection.
    echo  Visit: https://cursive.world/pdtracker/install-extension.html
    pause
    exit /b 1
)

echo [3/4] Extracting files...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP_PATH%' -DestinationPath '%INSTALL_DIR%' -Force"
del "%ZIP_PATH%" 2>nul

if not exist "%INSTALL_DIR%\manifest.json" (
    color 0C
    echo  ERROR: Extraction failed.
    pause
    exit /b 1
)

echo [4/4] Opening Chrome's Extensions page...
start chrome.exe --new-window "chrome://extensions/"
timeout /t 2 >nul

color 0A
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║                    ✓ READY!                          ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Chrome should now be open at the Extensions page.
echo.
echo  FINAL 3 STEPS in Chrome:
echo.
echo    1. Turn ON "Developer mode" (top-right toggle)
echo    2. Click "Load unpacked"
echo    3. Paste this path:
echo.
echo       %INSTALL_DIR%
echo.
echo       (Already copied to your clipboard.)
echo.
echo  Then click the Cursive icon in your toolbar and sign in.
echo.

echo|set /p="%INSTALL_DIR%" | clip

echo  Path copied to clipboard.
echo.
pause
exit /b 0
