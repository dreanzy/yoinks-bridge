@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "WSCRIPT=%SystemRoot%\System32\wscript.exe"

reg add "HKCU\Software\Classes\yoinks" /ve /d "URL:yoinks Protocol" /f >nul
reg add "HKCU\Software\Classes\yoinks" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\yoinks\shell\open\command" /ve /d "\"%WSCRIPT%\" \"%HERE%launcher.vbs\" \"%%1\"" /f >nul

if errorlevel 1 (
  echo Registration failed.
  pause
  exit /b 1
)

echo Registered protocol yoinks://
echo.
reg query "HKCU\Software\Classes\yoinks\shell\open\command" /ve
echo.
echo Now open a video page and click the button in the bottom right corner.
echo On the first click the browser will ask whether to open yoinks -
echo tick the "always allow" box so it stops asking.
pause
