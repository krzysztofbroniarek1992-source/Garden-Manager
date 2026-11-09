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

GM-009A: `versionName=0.4.1-test.1`, `versionCode=3` (poprzedni APK miał kod 2).
Workflow buduje **rzeczywiste źródła GM-009** (commit `567e633`) jako A/kod 2,
następnie nowy kod jako B/3, z tym samym kluczem w jednym jobie. To test zachowania
danych podczas aktualizacji, a nie dowód zgodności podpisu z telefonem.
Przy kolejnych wydaniach zwiększ kod, zachowując applicationId i podpis.

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

## Aparat i dokumentacja — poprawka GM-009A

Przyczyna potwierdzona w kodzie: poprzedni listener `appRestoredResult` odrzucał
wynik, nie sprawdzał pluginu/metody/statusu i zawsze wyświetlał komunikat o śmierci
procesu. Plik i jego cel istniały wyłącznie w pamięci React. Zdarzenie Capacitor
opisuje odtworzenie wywołania mostka, **nie dowodzi zmiany PID**. Dodatkowo stary
wielokrotny picker Camera używał dynamicznego callbacka niezapewniającego odtworzenia.

Mały adapter `GardenCamera` korzysta z `ACTION_IMAGE_CAPTURE` i
`ACTION_OPEN_DOCUMENT` (JPEG/PNG/WebP, wiele plików) oraz trwałego `@ActivityCallback`.
Przed otwarciem zapisuje synchronicznie UUID, rodzaj, czas, kategorię i identyfikatory
klienta/ogrodu/strefy/zlecenia w izolowanych preferencjach `pending-photo-operation`.
To kontekst **jednego niezakończonego wyboru**, nie druga baza biznesowa.
Surowe pliki tymczasowe znajdują się w prywatnym `files/pending-media/<UUID>`.
Nie ma base64 zdjęć w localStorage ani dodatkowych kopii w publicznej galerii.

Wynik trafia do tego samego formularza, zarówno przez obietnicę, jak i odtworzone
zdarzenie. Po nowym procesie lub ponownym uruchomieniu odczytujemy trwały wynik;
ponowione zdarzenia są rozpoznawane po UUID. Statusy sukces/anulowanie/błąd są
rozdzielone, obce pluginy/metody ignorowane. Błąd odczytu można ponowić lub świadomie
odrzucić. Przerwany wybór można anulować, bez blokowania aparatu do końca okresu ważności.

Zapis **zawsze wymaga zatwierdzenia**. Gdy zapisany cel nie istnieje lub zmienił
powiązania, formularz nie zgaduje nowego: użytkownik wskazuje klienta/ogród/zlecenie.
Przed zapisem istniejący serwis ponownie sprawdza aktualny IndexedDB. Stałe ID pozycji
wyboru chronią przed podwójnym zapisem po przerwaniu potwierdzenia natywnego. Polecenie
może otrzymać taki ID; format metadanych i model **v10 nie zmieniają się**.

Limity pozostają: 25 MB/plik, 20 plików/wybór, 50 mln pikseli, wynik do 1920 px,
miniatura 320 px, sumy kontrolne i dotychczasowy magazyn IndexedDB. Aparat otrzymuje
czasowy grant wyłącznie do pliku wyjściowego; galeria udostępnia tylko wskazane pliki.
Własne pliki i kontekst są usuwane po zapisie/anulowaniu albo wygasają po 24 godzinach
(sprzątanie przy kolejnym dostępie). Nieusunięte pliki po awarii są również sprzątane.
Nie kasujemy oryginałów z cudzej galerii. Nieutrwalone szkice opisu nie są trwałą bazą.

## Szybkie tworzenie danych podczas edycji zlecenia

`+ Nowy klient`, `+ Nowy ogród`, `+ Nowy materiał w katalogu` otwierają istniejące
formularze i zapisują przez dotychczasowe komendy atomowe. Callback po udanym zapisie
wybiera klienta/ogród albo dodaje materiał ze snapshotem nazwy, jednostki i ceny
zakupu, ilością 1 i edytowalną ceną dla klienta. Nie ma automatycznej marży.
Zatwierdzona należność nadal wymaga osobnej jawnej zmiany. Późniejsza edycja katalogu
nie zmienia materiałów historycznych.

