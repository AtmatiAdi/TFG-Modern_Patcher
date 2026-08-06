# TFG Patcher

Aplikacja, która nakłada na **wskazaną instancję gry albo serwer** stan pobrany z wydań
GitHuba: configi modów, ustawienia gry, argumenty JVM Prisma, shaderpack, narzędzia i mody.
Sama nie zna żadnej optymalizacji ani żadnego moda — czyta, co niosą repozytoria.

Pojedynczy przenośny `.exe` — nie wymaga Javy ani niczego doinstalowanego.

---

## Dla użytkownika

1. Uruchom `TFG-Patcher-<wersja>.exe`.
2. Wybierz instancję z listy (Prism Launcher wykrywany jest sam) albo wskaż katalog —
   gry, instancji lub serwera. Aplikacja rozpozna, co to jest.
3. Wybierz profil maszyny.
4. **Plan pokazuje się sam** i odświeża po każdej zmianie: każda pozycja osobno, ze stanem
   *zrobione / do zmiany / brak celu* wypisanym **na początku wiersza**. Zaznaczone jest to,
   co faktycznie jest do zrobienia. Wszystkie pozycje są **zwinięte do samego tytułu** —
   klik w nagłówek rozwija pojedynczą, przycisk **Rozwiń wszystko** pokazuje całość.
   Licznik u góry mówi, **ile zostanie zmienione po kliknięciu**, więc idzie za polami
   wyboru: odznaczenie czegoś zmienia go od razu (*„3 z 11 do zmiany"*).
5. **Zastosuj zaznaczone.**

| Profil | Dla kogo |
|---|---|
| **Standard** | domyślny — sprawdzony na 16 GB RAM |
| **High** | maszyna z zapasem RAM |
| **Serwer** | wykrywany sam; tylko zmiany serwerowe |

Profile i ich wartości (`renderDistance`, `MaxMemAlloc`) przychodzą **z presetu**, nie
z aplikacji — gałki po lewej pokazują to, co niesie profil, i wolno je nadpisać ręcznie.

**Nic nie dzieje się bez kliknięcia**, a każda zmiana jest odwracalna: kopie plików lądują
w `.tfg-patcher/backup-<data>/` w katalogu instancji, a przycisk **Cofnij ostatnie**
przywraca stan sprzed ostatniego uruchomienia.

Przycisk **Sprawdź źródła** pobiera najnowsze wydania modów i presetu. Bez internetu
aplikacja działa na tym, co już ściągnęła.

### Serwery i Linux

```bash
node src/cli.js -i /sciezka/do/serwera            # sam plan
node src/cli.js -i /sciezka/do/serwera --apply
node src/cli.js -i /sciezka/do/serwera --revert
```

> Jeśli wyłączasz Xaero na kliencie, **wyłącz je też na serwerze**. Xaero nie ustawia
> `displayTest`, więc serwer z Xaero odrzuci klienta, który go nie ma.

---

## Budowa i wydanie

```powershell
pwsh -File build.ps1        # zbuduj -> dist/TFG-Patcher-<wersja>.exe
pwsh -File release.ps1      # pokaz ostatnie wydanie, zapytaj o numer, zbuduj i wydaj
```

`release.ps1` prowadzi za rękę i **nic nie robi po cichu**:

```
Stan repozytorium
  package.json:      3.1.0
  ostatnie wydanie:  v3.1.0  (2026-08-05)
                     https://github.com/AtmatiAdi/TFG-Modern_Patcher/releases/tag/v3.1.0

Nowe wydanie
  Numer nowej wersji (x.y.z), Enter = 3.1.1: 3.1
  numer ma miec postac x.y.z, np. 3.1.1
  Numer nowej wersji (x.y.z), Enter = 3.1.1: 3.0.9
  package.json ma juz 3.1.0 - podaj numer nie nizszy
  Numer nowej wersji (x.y.z), Enter = 3.1.1: <Enter>

Plan wydania
  wersja:  3.1.0 -> 3.1.1
  tag:     v3.1.1
  plik:    ...\dist\TFG-Patcher-3.1.1.exe
  Wydac? [t/N]
```

Pyta dopóki numer nie przejdzie kontroli: musi mieć postać `x.y.z`, nie być niższy niż
`package.json` i **nie kolidować z istniejącym wydaniem** (porównanie po segmentach, więc
`0.10.0` jest wyżej niż `0.9.0`). Potem podbija wersję w `package.json`, buduje `.exe`,
commituje, wypycha i publikuje wydanie z tym plikiem (`gh release create`, opis
generowany z commitów).

| Przełącznik | Do czego |
|---|---|
| `-Version 3.1.1` | bez pytania — do skryptów |
| `-DryRun` | tylko sprawdzenie i wypisanie, co by się stało; nie rusza `package.json` |
| `-SkipBuild` | gdy `.exe` o tej wersji już leży w `dist/` |
| `-Yes` | bez pytania „Wydać?" |

Wymaga `gh` zalogowanego przez `gh auth login`.

---

## Dla rozwijających

```powershell
npm start                   # okno bez pakowania
node src\cli.js --list      # co aplikacja wprowadza, grupami
node src\cli.js --refresh   # samo pobranie wydan do cache
npm run icon                # przerysowanie ikony z siatki w build/make-icon.js
```

Ikona — pixelowy blok lapis lazuli — jest **kodem, nie wrzuconą binarką**: siatka 16×16
na początku `build/make-icon.js`, reszta to składanie `.ico` na wbudowanym `zlib`.
`build.ps1` generuje ją przy każdej budowie, więc nie ma jak zostać w tyle.

| Dokument | O czym |
|---|---|
| **`docs/CONTEXT.md`** | **zacznij tutaj** — po co to jest, konwencje, czego nie ruszać |
| `docs/PATCHER.md` | architektura, struktura kodu, pułapki |
| `docs/RELEASES.md` | jak wydawać mody i preset, żeby Patcher je zobaczył |
| **`docs/DLA-WSPOLPRACOWNIKOW.md`** | **do wysłania osobie z zewnątrz** — samodzielny opis: jak udostępniać swoje mody i configi, czego Patcher szuka, jak sprawdzić, że działa |

Uzasadnienia optymalizacji i pomiary RAM **nie leżą w tym repo** — są tam, gdzie
powstają, czyli w `TFG-Modern_atmatiadi_configs` (`docs/OPTIMIZATIONS-SPEC.md`,
`docs/ram/`, `docs/PRESET-FORMAT.md`).

Dodanie **moda** = wydanie jara z tagiem `<mod>-<x.y.z>`. Dodanie **optymalizacji** =
wydanie nowego `preset-*.json`. Jedno i drugie bez zmian w kodzie i bez nowego `.exe`.

---

## Skąd się biorą mody i configi

Patcher **nie zna żadnego moda ani żadnej optymalizacji**. Zna repozytoria — `sources.json`
wymienia same adresy:

```json
{
  "repos": [
    { "repo": "AtmatiAdi/TFG-Modern_atmatiadi_mods" },
    { "repo": "AtmatiAdi/TFG-Modern_atmatiadi_configs" },
    { "repo": "Scepeczki/TFG-Modern_scepeczki_mods" }
  ]
}
```

**Jedna lista — repozytorium nie ma rodzaju.** Każde jest sprawdzane pod obie konwencje,
więc jeden autor może w jednym repo wydawać mody, configi i pliki gry naraz:

**Mody** rozpoznaje po tagach wydań (`<mod>-<x.y.z>`, np. `mapatlas-0.4.0`): grupuje po
nazwie moda i bierze najwyższą wersję każdego. Wydanie jara wystarczy — nowy mod pojawia
się w planie u wszystkich, bez nowej wersji aplikacji.

**Configi** czyta z załącznika `preset-*.json` w najnowszym wydaniu danego repozytorium.
Manifest opisuje optymalizacje, profile maszyn, shaderpack i pliki do wgrania (configi,
KubeJS, resourcepacki). Presety różnych autorów **składają się w jeden plan**. Zmiana
`renderDistance` to nowe wydanie presetu, nie nowy `.exe`.

Patcher **niczego nie uruchamia** z cudzego repozytorium: kopiowanie plików opisuje
manifest, a wykonuje je zamknięty słownik operacji, ograniczony do katalogu instancji
i odwracalny.

Własne repozytoria dopisuje się bez ruszania aplikacji, w
`%LOCALAPPDATA%\TFG-Patcher\sources.json`. Repozytorium musi być **publiczne** — na
prywatne GitHub odpowiada `404`, więc dla anonimowego Patchera nie istnieje.
