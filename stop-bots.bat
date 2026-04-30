@echo off
REM Kills any node process running the bots. Safe — only matches the
REM specific path so you don't nuke other node servers running on the
REM machine.
echo Killing BASEic Brawlers bots...
wmic process where "name='node.exe' and commandline like '%%baseicbrawlers%%bots%%'" delete >nul 2>&1
wmic process where "name='node.exe' and commandline like '%%marketing\\bots\\run-all%%'" delete >nul 2>&1
echo Done. (If bots restart, also close the 'BASEic Brawlers Bots' cmd window.)
timeout /t 3
