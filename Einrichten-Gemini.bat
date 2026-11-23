@echo off
cd /d "%~dp0"
if not exist ".env.gemini.local" (
  copy ".env.gemini.example" ".env.gemini.local" >nul
)
start "Gemini-Schluessel eintragen" notepad.exe "%~dp0.env.gemini.local"
echo.
echo Trage den Gemini API-Schluessel hinter GEMINI_API_KEY= ein und speichere die Datei.
echo Das Fenster mit der App danach schliessen und Start-App.bat erneut starten.
echo.
pause
