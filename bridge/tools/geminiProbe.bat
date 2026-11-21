@echo off
rem Same as geminiProbe.cmd (this file only exists so either name works).
call "%~dp0geminiProbe.cmd" %*
exit /b %ERRORLEVEL%
