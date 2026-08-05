# Wydanie TFG Patchera na GitHuba.
#
# Pokazuje, jakie wydanie jest teraz najnowsze, pyta o numer nowego (sprawdzajac,
# co wpisales), podbija wersje w package.json, buduje .exe i publikuje go.
#
# Uzycie:
#   pwsh -File release.ps1                  # interaktywnie - tak sie tego uzywa
#   pwsh -File release.ps1 -Version 3.1.1   # bez pytania (np. z innego skryptu)
#   pwsh -File release.ps1 -DryRun          # wszystko oprocz commita i publikacji
#   pwsh -File release.ps1 -SkipBuild       # gdy .exe o tej wersji juz lezy w dist/
param(
  [string]$Version,
  [switch]$DryRun,
  [switch]$SkipBuild,
  [switch]$Yes          # nie pytaj o potwierdzenie przed publikacja
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pkgFile = Join-Path $root 'package.json'

function Fail($msg) { Write-Host "BLAD: $msg" -ForegroundColor Red; exit 1 }
function Head($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }

# Porownanie numerow po segmentach, a nie jako napisow: "0.10.0" jest wyzsze niz "0.9.0",
# choc alfabetycznie wypada odwrotnie.
function VerGt([string]$a, [string]$b) {
  $A = $a.Split('.'); $B = $b.Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    $x = [int]$A[$i]; $y = [int]$B[$i]
    if ($x -ne $y) { return $x -gt $y }
  }
  return $false
}

# --- 1. narzedzia --------------------------------------------------------------
foreach ($exe in @('node', 'npm', 'git', 'gh')) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { Fail "brak $exe w PATH" }
}
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail 'gh nie jest zalogowany - uruchom: gh auth login' }

# --- 2. co jest teraz ----------------------------------------------------------
$current = (Get-Content $pkgFile -Raw | ConvertFrom-Json).version
$latestVer = $null
$latestTag = '(brak wydan)'

$json = & gh release view --json tagName,publishedAt,url 2>$null
if ($LASTEXITCODE -eq 0 -and $json) {
  $rel = $json | ConvertFrom-Json
  $latestTag = $rel.tagName
  if ($latestTag -match '(\d+\.\d+\.\d+)') { $latestVer = $Matches[1] }
}

Head 'Stan repozytorium'
Write-Host ("  package.json:      {0}" -f $current)
Write-Host ("  ostatnie wydanie:  {0}{1}" -f $latestTag,
  $(if ($rel.publishedAt) { "  ($([datetime]$rel.publishedAt | Get-Date -Format 'yyyy-MM-dd'))" } else { '' }))
if ($rel.url) { Write-Host ("                     {0}" -f $rel.url) -ForegroundColor DarkGray }

$older = & gh release list --limit 5 2>$null
if ($LASTEXITCODE -eq 0 -and $older) {
  Write-Host "  wczesniejsze:" -ForegroundColor DarkGray
  $older -split "`n" | Select-Object -Skip 1 | Where-Object { $_ } |
    ForEach-Object { Write-Host ("    " + ($_ -split "`t")[0]) -ForegroundColor DarkGray }
}

$dirty = & git status --porcelain
if ($dirty) {
  Write-Host ""
  Write-Host "  UWAGA: w drzewie sa niezacommitowane zmiany:" -ForegroundColor Yellow
  $dirty -split "`n" | Select-Object -First 8 | ForEach-Object { Write-Host ("    " + $_) -ForegroundColor Yellow }
}

# --- 3. numer nowego wydania ---------------------------------------------------

# Co wpisany numer dyskwalifikuje. Null = numer jest dobry.
function VersionProblem([string]$v) {
  if ($v -notmatch '^\d+\.\d+\.\d+$') { return 'numer ma miec postac x.y.z, np. 3.1.1' }
  if (VerGt $current $v) { return "package.json ma juz $current - podaj numer nie nizszy" }
  if ($latestVer -and -not (VerGt $v $latestVer)) { return "wydanie $latestTag juz istnieje - podaj wyzszy numer" }
  & gh release view "v$v" *> $null
  if ($LASTEXITCODE -eq 0) { return "wydanie v$v juz istnieje na GitHubie" }
  return $null
}

