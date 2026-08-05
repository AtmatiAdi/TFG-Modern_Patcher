# Jak wydawać mody, żeby Patcher je widział

Patcher nie zna żadnych modów „na sztywno". Czyta `sources.json`, pyta GitHuba
o **najnowsze wydanie** każdego wymienionego repozytorium, bierze z niego załącznik
pasujący do maski i wgrywa go do `mods/`. Dołożenie moda — własnego czy cudzego —
to zmiana jednego pliku JSON, bez ruszania kodu.

---

## 1. Wydanie moda z naszego repozytorium (mapatlas — jest gotowy)

Mod żyje w repo z grą: `AtmatiAdi/TerraFirmaGreg-Modern_Optimisation`, źródła w
`mapatlas/`. Publikujemy **sam jar** jako załącznik wydania.

### Jednorazowo: sprawdź, czy masz `gh`

```powershell
gh auth status          # jeśli nie masz: winget install GitHub.cli, potem gh auth login
```

### Za każdym razem, gdy mod dostaje nową wersję

```powershell
# 1. zbuduj jar (JDK 17 z Prisma — patrz docs/CONTEXT.md)
cd <repo-gry>\mapatlas
./gradlew build

# 2. wystaw wydanie; tag = wersja moda z gradle.properties
cd <repo-gry>
gh release create mapatlas-0.4.0 `
  mapatlas\build\libs\mapatlas-0.4.0.jar `
  --title "Map Atlas 0.4.0" `
  --notes "Mapa rezerwuje caly obszar (kremowe pole), remap 1:1 przy chodzeniu z atlasem w rece."
```

To wszystko. Następne uruchomienie Patchera (albo przycisk **Sprawdź mody**) pobierze
`mapatlas-0.4.0.jar` i podmieni starszą wersję w `mods/`.

### Dogrywanie pliku do istniejącego wydania

```powershell
gh release upload mapatlas-0.4.0 mapatlas\build\libs\mapatlas-0.4.0.jar --clobber
```

### Bez `gh` (przez stronę)

Releases → *Draft a new release* → tag `mapatlas-0.4.0` → przeciągnij jar w pole
załączników → *Publish release*. Ważne: jar musi być **załącznikiem**, nie tylko
plikiem w repo — archiwa źródeł, które GitHub dokleja sam, Patcherowi nie wystarczą.

### Czego pilnować

- **Nazwa pliku musi pasować do maski** z `sources.json` (`mapatlas-*.jar`) — to maska,
  nie tag, identyfikuje moda.
- **Drafty i prereleasy są pomijane.** Draft to wygodny sposób, żeby przygotować wydanie,
  zanim trafi do ludzi.
- **Jedno repo spokojnie wydaje wiele modów, każdy własnym tempem.** Patcher nie bierze
  po prostu „najnowszego wydania" — bierze **najnowsze wydanie zawierające załącznik
  pasujący do maski danego moda**. Czyli:

  ```
  wydanie mapatlas-0.4.0  ->  mapatlas-0.4.0.jar
  wydanie innymod-1.2     ->  innymod-1.2.jar      <- to jest "latest" w repo
  ```

  …i mimo to wpis `mapatlas-*.jar` nadal znajdzie swoje 0.4.0. Nie trzeba dopinać jarów
  pozostałych modów do każdego wydania ani rozbijać modów na osobne repozytoria.
- **Tag** służy tylko ludziom i katalogowi cache — konwencja `<mod>-<wersja>` jest czytelna
  i od razu widać, czego dotyczy wydanie.

---

## 2. Dołożenie moda współpracownika

Dopisz wpis do `sources.json`:

```json
{
  "id": "nazwa-bez-spacji",
  "name": "Nazwa pokazywana w Patcherze",
  "repo": "wlasciciel/repozytorium",
  "asset": "mojmod-*.jar",
  "replaceGlob": "mojmod-*.jar",
  "side": "both",
  "doc": "link albo nazwa dokumentu",
  "why": "Po co to jest — jedno zdanie, widoczne w planie."
}
```

| Pole | Znaczenie |
|---|---|
| `id` | klucz w cache i w planie (`mod-<id>`); nie zmieniaj go po wydaniu |
| `repo` | `wlasciciel/repozytorium` na GitHubie |
| `asset` | maska nazwy załącznika; `*` zastępuje dowolny fragment |
| `replaceGlob` | które **starsze** pliki w `mods/` usunąć przy wgraniu (zwykle to samo co `asset`) |
| `side` | `client`, `server` albo `both` — gdzie pozycja ma sens |
| `doc`, `why` | tekst pokazywany w planie |

Bez `replaceGlob` stare wersje **zostaną** obok nowej i gra wystartuje z dwoma
kopiami moda. To prawie zawsze błąd — ustawiaj tę maskę.

---

## 3. Repozytorium z wydaniami musi być PUBLICZNE

To najważniejsza decyzja w całym mechanizmie, a łatwo się na niej przejechać:
**na repo prywatne GitHub odpowiada `404`, nie `403`** — celowo, żeby nie zdradzić, że
coś takiego istnieje. Patcher u odbiorcy chodzi anonimowo, więc dla niego prywatne repo
z wydaniami po prostu nie istnieje, choć Ty widzisz je w przeglądarce bez problemu.

Skutek: jeśli wydania mają być pobierane przez ludzi, którym dajesz `.exe`, repo
**musi być publiczne**. Alternatywa — token u każdego odbiorcy — nie działa w praktyce:
token daje dostęp do całego konta, więc nie rozdaje się go znajomym.

Rozsądny układ, gdy repo z grą ma zostać prywatne:

| Repo | Widoczność | Co w nim |
|---|---|---|
| repo z grą | prywatne | instancja, źródła modów, pomiary, notatki |
| repo z wydaniami modów | **publiczne** | tylko wydania (jary jako załączniki) — może być zupełnie puste |
| repo Patchera | publiczne albo prywatne | zależy, czy `.exe` rozdajesz z GitHuba |

Publiczne repo na wydania może nie mieć **żadnego kodu** — wystarczy, że istnieje.
Wgrywasz do niego jar jako załącznik wydania i wpisujesz je w `sources.json`.

Sprawdzenie w 5 sekund, czy repo jest widoczne dla Patchera — otwórz w przeglądarce
**wylogowany** (okno prywatne):
`https://github.com/<wlasciciel>/<repo>/releases/latest`

