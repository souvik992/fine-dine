# Stops the DinePOS Server started from THIS folder (matched by the full path of its node.exe), and nothing else.
# Used by the uninstaller and upgrades, which cannot replace files while the server runs from them.
# The database survives a forced stop: SQLite runs in WAL mode with synchronous=FULL, and the server's lock file
# from a stopped process is taken over at the next start.
$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'node.exe'
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $node }
foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Output "Stopped DinePOS Server (pid $($p.ProcessId))"
}
if (-not $procs) { Write-Output 'DinePOS Server was not running' }
