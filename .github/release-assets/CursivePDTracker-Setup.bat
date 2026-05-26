@echo off
title Cursive PD Tracker - Setup

echo.
echo  ===============================================================
echo            CURSIVE PD TRACKER - ONE-CLICK SETUP
echo  ===============================================================
echo.
echo  This will:
echo    1. Download/install the Cursive PD Tracker extension
echo    2. Make Chrome auto-start when your PC boots
echo    3. Open Chrome for the final 3 clicks (sign in)
echo.
echo  Takes about 30 seconds. Press any key to start.
echo.
pause
echo.

REM Detect Chrome
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if "%CHROME%"=="" (
    echo  ERROR: Chrome not found. Install Chrome from https://www.google.com/chrome/
    pause
    exit /b 1
)

echo  Chrome found.
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\Cursive\PDTracker"
set "DOWNLOAD_URL=https://github.com/ankit03sethi/ankit03sethi.github.io/releases/latest/download/cursive-pd-tracker.zip"
set "ZIP_PATH=%TEMP%\cursive-pd-tracker.zip"

echo  [1/4] Setting up extension folder...
if not exist "%LOCALAPPDATA%\Cursive" mkdir "%LOCALAPPDATA%\Cursive"
if exist "%INSTALL_DIR%" (
    echo        Removing old version...
    rmdir /s /q "%INSTALL_DIR%"
)
mkdir "%INSTALL_DIR%"

echo  [2/4] Downloading extension from cursive.world...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%ZIP_PATH%' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo  ERROR: Download failed. Check internet connection.
    echo  Try again, or contact us: WhatsApp +91 96257 37475
    pause
    exit /b 1
)

echo  [3/4] Extracting and setting Chrome auto-start...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP_PATH%' -DestinationPath '%INSTALL_DIR%' -Force"
del "%ZIP_PATH%" 2>nul

if not exist "%INSTALL_DIR%\manifest.json" (
    echo  ERROR: Extraction failed.
    pause
    exit /b 1
)

REM Chrome auto-start on Windows login
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\Cursive PD Tracker (Chrome).lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%'); $s.TargetPath='%CHROME%'; $s.Arguments='--start-minimized'; $s.WindowStyle=7; $s.Description='Auto-launch Chrome for Cursive PD Tracker'; $s.Save()"

echo  [4/4] Opening Chrome's extensions page...
echo|set /p="%INSTALL_DIR%" | clip
start "" "%CHROME%" --new-window "chrome://extensions/"
timeout /t 2 >nul

echo.
echo  ===============================================================
echo                    ALMOST DONE!
echo  ===============================================================
echo.
echo  Chrome is open at the Extensions page. Now do these 3 clicks:
echo.
echo    1. Turn ON "Developer mode" (top-right toggle)
echo    2. Click "Load unpacked" button
echo    3. Press Ctrl+V (paste path), then Enter
echo       Path already copied to clipboard:
echo       %INSTALL_DIR%
echo.
echo  Then click the Cursive icon in toolbar and sign in.
echo.
echo  After PC restarts: Chrome auto-launches, extension runs by itself.
echo.
pause
exit /b 0
