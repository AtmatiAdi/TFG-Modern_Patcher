# Jak wydawać, żeby Patcher to zobaczył

Patcher nie zna żadnego moda ani żadnej optymalizacji „na sztywno". Zna **repozytoria**
(`sources.json`) i pyta GitHuba, co w nich jest. Dołożenie moda albo zmiana configów to
wydanie na GitHubie — nie zmiana w tej aplikacji i nie nowy `.exe`.

**Repozytorium nie ma rodzaju.** Każde z `sources.json` jest sprawdzane pod obie
konwencje naraz, więc jedno repo może wydawać mody, configi albo jedno i drugie:

| Co wydajesz | Czego Patcher szuka |
|---|---|
| **mod** | wydania o tagu `<mod>-<x.y.z>` z załącznikiem `.jar` |
| **configi i pliki gry** | najnowszego wydania z załącznikiem `preset-*.json` |

Podział na `mods` i `configs` istniał wcześniej i był błędny: autor wydający jednocześnie
mody i pliki gry (kubejs, configi) musiałby prowadzić dwa repozytoria albo pogodzić się
z tym, że połowa jego pracy jest niewidoczna.

---

## 1. Wydanie moda

Tag niesie **nazwę i wersję**, i to on decyduje o wszystkim:

```
mapatlas-0.4.0        ->  mod "mapatlas", wersja 0.4.0
map-atlas-v1.2.3      ->  mod "map-atlas", wersja 1.2.3   (litera "v" jest opcjonalna)
```

```powershell
gh release create mapatlas-0.4.0 `
  mapatlas\build\libs\mapatlas-0.4.0.jar `
  --title "Map Atlas 0.4.0" `
  --notes "Mapa rezerwuje caly obszar, remap 1:1 przy chodzeniu z atlasem w rece."
```

Tyle. Następne uruchomienie Patchera (albo przycisk **Sprawdź źródła**) pobierze
`mapatlas-0.4.0.jar` i usunie starszą wersję z `mods/`.

### Co się dzieje z tagami

- **Jedno wydanie = jeden mod.** Patcher grupuje wydania po nazwie z tagu i bierze
  **najwyższą wersję każdego moda**. Nie trzeba dopinać cudzych jarów do każdego wydania
  ani rozbijać modów na osobne repozytoria:

  ```
  mapatlas-0.4.0   ->  mapatlas 0.4.0
  innymod-1.2      ->  innymod 1.2      <- to jest "latest" w repo
  mapatlas-0.3.0   ->  pominiete, starsza wersja
  ```

- **Wersje porównywane są liczbowo, odcinkami.** `0.10.0` jest **wyżej** niż `0.9.0`,
  choć alfabetycznie wypada odwrotnie. To nie jest szczegół — porównanie napisów cicho
  instalowałoby starszy jar i wyglądałoby na poprawne działanie.
- **Tag, który nie pasuje do wzorca, jest pomijany** i wypisany w logu. To celowe: repo
  może mieć wydania niebędące modami.
- **Drafty i prereleasy są pomijane.** Draft to wygodny sposób, żeby przygotować wydanie,
  zanim trafi do ludzi.
- **Jar musi być załącznikiem**, nie tylko plikiem w repo — archiwa źródeł, które GitHub
  dokleja sam, nie wystarczą. Bierzemy załączniki `.jar` zaczynające się od nazwy moda,
  a gdy takich nie ma — wszystkie `.jar` z wydania.
- **Starsze wersje w `mods/` usuwają się same.** Maska (`mapatlas-*.jar`) wyprowadzana
  jest z nazwy moda, więc nikt jej nie wpisuje i nie da się o niej zapomnieć — dwie kopie
  moda w `mods/` to crash gry.
- **Pierwsza linia notatek wydania** trafia do planu jako opis pozycji. Autor moda nie
  musi niczego dopisywać w żadnym innym repozytorium.
- **Ten sam mod w dwóch repozytoriach** to jedna pozycja, nie dwie: wygrywa wyższa wersja,
  a log mówi, skąd została wzięta. Dwa wpisy o tej samej nazwie byłyby nie do pogodzenia —
  oba usuwałyby jara tego drugiego przy tej samej masce `<mod>-*.jar`.

### Bez `gh` (przez stronę)

Releases → *Draft a new release* → tag `mapatlas-0.4.0` → przeciągnij jar w pole
załączników → *Publish release*.

---

## 2. Wydanie configów (presetu)

Preset to **jeden plik** `preset-<wersja>.json` jako załącznik wydania, plus załączniki,
do których się odwołuje (shaderpack, zzipowane narzędzia, paczka plików gry). Z każdego
repozytorium Patcher bierze **najnowsze** wydanie zawierające taki plik — presety tego
samego autora się nie sumują, nowszy zastępuje starszy.

Presety **różnych** repozytoriów sumują się już jak najbardziej: ich grupy i pozycje
składają się w jeden plan. Profile są wspólne — wygrywa pierwszy preset, który je
przynosi (kolejność z `sources.json`), więc preset dokładający same pliki nie powinien
w ogóle deklarować profili. Gdy dwa presety nadadzą pozycji to samo `id`, drugie
w kolejności dostaje dopisek `@<autor>`, żeby nic nie zniknęło po cichu.

Tag wydania z presetem (`preset-3.0.0`) wygląda jak tag moda, ale bez załącznika `.jar`
nie zostanie za moda wzięty — i nie jest z tego powodu zgłaszany w logu jako pominięty.

Instrukcja i skrypt pakujący są po tamtej stronie:
`TFG-Modern_atmatiadi_configs/docs/RELEASING.md` (`pwsh -File build/pack.ps1 -Release`).
Format manifestu opisuje `docs/PRESET-FORMAT.md` — **umowa obu repozytoriów**, więc jego
zmiana to zmiana po obu stronach i podbicie `formatVersion`.

Manifest, którego Patcher nie rozumie, jest **odrzucany w całości** i mówi o tym w logu.
Lepiej brak pozycji niż połowa wykonanej optymalizacji.

---

## 3. Dołożenie własnego repozytorium

`sources.json` to sama lista adresów:

```json
{
  "repos": [
    { "repo": "wlasciciel/repo", "label": "Nazwa w logu", "side": "both" }
  ]
}
```

| Pole | Znaczenie |
|---|---|
| `repo` | `wlasciciel/repozytorium` na GitHubie — jedyne pole obowiązkowe |
| `label` | nazwa źródła w logu i w planie |
| `side` | `client`, `server` albo `both` — gdzie mody z tego repo mają sens |
| `only` / `except` | lista nazw modów do wzięcia / pominięcia |
| `prerelease` | `true`, jeśli prereleasy też mają się liczyć |

Jeden wpis obejmuje **wszystko**, co repozytorium wydaje — mody i preset. Stare klucze
`mods` i `configs` są nadal czytane (nic nie trzeba przepisywać) i wpadają do tej samej
listy.

**Bez ruszania aplikacji** dopisuje się je w pliku użytkownika:
`%LOCALAPPDATA%\TFG-Patcher\sources.json` — ten sam format, doklejany do wbudowanego
(powtórzone `repo` liczy się raz).

---

## 4. Repozytorium z wydaniami musi być PUBLICZNE

Najłatwiej się na tym przejechać: **na repo prywatne GitHub odpowiada `404`, nie `403`** —
celowo, żeby nie zdradzić, że coś takiego istnieje. Patcher u odbiorcy chodzi anonimowo,
więc prywatne repo z wydaniami dla niego **nie istnieje**, choć Ty widzisz je w
przeglądarce bez problemu.

Alternatywa — token u każdego odbiorcy — nie działa w praktyce: token daje dostęp do
całego konta, więc nie rozdaje się go znajomym.

Publiczne repo na wydania może nie mieć **żadnego kodu** — wystarczy, że istnieje.
Sprawdzenie w 5 sekund, w oknie prywatnym (wylogowany):
`https://github.com/<wlasciciel>/<repo>/releases/latest`

