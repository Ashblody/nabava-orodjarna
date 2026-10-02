# Nabava Orodjarna - namestitev STREZNIKA na ta PC (Oro455, 192.168.1.124). Zazene jo NAMESTI-STREZNIK.bat.
# Vse lokalno: aplikacija + portable Node + podatki v eni mapi (privzeto C:\NabavaOrodjarna). Brez VBS.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$packRoot = Split-Path -Parent (Split-Path -Parent $here)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Title = 'Nabava strežnik'
$Port = 8787
$DefaultShare = '\\192.168.1.50\Skupno\NabavaOrodjarna\backup'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$nl = [Environment]::NewLine
$taskName = 'NabavaOrodjarna Streznik'
$fwName = 'NabavaOrodjarna-8787'
$markerDir = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna'
$script:InstLog = $null

function Log([string]$m) {
  if ($script:InstLog) { try { Add-Content -LiteralPath $script:InstLog -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch { } }
}
function Show-Msg([string]$text, [string]$kind) {
  $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  if ($kind -eq 'err') { $icon = [System.Windows.Forms.MessageBoxIcon]::Error }
  if ($kind -eq 'warn') { $icon = [System.Windows.Forms.MessageBoxIcon]::Warning }
  [void][System.Windows.Forms.MessageBox]::Show($text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}
function Test-Admin {
  try {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object System.Security.Principal.WindowsPrincipal($id)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}
function Test-PathTimeout([string]$p, [int]$ms) {
  try {
    $ps = [powershell]::Create()
    [void]$ps.AddScript({ param($x) Test-Path -LiteralPath $x }).AddArgument($p)
    $h = $ps.BeginInvoke()
    if ($h.AsyncWaitHandle.WaitOne($ms)) {
      $r = $ps.EndInvoke($h)
      $ps.Dispose()
      return ([bool]($r | Select-Object -First 1))
    }
    [void]$ps.BeginStop($null, $null)
    return $false
  } catch { return $false }
}
function Get-Url([string]$url, [int]$timeoutMs) {
  $req = [System.Net.WebRequest]::Create($url)
  $req.Proxy = $null
  $req.Timeout = $timeoutMs
  $req.ReadWriteTimeout = 60000
  $resp = $req.GetResponse()
  try {
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    return $sr.ReadToEnd()
  } finally { $resp.Close() }
}
function Test-PortOpen([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $ar.AsyncWaitHandle.WaitOne(1500) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

# ---- izbira mape
function Select-Root {
  $primary = 'C:\NabavaOrodjarna'
  try {
    New-Item -ItemType Directory -Path $primary -Force | Out-Null
    $t = Join-Path $primary '.test'
    Set-Content -LiteralPath $t -Value 'x'
    Remove-Item -LiteralPath $t -Force
    return $primary
  } catch {
    $alt = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarnaStreznik'
    New-Item -ItemType Directory -Path $alt -Force | Out-Null
    return $alt
  }
}

# ---- ustavi star streznik (nasa mapa, ali karkoli, kar poslusa na 8787 kot node.exe)
function Stop-OldServer([string]$root) {
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'start-streznik\.ps1' }
    foreach ($p in @($procs)) { if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }
  } catch { Log ('Stop nadzornik: ' + $_) }
  try {
    $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' }
    foreach ($p in @($nodes)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch { Log ('Stop node: ' + $_) }
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in @($conn)) {
      $pr = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      if ($pr -and $pr.ProcessName -eq 'node') { Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue }
    }
  } catch { }
  Start-Sleep -Milliseconds 1200
}

# ---- migracija obstojecega db.json (nikoli ne prepise obstojecega v ciljni mapi; vir se ne spremeni)
function Migrate-Data([string]$root, [string]$oldServerJson) {
  $dataDir = Join-Path $root 'data'
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $target = Join-Path $dataDir 'db.json'
  if (Test-Path -LiteralPath $target) { return 'Podatki že obstajajo v ' + $dataDir + ' (nespremenjeni).' }
  if ($oldServerJson) {
    [System.IO.File]::WriteAllText($target, $oldServerJson, (New-Object System.Text.UTF8Encoding($false)))
    Log 'Migracija: prevzeto iz tekocega strezniskega procesa (http://127.0.0.1:8787/api/data).'
    return 'Podatki prevzeti iz prejšnjega strežnika, ki je tekel na tem PC.'
  }
  $cands = @(
    (Join-Path $packRoot 'data\db.json'),
    (Join-Path $here 'data\db.json'),
    'S:\NabavaOrodjarna\data\db.json',
    'D:\NabavaOrodjarna\data\db.json',
    (Join-Path $env:USERPROFILE 'Desktop\NabavaOrodjarna\data\db.json'),
    (Join-Path $env:USERPROFILE 'NabavaOrodjarna\data\db.json'),
    '\\192.168.1.50\Skupno\NabavaOrodjarna\data\db.json'
  )
  $best = $null
  foreach ($c in $cands) {
    if (Test-PathTimeout $c 6000) {
      $f = Get-Item -LiteralPath $c
      if ($f.Length -gt 2 -and ((-not $best) -or $f.LastWriteTime -gt $best.LastWriteTime)) { $best = $f }
    }
  }
  if ($best) {
    Copy-Item -LiteralPath $best.FullName -Destination $target -Force
    Log ('Migracija: ' + $best.FullName + ' -> ' + $target)
    return 'Podatki kopirani iz ' + $best.FullName + ' (original ostane).'
  }
  return 'Ni starih podatkov - začnemo s prazno bazo.'
}

# ---- neobvezna omrezna mapa za kopijo (vprasa samo enkrat)
function Ask-Share([string]$current) {
  $f = New-Object System.Windows.Forms.Form
  $f.Text = $Title
  $f.StartPosition = 'CenterScreen'
  $f.FormBorderStyle = 'FixedDialog'
  $f.MaximizeBox = $false
  $f.MinimizeBox = $false
  $f.TopMost = $true
  $f.ClientSize = New-Object System.Drawing.Size(520, 210)
  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = 'Podatki so na tem PC. Za dodatno varnost se vsak dan naredi kopija v omrežno mapo.' + $nl +
    'Pusti tako, ali izbriši besedilo (prazno = brez kopije v omrežje).'
  $lbl.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $lbl.Location = New-Object System.Drawing.Point(12, 12)
  $lbl.Size = New-Object System.Drawing.Size(496, 60)
  $f.Controls.Add($lbl)
  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $tb.Location = New-Object System.Drawing.Point(12, 80)
  $tb.Size = New-Object System.Drawing.Size(496, 28)
  $tb.Text = $current
  $f.Controls.Add($tb)
  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'V redu'
  $ok.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $ok.Location = New-Object System.Drawing.Point(12, 140)
  $ok.Size = New-Object System.Drawing.Size(200, 46)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $f.Controls.Add($ok)
  $f.AcceptButton = $ok
  [void]$f.ShowDialog()
  $val = $tb.Text.Trim()
  $f.Dispose()
  return $val
}

# ---- samodejni zagon: Task Scheduler (ob prijavi, skrito, brez casovne omejitve); sicer mapa Startup
function Install-Autostart([string]$root) {
  $startScript = Join-Path $root 'start-streznik.ps1'
  $args2 = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $xml = '<?xml version="1.0" encoding="UTF-16"?>' + $nl +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
    '<RegistrationInfo><Description>Nabava Orodjarna streznik (skrito)</Description></RegistrationInfo>' +
    '<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + [System.Security.SecurityElement]::Escape($user) + '</UserId><Delay>PT20S</Delay></LogonTrigger></Triggers>' +
    '<Principals><Principal id="Author"><UserId>' + [System.Security.SecurityElement]::Escape($user) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>' +
    '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>' +
    '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable>' +
    '<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden>' +
    '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority></Settings>' +
    '<Actions Context="Author"><Exec><Command>' + [System.Security.SecurityElement]::Escape($psExe) + '</Command><Arguments>' +
    [System.Security.SecurityElement]::Escape($args2) + '</Arguments><WorkingDirectory>' + [System.Security.SecurityElement]::Escape($root) + '</WorkingDirectory></Exec></Actions></Task>'
  $xmlFile = Join-Path $env:TEMP 'nabava-streznik-task.xml'
  $xml | Out-File -LiteralPath $xmlFile -Encoding Unicode
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Nabava streznik.lnk'
  $how = ''
  try {
    $p = Start-Process -FilePath 'schtasks.exe' -ArgumentList ('/Create /TN "' + $taskName + '" /XML "' + $xmlFile + '" /F') -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -eq 0) { $how = 'Task Scheduler (ob prijavi)' }
    else { Log ('schtasks ni uspel, koda ' + $p.ExitCode) }
  } catch { Log ('schtasks napaka: ' + $_) }
  Remove-Item -LiteralPath $xmlFile -Force -ErrorAction SilentlyContinue
  if ($how) {
    if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue }
    return $how
  }
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath = $psExe
  $sc.Arguments = $args2
  $sc.WorkingDirectory = $root
  $sc.WindowStyle = 7
  $sc.Save()
  return 'mapa Startup (ob prijavi)'
}

function Install-Firewall([bool]$admin) {
  # vrne 'ok' | 'ze' | 'ni-admin'
  $ErrorActionPreference = 'Continue'
  $exists = $false
  try {
    & netsh advfirewall firewall show rule name=$fwName *> $null
    if ($LASTEXITCODE -eq 0) { $exists = $true }
  } catch { }
  if ($admin) {
    try { & netsh advfirewall firewall delete rule name=$fwName *> $null } catch { }
    & netsh advfirewall firewall add rule name=$fwName dir=in action=allow protocol=TCP localport=$Port profile=any *> $null
    if ($LASTEXITCODE -eq 0) { return 'ok' }
    return 'ni-admin'
  }
  if ($exists) { return 'ze' }
  return 'ni-admin'
}

try {
  # preveri pakete
  foreach ($need in @('node\node.exe', 'dist\index.html', 'server\index.js', 'server\app.js', 'server\store.js', 'start-streznik.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $here $need))) {
      Show-Msg ('V paketu manjka: ' + $need + $nl + 'Ali si ZIP razširil (desni klik > Razširi vse)? Poženi ponovno iz razširjene mape.') 'err'
      exit 1
    }
  }
  $admin = Test-Admin
  $root = Select-Root
  $script:InstLog = Join-Path $root 'namesti.log'
  Log ('--- namestitev strezniska, mapa ' + $root + ', admin=' + $admin + ' ---')
  New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $markerDir 'streznik-mapa.txt') -Value $root -Encoding UTF8

  # ce tece star streznik (npr. prejsnja namestitev z drugimi podatki), vzemi podatke iz njega
  $oldJson = ''
  if ((Test-PortOpen $Port) -and -not (Test-Path -LiteralPath (Join-Path $root 'data\db.json'))) {
    try {
      $txt = Get-Url ('http://127.0.0.1:' + $Port + '/api/data') 15000
      if ($txt -match '"(requests|users)"\s*:\s*\[\s*\{') { $oldJson = $txt }
    } catch { Log ('Branje tekocega strezniskega procesa ni uspelo: ' + $_) }
  }
  Stop-OldServer $root

  # kopiraj aplikacijo (data\ se NE dotakne)
  foreach ($d in @('dist', 'server')) {
    $dst = Join-Path $root $d
    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $here $d) -Destination $dst -Recurse -Force
  }
  New-Item -ItemType Directory -Path (Join-Path $root 'node') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $here 'node\node.exe') -Destination (Join-Path $root 'node\node.exe') -Force
  foreach ($f in @('package.json', 'start-streznik.ps1')) {
    if (Test-Path -LiteralPath (Join-Path $here $f)) { Copy-Item -LiteralPath (Join-Path $here $f) -Destination (Join-Path $root $f) -Force }
  }
  Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.ps1', '.js', '.exe', '.html' } | Unblock-File -ErrorAction SilentlyContinue

  $migr = Migrate-Data $root $oldJson

  # omrezna mapa za kopijo (vprasa samo ob prvi namestitvi)
  $shareFile = Join-Path $root 'backup-share.txt'
  if (-not (Test-Path -LiteralPath $shareFile)) {
    $share = Ask-Share $DefaultShare
    Set-Content -LiteralPath $shareFile -Value $share -Encoding UTF8
  }
  $share = ''
  $l = Get-Content -LiteralPath $shareFile -TotalCount 1 -Encoding UTF8
  if ($l) { $share = $l.Trim() }
  $shareNote = 'Kopija v omrežje: izklopljena.'
  if ($share) { $shareNote = 'Kopija v omrežje: ' + $share + ' (če ni dosegljiva, strežnik vseeno dela; opozorilo je v streznik.log).' }

  $how = Install-Autostart $root
  $fw = Install-Firewall $admin

  # zagon + preverjanje
  Start-Process -FilePath $psExe -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'start-streznik.ps1') + '"') -WorkingDirectory $root -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { [void](Get-Url ('http://127.0.0.1:' + $Port + '/api/data') 3000); $up = $true; break } catch { }
  }
  Log ('Streznik tece: ' + $up + '; zagon: ' + $how + '; firewall: ' + $fw)

  # naslovi
  $ips = @()
  try {
    foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($ni.OperationalStatus -ne 'Up') { continue }
      foreach ($ua in $ni.GetIPProperties().UnicastAddresses) {
        if ($ua.Address.AddressFamily -eq 'InterNetwork' -and -not $ua.Address.ToString().StartsWith('169.254') -and -not $ua.Address.ToString().StartsWith('127.')) { $ips += $ua.Address.ToString() }
      }
    }
  } catch { }
  $addr = 'http://192.168.1.124:' + $Port + '/'
  $ipNote = ''
  if ($ips.Count -gt 0 -and ($ips -notcontains '192.168.1.124')) {
    $ipNote = $nl + $nl + 'POZOR: ta PC ima naslov ' + ($ips -join ', ') + ', ne 192.168.1.124. Ostali PC-ji bodo morali uporabiti ta naslov (ali nastavi stalni IP na usmerjevalniku).'
  }

  $msg = ''
  $kind = 'info'
  if ($up) { $msg = 'Strežnik TEČE.' } else { $msg = 'Strežnik se ni zagnal v 15 s. Poglej: ' + $root + '\streznik-napake.log in zagon.log'; $kind = 'warn' }
  $msg += $nl + $nl + 'Naslov za vse: ' + $addr + $nl + 'Na tem PC tudi: http://localhost:' + $Port + '/' +
    $nl + $nl + 'Mapa: ' + $root + $nl + 'Samodejni zagon: ' + $how + ' (po prijavi v Windows, skrito)' +
    $nl + $migr + $nl + $shareNote
  if ($fw -eq 'ni-admin') {
    $msg += $nl + $nl + 'ZAŠČITNI ZID: če drugi PC-ji ne odprejo strani, enkrat klikni z desno na NAMESTI-STREZNIK.bat > Zaženi kot skrbnik.'
    $kind = 'warn'
  }
  $msg += $ipNote
  $msg += $nl + $nl + 'Na tem PC za obvestila poženi še NAMESTI-OBVESTILA.bat. Ne izklapljaj PC-ja.'
  Show-Msg $msg $kind
  exit 0
} catch {
  Log ('NAPAKA: ' + $_)
  Show-Msg ('Namestitev strežnika ni uspela:' + $nl + $_ + $nl + $nl + 'Zapis: ' + $script:InstLog) 'err'
  exit 1
}
