@echo off
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  set PY=py
) else (
  set PY=python
)

echo.
echo  VT GIS - iniciando servidor local...
echo  Acesse: http://localhost:8080/login.html
echo  Mantenha esta janela aberta enquanto usar o mapa.
echo.

start "VT GIS Server" /min %PY% -m http.server 8080
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080/login.html"

echo Servidor ativo. Pressione qualquer tecla para encerrar.
pause >nul
taskkill /FI "WINDOWTITLE eq VT GIS Server*" /T /F >nul 2>&1