---

## 5. Limity i token

Anonimowo GitHub daje 60 zapytań na godzinę na adres IP. Token podnosi limit i wpuszcza
do repo prywatnych:

```powershell
$env:TFG_GITHUB_TOKEN = "ghp_..."     # tylko na tę sesję
```

albo na stałe — `%LOCALAPPDATA%\TFG-Patcher\token.txt`. Wystarczy token z uprawnieniem
`repo` (albo *fine-grained* z dostępem tylko do wskazanych repozytoriów). Token jest
opcjonalny: bez niego wszystko publiczne działa normalnie.

---

## 6. Gdzie lądują pobrane pliki

`%LOCALAPPDATA%\TFG-Patcher\cache\<wlasciciel>__<repo>\<tag>\<plik>`

- pobranie zdarza się **raz na wersję** — plik o zgodnym rozmiarze nie jest ściągany ponownie,
- `catalog.json` w tym samym katalogu pamięta, co zostało rozwiązane, więc Patcher pokazuje
  sensowny plan także **bez internetu**,
- gdy GitHub nie odpowiada, źródło zostaje przy wersji z cache i mówi o tym w logu; reszta
  planu działa normalnie,
- kasowanie tego katalogu jest bezpieczne — najwyżej wszystko pobierze się jeszcze raz.

---

## 7. Test bez wydawania czegokolwiek

```powershell
$env:TFG_SOURCES_FILE = "C:\tmp\test-sources.json"
$env:TFG_CACHE_DIR    = "C:\tmp\cache"
node src\cli.js --refresh
node src\cli.js -i <instancja> --offline
```

Tak właśnie sprawdzono ten mechanizm: pobranie z prawdziwego wydania, ponowne uruchomienie
bez transferu, tryb offline, wgranie do atrapy instancji i cofnięcie.
