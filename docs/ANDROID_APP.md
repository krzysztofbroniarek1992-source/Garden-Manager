# Garden Manager — Android (GM-009)

## Architektura i zakres

To cała dotychczasowa aplikacja React/TypeScript opakowana w Capacitor, a nie
przeglądarka, PWA, skrót ani nowa wersja Lite. Wszystkie moduły korzystają z tych
samych komponentów, formularzy, komend, transakcji i zabezpieczeń GM-008.
Klienci, ogrody, strefy, zlecenia, kalendarz, GM-005, dostępność GM-006, tryb
terenowy GM-007, stoper, finanse, dokumentacja, materiały, kalkulatory i kopie są
nadal dostępne; mniej używane widoki na telefonie są w „Więcej”.

- `capacitor.config.ts`: stałe `pl.broniarek.gardenmanager`, Garden Manager,
  `https://localhost`, `webDir: dist`. Nie ma `server.url` ani serwera Vite w APK.
- `android/`: kompletny projekt Gradle, wrapper z kontrolą SHA256, aktywność,
  adapter plików i testy. Nie zmienia katalogu/profilu danych WebView.
- `src/platform/`: małe adaptery aparatu, plików, cyklu życia i Android Back.
- `vite.config.ts`: zwykły build nadal tworzy PWA. Tylko `--mode android`
  wyłącza service worker — zasoby są dostarczane przez APK, bez drugiego cache.
- PDF, fonty DejaVu, CSS, obrazy i wszystkie chunki JS są dołączone do APK.
  Pierwszy start nie potrzebuje internetu, komputera ani wcześniejszego cache.

Nie zmieniono danych v10, numeracji raportów, reguł rozliczeń, płatności,
zaokrągleń, czasu pracy, GM-005/006 ani historii. Nie dodano synchronizacji,
serwera, kont, reklam, telemetrii, Windows ani nowych funkcji biznesowych.

## Narzędzia i budowanie

Sprawdzona konfiguracja: Node 24, JDK 21, Android SDK Platform 36,
Build Tools 36.0.0, AGP 8.13.0, Gradle 8.14.3. `JAVA_HOME` musi wskazywać JDK
(z `javac`), a nie sam JRE. Capacitor core/CLI/Android 8.6.0, App 8.1.2,
Camera 8.2.6 są przypięte w lockfile. CLI wymaga Node >=22, zgodnego z projektem.
Minimalny Android: API 24 (Android 7); wymagany aktualny System WebView dla
tego systemu. Bezpieczeństwo danych zależy od działającego IndexedDB/Web Locks,
a nie od alternatywnego zapisu localStorage.

```bash
npm ci
npm run android:sync
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest
```

Ustaw Android SDK przez `ANDROID_HOME` lub lokalny `android/local.properties`:
`sdk.dir=/twoja/sciezka/do/Android/Sdk`. Nie zatwierdzaj tego pliku. W Windows
użyj `gradlew.bat`; można też uruchomić `npm run android:open` w Android Studio.
`npm run android:apk` wykonuje build web, synchronizację i build debug.

