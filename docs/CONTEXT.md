# Kontekst projektu — czytaj to najpierw

Dokument dla każdej nowej sesji (człowieka albo modelu) pracującej w tym repozytorium.
Mówi, czym to jest, skąd się wzięło i czego **nie** wolno tu zmieniać bez pomiaru.

---

## Repozytoria i role

| Repo | Co w nim jest | Kiedy tu pracujesz |
|---|---|---|
| **to repo** (`TFG-Modern_Patcher`) | sam silnik: wykrywanie instancji, plan, operacje, cofanie | zmiany w narzędziu, format presetu, obsługa nowych operacji |
| `TFG-Modern_atmatiadi_configs` | preset (`preset-*.json`), profile, narzędzia, shaderpack, śledztwo RAM | nowa optymalizacja, zmiana wartości profilu, nowe narzędzie |
| `TFG-Modern_atmatiadi_mods` | wydania jarów po tagach `<mod>-<x.y.z>` | nowy mod albo nowa wersja moda |
| repozytoria współpracowników | mody i/lub preset z plikami gry | nigdy — to cudza własność, wpinamy sam adres |

**W tym repo nie ma ani jednej optymalizacji i ani jednej nazwy moda.** Wszystko przychodzi
z wydań: mody rozpoznawane po tagach, configi z załącznika `preset-*.json`. Lista samych
adresów siedzi w `sources.json`; szczegóły: `RELEASES.md`.

**Repozytorium nie ma rodzaju.** `sources.json` to jedna lista, a każdy adres jest pytany
o jedno i drugie. Podział na `mods` i `configs` był błędem projektowym: wymuszał na autorze
wydającym mody **i** pliki gry (KubeJS, configi) prowadzenie dwóch repozytoriów. Stare
klucze są nadal czytane, żeby pliki użytkowników nie przestały działać.

---

## Co Patcher robi (w jednym akapicie)

Wskazujesz katalog instancji Prisma, katalog gry albo serwera. Patcher wykrywa, co to
jest, pokazuje **plan** — każdą zmianę osobno, ze stanem „zrobione / do zmiany / brak
celu" — i wykonuje tylko to, co zaznaczysz. Każda operacja jest idempotentna
(dwukrotne uruchomienie nic nie psuje) i odwracalna: kopie plików lądują w
`.tfg-patcher/backup-<data>/`, a dziennik pozwala cofnąć całość jedną akcją.
Zmiany w configach są **chirurgiczne** — podmieniamy pojedyncze klucze, zachowując
komentarze, kolejność i sposób zapisu pliku, bo nakładamy się na cudze ustawienia.

---

## Dlaczego optymalizacji szukasz gdzie indziej

**Tu ich nie ma i nie ma być.** Uzasadnienie każdej pozycji planu, pomiary RAM i lista
„czego NIE robić" mieszkają w repozytorium configów:

| Szukasz | Plik w `TFG-Modern_atmatiadi_configs` |
|---|---|
| po co jest dana pozycja planu | `docs/OPTIMIZATIONS-SPEC.md` |
| pełny zapis śledztwa RAM | `docs/ram/FINDINGS.md` |
| brief: stan śledztwa, co obalone | `docs/ram/HANDOFF.md` |
| format manifestu (umowa obu stron) | `docs/PRESET-FORMAT.md` |

Jedyny ślad tamtej wiedzy, który **musi** zostać po tej stronie, to powód istnienia
skanera bajtkodu: **`mods.toml` NIE wystarcza** do wykrycia zależności między modami.
Precedens — `sandworm_mod` odwoływał się do `aaa_particles` bez wpisu w `mods.toml`
i wyłączenie wywaliło grę. Dlatego `engine/modscan.js` czyta **constant pool** pozostałych
jarów, a operacja `disableMods` ma w formacie presetu **obowiązkowe** `scan.tokens`.

---

## Pułapki tego narzędzia (każda kosztowała sesję)