Szkic zlecenia pozostaje zamontowany, także po anulowaniu lub błędzie zapisu dziecka.
Podwójne zatwierdzenie jest blokowane. Wierzchnie okno ma fokus i obsługę Back/Escape;
niższe okna są nieaktywne, a ich niezapisane dane nadal chronione przy opuszczaniu
widoku. Zapis dziecka nie wysyła formularza zlecenia. Bez klienta tworzenie ogrodu
jest zablokowane. Zlecenie można rozpocząć również przy pustej bazie i utworzyć cały
łańcuch bez wychodzenia z jego formularza. Funkcje działają w web i Androidzie;
tryb terenowy jest dodatkowym interfejsem, nie zamiennikiem pełnej aplikacji.

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

Provider GardenFiles udostępnia wyłącznie `cache/garden-exports` i własne
`files/pending-media`, nie profil WebView. Stary provider Camera pozostaje dla zgodności biblioteki. Nie ma szerokiego dostępu do dysku.
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
przygotowuje pełne dane v10 z istniejącej fixture regresyjnej (niepuste harmonogramy
GM-005, wystąpienia, dostępność, płatności, notatki, sprawy, checklisty, katalog,
zatwierdzone rozliczenia i zapisany raport), prawdziwy blob zdjęcia/miniatury oraz aktywny stoper,
wykonuje force-stop, instaluje B przez `adb install -r` i w nowym procesie
porównuje **cały** zapis v10, SHA zdjęcia/miniatury i ciągłość stopera. Następnie
ponawia odczyt po kolejnym force-stop. Nie odinstalowuje aplikacji.

Workflow wykonuje ten scenariusz na emulatorze API 35. Lokalny brak `/dev/kvm`
nie jest zaliczonym testem emulatora. Testy systemowego aparatu, wyboru miejsca,
odbiorców udostępniania, fizycznego restartu oraz zachowania producenta telefonu
nie są zastępowane testami JVM/Chromium ani powyższym runnerem.
Fixture testowego APK można odtworzyć poleceniem
`node scripts/generate-android-test-data.mjs`; nie korzysta ono z danych użytkownika.

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
- Pełny E2E Chromium: **324/324**, jeden kompletny zielony przebieg.
- Emulator Android API 35 w GitHub Actions: **4/4 wykonania** (3 różne testy):
  natywny start/PDF offline/Back, przygotowanie pełnej fixture, porównanie po
  aktualizacji A → B i ponowne porównanie po force-stop. Oba odczyty zachowały
  cały zestaw v10, SHA zdjęcia/miniatury oraz aktywny timer.
- Weryfikacja emulatora: [zielony przebieg](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/42594146864),
  kod aplikacji `febe20ec87c95863652e471fdc84ab1f440a4bcc`.
- Android lint: 0 błędów, 29 ostrzeżeń dotyczących ikon/zasobów, kolejności
  manifestu, reguł ekstrakcji kopii systemowych i warunku SDK. Nie blokują
  debug APK; nie są deklaracją pełnego odbioru wizualnego na każdym urządzeniu.
- Czyste `npm ci`, TypeScript, produkcyjne buildy web/Android, `git diff --check`,
  kontrola zawartości APK, podpis apksigner i zipalign: zaliczone.
- Lokalne oraz CI APK A/B rzeczywiście zbudowane. Sprawdzony plik CI B ma
  9 257 993 bajty i SHA256
  `84a58767d1b2e840169f37f916241059c650cbd5fee7353c06406169bde61753`.
  [Artefakt APK](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/42594146864/artifacts/13661464923)
  zawiera parę A/B ze zgodnym podpisem. Późniejsze buildy mają osobne artefakty;
  używaj jednej pary z tego samego przebiegu i sprawdź opis PR dla najnowszego pliku.
- Testy aparatu/galerii, importu ZIP i operacji plików w Chromium są symulacją
  bridge. Testy JVM sprawdzają rzeczywiste operacje na plikach, ale nie aparat,
  systemowy picker ani zewnętrzny czytnik PDF. Te integracje wymagają telefonu.
- Fizyczny telefon: niewykonane; lista odbioru powyżej.

Rekomendacja: gotowe do przeglądu i scalenia jako wersja **testowa** Androida. Nie jest deklaracją gotowości
produkcyjnej przed przejściem wymaganych prób na fizycznym telefonie i ustaleniem
stałego podpisywania kolejnych wydań.

## Stały podpis kolejnych wersji testowych — GM-009A

