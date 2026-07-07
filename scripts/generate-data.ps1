param(
  [string]$CsvPath = "C:\Users\FADLHA SULTHAN\Downloads\Telegram Desktop\cleaned_data(1).csv",
  [string]$OutPath = "$PSScriptRoot\..\src\data.js"
)

$ErrorActionPreference = 'Stop'
$DASHBOARD = 'Dashboard'
$MONTH_ORDER = @('January','February','March','April','May','June','July','August','September','October','November','December')
$MONTH_IDX = @{}
for ($i = 0; $i -lt $MONTH_ORDER.Count; $i++) { $MONTH_IDX[$MONTH_ORDER[$i]] = $i }

$SM_TAGS = [System.Collections.Generic.HashSet[string]]::new([string[]]@(
  'S&M - Others','S&M - Online','S&M - Payment Channel','S&M - O2O','S&M - Offline',
  'S&M - Distribution Cost','S&M - PCV','Total S&M'
))
$GA_TAGS = [System.Collections.Generic.HashSet[string]]::new([string[]]@(
  'G&A - Depreciation','G&A - IT Cost','G&A - Other Staff Cost','G&A - Other staff cost',
  'G&A - Facility Management and Travelling','G&A - Consultancy Cost','G&A - Consultancy cost',
  'G&A - Corporate Action (Adj. Total)','GXA - Staff Cost (N/A)','G&A - Staff Cost',
  'Total G&A (Include Depre + Others)'
))
$TAG_NORM = @{
  'G&A - Other staff cost' = 'G&A - Other Staff Cost'
  'G&A - Consultancy cost' = 'G&A - Consultancy Cost'
}
$TAG_PRIORITY = @{ Actual = 4; 'Run-rate' = 3; Forecast = 2; Budget = 1 }

function Parse-CsvLine([string]$line) {
  $cols = New-Object System.Collections.Generic.List[string]
  $cur = ''
  $inQuote = $false
  foreach ($ch in $line.ToCharArray()) {
    if ($ch -eq '"') { $inQuote = -not $inQuote; continue }
    if ($ch -eq ',' -and -not $inQuote) { $cols.Add($cur.Trim()); $cur = ''; continue }
    $cur += $ch
  }
  $cols.Add($cur.Trim())
  return ,$cols
}

function Norm-Subcat([string]$subcat) {
  if ($TAG_NORM.ContainsKey($subcat)) { return $TAG_NORM[$subcat] }
  return $subcat
}

$allRows = New-Object System.Collections.Generic.List[object]
$reader = [System.IO.File]::OpenText($CsvPath)
$null = $reader.ReadLine()
while ($null -ne ($line = $reader.ReadLine())) {
  $line = $line.Trim()
  if (-not $line) { continue }
  $cols = Parse-CsvLine $line
  if ($cols.Count -lt 8) { continue }
  $year = $cols[0].Trim()
  if ($year -notmatch '^\d{4}$') { continue }
  $month = $cols[1].Trim()
  $segment = $cols[2].Trim()
  $subSegment = $cols[3].Trim()
  $subcat = $cols[5].Trim()
  $tag = $cols[6].Trim()
  $amtStr = $cols[7].Trim()
  if (-not $month -or -not $subcat -or -not $amtStr) { continue }
  $amount = 0.0
  if (-not [double]::TryParse($amtStr, [ref]$amount)) { continue }
  $allRows.Add([pscustomobject]@{
    year = [int]$year; month = $month; segment = $segment; subSegment = $subSegment
    subcat = $subcat; tag = $tag; amount = $amount
  })
}
$reader.Close()

$dashboardRows = $allRows | Where-Object { $_.subSegment -eq $DASHBOARD }
$best = @{}
foreach ($r in $dashboardRows) {
  $norm = Norm-Subcat $r.subcat
  $key = "$($r.year)|$($r.month)|$($r.segment)|$norm"
  $prio = if ($TAG_PRIORITY.ContainsKey($r.tag)) { $TAG_PRIORITY[$r.tag] } else { 0 }
  if (-not $best.ContainsKey($key) -or $prio -gt $best[$key].priority) {
    $best[$key] = @{ row = $r; priority = $prio; subcat = $norm }
  }
}
$rows = foreach ($k in $best.Keys) {
  $item = $best[$k]
  [pscustomobject]@{
    year = $item.row.year; month = $item.row.month; segment = $item.row.segment
    subSegment = $item.row.subSegment; subcat = $item.subcat; tag = $item.row.tag; amount = $item.row.amount
  }
}

