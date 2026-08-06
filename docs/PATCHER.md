# Patcher — architektura i rozwój

Dla kogoś, kto ma **zmieniać** to narzędzie. Jak go używać: `../README.md`.
Zasady i kontekst: `CONTEXT.md`. Skąd się biorą pozycje planu i dlaczego akurat takie —
to już nie tutaj, tylko w repozytorium configów (`docs/OPTIMIZATIONS-SPEC.md`,
`docs/PRESET-FORMAT.md`).

---

## Zasady, na których stoi konstrukcja

1. **Zmiana chirurgiczna, nie podmiana pliku.** Nakładamy się na cudze instancje, więc
   ruszamy pojedyncze klucze, zachowując komentarze, kolejność wpisów, wcięcia i znaki
   końca linii. Stąd własny `textconfig.js` zamiast bibliotek do TOML/INI/properties.
2. **Idempotencja.** Każda operacja umie powiedzieć, czy jest już zrobiona. Dwa
   uruchomienia z rzędu = jeden efekt, a plan czyta się jak diff.
3. **Odwracalność.** Kopie plików lądują w `.tfg-patcher/backup-<data>/`, dziennik zapisuje
   każdą operację, `--revert` odtwarza stan idąc od końca.
4. **Nic w tle.** Aplikacja nie modyfikuje niczego bez zaznaczenia pozycji i kliknięcia.
5. **Zero zależności runtime.** Własny czytnik ZIP, własny klient HTTP, własny skaner
   bajtkodu. Ma się budować za pięć lat bez archeologii npm.
6. **Sieć w jednym miejscu.** Tylko `engine/catalog.js` i `engine/release.js` dotykają
   internetu, i tylko na żądanie. Reszta silnika jest synchroniczna i działa offline.

---

## Przepływ

```
sources.json (REPOZYTORIA, nie mody - jedna lista, repo nie ma rodzaju)
      │
      └─ dla KAZDEGO repo: listReleases ─┬─► discover.mods()      ─► jary w cache
                        │                └─► preset-*.json        ─► manifest + zalaczniki
                        │                (catalog.refresh - jedyna siec, na zadanie)
                        ▼
                  compile(manifest) ──┐
                                      ├─► patches.all(opts, inst) ─► runner.plan()
instance.detect(dir) ─────────────────┘                                   │
                                                            zaznaczenie w UI / --only
                                                                          ▼
                                                    runner.apply() ─► journal ─► .tfg-patcher/
```

Jedno zapytanie na repozytorium, dwie konwencje odczytu. Presety **kilku** repozytoriów
składają się w jeden plan (`patches.all`), więc kolizje muszą być rozstrzygnięte właśnie
tam: `id` pozycji dostaje dopisek `@<autor>`, profile bierze pierwszy preset, który je
przynosi, a ten sam mod z dwóch źródeł redukuje `catalog.dedupeMods` do wyższej wersji.

Aplikacja nie zawiera **ani jednej** nazwy moda i **ani jednej** wartości configu.
`compile.js` zamienia manifest na dokładnie te same obiekty operacji, których silnik
używał zawsze — zmienia się źródło listy, nie sposób jej wykonywania.

**Stany pozycji:** `ok` (zrobione) · `todo` (do zmiany) · `missing` (brak celu — np. nie ma
pliku configu) · `error` · `skipped` (nie dotyczy tej strony: klient/serwer).

`runner.apply()` sprawdza stan każdej operacji **ponownie tuż przed wykonaniem**. Bez tego
pozycja zależna od poprzedniej wyglądałaby na „brak celu": shaderpack dopiero tworzy plik
ustawień, który zmienia pozycja `shaders-light`.

**Zwijanie pozycji w oknie.** Reguła jest jedna i **nie zależy od stanu**: każda pozycja
startuje zwinięta, do samego tytułu ze znacznikiem stanu. Wcześniej rozwijało się to, co
zaznaczone — brzmiało sensownie, ale przy świeżej instancji oznaczało, że *wszystko* jest
rozwinięte, czyli ścianę tekstu dokładnie wtedy, gdy lista jest najdłuższa. Kto chce
szczegółów, klika w nagłówek albo w **Rozwiń wszystko**; ręczne rozwinięcia żyją do
przebudowy planu. Zaznaczenie pola wyboru **nie rusza** zwijania — zwinięcie pozycji,
której ktoś właśnie się przygląda, wyrywałoby ją sprzed oczu.

