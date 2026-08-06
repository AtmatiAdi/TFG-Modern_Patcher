# Jak udostępniać swoje mody i configi przez TFG Patcher

Dokument dla osoby (albo agenta AI) pracującej we **własnym** repozytorium, którego
zawartość ma trafić do ludzi przez TFG Patcher. Nie musisz znać kodu Patchera ani mieć
z nim nic wspólnego — wystarczy, że będziesz wydawać rzeczy w umówiony sposób.

**Zasada całości:** Patcher nie zna listy modów ani listy optymalizacji. Zna **adresy
repozytoriów** i pyta GitHuba, co w nich jest. Twoja praca staje się widoczna u ludzi
w chwili, gdy opublikujesz **wydanie (release)** — nikt nie musi wypuszczać nowej wersji
aplikacji, a Ty nie potrzebujesz dostępu do żadnego cudzego repo.

---

## 1. Co można udostępniać

| Rodzaj | Co publikujesz | Czego szuka Patcher |
|---|---|---|
| **Mody** | jar jako załącznik wydania | wydań o tagu `<mod>-<x.y.z>` z załącznikiem `.jar` |
| **Configi i pliki gry** (preset) | manifest `preset-<wersja>.json` jako załącznik | **najnowszego** wydania z załącznikiem pasującym do `preset-*.json` |

**Jedno repozytorium może robić jedno i drugie naraz.** Patcher nie ma pojęcia
„repozytorium z modami" ani „repozytorium z configami" — każde adresowane repo
sprawdza pod obie konwencje. Twoje wydania z jarami i Twoje wydanie z presetem mogą
spokojnie leżeć obok siebie; nie musisz zakładać drugiego repo ani wybierać, która
połowa Twojej pracy ma być widoczna.

**Patcher nigdy nie uruchamia niczego z Twojego repozytorium** — ani `.bat`, ani `.ps1`,
ani `.sh`. Jeśli dziś rozdajesz pliki razem ze skryptem, który je kopiuje, jego zadanie
przejmuje preset (punkt 4.4): to samo kopiowanie, ale odwracalne, sprawdzalne przed
wykonaniem i zamknięte wewnątrz katalogu instancji.

## 2. Zanim cokolwiek zrobisz: repozytorium musi być PUBLICZNE

Na to najłatwiej się przejechać, bo wygląda, jakby wszystko było w porządku:
**na repozytorium prywatne GitHub odpowiada `404`, a nie `403`** — celowo, żeby nie
zdradzić, że coś takiego istnieje. Patcher u odbiorcy chodzi anonimowo, więc Twoje
prywatne repo **dla niego nie istnieje**, choć Ty widzisz je w przeglądarce bez problemu.

Sprawdzenie w pięć sekund — otwórz w oknie prywatnym (wylogowany):

```
https://github.com/<twoj-login>/<repo>/releases/latest
```

Repozytorium na same wydania może nie mieć **żadnego kodu**. Wystarczy, że istnieje
i ma wydania.

---

## 3. Mody

### 3.1 Tag decyduje o wszystkim

Nazwa i wersja moda biorą się **z tagu wydania**, nie z nazwy pliku i nie z tytułu:

```
<nazwa-moda>-<wersja>

mapatlas-0.4.0        ->  mod "mapatlas", wersja 0.4.0
map-atlas-1.2.3       ->  mod "map-atlas", wersja 1.2.3    (myślniki w nazwie są OK)
lepszykompas-v2.0      ->  mod "lepszykompas", wersja 2.0   (litera "v" jest opcjonalna)
```

Formalnie: wszystko przed **ostatnim** `-<liczby oddzielone kropkami>` to nazwa moda,
reszta to wersja. Wersja może mieć dwa albo cztery człony — `1.2` i `1.2.3.4` są poprawne.

### 3.2 Wydanie

```powershell
gh release create mapatlas-0.4.0 `
  build\libs\mapatlas-0.4.0.jar `
  --title "Map Atlas 0.4.0" `
  --notes "Mapa rezerwuje caly obszar, remap 1:1 przy chodzeniu z atlasem w rece."
