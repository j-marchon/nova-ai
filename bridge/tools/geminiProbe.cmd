@echo off
rem Checks the Gemini app route against your own Google account, start to finish:
rem gets your Google sign-in from your own browser (a Google sign-in already in
rem Firefox is used as it is; otherwise Chrome / Edge / Brave opens for you to
rem sign in), runs scripts\probe-gemini-web.mjs with those cookies, then deletes them.
rem Needs only Node.js 22 or newer. Extra arguments go to the probe, e.g.
rem   geminiProbe.cmd --models <hash> --long 200000
rem Choose the browser:  geminiProbe.cmd --browser firefox   (or chromium)
rem Forget the saved browser sign-in afterwards:  geminiProbe.cmd --forget
setlocal EnableExtensions
cd /d "%~dp0"
title Nova - Gemini app check

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed and was not found.
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Install it from https://nodejs.org, then run this again.
    goto :fail
  )
  echo Installing Node.js LTS with winget...
  winget install -e --id OpenJS.NodeJS.LTS
  echo.
  echo Close this window and run this file again, so it can find node.
  goto :fail
)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
if errorlevel 1 (
  echo Node.js is too old: Nova needs version 22 or newer. Update it from https://nodejs.org.
  goto :fail
)

if /i "%~1"=="--forget" (
  node gemini-cookies-cli.mjs --forget
  pause
  exit /b 0
)

set "BROWSERARG="
if /i "%~1"=="--browser" (
  set "BROWSERARG=--browser %~2"
  shift
  shift
)

set "JAR=%TEMP%\nova-gemini-cookies-%RANDOM%%RANDOM%.json"
echo.
node gemini-cookies-cli.mjs --out "%JAR%" %BROWSERARG%
if errorlevel 1 (
  echo Could not get a Google sign-in.
  goto :fail
)

echo.
node probe-gemini-web.mjs --cookies-file "%JAR%" --delete %1 %2 %3 %4 %5 %6 %7 %8 %9
set "CODE=%ERRORLEVEL%"
del /f /q "%JAR%" >nul 2>nul
echo.
echo Done ^(exit code %CODE%^). The folder named above holds your session: delete it when finished.
pause
exit /b %CODE%

:fail
if defined JAR del /f /q "%JAR%" >nul 2>nul
pause
exit /b 1
