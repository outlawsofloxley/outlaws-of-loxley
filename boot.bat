@echo off
REM ─── BASEic Brawlers — one-click boot ──────────────────────────────
REM Opens two windows:
REM   1. Bot daemon (welcome / raid / leaderboard) — auto-restarts on crash.
REM   2. Claude Code session in the project dir — pick "Resume" to get back
REM      to the in-flight conversation (or start a fresh one).
REM
REM Pin a shortcut to this file on your taskbar/desktop for one-click boot.
REM ──────────────────────────────────────────────────────────────────

cd /d C:\tools\brawlers

REM ─── 1. Bots — separate minimized window so it stays out of your way ───
start "BASEic Brawlers Bots" /min cmd /k "cd /d C:\tools\brawlers\marketing\bots && echo Starting bots... && :loop && npm run all && echo Bots crashed, restarting in 5s... && timeout /t 5 && goto loop"

REM ─── 2. Claude Code — foreground; pick Resume to restore prior chat ───
REM `claude resume` shows a session picker (most recent first). Or just
REM `claude` to start a new conversation in this directory.
start "BASEic Brawlers Claude" cmd /k "cd /d C:\tools\brawlers && echo Type:  claude resume   to pick a recent session && echo Or:    claude           for a new chat && echo. && echo (Bots are running in the other window — minimize it.)"

echo.
echo Two windows opened:
echo   1. Bots (minimized) — running welcome + raid + leaderboard
echo   2. Claude Code — type 'claude resume' to pick this conversation, or 'claude' for new
echo.
echo This window can be closed.
timeout /t 5