```

Bez `gh`: Releases → *Draft a new release* → wpisz tag → **przeciągnij jar w pole
załączników** → *Publish release*.

To wszystko. Przy najbliższym uruchomieniu Patchera (albo po kliknięciu **Sprawdź
źródła**) mod pojawi się w planie u każdego, kto ma Twoje repo w źródłach.

### 3.3 Dokładne reguły, według których Patcher czyta repozytorium

Warto je znać, bo tłumaczą każde „czemu mojego moda nie widać":

1. **Pobiera listę wydań** repozytorium (do 500 najnowszych).
2. **Pomija drafty i prereleasy.** Draft to wygodny sposób, żeby przygotować wydanie,
   zanim zobaczą je ludzie.
3. **Pomija tagi, które nie pasują** do `<mod>-<x.y.z>` — i wypisuje je w logu. To
   celowe: Twoje repo może mieć wydania niebędące modami.
4. **Grupuje po nazwie z tagu i bierze najwyższą wersję każdego moda.** Starsze wydania
   tego samego moda są ignorowane, więc historia wydań nie przeszkadza.
5. **Wersje porównuje liczbowo, człon po członie.** `0.10.0` jest **wyżej** niż `0.9.0`
   — porównanie tekstowe dawałoby odwrotnie i cicho instalowało starszy jar.
6. **Bierze załączniki `.jar` zaczynające się od nazwy moda**, a jeśli takich nie ma —
   wszystkie `.jar` z tego wydania. Wydanie bez żadnego `.jar` jest pomijane.
7. **Usuwa starsze wersje** z katalogu `mods/` u odbiorcy, dopasowując `<mod>-*.jar`.
   Maska bierze się z nazwy moda, więc nie musisz jej nigdzie podawać ani o niej pamiętać.
8. **Pierwsza linia notatek wydania** trafia do planu jako opis pozycji. Napisz tam jedno
   zdanie po co to jest — to jedyny opis, jaki zobaczy użytkownik.

### 3.4 Jedno wydanie = jeden mod

Nie musisz dopinać wszystkich swoich jarów do każdego wydania ani rozbijać modów na
osobne repozytoria. Każdy mod idzie własnym tempem:

```
mapatlas-0.4.0     ->  mapatlas 0.4.0
innymod-1.2        ->  innymod 1.2        <- to jest "latest" w repo
mapatlas-0.3.0     ->  pominiete (starsza wersja mapatlas)
```

Patcher **nie** bierze po prostu „najnowszego wydania" — składa obraz repozytorium
z całej listy wydań.

### 3.5 Najczęstsze pomyłki

| Objaw | Przyczyna |
|---|---|
| moda w ogóle nie widać, w logu „tag nie pasuje" | tag bez części liczbowej na końcu — sprawdzone, że **odpadają**: `latest`, `v1.0`, `mapatlas`, `mapatlas-final`, `mapatlas-0.9.0a` |
| jw., a tag wygląda dobrze | **podkreślnik zamiast myślnika**: `mapatlas_0.4.0` nie przechodzi, `mapatlas-0.4.0` tak |
| mod nazywa się nie tak, jak myślisz | nazwa to wszystko przed ostatnią częścią liczbową — tag `release-3` da moda o nazwie `release` w wersji `3` |
| „brak zalacznika .jar" | jar wgrany do repo zamiast **załącznika wydania**; archiwa źródeł, które GitHub dokleja sam, nie liczą się |
| widać starszą wersję | nowsze wydanie jest **draftem** albo **prereleasem** |
| dwie wersje uznane za tę samą | zera wiodące: `1.09.0` i `1.9.0` są liczbowo równe |
| dwie kopie moda w `mods/` | nazwa pliku nie zaczyna się od nazwy z tagu, więc maska nie objęła starego pliku |
| Patcher w ogóle nie widzi repo | repozytorium prywatne (patrz punkt 2) |

---

## 4. Configi i pliki gry (preset)

Preset to **jeden plik JSON** opisujący zmiany do wprowadzenia: klucze w configach,
ustawienia gry, argumenty JVM, pliki do wgrania. Patcher jest tylko wykonawcą — cała
wiedza „co zmienić i po co" siedzi w tym pliku.

Preset z Twojego repozytorium **dokłada się** do presetów innych autorów: Twoje grupy
i pozycje pojawiają się w tym samym planie obok cudzych. Nie nadpisujesz nikogo i nikt
nie nadpisuje Ciebie. Gdy dwie osoby nazwą pozycję tym samym `id`, drugie w kolejności
dostaje dopisek z loginem autora (`kalendarz@twojlogin`) — nic nie znika, ale prościej
od razu nadać pozycjom nazwy, które nie zderzą się z cudzymi.

### 4.1 Co Patcher robi z presetem

- bierze **najnowsze** wydanie zawierające załącznik `preset-*.json` (Twoje presety się
  **nie sumują** — nowsze zastępuje Twoje starsze),
- **waliduje manifest i odrzuca go W CAŁOŚCI**, jeśli cokolwiek jest nie tak. Lepiej
  pokazać „preset uszkodzony" niż wykonać połowę zmian. Błędy lądują w logu,
- dociąga **tylko te załączniki, do których manifest się odwołuje** — nie całe wydanie.

### 4.2 Najmniejszy działający manifest

```json
{
  "formatVersion": 1,
  "id": "moj-preset",
  "name": "Moje configi",
  "version": "1.0.0",

  "groups": [
    { "id": "moje-configi", "label": "Moje configi", "description": "Zmiany TwojLogin" }
  ],

  "items": [
    {
      "id": "czas-schniecia",
      "group": "moje-configi",
      "side": "both",
      "title": "Glina schnie dwa razy wolniej",
      "why": "Suszenie ma zajmowac pol dnia gry, zeby oplacalo sie planowac produkcje.",
      "changes": [
        { "op": "setKey", "file": "config/mojmod-server.toml", "style": "toml",
          "key": "dryingTicks", "value": "12000" }
      ]
    }
  ]
}
```

**Twarde wymagania walidatora** (każde z nich odrzuca cały preset):

- `formatVersion` musi być **dokładnie `1`**,
- muszą być `id`, `name`, `version`, przynajmniej jedna grupa i przynajmniej jedna pozycja,
- `id` grup, profili i pozycji są unikalne; `group` pozycji musi istnieć **w tym samym
  manifeście** (grupa jest sekcją planu — pozycja wskazująca nieistniejącą grupę nie
  miałaby się gdzie pokazać),
- `side` to `client`, `server` albo `both`,
- każda `{zmienna}` użyta w pozycjach musi być zdefiniowana w `vars` albo w `vars` profilu.

**Profile są opcjonalne** i zwykle nie powinieneś ich deklarować — patrz punkt 4.6.
Jeśli je podasz, **dokładnie jeden** musi mieć `"default": true`.

### 4.3 Słownik operacji

Zamknięty — innych `op` nie ma i nie da się ich przemycić:

| `op` | Co robi | Wymaga |
|---|---|---|
| `setKey` | ustawia klucz w pliku tekstowym | `file`, `key`, `value`, `style` |
| `setJson` | ustawia klucz w pliku JSON | `file`, `key`, `value` |
| `installAsset` | wgrywa załącznik **tego** wydania | `asset`, `target` |
| `installRelease` | wgrywa załącznik z **cudzego** repo | `repo`, `asset`, `target` |
| `disableMods` | zmienia `.jar` na `.jar.disabled` | `prefixes`, `scan.tokens` |

`style` dla `setKey` to jedno z: `toml`, `properties`, `options`, `ini`. Zmiany są
**chirurgiczne** — podmieniany jest pojedynczy klucz, z zachowaniem komentarzy,
kolejności i znaków końca linii, bo nakładasz się na cudze ustawienia.

`installAsset` i `installRelease` przyjmują też `unpack: "zip"` (rozpakowanie zamiast
kopiowania), `replaceGlob` (co usunąć przy podmianie) i `onlyIfMissing: true`
(nie nadpisuj, jeśli plik już jest).

**`disableMods` ma OBOWIĄZKOWE `scan.tokens`** i to nie jest formalność. `mods.toml`
nie wystarcza do wykrycia zależności między modami — zdarzyło się, że mod odwoływał się
do klas innego moda bez żadnej deklaracji i wyłączenie tamtego wywaliło grę. Przed
wyłączeniem Patcher skanuje **constant pool** pozostałych jarów, szukając Twoich tokenów.
Tokeny mają być **wąskie** (`xaero/common/`, a nie `xaero/`), inaczej złapią niepowiązane
mody tego samego autora.

### 4.4 Pliki gry (kubejs, configi, resourcepacki) — zamiast skryptu kopiującego

Jeśli Twoja praca to **zestaw plików do wgrania do instancji** — skrypty KubeJS, gotowe
pliki configów, resourcepack — spakuj je w ZIP-a, dołącz do wydania z presetem i wskaż
jedną operacją. To zastępuje skrypt kopiujący, który dziś rozdajesz razem z plikami.

```json
{
  "id": "nakladka-kubejs",
  "group": "moje-configi",
  "side": "both",
  "title": "Nakladka: glina, kaolinit, kamien roboczy",
  "why": "Wlasne bloki i przepisy - realistyczny lancuch gliny.",
  "changes": [
    { "op": "installAsset", "asset": "nakladka-1.0.0.zip", "target": ".", "unpack": "zip" }
  ]
}
```

- **ZIP ma zawierać ścieżki takie, jak w katalogu gry** — czyli w środku siedzi
  `kubejs/server_scripts/...`, a nie same pliki `.js`. `"target": "."` to katalog gry
  (`minecraft/`), więc archiwum rozpakowuje się dokładnie tam, gdzie ma być.
- **Nie pakuj katalogu nadrzędnego.** `nakladka/kubejs/...` wyląduje w `minecraft/nakladka/kubejs/...`
  i nic nie zadziała.
- Rozpakowanie jest **odwracalne i sprawdzalne**: Patcher pokazuje w planie, ile plików
  jest nieaktualnych, robi kopię każdego nadpisywanego pliku i zapisuje w dzienniku
  każdy dodany, więc **Cofnij ostatnie** czyści całość.
- Pozycja liczy się jako **zrobiona**, gdy wszystkie pliki z archiwum leżą na miejscu
  i mają zgodny rozmiar — dopóki tak jest, Patcher nie ma czego robić i nie proponuje
  tej pozycji do zastosowania.
- Wersja archiwum ma być **w nazwie pliku** (`nakladka-1.0.0.zip`), bo nazwa trafia
  wprost do manifestu. Nowa wersja plików = nowe wydanie presetu z nowym ZIP-em.
- `"onlyIfMissing": true` przy `unpack: "zip"` patrzy na **katalog docelowy, nie na
  poszczególne pliki** — przy `"target": "."` katalog gry zawsze istnieje, więc pozycja
  nigdy się nie wykona. Ma to sens tylko przy własnym podkatalogu (`kubejs/moja-nakladka/`).

Pojedynczy plik (bez pakowania) wgrywa ta sama operacja bez `unpack`:

```json
{ "op": "installAsset", "asset": "moj-config.toml", "target": "config/moj-config.toml" }
```

### 4.5 Ścieżki — granica zaufania

Manifest przychodzi z internetu, więc ścieżki są pilnowane dwa razy: przy walidacji
i ponownie przy wykonaniu.

| Zapis | Gdzie trafia |
|---|---|
| `config/mod.toml` | katalog gry (`minecraft/`) — domyślnie |
| `@instance/instance.cfg` | katalog instancji (obok `instance.cfg`) |
| `@tools/moje-narzedzie` | `.tfg-patcher/tools/` w instancji |

**Zabronione i odrzucane:** ścieżki bezwzględne (`C:\...`, `/etc/...`) i wyjście przez
`..`. Wszystko musi zostać wewnątrz instancji użytkownika.

### 4.6 Profile i domyślne zaznaczenie

Profile (`standard`, `high`, `server`) to **jeden selektor na całe okno**, wspólny dla
wszystkich presetów. Nie są Twoje — pierwszy preset, który je przynosi, ustala ich nazwy
i wartości, a pozostałe deklaracje tego samego `id` są ignorowane.

**Dlatego najlepiej nie deklaruj profili w ogóle.** Twoje pozycje i tak wykonają się
w każdym profilu; deklaracja własnego `standard` niczego nie doda, a stworzy złudzenie,
że sterujesz czymś, czym nie sterujesz. Profile są potrzebne tylko wtedy, gdy Twój preset
ma **własne zmienne o wartościach zależnych od maszyny**:

```json
"profiles": [
  { "id": "standard", "label": "Standard", "default": true, "vars": { "jakosc": "niska" } },
  { "id": "high",     "label": "High",                      "vars": { "jakosc": "wysoka" } }
]
```

Niezależnie od tego pozycja może być domyślnie odznaczona w wybranym profilu:

```json
"selected": { "server": false }
```

Wartością może być `true`/`false` (wszędzie tak samo) albo obiekt `{profil: bool}`
z opcjonalnym kluczem `"*"` jako wartością domyślną. Jeśli **Twój** manifest deklaruje
profile, nazwy są sprawdzane przy walidacji i literówka nie przejdzie po cichu; jeśli nie
deklaruje, wolno Ci wskazać cudzy profil (jak `server` wyżej) i nikt tego nie sprawdzi.

Odznaczone ≠ ukryte: pozycja jest widoczna i użytkownik może ją zaznaczyć ręcznie.

### 4.7 Wydanie presetu

Razem z manifestem wgraj **wszystkie załączniki, do których się odwołuje** przez
`installAsset` — inaczej te pozycje pokażą się u ludzi jako „nie pobrano załącznika":

```powershell
gh release create preset-1.0.0 `
  preset-1.0.0.json nakladka-1.0.0.zip `
  --title "Configi 1.0.0" --generate-notes
