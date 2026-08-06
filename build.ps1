# Budowa TFG Patchera -> dist/TFG-Patcher-<wersja>.exe
#
# Wynik to POJEDYNCZY, przenosny .exe - nie wymaga Javy ani niczego doinstalowanego.
#
# W przeciwienstwie do wersji 2.x nic nie jest sklejane z zywej instancji gry:
#  - mody pobiera sam Patcher z wydan wymienionych w sources.json,
#  - do exe wchodzi TYLKO sources.json (lista repozytoriow). Configi, shaderpack i mody
#    pobierane sa z wydan - aplikacja nie nosi w sobie zadnych zasobow.
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

# --- 1. zaleznosci -------------------------------------------------------------
Push-Location $root
try {
  if (-not $SkipInstall -or -not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host "npm install (Electron ~100 MB przy pierwszym razie)..."
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install zwrocil $LASTEXITCODE" }
  }

  # --- 2. ikona ---------------------------------------------------------------
  # Przegenerowana przy KAZDEJ budowie, choc build/icon.ico jest w repozytorium. Wynik
  # jest deterministyczny, wiec nic to nie brudzi, a poprawka w siatce ART nie ma jak
  # zostac w tyle za wydanym .exe.
  Write-Host "Generuje ikone..."
  node (Join-Path $root 'build/make-icon.js')
  if ($LASTEXITCODE -ne 0) { throw "make-icon.js zwrocil $LASTEXITCODE" }

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
