@echo off
rem Opens the Nova Bridge window (run npm install once first).
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0bridge\app"
