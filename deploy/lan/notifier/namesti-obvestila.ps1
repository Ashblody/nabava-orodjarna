# Nabava Orodjarna - namestitev obvestil na ta PC (brez admina). Zazene jo NAMESTI-OBVESTILA.bat.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
. (Join-Path $here 'nabava-obvestila.ps1') -NoRun   # skupne funkcije (Write-Log, Parse-Json, ...)
$ErrorActionPreference = 'Stop'   # (skripta obvestil ga je ob nalaganju spremenila)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Title = 'Nabava obvestila'
$DefaultServer = 'http://192.168.1.124:8787'
$packRoot = Split-Path -Parent (Split-Path -Parent $here)
$installDir = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna\notifier'
$cfgFile = Join-Path $installDir 'config.json'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Show-Msg([string]$text, [string]$kind) {
  $icon = [System.Windows.Forms.MessageBoxIcon]::Information
  if ($kind -eq 'err') { $icon = [System.Windows.Forms.MessageBoxIcon]::Error }
  if ($kind -eq 'warn') { $icon = [System.Windows.Forms.MessageBoxIcon]::Warning }
  [void][System.Windows.Forms.MessageBox]::Show($text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
}

function Normalize-Name([string]$s) {
  if (-not $s) { return '' }
  $d = $s.ToLowerInvariant().Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $d.ToCharArray()) {
    $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c)
    if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark -and [char]::IsLetterOrDigit($c)) { [void]$sb.Append($c) }
  }
  return $sb.ToString()
}

# Windows uporabnisko ime -> uporabnik iz aplikacije (samo ce je natanko en zadetek)
function Find-AutoUser($users, [string]$winUser) {
  $w = Normalize-Name $winUser
  if (-not $w) { return $null }
  $hits = @()
  foreach ($u in $users) {
    $parts = @(([string]$u.name).Trim() -split '\s+' | Where-Object { $_ })
    if ($parts.Count -eq 0) { continue }
    $first = Normalize-Name $parts[0]
    $last = Normalize-Name $parts[$parts.Count - 1]
    $cands = @((Normalize-Name $u.name), $first)
    if ($parts.Count -gt 1) { $cands += ($first + $last); $cands += ($last + $first); $cands += ($first.Substring(0, 1) + $last) }
    if ($cands -contains $w) { $hits += $u }
  }
  if ($hits.Count -eq 1) { return $hits[0] }
  return $null
}

function Get-ServerUsers([string]$server) {
  $req = [System.Net.WebRequest]::Create($server + '/api/data')
  $req.Proxy = $null
  $req.Timeout = 10000
  $req.ReadWriteTimeout = 30000
  $resp = $req.GetResponse()
  try {
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd()
  } finally { $resp.Close() }
  $data = Parse-Json $text
  $list = @()
  foreach ($u in @(As-List (Get-Prop $data 'users'))) {
    $n = [string](Get-Prop $u 'name')
    if (-not $n) { continue }
    $list += [pscustomobject]@{ id = [string](Get-Prop $u 'id'); name = $n; role = [string](Get-Prop $u 'role') }
  }
  return @($list | Sort-Object name)
}

