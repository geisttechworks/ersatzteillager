@echo off
cd /d "%~dp0"
if not exist "gemini-adapter\server.mjs" (
  echo Der Adapter wurde im Projektordner nicht gefunden.
  pause
  exit /b 1
)
echo Gemini-Adapter startet in diesem Fenster.
echo Der API-Schluessel wird aus .env.gemini.local geladen und hier nicht angezeigt.
echo Zum Beenden dieses Fenster mit Strg+C schliessen.
echo.
node.exe "gemini-adapter\server.mjs"
echo.
echo Der Adapter wurde beendet. Details stehen gegebenenfalls oben im Fenster.
pause
