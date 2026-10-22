# ==============================================================================
# Argus Matrix - RTX 5090 Offline Precompute Launcher
# ==============================================================================
Write-Host ""
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  ARGUS SURVEILLANCE MATRIX - RTX 5090 OFFLINE PRECOMPUTE LAUNCHER" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""

# Set local directory context
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check Python environment
$PythonCmd = "python"
if (Get-Command "python" -ErrorAction SilentlyContinue) {
    Write-Host "[+] Found Python environment." -ForegroundColor Green
} else {
    Write-Host "[!] Python not found on PATH. Please activate your environment." -ForegroundColor Red
    exit 1
}

# Run GPU Precomputation Pipeline
Write-Host "[*] Launching multi-stage pipeline on RTX 5090..." -ForegroundColor Yellow
Write-Host "    - Stage 0: YOLOv11s Tracking (ByteTrack)" -ForegroundColor Gray
Write-Host "    - Stage 1: SigLIP Pass 1 (Indian Road Categories)" -ForegroundColor Gray
Write-Host "    - Stage 2: SigLIP Pass 2 (Exact Car Models)" -ForegroundColor Gray
Write-Host "    - Stage 3: FastALPR (License Plates + Indian RTO Disambiguation)" -ForegroundColor Gray
Write-Host ""

& $PythonCmd "$ScriptDir\precompute_pipeline.py" @args

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[+] Precomputation completed successfully!" -ForegroundColor Green
    Write-Host "[*] Running verification audit on generated JSON files..." -ForegroundColor Yellow
    & $PythonCmd "$ScriptDir\verify_precompute.py"
} else {
    Write-Host ""
    Write-Host "[!] Precomputation exited with code $LASTEXITCODE." -ForegroundColor Red
}