Write-Host "Parsed $($allRows.Count) rows; using $($rows.Count) Dashboard rows (best tag per metric)"

$ebitdaMap = @{}
$adjMap = @{}
foreach ($r in $rows) {
  $key = "$($r.year)-$($r.month)-$($r.segment)"
  if ($r.subcat -eq 'EBITDA') {
    if (-not $ebitdaMap.ContainsKey($key)) { $ebitdaMap[$key] = 0.0 }
    $ebitdaMap[$key] += $r.amount
  } elseif ($r.subcat -eq 'Total Adjustment (Total)') {
    if (-not $adjMap.ContainsKey($key)) { $adjMap[$key] = 0.0 }
    $adjMap[$key] += $r.amount
  }
}
$adjEbitdaBySegMonth = @{}
foreach ($key in ($ebitdaMap.Keys + $adjMap.Keys | Select-Object -Unique)) {
  $e = if ($ebitdaMap.ContainsKey($key)) { $ebitdaMap[$key] } else { 0.0 }
  $a = if ($adjMap.ContainsKey($key)) { $adjMap[$key] } else { 0.0 }
  $adjEbitdaBySegMonth[$key] = $e - $a
}

$monthlyMap = @{}
foreach ($r in $rows) {
  if (-not $r.month) { continue }
  $key = "$($r.year)-$($r.month)"
  if (-not $monthlyMap.ContainsKey($key)) {
    $monthlyMap[$key] = @{ year = $r.year; month = $r.month; Revenue = 0.0; COGS = 0.0; GP = 0.0; SM = 0.0; GA = 0.0 }
  }
  $d = $monthlyMap[$key]
  switch ($r.subcat) {
    'Revenue' { $d.Revenue += $r.amount }
    'COGS' { $d.COGS += $r.amount }
    'GP' { $d.GP += $r.amount }
    default {
      if ($SM_TAGS.Contains($r.subcat)) { $d.SM += $r.amount }
      elseif ($GA_TAGS.Contains($r.subcat)) { $d.GA += $r.amount }
    }
  }
}

$monthly = @(
  foreach ($d in $monthlyMap.Values) {
    $gp = if ($d.GP -ne 0) { $d.GP } else { $d.Revenue + $d.COGS }
    $cogs = if ($d.COGS -ne 0) { $d.COGS } else { $gp - $d.Revenue }
    $mn = $MONTH_IDX[$d.month] + 1
    $prefix = "$($d.year)-$($d.month)-"
    $adjEbitda = ($adjEbitdaBySegMonth.GetEnumerator() | Where-Object { $_.Key.StartsWith($prefix) } | Measure-Object -Property Value -Sum).Sum
    if ($null -eq $adjEbitda) { $adjEbitda = 0 }
    [pscustomobject]@{
      year = $d.year; month = $d.month; monthNum = $mn; quarter = [math]::Ceiling($mn / 3)
      date = ('{0}-{1}-01' -f $d.year, $mn.ToString('00'))
      Revenue = [long][math]::Round($d.Revenue)
      COGS = [long][math]::Round($cogs)
      GP = [long][math]::Round($gp)
      SM = [long][math]::Round($d.SM)
      GA = [long][math]::Round($d.GA)
      EBITDA = [long][math]::Round($adjEbitda)
    }
  }
) | Sort-Object year, { $MONTH_IDX[$_.month] }

$segMonthMap = @{}
foreach ($r in $rows) {
  if (-not $r.month -or -not $r.segment) { continue }
  $key = "$($r.year)-$($r.month)-$($r.segment)"
  if (-not $segMonthMap.ContainsKey($key)) {
    $segMonthMap[$key] = @{ year = $r.year; month = $r.month; segment = $r.segment; Revenue = 0.0; COGS = 0.0 }
  }
  if ($r.subcat -eq 'Revenue') { $segMonthMap[$key].Revenue += $r.amount }
  elseif ($r.subcat -eq 'COGS') { $segMonthMap[$key].COGS += $r.amount }
}
$segmentMonthly = @(
  foreach ($d in $segMonthMap.Values) {
    [pscustomobject]@{
      year = $d.year; month = $d.month; segment = $d.segment
      Revenue = [long][math]::Round($d.Revenue)
      COGS = [long][math]::Round($d.COGS)
      GP = [long][math]::Round($d.Revenue + $d.COGS)
    }
  }
)

