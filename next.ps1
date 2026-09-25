# Solstice FDE - "what do I do next"
# Run it, do the ONE thing it tells you, run it again. That is the whole workflow.
#
#   powershell -ExecutionPolicy Bypass -File next.ps1
#   powershell -ExecutionPolicy Bypass -File next.ps1 -All    # show every step's state

param([switch]$All)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$envPath = Join-Path $root '.env'

function Get-EnvMap {
    $map = @{}
    if (Test-Path $envPath) {
        foreach ($line in (Get-Content -LiteralPath $envPath -Encoding UTF8)) {
            if ($line -match '^\s*#') { continue }
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $map[$matches[1]] = $matches[2].Trim() }
        }
    }
    return $map
}
$e = Get-EnvMap

function Has($k) { return -not [string]::IsNullOrWhiteSpace($e[$k]) }

function Get-ProjectRef {
    # Parenthesise both sides: `Has 'X' -and ...` parses as passing "-and" to Has.
    if (-not (Has 'SUPABASE_URL')) { return $null }
    $m = [regex]::Match($e['SUPABASE_URL'], 'https://([a-z0-9]+)\.supabase\.')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

# ---------------------------------------------------------------- checks

function Check-Telnyx {
    if (-not (Has 'TELNYX_API_KEY')) { return @{ ok = $false; detail = 'no key' } }
    try {
        $r = Invoke-RestMethod -Uri 'https://api.telnyx.com/v2/balance' -Headers @{ Authorization = "Bearer $($e['TELNYX_API_KEY'])" }
        return @{ ok = $true; detail = "balance `$$($r.data.balance)"; balance = [double]$r.data.balance }
    }
    catch { return @{ ok = $false; detail = 'key rejected' } }
}

function Check-Anthropic {
    if (-not (Has 'ANTHROPIC_API_KEY')) { return @{ ok = $false; detail = 'no key' } }
    try {
        $null = Invoke-RestMethod -Uri 'https://api.anthropic.com/v1/models' -Headers @{
            'x-api-key' = $e['ANTHROPIC_API_KEY']; 'anthropic-version' = '2023-06-01'
        }
        return @{ ok = $true; detail = 'working' }
    }
    catch { return @{ ok = $false; detail = 'key rejected or not workspace-scoped' } }
}

function Check-Schema {
    if (-not ((Has 'SUPABASE_URL') -and (Has 'SUPABASE_SERVICE_ROLE_KEY'))) { return @{ ok = $false; detail = 'supabase keys missing' } }
    try {
        $null = Invoke-RestMethod -Uri "$($e['SUPABASE_URL'])/rest/v1/properties?select=property_code&limit=1" -Headers @{
            apikey = $e['SUPABASE_SERVICE_ROLE_KEY']; Authorization = "Bearer $($e['SUPABASE_SERVICE_ROLE_KEY'])"
        }
        return @{ ok = $true; detail = 'tables exist' }
    }
    catch { return @{ ok = $false; detail = 'tables not created yet' } }
}

function Check-Messaging {
    if (-not (Has 'TELNYX_API_KEY')) { return @{ ok = $false; detail = 'no telnyx key' } }
    try {
        $r = Invoke-RestMethod -Uri 'https://api.telnyx.com/10dlc/brand' -Headers @{ Authorization = "Bearer $($e['TELNYX_API_KEY'])" }
        if ($r.totalRecords -gt 0) { return @{ ok = $true; detail = "$($r.totalRecords) brand(s) registered" } }
        return @{ ok = $false; detail = 'no 10DLC brand yet' }
    }
    catch { return @{ ok = $false; detail = 'could not check' } }
}

function Check-Migrations {
    if (-not ((Has 'SUPABASE_URL') -and (Has 'SUPABASE_SERVICE_ROLE_KEY'))) { return @{ ok = $false; detail = 'supabase keys missing' } }
    $dir = Join-Path $root 'supabase\migrations'
    if (-not (Test-Path $dir)) { return @{ ok = $true; detail = 'none pending' } }
    # One probe per migration: something the migration creates that did not exist before.
    $probes = @(
        @{ n = '001 supervisor fields'; url = 'sessions?select=supervisor_call_control_id&limit=1' },
        @{ n = '002 follow-ups'; url = 'follow_ups?select=id&limit=1' },
        @{ n = '003 failure injection'; url = 'demo_flags?select=key&limit=1' }
    )
    $pending = @()
    foreach ($probe in $probes) {
        try {
            $null = Invoke-RestMethod -Uri "$($e['SUPABASE_URL'])/rest/v1/$($probe.url)" -Headers @{
                apikey = $e['SUPABASE_SERVICE_ROLE_KEY']; Authorization = "Bearer $($e['SUPABASE_SERVICE_ROLE_KEY'])"
            }
        }
        catch { $pending += $probe.n }
    }
    if ($pending.Count -eq 0) { return @{ ok = $true; detail = 'up to date' } }
    return @{ ok = $false; detail = "$($pending.Count) pending: $($pending -join ', ')" }
}

function Do-Migrations {
    $ref = Get-ProjectRef
    $dir = Join-Path $root 'supabase\migrations'
    $sql = (Get-ChildItem -Path $dir -Filter '*.sql' | Sort-Object Name | ForEach-Object {
            "-- ===== $($_.Name) =====`r`n" + (Get-Content -LiteralPath $_.FullName -Raw)
        }) -join "`r`n`r`n"
    Set-Clipboard -Value $sql
    $url = "https://supabase.com/dashboard/project/$ref/sql/new"

    Write-Host ''
    Write-Host '  Migrations copied to your clipboard. These are safe to re-run.' -ForegroundColor Green
    Start-Process $url
    Write-Host ''
    Write-Host '   1. Click into the editor' -ForegroundColor White
    Write-Host '   2. Press Ctrl+V' -ForegroundColor White
    Write-Host '   3. Click Run' -ForegroundColor White
    Write-Host ''
    Read-Host '  Press Enter once it has run'
    $v = Check-Migrations
    if ($v.ok) { Write-Host '  Migrations applied.' -ForegroundColor Green }
    else { Write-Host '  Still pending. Paste any red error to Claude.' -ForegroundColor Yellow }
}

function Check-Netlify {
    if (Test-Path (Join-Path $root '.netlify\state.json')) { return @{ ok = $true; detail = 'site linked' } }
    return @{ ok = $false; detail = 'not linked yet' }
}

# ---------------------------------------------------------------- step actions

function Do-Schema {
    $ref = Get-ProjectRef
    if (-not $ref) {
        Write-Host ''
        Write-Host '  Could not read your Supabase project ref from SUPABASE_URL in .env.' -ForegroundColor Red
        Write-Host '  Expected something like https://abcdefgh.supabase.co' -ForegroundColor Yellow
        return
    }
    $sqlPath = Join-Path $root 'supabase\schema.sql'
    $sql = Get-Content -LiteralPath $sqlPath -Raw
    Set-Clipboard -Value $sql
    $url = "https://supabase.com/dashboard/project/$ref/sql/new"

    Write-Host ''
    Write-Host '  The schema is already copied to your clipboard.' -ForegroundColor Green
    Write-Host '  Opening the Supabase SQL Editor now...' -ForegroundColor Gray
    Start-Process $url
    Write-Host ''
    Write-Host '   1. Click into the editor' -ForegroundColor White
    Write-Host '   2. Press Ctrl+V' -ForegroundColor White
    Write-Host '   3. Click Run (or press Ctrl+Enter)' -ForegroundColor White
    Write-Host ''
    Write-Host "  If the tab did not open: $url" -ForegroundColor DarkGray
    Write-Host ''
    Read-Host '  Press Enter once it has run'

    $v = Check-Schema
    if ($v.ok) {
        Write-Host ''
        Write-Host '  Schema applied. Tables are live.' -ForegroundColor Green
        Write-Host '  Run this script again for the next step.' -ForegroundColor Gray
    }
    else {
        Write-Host ''
        Write-Host '  Still cannot see the tables.' -ForegroundColor Yellow
        Write-Host '  If Supabase showed a red error, copy it to Claude.' -ForegroundColor Yellow
        Write-Host '  If it showed "Success", wait a few seconds and run this script again.' -ForegroundColor Yellow
    }
}

function Do-Topup {
    Write-Host ''
    Write-Host '  Opening Telnyx billing...' -ForegroundColor Gray
    Start-Process 'https://portal.telnyx.com/#/billing/payments'
    Write-Host ''
    Write-Host '  Add $30 to $50. Why: 10DLC registration costs about $19 to $21 in fees' -ForegroundColor White
    Write-Host '  (brand $4, campaign vetting $15, then ~$2/month), and you still need' -ForegroundColor White
    Write-Host '  voice minutes for rehearsals and the live panel demo.' -ForegroundColor White
    Write-Host ''
    Write-Host '  THEN, on the same account, start messaging registration:' -ForegroundColor White
    Write-Host '    portal.telnyx.com  ->  Messaging  ->  register a Brand, then a Campaign' -ForegroundColor DarkGray
    Write-Host '    Use case: Customer Care (or low-volume mixed). EIN if you have one.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  This one has a carrier queue measured in days, so start it and move on.' -ForegroundColor Yellow
    Write-Host '  Everything except SMS works without it.' -ForegroundColor Yellow
}

function Do-Netlify {
    Write-Host ''
    Write-Host '  Creating and linking a Netlify site for this project.' -ForegroundColor White
    Write-Host '  Run this, and pick "Create & configure a new project" when asked:' -ForegroundColor Gray
    Write-Host ''
    Write-Host '     netlify init' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Accept the defaults it suggests. Claude sets the build settings and' -ForegroundColor DarkGray
    Write-Host '  environment variables afterwards.' -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- the ladder

$steps = @(
    @{ n = 'Telnyx API key'; check = { Check-Telnyx }; act = $null; required = $true }
    @{ n = 'Anthropic API key'; check = { Check-Anthropic }; act = $null; required = $true }
    @{ n = 'Database schema'; check = { Check-Schema }; act = { Do-Schema }; required = $true }
    @{ n = 'Database migrations'; check = { Check-Migrations }; act = { Do-Migrations }; required = $true }
    @{ n = 'Netlify site'; check = { Check-Netlify }; act = { Do-Netlify }; required = $true }
    @{ n = 'SMS registration'; check = { Check-Messaging }; act = { Do-Topup }; required = $false }
)

Write-Host ''
Write-Host '  Solstice FDE - setup progress' -ForegroundColor Cyan
Write-Host '  -----------------------------' -ForegroundColor Cyan

$next = $null
foreach ($s in $steps) {
    $r = & $s.check
    if ($r.ok) {
        Write-Host ('  [x] ' + $s.n.PadRight(22) + $r.detail) -ForegroundColor Green
    }
    else {
        $tag = 'needed'
        if (-not $s.required) { $tag = 'optional' }
        Write-Host ('  [ ] ' + $s.n.PadRight(22) + $r.detail + "  ($tag)") -ForegroundColor DarkYellow
        if ($null -eq $next) { $next = $s }
    }
}

if ($null -eq $next) {
    Write-Host ''
    Write-Host '  Everything is done. Tell Claude to deploy.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

if (-not $All) {
    Write-Host ''
    Write-Host ('  NEXT STEP:  ' + $next.n) -ForegroundColor Cyan
    Write-Host '  ------------------------------------------' -ForegroundColor Cyan
    if ($next.act) { & $next.act } else { Write-Host '  Ask Claude, this one needs a key pasted via setup.ps1.' -ForegroundColor Yellow }
}
Write-Host ''