**Stan stoi przed tytułem**, w kolumnie o stałej szerokości. Przy zwiniętej liście to
jedyna rzecz odróżniająca wiersze od siebie, więc musi zaczynać się w tym samym miejscu
w każdym z nich — znacznik dopisany za tytułem lądowałby za każdym razem gdzie indziej.

**Licznik „do zmiany" liczy zaznaczone**, a nie wszystkie pozycje różne od celu. Nagłówek
ma mówić, **co się stanie po kliknięciu**: liczba pozycji rozjeżdżających się z instancją
kłóciła się i z listą, i z przyciskiem, bo preset odznacza część pozycji sam
(`selected: false`), a użytkownik odznacza kolejne. Gdy zaznaczone nie jest wszystko, widać
oba człony — **„3 z 11 do zmiany"** — żeby nie zniknął rozmiar roboty, która zostaje.
Pozostałe liczniki są czystym stanem instancji i selekcji nie znają.

---

## Grupy

`patches.GROUPS` definiuje kolejność i opisy. Każda pozycja ma pole `group`:

| Grupa | Co w niej jest |
|---|---|
| `optimizations` | configi, `options.txt`, flagi JVM — wiedza z pomiarów |
| `mods` | shaderpack, mody z wydań, wyłączanie Xaero |
| `tools` | programy wspierające (na razie pusto) |

Grupa bez pozycji nie pokazuje się ani w oknie, ani w `--list`.

---

## Mody z wydań

`sources.json` → `catalog.refresh()` → GitHub API → wybór załącznika po masce → pobranie
do cache → pozycja planu `mod-<id>`, która wgrywa plik z cache.

- **Moda identyfikuje maska załącznika, nie tag.** `findRelease()` szuka najnowszego
  wydania, które **zawiera pasujący plik**: najpierw jednym zapytaniem sprawdza
  `releases/latest` (przypadek typowy), a gdy tam go nie ma — przegląda listę wydań.
  Dzięki temu jedno repozytorium wydaje wiele modów, każdy własnym tempem, i nie trzeba
  dopinać cudzych jarów do każdego wydania.

- **Cache:** `%LOCALAPPDATA%\TFG-Patcher\cache\<wlasciciel>__<repo>\<tag>\<plik>`.
  Plik o zgodnym rozmiarze nie jest pobierany ponownie.
- **Offline:** `catalog.loadCached()` odtwarza katalog z dysku przy starcie, więc plan
  pojawia się natychmiast i bez internetu.
- **Błąd źródła jest lokalny:** repo, które nie odpowiedziało, zostaje przy wersji z cache
  i mówi o tym w logu; reszta planu działa normalnie. Gdy nie ma nawet cache — pozycja jest
  widoczna ze stanem „brak celu" i pisze, czego brakuje.
- **Token** (`TFG_GITHUB_TOKEN` albo `token.txt`) jest opcjonalny: potrzebny tylko do repo
  prywatnych i przy limicie 60 zapytań/h dla anonimowych.

Dodanie moda = wpis w `sources.json`, bez dotykania kodu. Opis pól: `RELEASES.md`.

---

## Skan zależności: twarde kontra miękkie referencje

Przed wyłączeniem jakiegokolwiek moda `modscan.js` przegląda **constant pool** wszystkich
pozostałych jarów — `mods.toml` nie wystarcza (precedens: `sandworm_mod` → `aaa_particles`,
brak wpisu w `mods.toml`, wyłączenie wywaliło grę).

Sam fakt trafienia to jednak za mało. Pierwsza wersja blokowała `xaero-off`, bo:

- token `xaero/` łapał **`xaero/pac/`** — to Open Parties and Claims, inny mod tego samego
  autora,
- integracje w pakietach `compat/`, `integration/`, `mixin/`, `plugin/` ładują się
  **tylko gdy dany mod jest obecny**, więc jego brak im nie przeszkadza.

Stąd: wąskie tokeny (`xaero/common/`, `xaero/map/`, `xaero/hud/`, `xaero/minimap/`) plus
klasyfikacja trafień na **miękkie** (tylko informacja w logu) i **twarde** (przerywają
wykonanie, chyba że `--force`). Efekt na naszej paczce: 255 modów, 0 twardych, 1,7 s.

---

## Dodanie nowej pozycji planu — nie tutaj

Pozycja planu to wpis w `preset-*.json` w repozytorium, które ją wydaje — swoim albo
współpracownika — a nie zmiana w kodzie. **W tym repo nie dopisuje się optymalizacji.**
Tutaj przychodzisz tylko wtedy, gdy istniejące operacje nie wystarczają:

1. Nowy rodzaj operacji — dopisz go w `engine/changes.js` (musi mieć `describe`, `check`
   i `apply` z zapisem do dziennika), podepnij w `engine/compile.js` i dodaj do listy
   `OPS` w `engine/preset.js`.
2. Opisz go w `PRESET-FORMAT.md` — plik leży **po stronie configów**
   (`TFG-Modern_atmatiadi_configs/docs/`), jest jeden i nie ma tu kopii — i podbij
   `formatVersion`. To umowa, nie szczegół implementacji: starszy Patcher musi odrzucić
   manifest, którego nie umie wykonać, zamiast wykonać go połowicznie. Walidator po tamtej
   stronie (`build/validate.js`) ma sprawdzać to samo, co `engine/preset.js` tutaj.
3. Sprawdź na atrapie instancji: plan → apply → ponowny plan (wszystko „ZROBIONE") →
   revert (stan wraca).

---

## Struktura kodu

```
src/
  main.js            proces glowny Electrona: okno bez ramki + IPC
  preload.js         most do UI (contextIsolation, brak node w oknie)
  cli.js             ten sam silnik z konsoli - serwery, takze Linux
  ui/                index.html, style.css (liquid glass), app.js, ring.gif
  engine/
    instance.js      wykrycie instancji Prisma / katalogu gry / serwera, lista instancji
    patches.js       zlozenie planu: pozycje z presetu + mody wykryte w repozytoriach
    changes.js       operacje: setKey, setJson, installFile, installArchive, disableMods
    textconfig.js    chirurgiczna edycja toml / properties / options.txt / ini
    runner.js        profile, budowa planu, wykonanie
    journal.js       kopie zapasowe i cofanie
    modscan.js       skan constant pool jarow (twarde vs miekkie referencje)
    catalog.js       repozytoria -> pliki na dysku (jedyne miejsce z siecia)
    discover.js      tagi wydan -> mody (czysta logika, zero sieci)
    preset.js        wczytanie i WALIDACJA manifestu configow
    compile.js       manifest -> pozycje planu (zmienne, sciezki, operacje)
    release.js       klient GitHub Releases + cache
    zip.js           wlasny czytnik ZIP (EOCD + inflateRaw)
sources.json         rejestr repozytoriow (jedna lista) - jedyny plik danych w exe
build.ps1            budowa -> dist/TFG-Patcher-<wersja>.exe
release.ps1          wydanie: pyta o numer, buduje, publikuje przez gh
```

Do `.exe` wchodzi `src/` i `sources.json`. **Ani jednego zasobu** — shaderpack,
narzędzia i mody pobierają się z wydań.

---

## Pułapki (każda kosztowała sesję)

- **`signAndEditExecutable: false`** w `package.json` jest konieczne: archiwum winCodeSign
  zawiera dowiązania symboliczne macOS i electron-builder wywala się przy rozpakowaniu.
  Skutek uboczny: nie da się podmienić ikony exe (rcedit jest wtedy wyłączony).
- **`ELECTRON_RUN_AS_NODE`** odziedziczone z powłoki VS Code sprawia, że zbudowany exe
  kończy się natychmiast. To artefakt środowiska, nie błąd aplikacji.
- **Zrzut ekranu okna z zewnątrz** kadruje je przy skalowaniu DPI. Do diagnostyki układu
  służą `TFG_UI_DUMP` (wymiary + elementy wychodzące poza viewport) i `TFG_UI_SHOT`
  (zrzut robiony od środka, przez `capturePage`).
- **Niepodpisany exe** wywołuje SmartScreen przy pierwszym uruchomieniu u odbiorcy.
- Wersję z `package.json` widać w nazwie pliku i w oknie — **podbijaj ją**, gdy zmienia się
  zawartość, inaczej odbiorca nie odróżni buildów.

---

## Historia: dlaczego nie jar

Wersja 1.0 była aplikacją Javy (Swing). Poległa u odbiorcy: Prism trzyma kilka środowisk
Javy i uruchamiacz wybrał `jre-legacy` (Java 8) → `UnsupportedClassVersionError`. Elektron
niesie własne środowisko i ten problem znika. Wersja 2.x sklejała payload z **żywej
instancji** przy budowie — działało, dopóki mody były jedne i nasze. Wersja 3.0 pobiera je
z wydań, żeby każdy współpracownik mógł wydawać swoje mody u siebie.