$opexMap = @{}
foreach ($r in $rows) {
  if (-not $r.month) { continue }
  if (-not $SM_TAGS.Contains($r.subcat) -and -not $GA_TAGS.Contains($r.subcat)) { continue }
  if (-not $opexMap.ContainsKey($r.subcat)) { $opexMap[$r.subcat] = @{} }
  $mk = "$($r.year)-$($r.month)"
  if (-not $opexMap[$r.subcat].ContainsKey($mk)) { $opexMap[$r.subcat][$mk] = 0.0 }
  $opexMap[$r.subcat][$mk] += $r.amount
}
$opexCategories = @(
  foreach ($label in $opexMap.Keys) {
    $monthlyData = $opexMap[$label]
    $total = ($monthlyData.Values | Measure-Object -Sum).Sum
    [pscustomobject]@{
      label = $label
      total = [long][math]::Round($total)
      monthly = $monthlyData
    }
  }
) | Where-Object { $_.total -ne 0 } | Sort-Object { [math]::Abs($_.total) } -Descending

$segTotalsMap = @{}
foreach ($r in $rows) {
  if (-not $r.segment -or -not $r.month) { continue }
  if ($r.subcat -ne 'Revenue') { continue }
  if (-not $segTotalsMap.ContainsKey($r.segment)) { $segTotalsMap[$r.segment] = 0.0 }
  $segTotalsMap[$r.segment] += $r.amount
}
$segmentTotals = @(
  foreach ($seg in $segTotalsMap.Keys) {
    [pscustomobject]@{ Segment = $seg; Amount = [long][math]::Round($segTotalsMap[$seg]) }
  }
) | Sort-Object Amount -Descending

$kpis = [pscustomobject]@{
  revenue = ($monthly | Measure-Object Revenue -Sum).Sum
  cogs = ($monthly | Measure-Object COGS -Sum).Sum
  grossMargin = ($monthly | Measure-Object GP -Sum).Sum
  sm = ($monthly | Measure-Object SM -Sum).Sum
  ga = ($monthly | Measure-Object GA -Sum).Sum
  ebitda = ($monthly | Measure-Object EBITDA -Sum).Sum
}

function To-Json($obj, $depth = 20) {
  return ($obj | ConvertTo-Json -Depth $depth -Compress:$false)
}

$csvName = [System.IO.Path]::GetFileName($CsvPath)
$header = @"
// AUTO-GENERATED - do not edit manually
// Source: $csvName
// Filter: Sub-Segment = "$DASHBOARD"
// ADJ EBITDA = EBITDA - Total Adjustment (Total) per Year/Month/Segment
// Tag priority: Actual > Run-rate > Forecast > Budget
// Run node scripts/process-data.js or scripts/generate-data.ps1 to regenerate

"@

$content = $header +
"export const MONTHLY = " + (To-Json $monthly) + ";" + [Environment]::NewLine + [Environment]::NewLine +
"export const SEGMENT_MONTHLY = " + (To-Json $segmentMonthly) + ";" + [Environment]::NewLine + [Environment]::NewLine +
"export const SEGMENT_TOTALS = " + (To-Json $segmentTotals) + ";" + [Environment]::NewLine + [Environment]::NewLine +
"export const OPEX_CATEGORIES = " + (To-Json $opexCategories) + ";" + [Environment]::NewLine + [Environment]::NewLine +
"export const KPIS = " + (To-Json $kpis) + ";" + [Environment]::NewLine

[System.IO.File]::WriteAllText($OutPath, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $OutPath"
Write-Host ("Revenue: Rp {0:N0}" -f $kpis.revenue)
Write-Host ("ADJ EBITDA: Rp {0:N0}" -f $kpis.ebitda)
Write-Host ("Months: {0}" -f $monthly.Count)
