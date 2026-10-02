# Nabava Orodjarna — Windows toast notifier (Win10+, brez BurntToast)
# Zaženi prek start-notifier.bat (VBS ni potreben).

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ScriptDir 'notifier-config.json'
$StateDir = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna'
$StatePath = Join-Path $StateDir 'notifier-state.json'

function Get-Config {
  $apiUrl = 'http://192.168.1.124:8787/api/data'
  $pollSeconds = 30
  $role = 'vodja'
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($raw.apiUrl) { $apiUrl = [string]$raw.apiUrl }
      if ($raw.pollSeconds) { $pollSeconds = [int]$raw.pollSeconds }
      if ($raw.role) { $role = [string]$raw.role }
    } catch {
      Write-Host "Config napaka, privzeto: $_"
    }
  }
  return @{ apiUrl = $apiUrl; pollSeconds = $pollSeconds; role = $role }
}

function Get-State {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return @{ lastSeenAt = ''; notifiedIds = New-Object System.Collections.ArrayList }
  }
  try {
    $s = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $list = New-Object System.Collections.ArrayList
    if ($s.notifiedIds) {
      foreach ($x in @($s.notifiedIds)) { [void]$list.Add([string]$x) }
    }
    $ls = ''
    if ($s.lastSeenAt) { $ls = [string]$s.lastSeenAt }
    return @{ lastSeenAt = $ls; notifiedIds = $list }
  } catch {
    return @{ lastSeenAt = ''; notifiedIds = New-Object System.Collections.ArrayList }
  }
}

function Save-State($state) {
  if (-not (Test-Path -LiteralPath $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  }
  $ids = @($state.notifiedIds | Select-Object -Last 200)
  $obj = @{
    lastSeenAt = $state.lastSeenAt
    notifiedIds = $ids
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  ($obj | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Escape-Xml([string]$t) {
  if ($null -eq $t) { return '' }
  return ($t -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;')
}

function Show-Toast([string]$Title, [string]$Body) {
  $ok = $false
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
    $t1 = Escape-Xml $Title
    $t2 = Escape-Xml $Body
    $xmlText = '<toast><visual><binding template="ToastGeneric"><text>' + $t1 + '</text><text>' + $t2 + '</text></binding></visual></toast>'
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xmlText)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
    $n = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('NabavaOrodjarna.Notifier')
    $n.Show($toast)
    $ok = $true
  } catch {
    Write-Host ('Toast WinRT fail: ' + $_)
  }
  if (-not $ok) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $ni = New-Object System.Windows.Forms.NotifyIcon
      $ni.Icon = [System.Drawing.SystemIcons]::Information
      $ni.Visible = $true
      $ni.BalloonTipTitle = $Title
      $ni.BalloonTipText = $Body
      $ni.ShowBalloonTip(5000)
      Start-Sleep -Seconds 1
      $ni.Dispose()
    } catch {
      Write-Host ('Balloon fail: ' + $_)
      [Console]::Beep(880, 200)
    }
  }
}

function Get-ApiData([string]$url) {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
  return ($resp.Content | ConvertFrom-Json)
}

Write-Host 'Nabava Orodjarna notifier'
$cfg = Get-Config
Write-Host ('  API:  ' + $cfg.apiUrl)
Write-Host ('  Role: ' + $cfg.role + '  Poll: ' + $cfg.pollSeconds + 's')
Write-Host ('  State: ' + $StatePath)
Write-Host 'Okno lahko ostane odprto. Zaustavi: Ctrl+C ali zapri okno.'
Write-Host ''

$state = Get-State
$seeded = $false

while ($true) {
  try {
    $cfg = Get-Config
    $data = Get-ApiData $cfg.apiUrl

    if (-not $seeded) {
      if (-not $state.lastSeenAt) {
        $state.lastSeenAt = (Get-Date).ToUniversalTime().ToString('o')
        Save-State $state
        Write-Host ((Get-Date -Format 'HH:mm:ss') + ' Semenjeno (stare zahteve brez toasta).')
      }
      $seeded = $true
    } else {
      $since = $state.lastSeenAt
      if (-not $since) { $since = '1970-01-01T00:00:00.000Z' }
      $fresh = @()
      if ($data.requests) {
        foreach ($r in @($data.requests)) {
          $created = [string]$r.createdAt
          $status = [string]$r.status
          $urgency = [string]$r.urgency
          $title = [string]$r.title
          $by = [string]$r.createdBy
          $id = [string]$r.id
          $eid = 'new:' + $id + ':' + $created
          if ($created -le $since) { continue }
          if ($status -ne 'odprto' -and $status -ne 'naroceno') { continue }
          if ($cfg.role -ne 'vodja' -and $cfg.role -ne 'all') { continue }
          if ($state.notifiedIds -contains $eid) { continue }
          $nujno = ''
          if ($urgency -eq 'visoka') { $nujno = ' NUJNO' }
          $fresh += [pscustomobject]@{ Id = $eid; At = $created; Title = ('Nova zahteva' + $nujno); Body = ($title + ' - ' + $by) }
        }
      }
      $fresh = @($fresh | Sort-Object At -Descending)
      $i = 0
      foreach ($ev in $fresh) {
        if ($i -ge 5) { break }
        Show-Toast $ev.Title $ev.Body
        [void]$state.notifiedIds.Add($ev.Id)
        Write-Host ((Get-Date -Format 'HH:mm:ss') + ' TOAST: ' + $ev.Title + ' - ' + $ev.Body)
        if ($ev.At -gt $state.lastSeenAt) { $state.lastSeenAt = $ev.At }
        $i++
      }
      if ($i -gt 0) { Save-State $state }
    }
  } catch {
    Write-Host ((Get-Date -Format 'HH:mm:ss') + ' Napaka: ' + $_)
  }
  $sec = 30
  try { $sec = [Math]::Max(10, [int]$cfg.pollSeconds) } catch { $sec = 30 }
  Start-Sleep -Seconds $sec
}
