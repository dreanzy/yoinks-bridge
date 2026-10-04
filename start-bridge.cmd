@echo off
chcp 65001 >nul
title yoinks bridge
cd /d "%~dp0"
node "%~dp0bridge.mjs"
echo.
echo Bridge stopped.
pause
