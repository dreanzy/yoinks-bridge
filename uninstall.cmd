@echo off
reg delete "HKCU\Software\Classes\yoinks" /f
if errorlevel 1 (
  echo Nothing to remove, or removal failed.
) else (
  echo Removed protocol registration yoinks://
)
pause