- **Skan zależności musi dzielić trafienia na twarde i miękkie.** Pierwsza wersja
  blokowała `xaero-off`, bo token `xaero/` łapał `xaero/pac/` (Open Parties and Claims —
  inny mod tego samego autora) i opcjonalne integracje w pakietach `compat/`. Stąd wąskie
  tokeny i klasyfikacja w `modscan.js`.
- **O twardości decyduje struktura klasy, nie nazwa pakietu.** Druga wersja znowu
  zablokowała `xaero-off` — tym razem na SeasonHUD, którego `forge/platform/ForgeMinimapHelper`
  nie wygląda na „compat”. Twarde jest tylko to, co JVM rozwiązuje **przy ładowaniu
  klasy**: nadklasa i interfejsy. Odwołanie w ciele metody rozwiązuje się leniwie, więc
  mod z `ModList.isLoaded` nigdy go nie dotknie. Szczegóły i kontrola negatywna:
  `docs/PATCHER.md`.
- **Odpowiedź na `ipcMain.handle` wyprzedza w oknie wszystkie `webContents.send`
  z wnętrza tej samej obsługi.** Zmierzone: 300 linii logu dotarło **po** odpowiedzi na
  `invoke`, przy zachowanej kolejności FIFO między samymi `send`. Dlatego podsumowanie
  („Gotowe: …”) wypisuje proces główny kanałem logu, a nie okno z wyniku `invoke` —
  inaczej ląduje przed ostatnimi liniami operacji.
- **Etykieta operacji musi przejść przez podstawienie zmiennych.** Bez tego log i plan
  pokazywały `shaderpacks/{shaderpack}.txt` zamiast pliku, który naprawdę jest ruszany.
- **Xaero trzeba wyłączyć TAKŻE na serwerze.** Nie ustawia `displayTest` w `mods.toml`,
  więc Forge wymusza zgodność listy modów: serwer z Xaero **odrzuca** klienta bez Xaero.
- **Stan pozycji trzeba sprawdzać ponownie tuż przed wykonaniem**, bo wcześniejsza
  pozycja może dopiero utworzyć plik (shaderpack → plik ustawień shaderów).
- **`signAndEditExecutable: false`** w `package.json` jest konieczne: archiwum winCodeSign
  zawiera dowiązania symboliczne macOS i electron-builder wywala się przy ich rozpakowaniu.
- **Patcher nie ma własnego zdania o tym, co zmienić.** Dotyka wyłącznie kluczy
  wymienionych w presecie — ani jednego więcej. Jeśli w planie brakuje jakiejś zmiany,
  brakuje jej w manifeście, a nie w kodzie.

---

## Konwencje

- Commity **po polsku**, krótko, na końcu:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Kod i komentarze w kodzie: **bez polskich znaków diakrytycznych** (konsola Windows).
  Dokumentacja w `docs/` — normalną polszczyzną.
- Interfejs mówi po polsku, do użytkownika końcowego.
- **Zero zależności runtime.** Aplikacja używa wyłącznie Node/Electrona: własny czytnik
  ZIP, własny klient HTTP na wbudowanym `https`, własny parser configów. To świadome —
  narzędzie ma się budować za pięć lat bez archeologii npm.
- **Nowa optymalizacja NIE jest zmianą w tym repo.** Idzie do presetu, razem z wpisem
  w `OPTIMIZATIONS-SPEC.md` tamtego repozytorium. Pozycja bez uzasadnienia pomiarowego to
  pozycja, której nikt za pół roku nie odważy się ruszyć. Tutaj dochodzi tylko wtedy, gdy
  potrzebna jest **nowa operacja** (nowy `op` w `PRESET-FORMAT.md` i w `changes.js`).

---

## Budowa i testowanie

