@echo off
cd /d "%~dp0"
"runtime\node.exe" "scripts\launch.js"
if errorlevel 1 pause
