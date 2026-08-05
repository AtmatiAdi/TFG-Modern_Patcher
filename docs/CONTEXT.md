# Kontekst projektu — czytaj to najpierw

Dokument dla każdej nowej sesji (człowieka albo modelu) pracującej w tym repozytorium.
Mówi, czym to jest, skąd się wzięło i czego **nie** wolno tu zmieniać bez pomiaru.

---

## Dwa repozytoria, dwie role

| Repo | Co w nim jest | Kiedy tu pracujesz |
|---|---|---|
| **repo z grą** (`TerraFirmaGreg-Modern_Optimisation`) | żywa instancja Prisma, źródła naszych modów (`mapatlas/`), dziennik optymalizacji, pełne dane pomiarowe | tworzenie modów, zmiana mechaniki, nowe pomiary RAM |
| **to repo** (Patcher) | aplikacja nakładająca nasz stan na cudzą instancję albo serwer | zmiany w samym narzędziu, dołożenie źródła modów, nowa pozycja planu |

Podział wynika z tego, że repo z grą siedzi w katalogu instancji Prisma (żeby mieć
pod ręką mody i dane gry), a Patcher ma trafiać do ludzi, którzy tej instancji nie mają.

**Mody nie są tu kopiowane.** Patcher pobiera je z **wydań GitHuba** (`sources.json`),
więc to repo nie musi wiedzieć nic o kodzie modów, a współpracownicy trzymają swoje
mody u siebie. Szczegóły: `RELEASES.md`.

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

## Dlaczego te konkretne optymalizacje — skrót śledztwa RAM

Pełny zapis: `ram/FINDINGS.md` (chronologiczny) i `ram/HANDOFF.md` (brief).
Tu tylko to, bez czego nie wolno ruszać listy zmian:

**Problem wyjściowy.** Proces gry brał **18,4 GB** przy 16 GB fizycznych → stronicowanie
→ przycięcia co ~60 s. Heap `-Xmx` to była mniejszość tego rachunku.

**Ustalenie, które przestawiło projekt** (2026-07-22): RAM jest zjadany **przy ładowaniu
modów**, nie w rozgrywce. Pomiar w menu głównym, po załadowaniu 255 modów i bez wczytanego
świata, dał **13,1 GB commitu**. Czyli: mierz w menu głównym, nie w świecie — inaczej
mierzysz szum.

**Dowód na G1.** Garbage collector trzymał **3,8 GB pustej sterty** i nie oddawał jej
systemowi. Flagi `MinHeapFreeRatio=10 / MaxHeapFreeRatio=30 / G1PeriodicGCInterval=15000`
zbiły commit z **13,1 do 10,1 GB** — to najtańsze 3 GB w całym projekcie i dlatego
`prism-jvm` jest pozycją, której nie wolno „uprościć".

**Effekseer (`aaa_particles`).** Potwierdzone **1,03 GB** pamięci natywnej. Config `[gc]
enabled=true` oddaje ją pod presją RAM.

**renderDistance.** Największa gałka po stronie gry — dane i meshe chunków rosną
kwadratowo. Stąd 8 jako standard i 24 dopiero z `Xmx 8192` (większy zasięg bez wyższego
sufitu sterty tylko zagoniłby GC).

**Czego NIE robić** (sprawdzone, kosztowało nas sesje):
- **Nie włączać `ingredientDedupe` w AllTheLeaks** — wywala grę przy wejściu do świata
  (`ATLUnsupportedOperation`). Pozycja `alltheleaks-guard` istnieje po to, żeby pilnować
  wartości `false`, a nie żeby ją zmieniać.
- **Nie wyłączać shaderów** — decyzja użytkownika, są wizualnie istotne. Wolno tylko
  przycinać ich gałki pamięci (`shaders-light`).
- **Nie dodawać `-XX:+AlwaysPreTouch`** — zarezerwowałoby całą stertę z góry.
- **`mods.toml` NIE wystarcza** do wykrycia zależności między modami. Przed wyłączeniem
  jakiegokolwiek moda trzeba przeskanować **constant pool** pozostałych jarów. Precedens:
  `sandworm_mod` odwoływał się do `aaa_particles` bez wpisu w `mods.toml` i wyłączenie
  wywaliło grę. Robi to `engine/modscan.js` i dlatego pozycja `xaero-off` ma skan.

---

## Pułapki tego narzędzia (każda kosztowała sesję)

- **Skan zależności musi dzielić trafienia na twarde i miękkie.** Pierwsza wersja
  blokowała `xaero-off`, bo token `xaero/` łapał `xaero/pac/` (Open Parties and Claims —
  inny mod tego samego autora) i opcjonalne integracje w pakietach `compat/`. Stąd wąskie
  tokeny i klasyfikacja w `modscan.js`.
- **Xaero trzeba wyłączyć TAKŻE na serwerze.** Nie ustawia `displayTest` w `mods.toml`,
  więc Forge wymusza zgodność listy modów: serwer z Xaero **odrzuca** klienta bez Xaero.
- **Stan pozycji trzeba sprawdzać ponownie tuż przed wykonaniem**, bo wcześniejsza
  pozycja może dopiero utworzyć plik (shaderpack → plik ustawień shaderów).
- **`signAndEditExecutable: false`** w `package.json` jest konieczne: archiwum winCodeSign
  zawiera dowiązania symboliczne macOS i electron-builder wywala się przy ich rozpakowaniu.
- **Nie ustawiamy `fullscreen` ani `guiScale`** — to ustawienia osobiste gracza, nie
  optymalizacje. Patcher dotyka dokładnie pięciu kluczy `options.txt`.

---

## Konwencje

- Commity **po polsku**, krótko, na końcu:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Kod i komentarze w kodzie: **bez polskich znaków diakrytycznych** (konsola Windows).
  Dokumentacja w `docs/` — normalną polszczyzną.
- Interfejs mówi po polsku, do użytkownika końcowego.
- **Zero zależności runtime.** Aplikacja używa wyłącznie Node/Electrona: własny czytnik
  ZIP, własny klient HTTP na wbudowanym `https`, własny parser configów. To świadome —
  narzędzie ma się budować za pięć lat bez archeologii npm.
- **Nowa optymalizacja = nowa pozycja w `engine/patches.js` + wpis w
  `docs/OPTIMIZATIONS-SPEC.md`.** Pozycja bez uzasadnienia w dokumencie to pozycja,
  której nikt za pół roku nie odważy się ruszyć.

---

## Budowa i testowanie

```powershell
pwsh -File build.ps1            # -> dist/TFG-Patcher-<wersja>.exe
pwsh -File build.ps1 -SkipInstall
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
| `TFG_CACHE_DIR` | inny katalog cache |
| `TFG_ASSETS_DIR` | inny katalog zasobów |
| `TFG_GITHUB_TOKEN` | token do repo prywatnych i wyższych limitów |
| `TFG_UI_DUMP=<plik>` | zrzut układu interfejsu i elementów wychodzących poza okno |
| `TFG_UI_SHOT=<plik>` | zrzut ekranu okna (razem z `TFG_UI_DUMP`) |

---

## Co jest zaplanowane, a czego jeszcze nie ma

- Grupa **„Programy wspierające"** istnieje w kodzie (`patches.js` → `GROUPS`), ale nie
  ma w niej żadnej pozycji. Ma tam trafić m.in. narzędzie wymuszające zwalnianie RAM
  w systemie — użytkownik ma własne, gotowe rozwiązanie do pokazania.
- Model „wielu współpracowników, każdy z własnym repo" jest już obsłużony przez
  `sources.json`; na razie wpisany jest jeden mod (nasz).