Wynik: `android/app/build/outputs/apk/debug/app-debug.apk`.
Testowy runner: `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.
Do powtarzania synchronizacji zawsze używaj **android:sync**, ponieważ zwykłe
`npm run build` celowo zawiera service worker przeznaczony dla przeglądarki.

Workflow [Android APK](../.github/workflows/android.yml) wykonuje te kroki bez
Android Studio i udostępnia `GardenManager-Android-debug` w GitHub Actions →
konkretny przebieg → Artifacts. Artefakt zawiera APK B, APK A do testu aktualizacji,
runner i SHA256SUMS. Artefakty wygasają po 30 dniach; zachowaj pobrany plik.

Wyjątek instalacyjny: istniejący lockfile odwoływał się do niedostępnego na npm
`for-each@0.3.6` (HTTP 404). Jedyny override przypina dostępne `0.3.5` dla
zależności narzędziowych. Czysta instalacja jest sprawdzana; nie zmieniono
zależności finansowych ani modelu danych.

## Instalacja, podpis i wersje

Przenieś APK na telefon, zezwól **wybranej aplikacji instalującej** na instalację
z tego źródła i otwórz plik. Alternatywnie z włączonym USB debugging:

```bash
adb install -r GardenManager-Android-debug.apk
adb shell am start -n pl.broniarek.gardenmanager/.MainActivity
```

Pierwsza wersja lokalna ma `versionName=0.4.0-test.1`, `versionCode=1`.
Workflow buduje A z kodem 1 oraz B z kodem 2 i nazwą `0.4.0-test.2`.
Przy kolejnych wydaniach zwiększ kod, zachowując applicationId i podpis:

```bash
./gradlew :app:assembleDebug -PgmVersionCode=3 -PgmVersionName=0.4.0-test.3
```

Numer Androida nie jest formatem danych **v10**. Wersja interfejsu web zachowuje
istniejący numer; wersję pakietu widać w informacjach Androida o aplikacji.

Debug APK jest podpisany automatycznym kluczem testowym. Nie jest wydaniem
produkcyjnym ani publikacją w Google Play. Kluczy prywatnych nie ma w repozytorium
ani w artefakcie APK. Aktualizacja wymaga tego samego applicationId **i zgodnego
podpisu**, nie tylko większego numeru. Zachowaj klucz `~/.android/debug.keystore`
na komputerze budującym, jeśli chcesz aktualizować tę instalację debug.

**GitHub Actions bez własnej konfiguracji tworzy klucz na czas pojedynczego
jobu.** A i B z jednego artefaktu mają ten sam podpis. Nie gwarantujemy aktualizacji
pomiędzy artefaktami z różnych przebiegów. Do takich aktualizacji potrzebny jest
zachowany klucz testowy skonfigurowany bezpiecznie poza kodem.
Workflow obsługuje opcjonalny sekret repozytorium `ANDROID_TEST_KEYSTORE_BASE64`
z zawartością zgodnego standardowego debug.keystore. Bez niego używa klucza
utworzonego w jobie; nie ma sekretów ani kluczy w kodzie/artefakcie. Nie wklejaj kluczy
ani haseł do czatu/PR. Przejście z podpisu debug na inny produkcyjny wymaga
zewnętrznej pełnej kopii ZIP, świadomej reinstalacji i odtworzenia danych.
Nigdy nie odinstalowuj aplikacji z danymi tylko po to, aby ominąć błąd podpisu.

## Trwałe dane i aktualizacje

- `garden-manager-state`: ten sam atomowy IndexedDB jako źródło prawdy.
- `garden-manager-photos`: dotychczasowe pliki, miniatury i dziennik odtwarzania.
- `garden-manager:v1`: niezmieniona kopia zgodności w localStorage.
- Osobne SharedPreferences `navigation-ui` zawierają tylko ostatni adres widoku,
  bez rekordów, zdjęć, szkiców lub danych biznesowych.
- Cache plików eksportu jest wyłącznie tymczasowy. Nie zawiera głównej bazy.

Zwykła aktualizacja `adb install -r`, zakończenie procesu i restart telefonu
nie są operacjami czyszczenia danych. Kod nie resetuje IndexedDB ani profilu.
Nie zmieniaj origin, applicationId, katalogu profilu ani schematu bez odrębnej
strategii migracji. Android Auto Backup jest wyłączony — świadomą kopią jest ZIP.

Odinstalowanie, „Wyczyść dane”, utrata/uszkodzenie urządzenia usuwają lokalne dane.
Nie ma automatycznej synchronizacji ani gwarancji odzyskania po odinstalowaniu.
Wykonuj i sprawdzaj kopie **poza aplikacją/telefonem**. Dane przeglądarki komputera
nie są automatycznie widoczne w WebView telefonu, mimo podobnych nazw localhost.

## Import z komputera i kopie

1. Na komputerze: Ustawienia → „Pobierz pełną kopię ZIP”.
2. Przenieś plik ZIP na telefon, np. przez USB.
3. Android: Ustawienia → „Wczytaj pełną kopię ZIP”; systemowy picker daje dostęp
   tylko do wybranego pliku.
4. Dotychczasowy mechanizm sprawdza manifest, sumy, limity, metadane i zdjęcia.
5. Sprawdź podsumowanie, zaznacz potwierdzenie i wpisz **ODTWÓRZ**.
6. „Odtwórz dane i zdjęcia” świadomie zastępuje bieżący zestaw. Obowiązuje
   dotychczasowy punkt odzyskiwania i ochrona przed nieaktualnym stanem.

Import nie zapisuje danych na etapie wyboru/walidacji. Anulowanie niczego nie
zastępuje. Podczas aktywnego pomiaru odtwarzanie jest blokowane jak dotychczas;
nie zatrzymujemy go automatycznie. Wizyta uruchomiona w samej kopii jest obsługiwana
przez dotychczasowe reguły importu, bez zmiany zasad w GM-009.

ZIP można zapisać przez systemowy wybór lokalizacji lub udostępnić. JSON używa
tego samego adaptera zapisu, ale zawiera **metadane, bez plików zdjęć**. JSON nie
jest pełną kopią dokumentacji. Nie dodano odrębnego importera ani formatu kopii.
Wykonanie ZIP przy braku pliku lub niespójnej sumie nie usuwa żadnych danych.

Limit ZIP: 200 MB, dotychczasowy limit rozpakowania 250 MB i danych JSON 10 MB.
Urządzenie musi mieć wolną pamięć operacyjną i dyskową na przygotowanie kopii.
Systemowy wybór miejsca może pokazać zewnętrznych dostawców plików; zapis do
nich wymaga ich dostępności. Lokalny folder telefonu działa offline.

## Aparat i dokumentacja

„Zrób zdjęcie” używa Camera, wybór z galerii używa systemowego pickera. Wynik URI
jest odczytywany jako File i trafia do **tego samego** procesora oraz magazynu
fotografii: limity, korekta orientacji, JPEG/PNG/WebP, zmniejszenie do 1920 px,
miniatury 320 px, sumy kontrolne, powiązania i atomowe operacje metadanych.
Anulowanie nie tworzy rekordu. Odmowa uprawnienia/błąd jest widoczna.

Wybranie zdjęcia nie zapisuje go automatycznie — nadal potwierdza się formularz.
Aparat nie zapisuje dodatkowej kopii do publicznej galerii (`saveToGallery=false`).
Po odczycie usuwamy tylko własne pliki tymczasowe Camera, nigdy oryginały z cudzej
galerii. Nieodczytane resztki we własnym cache/Pictures są sprzątane po 48 h przy
kolejnym uruchomieniu. Pliki w IndexedDB pozostają pod kontrolą istniejącego
serwisu, bez nowego systemu przechowywania. Nie ma pełnych zdjęć w localStorage.

Jeśli Android ubije proces podczas zewnętrznego wyboru, pokazujemy informację
o odtworzonym wyniku. Trzeba ponownie wybrać właściwą wizytę/plik; nie zgadujemy
powiązania i nie powtarzamy zapisu. Niezapisane szkice nie są trwałą bazą.

## Pliki PDF/JSON/ZIP

`GardenFiles` kopiuje Blob fragmentami 192 KiB przez bridge do prywatnego cache,
sprawdza kolejność i rozmiar (maks. 200 MB). Nie przenosi całego ZIP jako jednego
base64 i nie utrwala go w localStorage. Osobne eksporty mają osobne tokeny/pliki.

- **Zapis:** Storage Access Framework `ACTION_CREATE_DOCUMENT`; użytkownik
  wybiera miejsce. Potwierdzenie następuje po zakończeniu kopiowania.
- **Otwórz PDF:** `ACTION_VIEW`, MIME `application/pdf`, content URI FileProvider.
- **Udostępnij:** `ACTION_SEND`, poprawny MIME, ClipData i czasowy dostęp do odczytu.
  Otwarcie panelu nie oznacza potwierdzenia dostarczenia pliku odbiorcy.
- **Import:** `ACTION_OPEN_DOCUMENT`; strumień ograniczony do 200 MB przed
  dotychczasową walidacją ZIP. MIME/nazwa nie są uznawane za dowód poprawności.

Provider eksportów udostępnia wyłącznie `cache/garden-exports`, nie profil WebView.
Provider aparatu obejmuje własny cache/Pictures. Nie ma szerokiego dostępu do dysku.
Cache wyeksportowany do czytnika/udostępniania umożliwia odbiorcy odczyt po zamknięciu panelu. Resztki starsze niż 48 h są
usuwane przy kolejnym starcie; Android może zwolnić cache wcześniej. Zapis do
wybranej zewnętrznej lokalizacji jest trwałą kopią niezależną od cache. Własny cache ma limit 600 MB; zapisane do wybranej lokalizacji
pliki są niezależne od tego cache. Odbiorca może skopiować udostępniony dokument.

Historia i numer raportu są zatwierdzane **przed** przekazaniem PDF do Androida.
Błąd/cancel/ponowienie zapisu lub brak czytnika nie alokuje nowego numeru.
Można ponownie pobrać tę samą historyczną wersję. Gdy nie ma aplikacji do PDF,
pokazujemy błąd i można zapisać dokument; nie znika istniejący podgląd HTML.
Nieudany zapis nie nadpisuje stanu aplikacji. Niekompletny nowy eksport jest
usuwany w miarę możliwości; nigdy nie usuwamy pliku źródłowego ani historii.

## Stoper i cykl życia

Jedyny stoper opiera się na zapisanych znacznikach czasu i dotychczasowych
komendach START/PAUZA/WZNÓW/STOP. Zdarzenie wznowienia wysyła tylko sygnał focus:
GardenProvider odczytuje aktualny IndexedDB, a useNow przelicza widok od Date.now.
Nie ma automatycznego STOP/START, nowego zlecenia, zdjęcia ani cyklu zabiegu.
Nie potrzeba aktywnego JavaScript w tle, usługi foreground ani powiadomienia.

START 08:00 i ponowne otwarcie 11:30 daje 3:30, także po zamknięciu procesu.
Pauza pozostaje pauzą, STOP wymaga istniejącego potwierdzenia. Obowiązują nadal
kontrole starego polecenia z drugiej instancji i ręczna korekta po zatrzymaniu.
Zmiana zegara systemowego podlega istniejącym regułom stopera, nie jest nowym
zegarem niezależnym od czasu urządzenia.

## Android Back, klawiatura i nawigacja

Back zamyka najwyższe aktywne okno przez te same procedury co X/Escape.
Potem używa wspólnego kontrolera historii, a na korzeniu prosi o potwierdzenie
przejścia do ekranu głównego telefonu. Nie jest bezwarunkowym history.back().
Aktywny pomiar nie blokuje wyjścia; samo wyjście go nie zatrzymuje.

Niezapisane formularze wymagają potwierdzenia. Trwający zapis/picker/eksport
blokuje opuszczenie; Back pokazuje, że trzeba poczekać. Odmowa zapisu pozostawia
szkic. Ochrona nie może wymusić zapisania szkicu przy ubiciu procesu przez Androida,
wyłączeniu zasilania lub awarii WebView — zapisz formularz przed taką operacją.
Nie utrwalamy automatycznie plików lub szkiców w drugim systemie danych.

Adres ostatniej karty/sekcji/kalendarza jest odtwarzany przed startem React.
Brakujące rekordy obsługuje istniejąca nawigacja. Historia/filtry zachowują się
jak dotychczas w działającym WebView; po całkowitej utracie procesu odtwarza się
adres, nie cała ulotna historia i fokus poprzedniego procesu.

MainActivity wyznacza insets system bars/cutout/IME; treść WebView nie zachodzi
pod pasek ani klawiaturę. Jasne paski mają ciemne ikony. Istniejące formularze,
modalne okna, daty, godziny, dolne menu i tryb terenowy nie są zastępowane.
Szerokości 320, 360, 390 i 430 px obejmują testy układu; fizyczna klawiatura i
różnice producentów wymagają prób opisanych niżej.

## Uprawnienia i przyszłe platformy

Manifest wynikowego APK żąda INTERNET (standard Capacitor; start działa offline).
AndroidX dodaje techniczne uprawnienie signature
`pl.broniarek.gardenmanager.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; chroni
wewnętrzny odbiornik i nie daje dostępu do danych telefonu.
Zewnętrzna aplikacja aparatu i systemowy Photo Picker nie wymagają deklarowania
przez Garden Manager szerokich uprawnień kamery/pamięci. SAF daje dostęp wyłącznie
do wybranego pliku. Nie ma MANAGE_EXTERNAL_STORAGE, lokalizacji, kontaktów,
SMS, połączeń, mikrofonu ani trwałej usługi w tle. Nie ma reklam/analiz ruchu.