```

Wydanie z presetem żyje **obok** Twoich wydań z modami, w tym samym repozytorium.
Tag `preset-1.0.0` wygląda jak tag moda (`preset` w wersji `1.0.0`), ale nie ma jara,
więc nie zostanie wzięty za moda — Patcher rozpoznaje po załączniku, nie po tagu.

Pełną specyfikację formatu (z każdym polem) znajdziesz w repozytorium configów:
`docs/PRESET-FORMAT.md`.

---

## 5. Wpięcie Twojego repozytorium do Patchera

Patcher czyta `sources.json` — rejestr samych adresów:

```json
{
  "repos": [
    { "repo": "twoj-login/twoje-repo", "label": "TwojLogin", "side": "both" }
  ]
}
```

**Jeden wpis wystarczy na wszystko, co wydajesz** — mody i preset z tego samego repo
Patcher znajdzie sam, bo sprawdza każde repozytorium pod obie konwencje.

| Pole | Znaczenie |
|---|---|
| `repo` | `wlasciciel/repozytorium` — jedyne obowiązkowe |
| `label` | nazwa źródła w logu i w planie |
| `side` | `client`, `server` albo `both` — gdzie Twoje mody mają sens |
| `only` / `except` | lista nazw modów do wzięcia / pominięcia (opcjonalnie) |
| `prerelease` | `true`, jeśli prereleasy też mają się liczyć (opcjonalnie) |

Starsze wersje Patchera miały osobne listy `mods` i `configs`. Nadal są czytane
(nic nie trzeba przepisywać), ale wpadają do tej samej listy — rodzaj repozytorium
przestał cokolwiek znaczyć.

**Nie trzeba zmieniać aplikacji.** Każdy użytkownik może dopisać dowolne repozytorium
u siebie, w pliku:

```
%LOCALAPPDATA%\TFG-Patcher\sources.json
```

Ten sam format; wpisy doklejają się do wbudowanych, a powtórzone `repo` liczy się raz.
To jest droga na testy i na źródła, które nie mają iść do wszystkich.

---

## 6. Sprawdzenie, że działa

Poproś kogoś z Patcherem (albo zrób to sam z kodu źródłowego):

```powershell
# same źródła, bez dotykania jakiejkolwiek instancji
node src\cli.js --refresh
```

W logu ma się pojawić Twoje repozytorium i to, co Patcher w nim zobaczył:

```
Sprawdzam repozytoria (2)...
  Mody AtmatiAdi: 1 wydan -> 1 modow
      mapatlas 0.4.0 (mapatlas-0.4.0.jar)
  TwojLogin: 4 wydan -> 2 modow, preset w preset-1.0.0
      pominieto jakis-tag (tag nie pasuje do <mod>-<x.y.z>)
    pobieram mojmod-1.2.jar (412 KB)
      mojmod 1.2 (mojmod-1.2.jar)
      innymod 0.4.0 (innymod-0.4.0.jar)
    pobieram preset-1.0.0.json (22 KB)
      preset Moje configi 1.0.0 (5 pozycji)
    pobieram nakladka-1.0.0.zip (163 KB)