Repozytorium nadal używa **jednego** sekretu `ANDROID_TEST_KEYSTORE_BASE64`.
Lokalne uruchomienie `./gradlew :app:assembleDebug` tworzy standardowy plik
`~/.android/debug.keystore`, jeśli jeszcze go nie ma. Administrator zachowuje ten
plik poza repozytorium, wykonuje
jego bezpieczną kopię i umieszcza zawartość zakodowaną base64 w tym sekrecie GitHub
(Settings → Secrets and variables → Actions). Nie wkleja pliku ani haseł do czatu,
PR, dokumentacji lub logów. Każde kolejne wydanie musi używać tego samego pliku.
Jeżeli zachowano klucz już zainstalowanej aplikacji, należy użyć właśnie jego.
Ręczne uruchomienie workflow domyślnie wymaga sekretu (`require_stable_signing=true`).
PR bez sekretu może nadal przeprowadzić testy i stworzyć **jednorazowy** debug APK,
wyraźnie oznaczony `ephemeral-debug` w `APK-METADATA.json`. Nie jest to obietnica aktualizacji.

Publiczny certyfikat poprzedniego artefaktu 0.4.0-test.2, run `42595627510`:
`0a0004911306792c5700e43440b2be8f483b497330d50203e8e1abb6feb3bfcd` (SHA-256).
SHA samego APK z tego przebiegu:
`0ab534a01ff4dc52611c03e5c7ed8c385888b8d858a2037a03d4cf0eaa4c792e`.
Nowy artefakt zawiera publiczne `APK-METADATA.json` z wersją, kodem, SHA APK,
SHA certyfikatu, trybem podpisywania i wynikiem porównania z tym przebiegiem.
Jeżeli telefon otrzymał inny artefakt, porównaj certyfikat jego APK poleceniem
`apksigner verify --print-certs <poprzedni.apk>`. Sam numer 0.4.0-test.2 nie identyfikuje klucza.

Klucza prywatnego z jednorazowego runnera nie można odzyskać z APK/certyfikatu.
Przy niezgodności podpisu aktualizacja jest niemożliwa bez zachowanego starego klucza.
**Nie odinstalowuj od razu.** Najpierw zapisz pełny ZIP w zewnętrznej lokalizacji,
skopiuj go poza aplikację/telefon i sprawdź jego odtworzenie w osobnym profilu testowym:
klienci, ogrody, płatności, raporty, zdjęcia i miniatury muszą być czytelne. JSON sam
nie wystarczy. Dopiero po tej kontroli użytkownik może świadomie zdecydować o
reinstalacji i odtworzeniu ZIP. Aplikacja i workflow nie odinstalowują ani nie czyszczą
danych istniejącego telefonu oraz nie obchodzą podpisu. Od tej chwili zachowuj stały klucz.

## Testy GM-009A i kontrola telefonu

`scripts/android-camera-check.mjs` działa na prawdziwym WebView emulatora API 35,
przez ADB/CDP. Osobna aplikacja `camera-fixture` (wyłącznie testowa, poza docelowym APK)
realizuje zewnętrzny Intent i zapisuje prawdziwy JPEG do przyznanego URI. Scenariusze:
zwykły wynik, odtworzenie aktywności (`always_finish_activities`), zabicie procesu
Garden Managera w tle przez `am kill` podczas pracy aparatu i po galerii, anulowanie,
jawny zapis, poprawny cel, brak duplikatów i odświeżenie. Test śmierci procesu wymaga
zniknięcia starego PID i nowego PID po powrocie. Test A/B instaluje wcześniejsze źródła
z tym samym testowym kluczem i sprawdza zachowanie pełnego v10, plików zdjęć i stopera.
To test natywnego transportu/cyklu życia, **nie test fizycznego sensora ani aparatu OEM**.
Symulacje mostka w Chromium są opisane oddzielnie w testach.

Przed użyciem z danymi firmowymi na fizycznym telefonie sprawdź:

- W zwykłym zleceniu i GM-007: zdjęcie → zatwierdzenie w aparacie → wybrany plik
  i właściwy klient/ogród/zlecenie → opis/kategoria → jawny zapis → galeria po restarcie.
- Aparat OEM, obrót zdjęcia, anulowanie, odmowa dostępu, brak miejsca; galeria i kilka zdjęć.
- Powrót z aparatu z włączonym „Nie zachowuj aktywności”, poprawne przywrócenie i brak
  fałszywego komunikatu o śmierci procesu; ponowione wyniki nie dodają zdjęć drugi raz.
- Nowy klient → ogród → materiał w szkicu, anulowanie każdego okna, Back, klawiatura,
  zachowany fokus i wartości, również w 320/360/390/430 px.
- Pełny ZIP ze zdjęciami poza aplikacją i odtworzenie w profilu testowym.
- Podpis zainstalowanej wersji zgodny z metadanymi nowego APK przed próbą aktualizacji.

Końcowe liczby regresji i link do konkretnego artefaktu zawiera PR GM-009A.
