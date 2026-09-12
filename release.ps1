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
#   pwsh -File release.ps1 -Keep 3          # zostaw trzy najnowsze wydania, reszte skasuj
#   pwsh -File release.ps1 -Keep 0          # nie kasuj niczego
param(
  [string]$Version,
  [switch]$DryRun,
  [switch]$SkipBuild,
  [switch]$Yes,         # nie pytaj o potwierdzenie przed publikacja
  [int]$Keep = 1        # ile wydan Patchera ma zostac PO publikacji (0 = nie sprzataj)
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pkgFile = Join-Path $root 'package.json'

function Fail($msg) { Write-Host "BLAD: $msg" -ForegroundColor Red; exit 1 }
function Head($msg) { Write-Host ""; Write-Host $msg -ForegroundColor Cyan }

# Porownanie numerow po segmentach, a nie jako napisow: "0.10.0" jest wyzsze niz "0.9.0",
# choc alfabetycznie wypada odwrotnie.
#
# Nazwy $segA/$segB, a nie $A/$B: w PowerShellu nazwy zmiennych nie rozrozniaja wielkosci
# liter, wiec $A JEST parametrem $a. Tablica wpisana do parametru [string] wraca do niego
# jako napis "3 1 0" i petla porownuje wtedy pojedyncze ZNAKI, nie segmenty - "3.1.1" i
# "3.1.0" wygladaja identycznie na trzech pierwszych znakach.
function VerGt([string]$a, [string]$b) {
  $segA = $a.Split('.'); $segB = $b.Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    $x = [int]$segA[$i]; $y = [int]$segB[$i]
    if ($x -ne $y) { return $x -gt $y }
  }
  return $false
}

# Wydania PATCHERA, od najnowszego. Filtr `v<x.y.z>` jest istotny, a nie kosmetyczny:
# to jedyne, co odroznia wydanie aplikacji od wydania MODA albo PRESETU (tagi
# `<mod>-<x.y.z>`, `preset-<x.y.z>`). Gdyby kiedys w tym repozytorium stanelo jedno
# obok drugiego, sprzatanie po wydaniu aplikacji NIE MOZE ruszyc katalogu, z ktorego
# Patcher czyta mody - skasowanie takiego wydania zabiera odbiorcom plik do pobrania.
function PatcherReleases() {
  $json = & gh release list --limit 100 --json tagName 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return @() }
  return @($json | ConvertFrom-Json |
    Where-Object { $_.tagName -match '^v\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.tagName.TrimStart('v') } -Descending |
    ForEach-Object { $_.tagName })
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
# ZIP jest OBOWIAZKOWYM drugim zalacznikiem, nie dodatkiem dla wygody: Smart App Control
# w Windows 11 blokuje pojedynczy .exe (stub portable nie ma reputacji i nie da sie go
# odblokowac - SAC nie ma listy wyjatkow), a te sama aplikacje rozpakowana z ZIP-a
# przepuszcza. Szczegoly i pomiary: docs/PATCHER.md.
$zipPath = Join-Path $root ("dist\TFG-Patcher-{0}.zip" -f $Version)

# Co zniknie po publikacji. Liczymy PO doliczeniu nowego wydania, wiec -Keep 1 znaczy
# "ma zostac samo nowe". Lista powstaje TERAZ, zeby bylo ja widac przed pytaniem
# "Wydac?" - kasowanie wydania na GitHubie jest nieodwracalne.
$toDelete = @()
if ($Keep -gt 0) {
  $existing = PatcherReleases
  if ($existing.Count -ge $Keep) { $toDelete = @($existing | Select-Object -Skip ($Keep - 1)) }
}

Head 'Plan wydania'
Write-Host ("  wersja:  {0} -> {1}" -f $current, $Version)
Write-Host ("  tag:     {0}" -f $tag)
Write-Host ("  pliki:   {0}" -f $exePath)
Write-Host ("           {0}" -f $zipPath)
if ($Keep -le 0) {
  Write-Host "  sprzatanie: wylaczone (-Keep 0)" -ForegroundColor DarkGray
} elseif ($toDelete) {
  Write-Host ("  skasuje starsze wydania ({0}), zostanie {1}:" -f $toDelete.Count, $Keep) -ForegroundColor Yellow
  $toDelete | ForEach-Object { Write-Host ("    $_") -ForegroundColor Yellow }
  Write-Host "    (tagi i commity zostaja - znika wydanie razem z plikami do pobrania)" -ForegroundColor DarkGray
} else {
  Write-Host ("  sprzatanie: nie ma czego kasowac (zostawiamy {0} najnowszych)" -f $Keep) -ForegroundColor DarkGray
}

# Proba konczy sie tutaj: nie ruszamy package.json, zeby nie zostawic repo w polowie
# wydania. Sam build sprawdza sie osobno przez build.ps1.
if ($DryRun) {
  Head 'PROBA - to sie NIE wykonalo'
  Write-Host "  package.json: $current -> $Version"
  Write-Host "  pwsh -File build.ps1"
  Write-Host "  git commit -am `"TFG Patcher $Version`" ; git push"
  Write-Host "  gh release create $tag `"$exePath`" `"$zipPath`" --title `"TFG Patcher $Version`" --generate-notes"
  $toDelete | ForEach-Object { Write-Host "  gh release delete $_ --yes" }
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
  foreach ($f in @($exePath, $zipPath)) {
    if (-not (Test-Path $f)) { Fail "brak $f, a podano -SkipBuild" }
  }
  Write-Host "  build pominiety (-SkipBuild)"
} else {
  Head 'Budowanie'
  & (Join-Path $root 'build.ps1')
  if ($LASTEXITCODE -ne 0) { Fail "build.ps1 zwrocil $LASTEXITCODE" }
}
# Brak ZIP-a przerywa wydanie tak samo jak brak .exe: wydanie z samym .exe jest dla
# czesci odbiorcow wydaniem, ktorego nie da sie uruchomic.
foreach ($f in @($exePath, $zipPath)) {
  if (-not (Test-Path $f)) { Fail "build nie zostawil pliku $f" }
}
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

& gh release create $tag $exePath $zipPath --title "TFG Patcher $Version" --generate-notes
if ($LASTEXITCODE -ne 0) { Fail "gh release create zwrocil $LASTEXITCODE" }

# --- 7. sprzatanie -------------------------------------------------------------
# Dopiero PO udanej publikacji: gdyby cokolwiek wyzej padlo, stare wydanie zostaje
# jedynym, ktore odbiorcy moga pobrac. Kasujemy wydanie, NIE tag: tag za darmo
# pokazuje, ktory commit byl ktora wersja, a samo wydanie i tak da sie odtworzyc
# z niego buildem.
if ($toDelete) {
  Head 'Sprzatanie starszych wydan'
  foreach ($old in $toDelete) {
    & gh release delete $old --yes
    if ($LASTEXITCODE -ne 0) {
      # Nie przerywamy: nowe wydanie juz jest, a stare mozna skasowac recznie.
      Write-Host ("  UWAGA: nie udalo sie skasowac {0}" -f $old) -ForegroundColor Yellow
    } else {
      Write-Host ("  skasowane: {0}" -f $old)
    }
  }
}

Write-Host ""
Write-Host ("Wydane: {0} ({1} MB)" -f $tag, $mb) -ForegroundColor Green
& gh release view $tag --json url --jq .url