## 4. Repozytoria prywatne i limity

Anonimowo GitHub daje 60 zapytań na godzinę na adres IP i nie wpuszcza do repo
prywatnych. Token rozwiązuje jedno i drugie:

```powershell
$env:TFG_GITHUB_TOKEN = "ghp_..."     # tylko na tę sesję
```

albo na stałe — plik `token.txt` obok katalogu cache:
`%LOCALAPPDATA%\TFG-Patcher\token.txt`. Wystarczy token z uprawnieniem `repo`
(albo *fine-grained* z dostępem tylko do wskazanych repozytoriów).

Token jest opcjonalny: bez niego wszystko publiczne działa normalnie.

---

## 5. Gdzie lądują pobrane pliki

`%LOCALAPPDATA%\TFG-Patcher\cache\<wlasciciel>__<repo>\<tag>\<plik>`

- pobranie zdarza się **raz na wersję** — plik o zgodnym rozmiarze nie jest ściągany ponownie,
- `catalog.json` w tym samym katalogu pamięta, co zostało rozwiązane, więc Patcher
  pokazuje sensowny plan także **bez internetu**,
- gdy GitHub nie odpowiada, źródło zostaje przy wersji z cache i mówi o tym w logu;
  reszta planu działa normalnie,
- kasowanie tego katalogu jest bezpieczne — najwyżej wszystko pobierze się jeszcze raz.

---

## 6. Test bez wydawania czegokolwiek

Podmień plik źródeł na czas testu i sprawdź pełną ścieżkę na dowolnym publicznym repo:

```powershell
$env:TFG_SOURCES_FILE = "C:\tmp\test-sources.json"
$env:TFG_CACHE_DIR    = "C:\tmp\cache"
node src\cli.js --refresh
node src\cli.js -i <instancja> --offline
```

Tak właśnie sprawdzono ten mechanizm przed oddaniem: pobranie z prawdziwego wydania,
ponowne uruchomienie bez transferu, tryb offline, wgranie do atrapy instancji i cofnięcie.
