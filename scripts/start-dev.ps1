$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$backendLog = Join-Path $runtime 'backend.log'
$frontendLog = Join-Path $runtime 'frontend.log'

foreach ($name in @('frontend', 'backend')) {
  $pidFile = Join-Path $runtime "$name.pid"
  if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($oldPid) {
      $oldPidInt = [int]$oldPid
      if (Get-Process -Id $oldPidInt -ErrorAction SilentlyContinue) {
        & taskkill.exe /PID $oldPidInt /T /F *> $null
        Stop-Process -Id $oldPidInt -Force -ErrorAction SilentlyContinue
      }
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  }
}

Get-NetTCPConnection -LocalPort 10101, 3000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    if ($_ -gt 0) {
      if (Get-Process -Id $_ -ErrorAction SilentlyContinue) {
        & taskkill.exe /PID $_ /T /F *> $null
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
    }
  }

Set-Content -Path $backendLog -Value ''
Set-Content -Path $frontendLog -Value ''

$backendCommand = "cd /d ""$backendDir"" && set ""PORT=10101"" && go run . > ""$backendLog"" 2>&1"
$frontendCommand = "cd /d ""$frontendDir"" && npm run dev > ""$frontendLog"" 2>&1"

Write-Host 'Starting AllocateAntivirus backend on port 10101...'
$backend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $backendCommand) -WindowStyle Hidden -PassThru
Set-Content -Path (Join-Path $runtime 'backend.pid') -Value $backend.Id

Write-Host 'Starting AllocateAntivirus frontend on port 3000...'
$frontend = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $frontendCommand) -WindowStyle Hidden -PassThru
Set-Content -Path (Join-Path $runtime 'frontend.pid') -Value $frontend.Id
