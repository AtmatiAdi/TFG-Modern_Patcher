# Budowa TFG Patchera -> dist/TFG-Patcher-<wersja>.exe
#
# Wynik to POJEDYNCZY, przenosny .exe - nie wymaga Javy ani niczego doinstalowanego.
#
# W przeciwienstwie do wersji 2.x nic nie jest sklejane z zywej instancji gry:
#  - mody pobiera sam Patcher z wydan wymienionych w sources.json,
#  - do exe wchodzi tylko assets/ (shaderpack + jego ustawienia) i sources.json.
#
# Uzycie:  pwsh -File build.ps1  [-SkipInstall] [-DirOnly]
param(
  [switch]$SkipInstall,   # pomija npm install (gdy node_modules juz jest)
  [switch]$DirOnly        # tylko rozpakowana aplikacja, bez pakowania do .exe
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

foreach ($exe in @('node', 'npm')) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { throw "Brak $exe w PATH - zainstaluj Node.js" }
}

# --- 1. sanity zasobow ---------------------------------------------------------
$sources = Join-Path $root 'sources.json'
if (-not (Test-Path $sources)) { throw "Brak sources.json - bez niego Patcher nie wie, skad brac mody" }
try { Get-Content $sources -Raw | ConvertFrom-Json | Out-Null } catch { throw "sources.json nie jest poprawnym JSON-em: $_" }

$shaderDir = Join-Path $root 'assets\shaderpacks'
$packZip = Get-ChildItem $shaderDir -Filter '*.zip' -ErrorAction SilentlyContinue |
           Sort-Object Name | Select-Object -Last 1
if ($packZip) {
  $packTxt = Join-Path $shaderDir ($packZip.Name + '.txt')
  if (-not (Test-Path $packTxt)) { throw "Brak ustawien shaderow: $packTxt" }
  Write-Host ("shaderpack: {0} ({1} MB)" -f $packZip.Name, [math]::Round($packZip.Length/1MB,1))
} else {
  Write-Host "UWAGA: brak shaderpacka w assets/shaderpacks - pozycje shaderowe zostana pominiete"
}

# --- 2. zaleznosci -------------------------------------------------------------
Push-Location $root
try {
  if (-not $SkipInstall -or -not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "npm install (Electron ~100 MB przy pierwszym razie)..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install zwrocil $LASTEXITCODE" }
  }

  # --- 3. build ---------------------------------------------------------------
  if ($DirOnly) {
    Write-Host "Pakuje (tylko katalog)..."
    npx electron-builder --win dir --publish never
  } else {
    Write-Host "Pakuje do .exe..."
    npx electron-builder --win portable --publish never
  }
  if ($LASTEXITCODE -ne 0) { throw "electron-builder zwrocil $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host ""
Get-ChildItem (Join-Path $root 'dist') -Filter '*.exe' -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("Zbudowano: {0} ({1} MB)" -f $_.FullName, [math]::Round($_.Length/1MB,1)) }
