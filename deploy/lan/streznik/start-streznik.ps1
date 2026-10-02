# Nabava Orodjarna - zagon strezniska (skrito, samodejni ponovni zagon). Brez pause, brez VBS.
# Varno za veckratni zagon: ce port ze poslusa, tiho konca.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Path }
$port = 8787
$logFile = Join-Path $root 'streznik.log'
$errFile = Join-Path $root 'streznik-napake.log'
$ctlLog = Join-Path $root 'zagon.log'

function Write-Ctl([string]$m) {
  try { Add-Content -LiteralPath $ctlLog -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch { }
}
function Test-Port([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $ar.AsyncWaitHandle.WaitOne(1500) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}
function Rotate([string]$f) {
  try {
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 1048576)) { Move-Item -LiteralPath $f -Destination ($f + '.old') -Force }
  } catch { }
}

if (Test-Path -LiteralPath $ctlLog) { if ((Get-Item -LiteralPath $ctlLog).Length -gt 262144) { Move-Item -LiteralPath $ctlLog -Destination ($ctlLog + '.old') -Force } }

if (Test-Port $port) { Write-Ctl ('Port ' + $port + ' ze poslusa - nic za narediti.'); exit 0 }

# en sam nadzornik (ob hkratnem zagonu prek opravila + mape Startup)
$mutex = $null
try {
  $created = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Global\NabavaOrodjarnaStreznik', [ref]$created)
  if (-not $created) { Write-Ctl 'Drug nadzornik ze tece - izhod.'; exit 0 }
} catch { }

$node = Join-Path $root 'node\node.exe'
$entry = Join-Path $root 'server\index.js'
if (-not (Test-Path -LiteralPath $node)) { Write-Ctl ('MANJKA ' + $node); exit 1 }
if (-not (Test-Path -LiteralPath $entry)) { Write-Ctl ('MANJKA ' + $entry); exit 1 }

$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$env:NABAVA_DATA_DIR = $dataDir
$env:PORT = [string]$port
# neobvezna omrezna mapa za dnevno kopijo (prva vrstica datoteke backup-share.txt; prazno = izklopljeno)
$env:NABAVA_BACKUP_SHARE = ''
$shareFile = Join-Path $root 'backup-share.txt'
if (Test-Path -LiteralPath $shareFile) {
  $l = Get-Content -LiteralPath $shareFile -TotalCount 1 -Encoding UTF8
  if ($l) { $env:NABAVA_BACKUP_SHARE = $l.Trim() }
}

Write-Ctl ('Zagon nadzornika. Mapa: ' + $root + ', kopija v omrezno mapo: [' + $env:NABAVA_BACKUP_SHARE + ']')
$fast = 0
while ($true) {
  Rotate $logFile
  Rotate $errFile
  $t0 = Get-Date
  try {
    $p = Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $root -WindowStyle Hidden `
      -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
    Write-Ctl ('node zagnan, PID ' + $p.Id)
    $p.WaitForExit()
    Write-Ctl ('node se je ustavil, koda ' + $p.ExitCode)
  } catch {
    Write-Ctl ('Zagon node ni uspel: ' + $_)
  }
  if (((Get-Date) - $t0).TotalSeconds -lt 15) { $fast++ } else { $fast = 0 }
  if ($fast -ge 3) { Start-Sleep -Seconds 60 } else { Start-Sleep -Seconds 5 }
  if (Test-Port $port) { Write-Ctl 'Port zaseden (drug streznik) - nadzornik konca.'; exit 0 }
}