Przyszły Windows może użyć kolejnego adaptera plików, bez rozdzielenia logiki.
Przyszła synchronizacja wymaga osobnego projektu konfliktów, dostępu, migracji
zdjęć i numeracji. Obecnie APK **nie synchronizuje** danych z komputerem.
Identyfikatory i historie pozostają niezmienione.

## Testy automatyczne

Wyniki końcowe są zapisane w sekcji „Weryfikacja GM-009” poniżej. Polecenia:

```bash
npm test
npx tsc -b
npm run test:e2e
npm run test:pwa
npm run test:android-web
npm run android:sync
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest
cd ..
python3 scripts/check-android-package.py android/app/build/outputs/apk/debug/app-debug.apk
git diff --check
```

Testy TS i `android-bridge.spec.ts` symulują bridge w Chromium: nie są testami
urządzenia. Sprawdzają m.in. dane i pełny ZIP ze zdjęciem, wyjątki aparatu,
Back z niezapisanym formularzem i trwającym commitem, wznowienie stopera,
numerację PDF przy nieudanym otwarciu oraz dostępność wszystkich modułów.
`test:android-web` podaje **zbudowane** zasoby bez serwera i z wyłączoną siecią,
bez SW; nadal jest symulacją Chromium, nie dowodem instalacji APK.