function Select-User($users, [string]$preselectId) {
  $f = New-Object System.Windows.Forms.Form
  $f.Text = $Title
  $f.StartPosition = 'CenterScreen'
  $f.FormBorderStyle = 'FixedDialog'
  $f.MaximizeBox = $false
  $f.MinimizeBox = $false
  $f.TopMost = $true
  $f.ClientSize = New-Object System.Drawing.Size(360, 440)
  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = 'Kdo si ti? Klikni svoje ime:'
  $lbl.Font = New-Object System.Drawing.Font('Segoe UI', 12)
  $lbl.Location = New-Object System.Drawing.Point(12, 10)
  $lbl.Size = New-Object System.Drawing.Size(336, 28)
  $f.Controls.Add($lbl)
  $lb = New-Object System.Windows.Forms.ListBox
  $lb.Font = New-Object System.Drawing.Font('Segoe UI', 14)
  $lb.Location = New-Object System.Drawing.Point(12, 44)
  $lb.Size = New-Object System.Drawing.Size(336, 330)
  $lb.IntegralHeight = $false
  foreach ($u in $users) {
    $t = $u.name
    if ($u.role -eq 'vodja') { $t += '  (vodja)' }
    [void]$lb.Items.Add($t)
  }
  $idx = 0
  for ($i = 0; $i -lt $users.Count; $i++) { if ($users[$i].id -eq $preselectId) { $idx = $i } }
  if ($users.Count -gt 0) { $lb.SelectedIndex = $idx }
  $lb.add_DoubleClick({ if ($this.SelectedIndex -ge 0) { $this.FindForm().DialogResult = [System.Windows.Forms.DialogResult]::OK } })
  $f.Controls.Add($lb)
  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'V redu'
  $ok.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
  $ok.Location = New-Object System.Drawing.Point(12, 384)
  $ok.Size = New-Object System.Drawing.Size(200, 44)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $f.Controls.Add($ok)
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Prekliči'
  $cancel.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $cancel.Location = New-Object System.Drawing.Point(224, 384)
  $cancel.Size = New-Object System.Drawing.Size(124, 44)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $f.Controls.Add($cancel)
  $f.AcceptButton = $ok
  $f.CancelButton = $cancel
  $res = $f.ShowDialog()
  $sel = $lb.SelectedIndex
  $f.Dispose()
  if ($res -ne [System.Windows.Forms.DialogResult]::OK -or $sel -lt 0) { return $null }
  return $users[$sel]
}

function Stop-OldNotifier {
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'nabava-obvestila\.ps1|nabava-notifier\.ps1' }
    foreach ($p in @($procs)) {
      if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Milliseconds 700
  } catch { Write-Log ('Zaustavitev starega obvestila: ' + $_) }
}

