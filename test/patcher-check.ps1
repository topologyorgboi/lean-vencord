# Cold-boots Vesktop, checks the webpack patcher, then relaunches it normally.
#
# Correct : patchesRemaining 0, no warning beyond the known Vesktop
#           enumerateDevices miss. Exits non-zero otherwise.
# Fast    : topVencordFrames[0] is the patcher. ~1.57s stock, ~0.68s with the patch.
#
# Run after any Vencord update, which overwrites patchWebpack.ts and drops both changes.
#
#   powershell -File test/patcher-check.ps1 -Label after-update
param([string]$Label = "check", [int]$Port = 9223)
$ErrorActionPreference = "Stop"

Get-Process vesktop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4

$exe = Get-ChildItem "$env:LOCALAPPDATA\vesktop" -Filter "Vesktop.exe" -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $exe) { throw "Vesktop.exe not found under $env:LOCALAPPDATA\vesktop" }

$t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Start-Process -FilePath $exe.FullName -ArgumentList "--remote-debugging-port=$Port"
node "$PSScriptRoot\patcher-check.mjs" $Port $t0 $Label
$checkExit = $LASTEXITCODE

# always relaunch without the debug port. open CDP = any local process drives the
# client and reads the account token.
Write-Host "`nRelaunching without the debug port."
Get-Process vesktop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Start-Process -FilePath $exe.FullName

exit $checkExit