`FileStageStoreTest`: rzeczywiste testy JVM adaptera plików (kolejność, długości,
oddzielne eksporty, MIME, limity, usuwanie, nazwy). `check-android-package.py`
sprawdza sam ZIP APK: lokalny origin, brak server.url/SW, chunki i fonty PDF.
Podpis APK należy dodatkowo sprawdzić `apksigner verify --verbose --print-certs`.

### Powtarzalny test rzeczywistego Androida i aktualizacji

Tylko na pustym emulatorze/testowej instalacji. Nie używaj tej procedury do bazy
firmowej: runner tworzy testowe dane bezpośrednio w IndexedDB. Zbuduj A, zachowaj
APK i runner, następnie B z większym versionCode **z tym samym kluczem**.

```bash
scripts/android-device-check.sh GardenManager-A.apk GardenManager-Android-debug.apk GardenManager-test.apk
```

Skrypt wyłącza sieć emulatora, instaluje A, wykonuje test prawdziwego WebView i
native bridge (origin, brak SW, moduły, PDF offline, Android Back/ostrzeżenie),
przygotowuje dane v10, prawdziwy blob zdjęcia/miniatury oraz aktywny stoper,
wykonuje force-stop, instaluje B przez `adb install -r` i w nowym procesie
porównuje **cały** zapis v10, SHA zdjęcia/miniatury i ciągłość stopera. Następnie
ponawia odczyt po kolejnym force-stop. Nie odinstalowuje aplikacji.