```powershell
pwsh -File build.ps1            # -> dist/TFG-Patcher-<wersja>.exe
pwsh -File build.ps1 -SkipInstall
pwsh -File release.ps1          # wydanie: pyta o numer, buduje, publikuje przez gh
pwsh -File release.ps1 -DryRun  # samo sprawdzenie, bez ruszania package.json
pwsh -File release.ps1 -Keep 0  # bez kasowania starszych wersji na GitHubie i w dist/ (domyslnie zostaje tylko nowa)
npm run icon                    # przerysowanie ikony (build.ps1 robi to sam)
node src\cli.js --list          # co aplikacja wprowadza, grupami
node src\cli.js --refresh       # samo pobranie wydan do cache
node src\cli.js -i <sciezka>    # plan bez zmian
node src\cli.js -i <sciezka> --apply
node src\cli.js -i <sciezka> --revert
```

Testuj **na atrapie instancji**, nie na żywej grze: katalog z `instance.cfg`,
`mmc-pack.json`, `minecraft/mods` (kilka pustych plików o właściwych nazwach),
`minecraft/config`, `minecraft/options.txt`. Pełny cykl to plan → apply → ponowny plan
(wszystko „ZROBIONE") → revert (stan wraca).

Zmienne środowiskowe przydatne przy pracy:

| Zmienna | Do czego |
|---|---|
| `TFG_SOURCES_FILE` | inny `sources.json` (testy bez ruszania repo) |
| `TFG_CACHE_DIR` | inny katalog cache (tam lądują pobrane jary i załączniki presetu) |
| `TFG_GITHUB_TOKEN` | token do repo prywatnych i wyższych limitów |
| `TFG_UI_DUMP=<plik>` | zrzut układu interfejsu i elementów wychodzących poza okno |
| `TFG_UI_SHOT=<plik>` | zrzut ekranu okna (razem z `TFG_UI_DUMP`) |

---

## Co jest zaplanowane, a czego jeszcze nie ma

- **Wydzielenie zakończone (2026-08-05).** Aplikacja nie zawiera żadnej optymalizacji,
  żadnej nazwy moda ani żadnego zasobu. `patches.js` buduje plan z presetu, `runner.js`
  bierze profile z presetu, `assets/` już nie ma. Zostały dwa osobne projekty:
  `TFG-Modern_atmatiadi_configs` (preset) i `TFG-Modern_atmatiadi_mods` (jary).
- **Umowa z repozytorium configów: `PRESET-FORMAT.md`** — plik jest **jeden** i leży
  w tamtym repo, w `docs/`; tutaj go nie kopiujemy, bo dwie kopie i tak by się rozjechały.
  Zmiana formatu to opis tam, implementacja tutaj i podbicie `formatVersion`.
- **Bez presetu plan pokazuje same mody.** To poprawny stan, nie awaria — repozytorium
  bez wydania z presetem po prostu nic nie wnosi.
- Model „wielu współpracowników, każdy z własnym repo" obsługuje `sources.json` plus plik
  użytkownika w `%LOCALAPPDATA%\TFG-Patcher\sources.json` — dopisanie cudzego repozytorium
  nie wymaga nowej wersji aplikacji. Dokument do wysłania takiej osobie (albo jej agentowi):
  `docs/DLA-WSPOLPRACOWNIKOW.md`.
- **Presety się składają, ale nie zlewają** (2026-08-06). Każde repozytorium wnosi swój
  preset; grupy i pozycje sumują się w jednym planie. Rozstrzygnięte kolizje: profile —
  wygrywa pierwszy preset z danym `id`; `id` pozycji — drugie w kolejności dostaje dopisek
  `@<autor>`; ten sam mod w dwóch repozytoriach — wygrywa wyższa wersja. Profile są
  **opcjonalne**, bo preset dokładający same pliki nie ma czego profilować.
  `formatVersion` **zostaje 1**: rozluźnienie walidacji nie unieważnia żadnego istniejącego
  manifestu, a starszy Patcher odrzuci manifest bez profili z czytelnym błędem — nie ma
  przed czym chronić podbiciem. Bump należy się dopiero nowej **operacji**.
- **Patcher nie uruchamia niczego z cudzego repozytorium** i nie ma tego robić. Prośba
  „a niech odpali skrypt instalacyjny autora" ma odpowiedź: `installAsset` + `unpack`,
  bo to samo robi w granicach instancji, odwracalnie i widocznie w planie.