```

Czego szukać w tym zrzucie:

- **jedna linia na repozytorium** podsumowuje, co w nim zobaczono: ile modów i czy jest
  preset. Twoje repo ma się tam pojawić, nawet jeśli nic z niego nie wynika,
- **liczba modów** zgadza się z tym, co spodziewasz się widzieć,
- **wersja** przy każdym modzie to ta najnowsza,
- linie `pominieto ...` mówią **dlaczego** coś odpadło — to najszybsza droga do przyczyny,
- preset pokazuje nazwę, wersję i liczbę pozycji; jeśli jest `ODRZUCONY`, poniżej stoją
  konkretne błędy walidacji,
- `0 wydan -> 0 modow` to **dobra** wiadomość o pustym repo: GitHub odpowiedział.
  Repozytorium prywatne albo z literówką w nazwie daje `HTTP 404` — inną linię.

Plan złożony z tego, co pobrane, obejrzysz bez dotykania instancji:

```powershell
node src\cli.js --list
```

Pobrane pliki lądują w:

```
%LOCALAPPDATA%\TFG-Patcher\cache\<wlasciciel>__<repo>\<tag>\<plik>
```

Kasowanie tego katalogu jest bezpieczne — najwyżej wszystko pobierze się jeszcze raz.
Plik o zgodnym rozmiarze nie jest ściągany ponownie, więc kolejne sprawdzenia są tanie.

---

## 7. Limity

Anonimowo GitHub daje **60 zapytań na godzinę na adres IP**. Patcher robi jedno
zapytanie na repozytorium (plus pobrania nowych plików), więc w normalnym użyciu to
nie przeszkadza. Przy intensywnym testowaniu warto ustawić token:

```powershell
$env:TFG_GITHUB_TOKEN = "ghp_..."      # tylko na tę sesję
```

albo na stałe w `%LOCALAPPDATA%\TFG-Patcher\token.txt`. Token jest **opcjonalny**
i służy tylko Tobie — odbiorcy Twoich wydań go nie potrzebują, o ile repo jest publiczne.

---

## 8. Lista kontrolna przed pierwszym wydaniem

- [ ] repozytorium jest **publiczne** (sprawdzone w oknie prywatnym)
- [ ] tag ma postać `<mod>-<x.y.z>` — nazwa, myślnik, liczby z kropkami
- [ ] jar jest **załącznikiem wydania**, nie plikiem w repo
- [ ] nazwa jara zaczyna się od nazwy z tagu
- [ ] wydanie **nie jest** draftem ani prereleasem
- [ ] pierwsza linia notatek to jedno zdanie o tym, po co ten mod
- [ ] (preset) manifest przechodzi walidację, a wszystkie jego załączniki są w tym wydaniu
- [ ] (preset) ZIP z plikami gry ma w środku ścieżki od katalogu gry (`kubejs/...`)
- [ ] (preset) `id` pozycji i grup są na tyle własne, że nie zderzą się z cudzymi
- [ ] `node src\cli.js --refresh` pokazuje Twoje repo z właściwą wersją