Workflow wykonuje ten scenariusz na emulatorze API 35. Lokalny brak `/dev/kvm`
nie jest zaliczonym testem emulatora. Testy systemowego aparatu, wyboru miejsca,
odbiorców udostępniania, fizycznego restartu oraz zachowania producenta telefonu
nie są zastępowane testami JVM/Chromium ani powyższym runnerem.

## Lista odbioru na fizycznym telefonie — nie odznaczać bez wykonania

- [ ] Zainstaluj testowy APK i zanotuj wersję/podpis; pierwszy start w trybie samolotowym.
- [ ] Otwórz każdy moduł z menu, klient → ogród → strefa → zlecenie → dokumentacja i powrót.
- [ ] Na 320/360/390/430 px sprawdź przewijanie, dolne menu, paski systemowe, obrót i dużą czcionkę.
- [ ] Klawiatura: tytuł/notatka na dole formularza, daty/godziny, przewijanie, zamknięcie klawiatury gestem Back.
- [ ] Aparat: zrób portret i krajobraz; sprawdź orientację, kategorię, przypisanie, powiększenie, miniaturę i restart.
- [ ] Anuluj aparat/picker, odmów dostępu, spróbuj dużego/nieprawidłowego zdjęcia; nie ma pustego rekordu ani utraty innych danych.
- [ ] Zaimportuj pełny ZIP z komputera z rzeczywistymi zdjęciami; sprawdź klientów, strefy, wizyty, płatności, GM-005/006 i dokumentację.
- [ ] Anuluj wybór/import; wybierz błędny ZIP; sprawdź walidację i brak zmiany danych.
- [ ] Zapisz JSON i ZIP w wybranym **zewnętrznym** miejscu, udostępnij ZIP; odczytaj je poza aplikacją i odtwórz ZIP z potwierdzeniem/punktem odzyskiwania.
- [ ] Wygeneruj PDF ze zdjęciami i polskimi znakami; zapisz, otwórz, udostępnij. Porównaj numer PDF z historią.
- [ ] Bez czytnika PDF sprawdź komunikat i ponowne pobranie tej samej wersji; cancel miejsca zapisu nie duplikuje historii.
- [ ] START → PAUZA → WZNÓW → potwierdzony STOP, korekta; jednoznacznie sprawdź brak automatycznego STOP.
- [ ] START, blokada ekranu, powrót po dłuższej przerwie: licznik uwzględnia całą pracę.
- [ ] START, usuń aplikację z ostatnich/force-stop (bez „Wyczyść dane”), uruchom: licznik i historia zachowane.
- [ ] Uruchom stoper, zrestartuj telefon i wróć offline: zachowany timer i wszystkie dane.
- [ ] PAUZA + force-stop/restart: pozostaje pauzą, bez doliczenia przerwy.
- [ ] Niezapisany formularz + Back: anuluj ostrzeżenie, sprawdź szkic; potem zaakceptuj. Podczas zapisu Back czeka.
- [ ] Przy małej ilości miejsca spróbuj zapisu zdjęcia/ZIP/PDF: widoczny błąd, istniejące dane i kopia nadal czytelne.
- [ ] Przerwij eksport/import na instalacji testowej, uruchom ponownie; sprawdź dziennik i punkt odzyskiwania.
- [ ] Aktualizacja A → B zgodnym podpisem **bez odinstalowania**: timer, zdjęcia, raporty, harmonogramy, dostępność i płatności pozostają identyczne.
- [ ] Dwie karty przeglądarki: starsze formularze i powtórzone polecenia nie nadpisują nowszego zapisu (dotychczasowe kontrole GM-008).

## Weryfikacja GM-009

- Jednostkowe: 605/605; JVM adaptera plików: 10/10.
- PWA offline: 17/17, TypeScript i produkcyjny build web: zaliczone.
- Pakiet produkcyjny bez sieci/serwera: 1/1 (Chromium, symulacja).
- Pełny E2E i emulator: weryfikacja w toku; końcowe wyniki w opisie PR.
- Lokalne APK A/B rzeczywiście zbudowane; podpis i zawartość sprawdzone.
- Fizyczny telefon: niewykonane; lista odbioru powyżej.


Rekomendacja dotyczy wersji **testowej**. Nie jest deklaracją gotowości
produkcyjnej przed przejściem wymaganych prób na fizycznym telefonie i ustaleniem
stałego podpisywania kolejnych wydań.
