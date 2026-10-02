# Nabava Orodjarna - obvestila v opravilni vrstici (tray) + Windows toast
# Windows PowerShell 5.1, brez exe, brez VBS. Zagon: powershell -WindowStyle Hidden -File nabava-obvestila.ps1
# Datoteka mora biti shranjena kot UTF-8 z BOM (zaradi č, š, ž).
param(
  [switch]$NoRun,       # samo naloži funkcije (za teste)
  [switch]$FirstRun,    # po zagonu pokaže preizkusni toast (uporablja namestitev)
  [string]$ConfigPath
)

$ErrorActionPreference = 'Continue'

$script:AppName    = 'Nabava Orodjarna'
$script:AppId      = 'Nabava.Orodjarna.Obvestila'
$script:PsAppId    = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
$script:DataDir    = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna'
$script:LogPath    = Join-Path $script:DataDir 'notifier.log'
$script:StatePath  = Join-Path $script:DataDir 'notifier-state.json'
$script:ScriptDir  = $PSScriptRoot
if (-not $script:ScriptDir) { $script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $script:ScriptDir 'config.json' }

# ---------------------------------------------------------------- log
function Write-Log([string]$Msg) {
  try {
    if (-not (Test-Path -LiteralPath $script:DataDir)) { New-Item -ItemType Directory -Path $script:DataDir -Force | Out-Null }
    if (Test-Path -LiteralPath $script:LogPath) {
      if ((Get-Item -LiteralPath $script:LogPath).Length -gt 524288) {
        Move-Item -LiteralPath $script:LogPath -Destination ($script:LogPath + '.old') -Force
      }
    }
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Msg
    Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
  } catch { }
}

# ---------------------------------------------------------------- pomocne
function To-Iso($v) {
  if ($null -eq $v) { return '' }
  if ($v -is [datetime]) { return $v.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture) }
  return [string]$v
}

function Get-Prop($o, [string]$name) {
  if ($null -eq $o) { return $null }
  if ($o -is [System.Collections.IDictionary]) {
    # POZOR: JavaScriptSerializer vrne Dictionary<string,object>. Njegov Contains(object) je v .NET Framework
    # (Windows PowerShell 5.1) "explicit interface" in ga PowerShell ne vidi -> napaka
    # 'Cannot find an overload for "Contains"'. Zato NE uporabljaj .Contains(); uporabi TryGetValue / zanko po Keys.
    $v = $null
    if ($o -is [System.Collections.Generic.Dictionary[string, object]]) {
      if ($o.TryGetValue($name, [ref]$v)) { return $v }
      return $null
    }
    foreach ($k in @($o.Keys)) {
      if ([string]$k -eq $name) { return $o[$k] }
    }
    return $null
  }
  $p = $o.PSObject.Properties[$name]
  if ($p) { return $p.Value }
  return $null
}

function As-List($x) {
  if ($null -eq $x) { return @() }
  return @($x)
}

function Parse-Json([string]$text) {
  # Windows PowerShell 5.1: JavaScriptSerializer brez omejitve velikosti (db.json je lahko velik)
  $ser = $null
  try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    $ser.RecursionLimit = 200
  } catch { $ser = $null }
  if ($ser) { return $ser.DeserializeObject($text) }
  return ($text | ConvertFrom-Json)
}

function Get-MaxStamp($data) {
  $max = ''
  foreach ($r in @(As-List (Get-Prop $data 'requests'))) {
    $c = To-Iso (Get-Prop $r 'createdAt')
    if ([string]::CompareOrdinal($c, $max) -gt 0) { $max = $c }
    foreach ($h in @(As-List (Get-Prop $r 'history'))) {
      $a = To-Iso (Get-Prop $h 'at')
      if ([string]::CompareOrdinal($a, $max) -gt 0) { $max = $a }
    }
  }
  return $max
}

function Find-User($data, [string]$userId) {
  foreach ($u in @(As-List (Get-Prop $data 'users'))) {
    if ([string](Get-Prop $u 'id') -eq $userId) { return $u }
  }
  return $null
}