try {
  Write-Log '--- namestitev obvestil ---'
  # 1) naslov streznika: privzet, brez vpisovanja (neobvezno: streznik-naslov.txt ob ZIP-u)
  $server = $DefaultServer
  $override = Join-Path $packRoot 'streznik-naslov.txt'
  if (Test-Path -LiteralPath $override) {
    $line = (Get-Content -LiteralPath $override -TotalCount 1 -Encoding UTF8)
    if ($line -and $line.Trim() -match '^https?://') { $server = $line.Trim().TrimEnd('/') }
  }

  # 2) seznam imen s streznika
  $users = @()
  try { $users = @(Get-ServerUsers $server) } catch {
    Write-Log ('Streznik ni dosegljiv: ' + $_)
    Show-Msg ("Ne najdem strežnika:" + [Environment]::NewLine + $server + [Environment]::NewLine + [Environment]::NewLine +
      "1) Ali PC Oro455 (192.168.1.124) teče?" + [Environment]::NewLine +
      "2) Ali si v istem omrežju (Wi-Fi / kabel)?" + [Environment]::NewLine +
      "3) Poskusi v brskalniku: " + $server + [Environment]::NewLine + [Environment]::NewLine +
      "Ko bo odprlo, poženi NAMESTI-OBVESTILA.bat še enkrat.") 'err'
    exit 2
  }
  if ($users.Count -eq 0) {
    Show-Msg ("V aplikaciji še ni nobenega uporabnika." + [Environment]::NewLine +
      "Odpri " + $server + " v brskalniku, se prijavi/registriraj, nato poženi NAMESTI-OBVESTILA.bat še enkrat.") 'warn'
    exit 3
  }

  # 3) izbira imena (samodejno, ce se Windows ime natanko ujema in se ni nastavljeno)
  $existingId = ''
  if (Test-Path -LiteralPath $cfgFile) {
    try { $existingId = [string]((Get-Content -LiteralPath $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json).userId) } catch { }
  }
  $chosen = $null
  if (-not $existingId) { $chosen = Find-AutoUser $users $env:USERNAME }
  if ($chosen) { Write-Log ('Samodejno ime: ' + $chosen.name + ' (Windows: ' + $env:USERNAME + ')') }
  else { $chosen = Select-User $users $existingId }
  if (-not $chosen) { Write-Log 'Preklicano.'; exit 0 }

  # 4) kopiraj datoteke, nastavitve
  Stop-OldNotifier
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $here 'nabava-obvestila.ps1') -Destination $installDir -Force
  Get-ChildItem -LiteralPath $installDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  $cfg = [ordered]@{ serverUrl = $server; userId = $chosen.id; userName = $chosen.name; role = $chosen.role; pollSeconds = 30 }
  ($cfg | ConvertTo-Json) | Set-Content -LiteralPath $cfgFile -Encoding UTF8
  # nov uporabnik = novo semenjenje (brez poplave starih obvestil)
  if (Test-Path -LiteralPath $script:StatePath) { Remove-Item -LiteralPath $script:StatePath -Force -ErrorAction SilentlyContinue }

  # 5) AUMID (HKCU) - isti postopek kot ob zagonu
  $script:ScriptDir = $installDir
  [void](Register-Aumid)

  # 6) samodejni zagon ob prijavi (mapa Startup, brez admina)
  $script2 = Join-Path $installDir 'nabava-obvestila.ps1'
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup 'Nabava obvestila.lnk'
  $wsh = New-Object -ComObject WScript.Shell
  $sc = $wsh.CreateShortcut($lnk)
  $sc.TargetPath = $psExe
  $sc.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script2 + '"'
  $sc.WorkingDirectory = $installDir
  $sc.WindowStyle = 7
  $sc.Description = 'Nabava Orodjarna - obvestila'
  $sc.Save()

  # 7) zagon + preizkusni toast
  $logSize = 0
  if (Test-Path -LiteralPath $script:LogPath) { $logSize = (Get-Item -LiteralPath $script:LogPath).Length }
  Start-Process -FilePath $psExe -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script2 + '" -FirstRun') -WindowStyle Hidden
  $result = ''
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $script:LogPath) {
      $txt = Get-Content -LiteralPath $script:LogPath -Encoding UTF8 -Tail 40 | Out-String
      $m = [regex]::Match($txt, 'FIRSTRUN: (.*)')
      if ($m.Success) { $result = $m.Groups[1].Value.Trim() }
      if ($result) { break }
    }
  }
  Write-Log ('Namestitev končana, uporabnik ' + $chosen.name + ', preizkus: ' + $result)

  $nl = [Environment]::NewLine
  if ($result -eq 'ok') {
    Show-Msg ("Pripravljeno, " + $chosen.name + "!" + $nl + $nl +
      "Videti bi moral obvestilo v desnem spodnjem kotu in slišati zvok." + $nl +
      "Ikona 'N' je zraven ure (lahko je pod puščico ^)." + $nl + $nl +
      "Obvestila ne pridejo? Glej KAKO-NAMESTIM.txt (razdelek TEŽAVE): Ne moti / Focus Assist, Nastavitve > Obvestila.") 'info'
  } elseif ($result -like 'izklopljeno*') {
    Show-Msg ("Nameščeno, a Windows ima obvestila IZKLOPLJENA." + $nl + $nl +
      "Popravek: Nastavitve > Sistem > Obvestila > vklopi 'Prejemanje obvestil od aplikacij' (in vklopi 'Nabava Orodjarna' na seznamu)." + $nl +
      "Preveri tudi 'Ne moti' / Focus Assist (izklopi)." + $nl + $nl +
      "Medtem boš videl obvestila kot mehurček pri uri.") 'warn'
  } elseif ($result) {
    Show-Msg ("Nameščeno, a toast ni uspel (" + $result + ")." + $nl +
      "Videl boš mehurček pri uri. Datoteka z zapisom:" + $nl + $script:LogPath + $nl + "Pošlji jo Andreju/razvijalcu.") 'warn'
  } else {
    Show-Msg ("Nameščeno, a nisem dobil potrditve preizkusa." + $nl + "Poglej ikono 'N' pri uri (morda pod ^). Zapis:" + $nl + $script:LogPath) 'warn'
  }
  exit 0
} catch {
  Write-Log ('NAPAKA namestitve: ' + $_)
  Show-Msg ("Namestitev ni uspela:" + [Environment]::NewLine + $_ + [Environment]::NewLine + [Environment]::NewLine + "Zapis: " + $script:LogPath) 'err'
  exit 1
}
