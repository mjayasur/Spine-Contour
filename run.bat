@echo off
where py >nul 2>nul
if %errorlevel% equ 0 goto use_py
python "%~dp0run.py" %*
exit /b %errorlevel%

:use_py
py -3 "%~dp0run.py" %*