# ---------------------------------------------------------------- pravila obvestil
# Enaka pravila kot v aplikaciji (src/notifications.ts):
#  vodja  -> nove zahteve (odprto / naroceno)
#  delavec-> njegove zahteve, ki so postale "Naročeno" ali "Prejeto"
function Get-NotifEvents($data, [string]$userId, [string]$fallbackRole, [string]$sinceIso) {
  $since = $sinceIso
  if (-not $since) { $since = '1970-01-01T00:00:00.000Z' }
  $user = Find-User $data $userId
  $role = $fallbackRole
  $name = ''
  $ws = ''
  if ($user) {
    $role = [string](Get-Prop $user 'role')
    $name = [string](Get-Prop $user 'name')
    $ws = [string](Get-Prop $user 'workstationId')
  }
  $out = New-Object System.Collections.ArrayList
  foreach ($r in @(As-List (Get-Prop $data 'requests'))) {
    $id = [string](Get-Prop $r 'id')
    $status = [string](Get-Prop $r 'status')
    $title = [string](Get-Prop $r 'title')
    $by = [string](Get-Prop $r 'createdBy')
    $urg = [string](Get-Prop $r 'urgency')
    $created = To-Iso (Get-Prop $r 'createdAt')
    if ($role -eq 'vodja') {
      if ([string]::CompareOrdinal($created, $since) -gt 0 -and ($status -eq 'odprto' -or $status -eq 'naroceno')) {
        $nujno = ''
        if ($urg -eq 'visoka') { $nujno = ' · NUJNO' }
        [void]$out.Add([pscustomobject]@{
          Id = 'new:' + $id + ':' + $created; At = $created
          Title = 'Nova zahteva' + $nujno; Body = ($title + ' · ' + $by); Nujno = ($urg -eq 'visoka')
        })
      }
    } else {
      $own = $false
      if ($name -and $by -eq $name) { $own = $true }
      if ($ws -and ([string](Get-Prop $r 'workstationId') -eq $ws)) { $own = $true }
      if (-not $own) { continue }
      foreach ($st in @('naroceno', 'prejeto')) {
        $latest = ''
        foreach ($h in @(As-List (Get-Prop $r 'history'))) {
          if ([string](Get-Prop $h 'status') -eq $st) {
            $a = To-Iso (Get-Prop $h 'at')
            if ([string]::CompareOrdinal($a, $latest) -gt 0) { $latest = $a }
          }
        }
        if ($latest -and [string]::CompareOrdinal($latest, $since) -gt 0 -and $status -eq $st) {
          $label = 'Naročeno'
          if ($st -eq 'prejeto') { $label = 'Prejeto' }
          [void]$out.Add([pscustomobject]@{
            Id = 'status:' + $id + ':' + $st + ':' + $latest; At = $latest
            Title = 'Status: ' + $label; Body = $title; Nujno = $false
          })
        }
      }
    }
  }
  return @($out | Sort-Object At -Descending)
}

# ---------------------------------------------------------------- konfiguracija in stanje
function Get-Config {
  $cfg = @{ serverUrl = 'http://192.168.1.124:8787'; userId = ''; userName = ''; role = 'delavec'; pollSeconds = 30; toastAppId = '' }
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($raw.serverUrl) { $cfg.serverUrl = ([string]$raw.serverUrl).TrimEnd('/') }
      if ($raw.userId) { $cfg.userId = [string]$raw.userId }
      if ($raw.userName) { $cfg.userName = [string]$raw.userName }
      if ($raw.role) { $cfg.role = [string]$raw.role }
      if ($raw.pollSeconds) { $cfg.pollSeconds = [Math]::Max(10, [int]$raw.pollSeconds) }
      if ($raw.toastAppId) { $cfg.toastAppId = [string]$raw.toastAppId }
    } catch { Write-Log ('Napaka v config.json: ' + $_) }
  }
  return $cfg
}

function Get-State {
  $st = @{ lastSeenAt = ''; userId = ''; notifiedIds = (New-Object System.Collections.ArrayList) }
  if (Test-Path -LiteralPath $script:StatePath) {
    try {
      $s = Get-Content -LiteralPath $script:StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($s.lastSeenAt) { $st.lastSeenAt = To-Iso $s.lastSeenAt }
      if ($s.userId) { $st.userId = [string]$s.userId }
      foreach ($x in @(As-List $s.notifiedIds)) { [void]$st.notifiedIds.Add([string]$x) }
    } catch { Write-Log ('Napaka v stanju (ponovno semenjenje): ' + $_) }
  }
  return $st
}

