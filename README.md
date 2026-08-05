# TFG Patcher

Aplikacja, która nakłada nasz stan optymalizacyjny TerraFirmaGreg-Modern na **wskazaną
instancję gry albo serwer**: configi modów, ustawienia gry, argumenty JVM Prisma,
shaderpack i mody pobierane z wydań GitHuba.

Pojedynczy przenośny `.exe` — nie wymaga Javy ani niczego doinstalowanego.

---

## Dla użytkownika

1. Uruchom `TFG-Patcher-<wersja>.exe`.
2. Wybierz instancję z listy (Prism Launcher wykrywany jest sam) albo wskaż katalog —
   gry, instancji lub serwera. Aplikacja rozpozna, co to jest.
3. Wybierz profil maszyny.
4. **Plan pokazuje się sam** i odświeża po każdej zmianie: każda pozycja osobno, ze stanem
   *zrobione / do zmiany / brak celu*. Zaznaczone jest to, co faktycznie jest do zrobienia.
5. **Zastosuj zaznaczone.**

| Profil | renderDistance | MaxMemAlloc | Dla kogo |
|---|---|---|---|
| **Standard** | 8 | 6144 MB | domyślny — sprawdzony na 16 GB RAM |
| **High** | 24 | 8192 MB | maszyna z zapasem RAM |
| **Serwer** | — | 6144 MB | wykrywany sam; tylko zmiany serwerowe |

**Nic nie dzieje się bez kliknięcia**, a każda zmiana jest odwracalna: kopie plików lądują
w `.tfg-patcher/backup-<data>/` w katalogu instancji, a przycisk **Cofnij ostatnie**
przywraca stan sprzed ostatniego uruchomienia.

Przycisk **Sprawdź mody** pobiera najnowsze wydania modów. Bez internetu aplikacja działa
na tym, co już ściągnęła.

### Serwery i Linux

```bash
node src/cli.js -i /sciezka/do/serwera            # sam plan
node src/cli.js -i /sciezka/do/serwera --apply
node src/cli.js -i /sciezka/do/serwera --revert
```

> Jeśli wyłączasz Xaero na kliencie, **wyłącz je też na serwerze**. Xaero nie ustawia
> `displayTest`, więc serwer z Xaero odrzuci klienta, który go nie ma.

---

## Dla rozwijających

```powershell
pwsh -File build.ps1        # -> dist/TFG-Patcher-<wersja>.exe
npm start                   # okno bez pakowania
node src\cli.js --list      # co aplikacja wprowadza, grupami
node src\cli.js --refresh   # samo pobranie wydan do cache
```

| Dokument | O czym |
|---|---|
| **`docs/CONTEXT.md`** | **zacznij tutaj** — po co to jest, śledztwo RAM w skrócie, konwencje, czego nie ruszać |
| `docs/RELEASES.md` | jak wydawać mody, żeby Patcher je widział; jak dodać repo współpracownika |
| `docs/OPTIMIZATIONS-SPEC.md` | każda pozycja planu i jej uzasadnienie pomiarowe |
| `docs/PATCHER.md` | architektura, struktura kodu, pułapki |
| `docs/ram/FINDINGS.md` | pełny zapis pomiarów (chronologicznie) |
| `docs/ram/HANDOFF.md` | brief: stan śledztwa RAM, co obalone |

Dodanie moda do Patchera = wpis w `sources.json`. Bez zmian w kodzie.

---

## Skąd się biorą mody

Patcher nie nosi modów w sobie. Czyta `sources.json`, pyta GitHuba o najnowsze wydanie
każdego wymienionego repozytorium i pobiera z niego załącznik pasujący do maski:

```json
{
  "id": "mapatlas",
  "name": "Map Atlas",
  "repo": "AtmatiAdi/TerraFirmaGreg-Modern_Optimisation",
  "asset": "mapatlas-*.jar",
  "replaceGlob": "mapatlas-*.jar"
}
```

Dzięki temu każdy współpracownik trzyma swoje mody u siebie i wydaje je własnym tempem,
a Patcher jest tylko dystrybutorem. Repozytorium z grą i źródłami naszych modów jest
osobno — patrz `docs/CONTEXT.md`.
