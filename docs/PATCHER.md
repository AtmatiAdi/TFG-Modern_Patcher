# Patcher — architektura i rozwój

Dla kogoś, kto ma **zmieniać** to narzędzie. Jak go używać: `../README.md`.
Skąd się wzięły pozycje planu: `OPTIMIZATIONS-SPEC.md`. Zasady i kontekst: `CONTEXT.md`.

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
sources.json ──► catalog.refresh()  ──► pliki w cache        (jedyna siec, na zadanie)
                        │
                        ▼
instance.detect(dir) ──► patches.all() ──► runner.plan()  ──► lista pozycji ze stanem
                                                │
                                     zaznaczenie w UI / --only
                                                ▼
                                          runner.apply()  ──► journal ──► .tfg-patcher/
```

**Stany pozycji:** `ok` (zrobione) · `todo` (do zmiany) · `missing` (brak celu — np. nie ma
pliku configu) · `error` · `skipped` (nie dotyczy tej strony: klient/serwer).

`runner.apply()` sprawdza stan każdej operacji **ponownie tuż przed wykonaniem**. Bez tego
pozycja zależna od poprzedniej wyglądałaby na „brak celu": shaderpack dopiero tworzy plik
ustawień, który zmienia pozycja `shaders-light`.

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

## Dodanie nowej pozycji planu

1. Dopisz sekcję do `OPTIMIZATIONS-SPEC.md` — **najpierw uzasadnienie, potem kod**.
2. Dodaj pozycję w `engine/patches.js`: `id`, `side`, `group`, `title`, `doc`, `why`
   i listę `changes` złożoną z gotowych operacji (`setKey`, `setJson`, `installFile`,
   `disableMods`).
3. Potrzebujesz nowego rodzaju operacji? Dopisz go w `engine/changes.js` — musi mieć
   `describe`, `check` i `apply` (z zapisem do dziennika).
4. Sprawdź na atrapie instancji: plan → apply → ponowny plan (wszystko „ZROBIONE") →
   revert (stan wraca).

---

## Struktura kodu

```
src/
  main.js            proces glowny Electrona: okno bez ramki + IPC
  preload.js         most do UI (contextIsolation, brak node w oknie)
  cli.js             ten sam silnik z konsoli - serwery, takze Linux
  ui/                index.html, style.css (liquid glass), app.js
  engine/
    instance.js      wykrycie instancji Prisma / katalogu gry / serwera, lista instancji
    patches.js       PELNA lista pozycji + definicja grup
    changes.js       elementarne operacje: setKey, setJson, installFile, disableMods
    textconfig.js    chirurgiczna edycja toml / properties / options.txt / ini
    runner.js        profile, budowa planu, wykonanie
    journal.js       kopie zapasowe i cofanie
    modscan.js       skan constant pool jarow (twarde vs miekkie referencje)
    catalog.js       sources.json -> pliki na dysku (jedyne miejsce z siecia)
    release.js       klient GitHub Releases + cache
    assets.js        pliki dolaczone do aplikacji (shaderpack)
    zip.js           wlasny czytnik ZIP (EOCD + inflateRaw)
assets/shaderpacks/  pakiet shaderow i jego ustawienia
sources.json         katalog modow pobieranych z wydan
```

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
