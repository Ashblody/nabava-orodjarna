# Nabava Orodjarna — Windows toast companion (Win10+ WinRT, no BurntToast)
# Polls /api/data and shows toast on new vodja-relevant (or all) requests.

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ScriptDir 'notifier-config.json'

$DefaultConfig = @{
  apiUrl      = 'http://192.168.1.124:8787/api/data'
  pollSeconds = 30
  role        = 'vodja'  # vodja | all
}

function Read-Config {
  if (Test-Path -LiteralPath $ConfigPath) {
    try {
      $raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      return @{
        apiUrl      = if ($raw.apiUrl) { [string]$raw.apiUrl } else { $DefaultConfig.apiUrl }
        pollSeconds = if ($raw.pollSeconds) { [int]$raw.pollSeconds } else { $DefaultConfig.pollSeconds }
        role        = if ($raw.role) { [string]$raw.role } else { $DefaultConfig.role }
      }
    } catch {
      Write-Warning "Config berljiv z napako, uporabljam privzeto: $_"
    }
  }
  return $DefaultConfig.Clone()
}

$StateDir = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna'
$StatePath = Join-Path $StateDir 'notifier-state.json'

function Read-State {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return @{ lastSeenAt = $null; notifiedIds = @() }
  }
  try {
    $s = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $ids = @()
    if ($s.notifiedIds) { $ids = @($s.notifiedIds | ForEach-Object { [string]$_ }) }
    return @{
      lastSeenAt   = if ($s.lastSeenAt) { [string]$s.lastSeenAt } else { $null }
      notifiedIds  = $ids
    }
  } catch {
    return @{ lastSeenAt = $null; notifiedIds = @() }
  }
}

function Write-State($state) {
  if (-not (Test-Path -LiteralPath $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  }
  $ids = @($state.notifiedIds | Select-Object -Last 200)
  $obj = [ordered]@{
    lastSeenAt  = $state.lastSeenAt
    notifiedIds = $ids
    updatedAt   = (Get-Date).ToUniversalTime().ToString('o')
  }
  ($obj | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Show-Toast {
  param(
    [string]$Title,
    [string]$Body,
    [string]$Tag
  )
  try {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

    $appId = 'NabavaOrodjarna.Notifier'
    $xml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$([System.Security.SecurityElement]::Escape($Title))</text>
      <text>$([System.Security.SecurityElement]::Escape($Body))</text>
    </binding>
  </visual>
</toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
    if ($Tag) { $toast.Tag = $Tag; $toast.Group = 'nabava' }
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
    $notifier.Show($toast)
  } catch {
    # Fallback balloon via NotifyIcon-less Message — last resort console beep
    Write-Host "[TOAST FAIL] $Title — $Body ($_)"
    try {
      Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
      # Use tray balloon if possible via temporary notify icon
      $ni = New-Object System.Windows.Forms.NotifyIcon
      $ni.Icon = [System.Drawing.SystemIcons]::Information
      $ni.Visible = $true
      $ni.ShowBalloonTip(5000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
      Start-Sleep -Milliseconds 600
      $ni.Dispose()
    } catch {
      [Console]::Beep(880, 200)
    }
  }
}

function Get-ApiData([string]$url) {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
  return ($resp.Content | ConvertFrom-Json)
}

function Find-Events($data, $sinceIso, $role) {
  $since = if ($sinceIso) { $sinceIso } else { '1970-01-01T00:00:00.000Z' }
  $events = @()
  if (-not $data.requests) { return $events }

  foreach ($r in $data.requests) {
    $created = [string]$r.createdAt
    $status = [string]$r.status
    $urgency = [string]$r.urgency
    $title = [string]$r.title
    $by = [string]$r.createdBy
    $id = [string]$r.id

    $isNewOpen = ($created -gt $since) -and ($status -eq 'odprto' -or $status -eq 'naroceno')
    if (-not $isNewOpen) { continue }

    if ($role -eq 'vodja' -or $role -eq 'all') {
      $nujno = if ($urgency -eq 'visoka') { ' · NUJNO' } else { '' }
      $events += [pscustomobject]@{
        Id    = "new:${id}:${created}"
        At    = $created
        Title = "Nova zahteva$nujno"
        Body  = "$title · $by"
        Nujno = ($urgency -eq 'visoka')
      }
    }
  }

  # Sort newest first
  return @($events | Sort-Object At -Descending)
}

Write-Host "Nabava Orodjarna notifier"
$cfg = Read-Config
Write-Host "  API:  $($cfg.apiUrl)"
Write-Host "  Role: $($cfg.role)  Poll: $($cfg.pollSeconds)s"
Write-Host "  State: $StatePath"
Write-Host "Ctrl+C za zaustavitev.`n"

$state = Read-State
# First successful fetch seeds lastSeen without flooding toasts
$seeded = $false

while ($true) {
  try {
    $cfg = Read-Config
    $data = Get-ApiData $cfg.apiUrl

    if (-not $seeded -and -not $state.lastSeenAt) {
      $state.lastSeenAt = (Get-Date).ToUniversalTime().ToString('o')
      Write-State $state
      $seeded = $true
      Write-Host "$(Get-Date -Format 'HH:mm:ss') Semenjeno (brez toastov za staro zgodovino)."
    } else {
      $seeded = $true
      $events = Find-Events $data $state.lastSeenAt $cfg.role
      $fresh = @()
      foreach ($ev in $events) {
        if ($state.notifiedIds -notcontains $ev.Id) { $fresh += $ev }
      }

      if ($fresh.Count -gt 0) {
        $maxShow = 5
        $i = 0
        foreach ($ev in $fresh) {
          if ($i -ge $maxShow) { break }
          Show-Toast -Title $ev.Title -Body $ev.Body -Tag $ev.Id
          $state.notifiedIds += $ev.Id
          Write-Host "$(Get-Date -Format 'HH:mm:ss') TOAST: $($ev.Title) — $($ev.Body)"
          $i++
        }
        # Advance lastSeen to newest event time so we don't re-scan forever
        $newest = ($fresh | Sort-Object At -Descending | Select-Object -First 1).At
        if ($newest -and $newest -gt $state.lastSeenAt) {
          $state.lastSeenAt = $newest
        }
        Write-State $state
      }
    }
  } catch {
    Write-Host "$(Get-Date -Format 'HH:mm:ss') Napaka: $_"
  }

  $sec = [Math]::Max(10, [int]$cfg.pollSeconds)
  Start-Sleep -Seconds $sec
}