if ($Version) {
  $Version = $Version.Trim().TrimStart('v')   # "v3.1.1" i "3.1.1" znacza to samo
  $problem = VersionProblem $Version
  if ($problem) { Fail $problem }
} else {
  # propozycja: kolejna latka po tym, co wyzsze - wydanie albo package.json
  $base = if ($latestVer -and (VerGt $latestVer $current)) { $latestVer } else { $current }
  $p = $base.Split('.')
  $suggest = if ($latestVer -and -not (VerGt $current $latestVer)) {
    "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
  } else { $current }

  Head 'Nowe wydanie'
  while (-not $Version) {
    $answer = Read-Host "  Numer nowej wersji (x.y.z), Enter = $suggest"
    if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $suggest }
    $answer = $answer.Trim().TrimStart('v')
    $problem = VersionProblem $answer
    if ($problem) { Write-Host "  $problem" -ForegroundColor Yellow; continue }
    $Version = $answer
  }
}

$tag = "v$Version"
$exePath = Join-Path $root ("dist\TFG-Patcher-{0}.exe" -f $Version)

Head 'Plan wydania'
Write-Host ("  wersja:  {0} -> {1}" -f $current, $Version)
Write-Host ("  tag:     {0}" -f $tag)
Write-Host ("  plik:    {0}" -f $exePath)

# Proba konczy sie tutaj: nie ruszamy package.json, zeby nie zostawic repo w polowie
# wydania. Sam build sprawdza sie osobno przez build.ps1.
if ($DryRun) {
  Head 'PROBA - to sie NIE wykonalo'
  Write-Host "  package.json: $current -> $Version"
  Write-Host "  pwsh -File build.ps1"
  Write-Host "  git commit -am `"TFG Patcher $Version`" ; git push"
  Write-Host "  gh release create $tag `"$exePath`" --title `"TFG Patcher $Version`" --generate-notes"
  exit 0
}

if (-not $Yes) {
  $go = Read-Host "  Wydac? [t/N]"
  if ($go -notmatch '^[tTyY]') { Write-Host 'Przerwane.'; exit 0 }
}

# --- 4. wersja w package.json --------------------------------------------------
if ($current -ne $Version) {
  # Podmiana samego numeru, a nie przepisanie pliku przez ConvertTo-Json:
  # to zachowuje formatowanie i kolejnosc kluczy.
  $raw = Get-Content $pkgFile -Raw
  $new = [regex]::Replace($raw, '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
  if ($new -eq $raw) { Fail 'nie znalazlem pola "version" w package.json' }
  Set-Content -Path $pkgFile -Value $new -NoNewline -Encoding utf8
  Write-Host "  package.json: $current -> $Version"
}

# --- 5. build ------------------------------------------------------------------
if ($SkipBuild) {
  if (-not (Test-Path $exePath)) { Fail "brak $exePath, a podano -SkipBuild" }
  Write-Host "  build pominiety (-SkipBuild)"
} else {
  Head 'Budowanie'
  & (Join-Path $root 'build.ps1')
  if ($LASTEXITCODE -ne 0) { Fail "build.ps1 zwrocil $LASTEXITCODE" }
}
if (-not (Test-Path $exePath)) { Fail "build nie zostawil pliku $exePath" }
$mb = [math]::Round((Get-Item $exePath).Length / 1MB, 1)

# --- 6. publikacja -------------------------------------------------------------
Head 'Publikacja'
if (& git status --porcelain) {
  & git add -A
  & git commit -m "TFG Patcher $Version"
  if ($LASTEXITCODE -ne 0) { Fail "git commit zwrocil $LASTEXITCODE" }
}
& git push
if ($LASTEXITCODE -ne 0) { Fail "git push zwrocil $LASTEXITCODE" }

& gh release create $tag $exePath --title "TFG Patcher $Version" --generate-notes
if ($LASTEXITCODE -ne 0) { Fail "gh release create zwrocil $LASTEXITCODE" }

Write-Host ""
Write-Host ("Wydane: {0} ({1} MB)" -f $tag, $mb) -ForegroundColor Green
& gh release view $tag --json url --jq .url
