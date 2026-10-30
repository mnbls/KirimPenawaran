@echo off
setlocal
cd /d "%~dp0"
title Kirim Penawaran

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang.
  echo Pasang dulu dari https://nodejs.org ^(pilih versi LTS, minimal 18^), lalu klik file ini lagi.
  start "" https://nodejs.org
  pause
  exit /b 1
)

for /f %%v in ('node -p "parseInt(process.version.slice(1))"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo Versi Node.js Anda terlalu lama ^(v%NODE_MAJOR%^). Pasang Node.js 18 atau lebih baru dari https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Pemasangan pertama kali, mohon tunggu 1-2 menit...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Gagal memasang. Cek koneksi internet, lalu coba lagi.
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=3838
echo Membuka http://localhost:%PORT% di browser...
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%"
node server.mjs
echo.
echo Server berhenti.
pause