function Save-State($st) {
  try {
    if (-not (Test-Path -LiteralPath $script:DataDir)) { New-Item -ItemType Directory -Path $script:DataDir -Force | Out-Null }
    $ids = @($st.notifiedIds | Select-Object -Last 200)
    $obj = @{ lastSeenAt = $st.lastSeenAt; userId = $st.userId; notifiedIds = $ids; updatedAt = (To-Iso (Get-Date)) }
    ($obj | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $script:StatePath -Encoding UTF8
  } catch { Write-Log ('Shranjevanje stanja ni uspelo: ' + $_) }
}

# ---------------------------------------------------------------- AppUserModelID (HKCU, brez admina)
function New-AppBitmap([int]$size, $color, [string]$letter) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $color
  $g.FillEllipse($brush, 1, 1, ($size - 2), ($size - 2))
  $font = New-Object System.Drawing.Font('Segoe UI', ([single]($size * 0.55)), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString($letter, $font, [System.Drawing.Brushes]::White, $rect, $fmt)
  $g.Dispose(); $brush.Dispose(); $font.Dispose()
  return $bmp
}

function Register-Aumid {
  try {
    Add-Type -AssemblyName System.Drawing
    $iconPng = Join-Path $script:ScriptDir 'ikona.png'
    if (-not (Test-Path -LiteralPath $iconPng)) {
      try {
        $b = New-AppBitmap 96 ([System.Drawing.Color]::FromArgb(42, 95, 143)) 'N'
        $b.Save($iconPng, [System.Drawing.Imaging.ImageFormat]::Png)
        $b.Dispose()
      } catch { Write-Log ('Ikona PNG ni uspela: ' + $_) }
    }
    $key = 'HKCU:\Software\Classes\AppUserModelId\' + $script:AppId
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name 'DisplayName' -Value $script:AppName -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name 'IconBackgroundColor' -Value 'FF2A5F8F' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $key -Name 'ShowInSettings' -Value 1 -PropertyType DWord -Force | Out-Null
    if (Test-Path -LiteralPath $iconPng) {
      New-ItemProperty -Path $key -Name 'IconUri' -Value $iconPng -PropertyType String -Force | Out-Null
    }
    return $true
  } catch {
    Write-Log ('Registracija AUMID ni uspela: ' + $_)
    return $false
  }
}

# ---------------------------------------------------------------- toast / balloon / zvok
function Escape-Xml([string]$t) {
  if ($null -eq $t) { return '' }
  return [System.Security.SecurityElement]::Escape($t)
}

function Show-Toast([string]$Title, [string]$Body, [bool]$Urgent, [string]$Url) {
  # vrne 'ok' ali opis napake / 'izklopljeno:<stanje>'
  $appIds = @($script:ToastAppId)
  if ($script:ToastAppId -ne $script:PsAppId) { $appIds += $script:PsAppId }
  $last = 'fail'
  foreach ($appId in $appIds) {
    try {
      [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
      [void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
      [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
      $u = Escape-Xml $Url
      $sound = 'ms-winsoundevent:Notification.Default'
      $dur = ''
      if ($Urgent) { $sound = 'ms-winsoundevent:Notification.Reminder'; $dur = ' duration="long"' }
      $xml = '<toast launch="' + $u + '" activationType="protocol"' + $dur + '>' +
        '<visual><binding template="ToastGeneric"><text>' + (Escape-Xml $Title) + '</text><text>' + (Escape-Xml $Body) + '</text></binding></visual>' +
        '<actions><action content="Odpri" arguments="' + $u + '" activationType="protocol"/></actions>' +
        '<audio src="' + $sound + '"/></toast>'
      $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
      $doc.LoadXml($xml)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
      # Setting ponekod (Windows 10 + PS 5.1) vrne prazno/$null, ceprav toast deluje -> prazno = neznano, poskusi pokazati.
      # Izklopljeno sele, ce Windows izrecno vrne drugo vrednost kot Enabled.
      $setting = ''
      try { if ($null -ne $notifier.Setting) { $setting = [string]$notifier.Setting } } catch { $setting = '' }
      if ($setting -eq '') { Write-Log ('Toast (' + $appId + '): nastavitev obvestil neznana (prazno) - poskusim vseeno.') }
      if ($setting -ne '' -and $setting -ne 'Enabled') {
        Write-Log ('Toast (' + $appId + '): nastavitev obvestil = ' + $setting)
        $last = 'izklopljeno:' + $setting
        continue
      }
      $notifier.Show($toast)
      if ($appId -ne $script:ToastAppId) { Write-Log 'Toast poslan prek rezervnega AppId (PowerShell).' }
      return 'ok'
    } catch {
      $last = [string]$_
      Write-Log ('Toast napaka (' + $appId + '): ' + $_)
    }
  }
  return $last
}

# Zapise v dnevnik nastavitve, zaradi katerih toast morda ne prikaze (za diagnozo; nic ne spreminja)
function Write-ToastDiagnostics {
  try {
    $items = @(
      @('HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications', 'ToastEnabled'),
      @(('HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\' + $script:AppId), 'Enabled'),
      @('HKCU:\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications', 'NoToastApplicationNotification'),
      @('HKCU:\Software\Policies\Microsoft\Windows\Explorer', 'DisableNotificationCenter'),
      @('HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications', 'NoToastApplicationNotification'),
      @('HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer', 'DisableNotificationCenter')
    )
    foreach ($it in $items) {
      $val = '(ni nastavljeno)'
      try {
        $v = (Get-ItemProperty -LiteralPath $it[0] -Name $it[1] -ErrorAction Stop).($it[1])
        $val = [string]$v
      } catch { }
      Write-Log ('DIAG ' + $it[0] + ' ' + $it[1] + ' = ' + $val)
    }
    Write-Log 'DIAG nasvet: Nastavitve > Sistem > Obvestila: vklopi obvestila; izklopi Ne moti / Focus Assist; na seznamu vklopi "Nabava Orodjarna".'
  } catch { Write-Log ('DIAG napaka: ' + $_) }
}

function Play-FallbackSound {
  try {
    $dir = Join-Path $env:SystemRoot 'Media'
    foreach ($n in @('Windows Notify System Generic.wav', 'Windows Notify Messaging.wav', 'Windows Notify.wav', 'notify.wav', 'chimes.wav', 'ding.wav')) {
      $p = Join-Path $dir $n
      if (Test-Path -LiteralPath $p) {
        $sp = New-Object System.Media.SoundPlayer $p
        $sp.Play()
        return
      }
    }
    [System.Media.SystemSounds]::Asterisk.Play()
  } catch {
    try { [Console]::Beep(880, 250) } catch { }
  }
}

function Show-Balloon([string]$Title, [string]$Body) {
  try {
    $script:Tray.BalloonTipTitle = $Title
    $script:Tray.BalloonTipText = $Body
    $script:Tray.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $script:Tray.ShowBalloonTip(10000)
    return $true
  } catch {
    Write-Log ('Balloon napaka: ' + $_)
    return $false
  }
}

# Pokaže obvestilo: toast; ce ne gre -> balloon + zvok. Vrne rezultat toasta.
function Show-Notification([string]$Title, [string]$Body, [bool]$Urgent) {
  $r = Show-Toast $Title $Body $Urgent $script:Cfg.serverUrl
  if ($r -eq 'ok') {
    Write-Log ('TOAST: ' + $Title + ' | ' + $Body)
  } else {
    Write-Log ('TOAST ni uspel (' + $r + ') -> balloon + zvok: ' + $Title + ' | ' + $Body)
    [void](Show-Balloon $Title $Body)
    Play-FallbackSound
  }
  return $r
}

function Open-App {
  $url = $script:Cfg.serverUrl + '/'
  try { Start-Process $url } catch {
    Write-Log ('Odpiranje brskalnika ni uspelo: ' + $_)
    try { Start-Process 'cmd.exe' -ArgumentList ('/c start "" "' + $url + '"') -WindowStyle Hidden } catch { }
  }
}

# ---------------------------------------------------------------- obdelava odgovora strežnika
function Update-Status([bool]$ok, [string]$why) {
  if ($ok -ne $script:Online) {
    $script:Online = $ok
    if ($ok) { Write-Log 'Povezava s strežnikom OK.' } else { Write-Log ('Strežnik ni dosegljiv: ' + $why) }
    Update-TrayText
  }
}

function Handle-PollText([string]$text) {
  $key = $text.Length.ToString() + ':' + $text.GetHashCode()
  if ($key -eq $script:LastHash) { return }
  $data = Parse-Json $text
  $cfg = $script:Cfg
  $st = $script:State
  $user = Find-User $data $cfg.userId
  if (-not $user) { Write-Log ('Uporabnik ' + $cfg.userName + ' (' + $cfg.userId + ') ni v bazi - preveri ime.') }

  if (-not $st.lastSeenAt -or $st.userId -ne $cfg.userId) {
    $st.userId = $cfg.userId
    $st.lastSeenAt = Get-MaxStamp $data
    if (-not $st.lastSeenAt) { $st.lastSeenAt = To-Iso (Get-Date) }
    $st.notifiedIds = New-Object System.Collections.ArrayList
    Save-State $st
    Write-Log ('Prvo branje, semenjeno do ' + $st.lastSeenAt + ' (stare zahteve brez obvestil).')
    $script:LastHash = $key
    return
  }

  $events = @(Get-NotifEvents $data $cfg.userId $cfg.role $st.lastSeenAt | Where-Object { $st.notifiedIds -notcontains $_.Id })
  if ($events.Count -gt 0) {
    $shown = 0
    foreach ($ev in $events) {
      if ($shown -ge 4) { break }
      [void](Show-Notification $ev.Title $ev.Body $ev.Nujno)
      $shown++
    }
    if ($events.Count -gt $shown) {
      $rest = $events.Count - $shown
      [void](Show-Notification 'Nabava' ('Še ' + $rest + ' novih obvestil.') $false)
    }
    foreach ($ev in $events) { [void]$st.notifiedIds.Add($ev.Id) }
  }
  $mx = Get-MaxStamp $data
  if ([string]::CompareOrdinal($mx, $st.lastSeenAt) -gt 0) { $st.lastSeenAt = $mx }
  Save-State $st
  $script:LastHash = $key
}

# ---------------------------------------------------------------- tray
function Update-TrayText {
  try {
    $t = 'Nabava: ' + $script:Cfg.userName
    if ($script:MutedUntil -gt (Get-Date)) { $t += ' (utišano)' }
    elseif (-not $script:Online) { $t += ' (ni povezave)' }
    if ($t.Length -gt 62) { $t = $t.Substring(0, 62) }
    $script:Tray.Text = $t
    if ($script:MutedUntil -gt (Get-Date)) { $script:Tray.Icon = $script:IconMuted }
    elseif (-not $script:Online) { $script:Tray.Icon = $script:IconOffline }
    else { $script:Tray.Icon = $script:IconOn }
  } catch { }
}

function Set-Mute([bool]$on) {
  if ($on) {
    $script:MutedUntil = (Get-Date).AddHours(1)
    $script:MenuMute.Text = 'Prekliči utišanje'
    Write-Log 'Utišano za 1 uro.'
  } else {
    $script:MutedUntil = [datetime]::MinValue
    $script:MenuMute.Text = 'Utišaj 1 h'
    $script:NextPoll = Get-Date
    Write-Log 'Utišanje preklicano.'
  }
  Update-TrayText
}

function Start-TrayApp {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Net.Http
  [System.Windows.Forms.Application]::EnableVisualStyles()

  # en sam primerek na uporabnika
  $created = $false
  $script:Mutex = New-Object System.Threading.Mutex($true, 'Local\NabavaOrodjarnaObvestila', [ref]$created)
  if (-not $created) { Write-Log 'Že teče (drug primerek) - izhod.'; return }

  $script:Cfg = Get-Config
  Write-Log ('=== Zagon. Strežnik ' + $script:Cfg.serverUrl + ', uporabnik "' + $script:Cfg.userName + '", PS ' + $PSVersionTable.PSVersion + ' ===')
  if (-not $script:Cfg.userId) {
    Write-Log 'V config.json ni userId - zaženi NAMESTI-OBVESTILA.bat.'
    [void][System.Windows.Forms.MessageBox]::Show('Obvestila še niso nastavljena.' + [Environment]::NewLine + 'Zaženi NAMESTI-OBVESTILA.bat.', $script:AppName)
    return
  }
  $script:State = Get-State
  $script:ToastAppId = $script:AppId
  if ($script:Cfg.toastAppId -eq 'powershell') { $script:ToastAppId = $script:PsAppId }
  if ($script:ToastAppId -eq $script:AppId) { [void](Register-Aumid) }

  $script:Online = $true   # prvi neuspeh se zabeleži
  $script:LastHash = ''
  $script:MutedUntil = [datetime]::MinValue
  $script:NextPoll = Get-Date
  $script:PollTask = $null

  $script:IconOn = [System.Drawing.Icon]::FromHandle((New-AppBitmap 32 ([System.Drawing.Color]::FromArgb(42, 95, 143)) 'N').GetHicon())
  $script:IconMuted = [System.Drawing.Icon]::FromHandle((New-AppBitmap 32 ([System.Drawing.Color]::FromArgb(130, 130, 130)) 'N').GetHicon())
  $script:IconOffline = [System.Drawing.Icon]::FromHandle((New-AppBitmap 32 ([System.Drawing.Color]::FromArgb(200, 60, 50)) 'N').GetHicon())

  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.UseProxy = $false
  $script:Http = New-Object System.Net.Http.HttpClient($handler)
  $script:Http.Timeout = [TimeSpan]::FromSeconds(20)

  $script:Tray = New-Object System.Windows.Forms.NotifyIcon
  $script:Tray.Icon = $script:IconOn
  $script:Tray.Text = 'Nabava: ' + $script:Cfg.userName

  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $head = $menu.Items.Add('Nabava · ' + $script:Cfg.userName)
  $head.Enabled = $false
  $miOpen = $menu.Items.Add('Odpri')
  $miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
  $script:MenuMute = $menu.Items.Add('Utišaj 1 h')
  $miTest = $menu.Items.Add('Preizkusni toast')
  [void]$menu.Items.Add('-')
  $miExit = $menu.Items.Add('Izhod')
  $script:Tray.ContextMenuStrip = $menu

  $miOpen.add_Click({ try { Open-App } catch { Write-Log ('Odpri: ' + $_) } })
  $script:Tray.add_DoubleClick({ try { Open-App } catch { Write-Log ('Odpri: ' + $_) } })
  $script:Tray.add_BalloonTipClicked({ try { Open-App } catch { Write-Log ('Balloon klik: ' + $_) } })
  $script:MenuMute.add_Click({
    try { Set-Mute ($script:MutedUntil -le (Get-Date)) } catch { Write-Log ('Utišaj: ' + $_) }
  })
  $miTest.add_Click({
    try {
      $r = Show-Notification 'Nabava: preizkus' ('Obvestila delujejo, ' + $script:Cfg.userName + '.') $false
      Write-Log ('Preizkusni toast: ' + $r)
    } catch { Write-Log ('Preizkus: ' + $_) }
  })
  $miExit.add_Click({
    try {
      Write-Log 'Izhod (meni).'
      $script:Tray.Visible = $false
      $script:Tray.Dispose()
      [System.Windows.Forms.Application]::Exit()
    } catch { }
  })

  $script:Tray.Visible = $true

  # glavni casovnik: vsako sekundo preveri, ali je odgovor strežnika pripravljen / ali je cas za novo poizvedbo
  $script:Timer = New-Object System.Windows.Forms.Timer
  $script:Timer.Interval = 1000
  $script:Timer.add_Tick({
    try {
      $now = Get-Date
      if ($script:MutedUntil -ne [datetime]::MinValue -and $script:MutedUntil -le $now) { Set-Mute $false }
      if ($script:PollTask) {
        if ($script:PollTask.IsCompleted) {
          $t = $script:PollTask
          $script:PollTask = $null
          if ($t.IsFaulted -or $t.IsCanceled) {
            $why = 'prekinitev'
            if ($t.Exception) { $why = $t.Exception.GetBaseException().Message }
            Update-Status $false $why
          } else {
            Update-Status $true ''
            Handle-PollText ([string]$t.Result)
          }
        }
        return
      }
      if ($script:MutedUntil -gt $now) { return }
      if ($now -ge $script:NextPoll) {
        $script:NextPoll = $now.AddSeconds($script:Cfg.pollSeconds)
        $script:PollTask = $script:Http.GetStringAsync($script:Cfg.serverUrl + '/api/data')
      }
    } catch {
      Write-Log ('Napaka v zanki: ' + $_)
      $script:PollTask = $null
    }
  })
  $script:Timer.Start()

  if ($FirstRun) {
    $script:FirstTimer = New-Object System.Windows.Forms.Timer
    $script:FirstTimer.Interval = 2500
    $script:FirstTimer.add_Tick({
      $script:FirstTimer.Stop()
      try {
        $r = Show-Notification 'Nabava: obvestila delujejo' ('Pozdravljen, ' + $script:Cfg.userName + '! Takole bo videti novo obvestilo.') $false
        Write-Log ('FIRSTRUN: ' + $r)
      } catch { Write-Log ('FIRSTRUN napaka: ' + $_); Write-Log 'FIRSTRUN: fail' }
    })
    $script:FirstTimer.Start()
  }

  $ctx = New-Object System.Windows.Forms.ApplicationContext
  [System.Windows.Forms.Application]::Run($ctx)

  try { $script:Timer.Stop(); $script:Tray.Visible = $false; $script:Tray.Dispose() } catch { }
  try { $script:Mutex.ReleaseMutex() } catch { }
}

if (-not $NoRun) {
  try { Start-TrayApp } catch { Write-Log ('KRITIČNA napaka: ' + $_) }
}
