# GM-011B — postęp i punkty kontrolne

Baza: main **8cc997b3e5e2cee1c23923f8ca874d35e4b15669**, scalony GM-011A / PR #28.
Gałąź: codex/gm011b-business-sync. Nowy PR pozostaje Draft do spełnienia pełnych kryteriów odbioru.
GM-011A, tożsamości LAN i magazyny kluczy są wykorzystywane ponownie, nie odtwarzane.

## Stan faktyczny — punkt 0

- Potwierdzono aktualny main i brak istniejącego otwartego PR GM-011B.
- Przeczytano AtomicRepository, GardenStore, walidację v12, klientów/ogrody/zlecenia i płatności, stoper i historię czasu, raporty, wydatki/CSV, zakupy, harmonogramy, checklisty, notatki i dostępność.
- Kanoniczny stan jest rekordem current w garden-manager-state / state. Każda komenda GardenStore pracuje na świeżym stanie w jednej transakcji readwrite; localStorage pozostaje kopią zgodności.
- Brak rewizji klientów i ogrodów; strefy, materiały zlecenia, historia czasu i raporty są zagnieżdżone. Samo updatedAt lub revision nie wystarcza do scalania między urządzeniami.
- Nie ma jeszcze działającej synchronizacji biznesowej, nowych natywnych pakietów ani zaliczonych testów GM-011B. Tego punktu kontrolnego nie wolno traktować jako gotowego odbioru.

## Wybór architektury

1. Dziennik, zegary przyczynowe, potwierdzenia, tombstones, konflikty i lokalna tożsamość repliki są projektowane jako rekordy **oddzielnego magazynu sync w tej samej bazie IndexedDB**, poza obiektem Data. Zapis current i dziennika musi zatwierdzać się lub wycofywać razem. Nie ma uzasadnienia zmiany biznesowego v12 → v13 ani klucza localStorage. Pierwsza jawna aktywacja dziennika podnosi techniczną wersję bazy IndexedDB z 1 do 2. Dzięki temu starszy writer GM-011A, otwierający jawnie wersję 1, nie może zapisać current z pominięciem dziennika. Przed zmianą zachowany jest dokładny rekord źródłowy.
2. Identyfikator repliki historii jest stabilny i lokalny, oddzielony od kopii firmowej; powiązanie z uwierzytelnioną instalacją GM-011A następuje przy onboardingu. Nie zależy od IP. Nie kopiujemy kluczy, certyfikatów ani zaufania przez JSON/ZIP.
3. Operacja ma niezmienną tożsamość źródła, monotoniczny licznik, UUID oraz wektor poprzednio znanych operacji. Przekazanie przez telefon zachowuje oryginalną operację i jej kontekst. Zegary ścienne służą prezentacji, nie wyborowi zwycięzcy.
4. Jedna atomowa komenda lokalna tworzy atomową paczkę zmian rekordów. Zmiana zakupu i utworzenie wydatku albo ukończenie wystąpienia i powiązanie wizyty nie mogą zostać dowolnie rozdzielone przy odbiorze.
5. Jednoznaczne niezależne rekordy mogą się łączyć. Automatyczne scalanie pól ma początkowo wąską białą listę (np. telefon kontra notatka klienta); finanse, historia czasu, raporty i powiązane dane wymagają zachowania spójnej jednostki oraz pełnej walidacji Data.
6. Konflikt nie jest zastosowaną operacją. Może być trwale odebrany do osobnej kolejki oczekującej, lecz zegar zastosowanych zmian i trwałe potwierdzenie nie mogą twierdzić, że zmodyfikował bazę. Niezależne paczki mogą postępować dalej.
7. Przed pierwszym scalenieniem powstaje podgląd i lokalny punkt odtworzenia. Identyczne ID nie dowodzi wspólnego przodka. Niezależne bazy muszą przejść jawne uzgodnienie; podobne nazwiska i transakcje nie są kluczem automatycznej deduplikacji.
8. Odtworzenie starego JSON/ZIP nie odtwarza starego dziennika jako aktualnego. Wymaga zatrzymania propagacji i ponownego uzgodnienia historii; stare tombstones i potwierdzenia nie są po cichu usuwane.
9. Zakończone pomiary i Job.seconds muszą być rozpatrywane razem. Timer jest lokalny; paczka dotykająca aktywnej wizyty ma zostać odroczona bez zatrzymywania pomiaru. Nie sumujemy dwóch alternatywnych wartości seconds ani nie usuwamy korekt.
10. Obecne numery BO/rok/licznik są globalnie unikalne tylko wewnątrz instalacji. Dwa offline urządzenia mogą nadać ten sam numer różnym wizytom. Wydanych numerów nie wolno przepisywać. Przed włączeniem nowych raportów wielourządzeniowych potrzebna jest jawna, przetestowana polityka przydziału; kolizja historyczna ma blokować właściwą paczkę i pokazywać konflikt.

## Granice zdjęć i dokumentacji

photos, photoRestoreId, pliki i miniatury pozostają lokalne. Także referencje photoId/photoName w notatkach i checklistach oraz obrazy historycznego raportu wymagają świadomej projekcji lokalnej. Nie tworzymy rekordów zdjęć bez plików, nie kasujemy lokalnej dokumentacji i nie zmieniamy wydanego snapshotu raportu. Nie ma GM-011C.

## Dziennik i retencja

Nie wolno usuwać tombstones ani dowodów odebrania potrzebnych długo nieobecnym replikom. Projekt przewiduje jawne limity oraz wycofanie całej komendy przy niemożności bezpiecznego zapisu. Kompakcja może nastąpić wyłącznie po udowodnieniu bezpiecznego checkpointu/uzgodnieniu uczestników, nigdy przez skasowanie starych wpisów według daty. Dokładna polityka i testy retencji pozostają do wdrożenia; nie deklarujemy nieograniczonej przestrzeni.

## Kolejne punkty kontrolne

- [ ] Czysty silnik przyczynowości, walidacji i planowania zmian + testy wektorów, replay, tombstones i konfliktów.
- [ ] Atomowy dziennik w IndexedDB, zachowanie oryginalnego v12, restart, rollback i dwie karty.
- [ ] Projekcja wszystkich jednostek v12, zależności, CSV/płatności/zakupy oraz ochrona czasu i numerów.
- [ ] Onboarding istniejących baz, trwałe konflikty i świadome decyzje.
- [ ] Wersjonowane rozszerzenie istniejącego transportu, limity, porcjowanie, integralność i trwałe potwierdzenia; stary klient syntetyczny nie przyjmuje danych biznesowych.
- [ ] Wspólny UI Sprawdź zmiany → Synchronizuj teraz, rzeczywisty postęp i odzyskiwanie.
- [ ] Automatyczne dwie/trzy repliki, testy właściwościowe i rzeczywisty natywny transport.
- [ ] Pełna regresja i pakiety 0.7.0-test.1, metadane/SHA256 i instrukcja odbioru.

## Środowisko i bezpieczeństwo publikacji

Lokalny executor jest niedostępny. Zmiany są zapisywane bezpośrednio przez GitHub i sprawdzane w GitHub Actions; nie deklarujemy lokalnie wykonanych poleceń lub testów. Dane testowe są wyłącznie syntetyczne. Publiczne repozytorium nie zawiera danych klientów, rzeczywistych identyfikatorów instalacji, prywatnych kluczy ani sekretów.

Nie scalać automatycznie. Nie uruchamiać GM-011C, synchronizacji w tle ani internetowej. Jeśli pełne kryteria nie są spełnione, PR pozostaje Draft z dokładną listą braków.

## Punkt 1 — silnik przyczynowy, implementacja w toku

Dodano src/sync/model.ts i causal.ts: niezmienne operacje źródłowe, wektory wiedzy, monotoniczne liczniki, kolejkę luk przyczynowych, idempotencję i wykrywanie innej treści pod tą samą tożsamością. Rejestry pól zachowują wcześniejsze zapisy nawet po późniejszej edycji innego pola klienta. Rekordy inne niż płaskie pola klienta pozostają jednostkami nierozdzielnymi. Usunięcie kontra edycja i niezależne różne utworzenia tego samego ID powodują konflikt. Jawna decyzja może zachować obecną wartość, a mimo to tworzy nową operację przyczynową.

Dodano 22 testy jednostkowe, w tym syntetyczny przepływ A ↔ B ↔ C, odwróconą kolejność, luki, replay, tombstones, konflikt ceny i losową sekwencję 120 operacji. To testy czystego silnika, **nie** końcowy test trwałych baz i natywnego transportu. Workflow Business sync foundations sprawdzi TypeScript, nowe testy i dotychczasowe jednostkowe. Wyniki pozostają do potwierdzenia w CI.

Wektor known oznacza odebranie i sprawdzenie przyczynowości; nie jest potwierdzeniem trwałego zastosowania danych biznesowych. Ten moduł nie modyfikuje Data, nie ma dostępu do IndexedDB i nie uruchamia komunikacji LAN. Następny punkt: trwały dziennik i adaptery jednostek v12. PR pozostaje Draft.

## Punkt 2 — jawna aktywacja trwałego dziennika, implementacja w toku

Poprawiono błąd zawężania typu w nowym walidatorze JSON. Workflow pierwszego punktu przeszedł TypeScript, testy silnika i dotychczasowe testy jednostkowe. Nie była to awaria istniejącej logiki biznesowej.

Dodano opt-in enableSyncJournal w AtomicRepository. Zwykły start oraz GM-011A nie aktywują dziennika. Przy aktywacji powstaje magazyn sync w DB v2, dokładny checkpoint przed zmianą schematu oraz rekord v12 sprzed aktywacji. Dane biznesowe nadal mają wersję 12. Starszy writer jawnie otwierający DB v1 jest blokowany przez IndexedDB VersionError, zamiast tworzyć niezarejestrowane zapisy.

Po aktywacji każda komenda GardenStore zapisuje current i operację w tej samej transakcji state+sync. Awaria journal.put wycofuje oba zapisy; localStorage jest projektowany dopiero po zatwierdzeniu. Dwie karty korzystają z tej samej tożsamości/licznika w kanonicznym magazynie, niezależnie od swoich kopii localStorage.

Projekcja rekordów obejmuje kolekcje v12. Wizyta wraz z płatnościami, ceną, czasem i historią jest jedną jednostką. Timer, Data.photos i photoRestoreId nie są operacjami. Referencje zdjęć w notatkach/checklistach nie opuszczają lokalnej projekcji. Raport wymagający zdjęć pozostaje lokalny w pełnej postaci; w jednostce wizyty rejestrowana jest tylko tożsamość dokumentu/rezerwacja numeru. Odbiór takich dokumentów, dostępność plików i polityka numeracji pozostają do ukończenia i nie są przedstawiane jako pełna synchronizacja raportów.

Przy restoreSnapshot oryginalny dziennik i liczniki nie są cofane; nowe lokalne zmiany są zapisywane, ale trwały stan restore-review będzie wymagał kreatora przed ponowną propagacją. **Kreator, odbiór zmian biznesowych, kontrola zastosowanych operacji i natywna wymiana nie są jeszcze zaimplementowane.**

Dodano 14 testów jednostkowych dziennika: źródła v12, blokada starego writera, dwie karty, restart, quota/rollback, pełny mirror, zakupy+wydatki, płatności, wykluczenie zdjęć, stoper, przywrócenie i niespójny dziennik. Ich wynik pozostaje do potwierdzenia w CI. Następnie wymagane są testy rzeczywistego IndexedDB w Chromium oraz dopracowanie ograniczeń i retencji. Dziennik w obecnej implementacji zachowuje historię do jawnego limitu; nie wdrożono jeszcze bezpiecznej kompakcji.

To nadal punkt kontrolny Draft, nie wersja 0.7.0 gotowa do instalacji ani odbioru.


### Punkt 2a — rzeczywisty Chromium

Dodano sześć E2E dla rzeczywistego IndexedDB w Chromium: aktywacja i źródła v12, dwie karty, wymuszony błąd quota i rollback obu zapisów, restart/blokada writera v1, nieudana aktywacja i ponowienie oraz prawdziwy syntetyczny JPEG w magazynie zdjęć z eksportem/odczytem ZIP i restore-review. To nie jest jeszcze test natywnego LAN ani przekazania danych biznesowych między replikami. Nowy workflow uruchamia je jako osobny szybki punkt kontrolny; pełne dotychczasowe workflow pozostają włączone.


### Poprawki punktu kontrolnego

Pierwsze testy dziennika przeszły jednostkowo; Chromium zaliczył 5/6 nowych scenariuszy. Fixture zdjęcia tworzył plik poza blokadą garden-manager-photos, więc istniejące porządkowanie plików osieroconych mogło usunąć go przed zapisem metadanych. Test korzysta teraz z rzeczywistego PhotoService.add i BrowserPhotoProcessor; nie zmieniono modułu fotografii ani nie usunięto asercji eksportu/odczytu ZIP. Wynik ponowienia będzie zapisany po CI.

Dodano także test nieudanego otwarcia DB v2: źródło v12 pozostaje czytelne, a aktywację można ponowić po ustąpieniu błędu. Odrzucona obietnica połączenia nie może trwale blokować tego ponowienia.


## Punkt 3 — kodek pakietów, bez podłączenia do LAN

Na head 6dc9878 CI zaliczyło **37/37 nowych jednostkowych, 720/720 pełnych jednostkowych i 6/6 nowych E2E rzeczywistego IndexedDB**. Fixture zdjęcia korzystający z istniejącego PhotoService.add zaliczył JPEG/ZIP i izolację dziennika. TypeScript i git diff --check są zielone na tym punkcie.

Dodano kodek businessProtocol=1 / dataVersion=12: części 64 KiB, limit pakietu 10 MiB, oryginalne operacje, SHA256 WebCrypto, kontrola ofert, kolejności/powtórzeń, niekompletnego i uszkodzonego transferu. Zablokowano przygotowanie transferu dla restore-review bez domyślnego pomijania tego warunku. Dodano 10 testów kodeka; ich wynik wymaga CI bieżącego commitu.

Kodek nie jest podłączony do istniejących natywnych kanałów i nie zapisuje bazy odbiorcy. Nie jest to test natywnej wymiany rekordów ani dowód końcowej synchronizacji trzech replik. docs/GM011B_ARCHITECTURE.md opisuje dokładne granice oraz blokady przed wdrożeniem zatwierdzania biznesowego.

**Nie ukończono GM-011B.** Pozostają: przyjmowanie i atomowe stosowanie operacji odebranych, trwałe rozstrzygnięcia i potwierdzenia, onboarding i kreator restore, zależności i polityki finansów/CSV/czasu/raportów, retencja, natywny transport, interfejs, rzeczywisty test trzech replik i pakiety 0.7.0. PR pozostaje Draft; dotychczasowy ekran Synchronizacja nadal jest testem GM-011A.


### Przegląd wspólnego przodka

Przegląd wykrył zbyt słabe określanie wspólnej wartości pola: dwa urządzenia mogły niezależnie zapisać tę samą wartość pośrednią, a potem różne wartości. Sama równość before nie dowodziła wspólnego przodka. Informacja o bazie konfliktu pochodzi teraz z przecięcia wektorów przyczynowych; dodano regresję tego wariantu i sprawdzenie bazy całego agregatu finansowego. Nie stosowano zegarów ściennych ani LWW.

Końcowe wyniki automatycznych kontroli bieżącego HEAD są aktualizowane w opisie PR #29. Historyczne wyniki podpunktów odnoszą się wyłącznie do wymienionych commitów. Pozostałe blokady pełnego GM-011B są nadal otwarte.

### Dodatkowa kontrola przyczynowości i ponownego utworzenia

Przegląd dodał odrzucanie wektora, który wskazuje poprzednika, ale pomija jego zależności. Taki kontekst nie reprezentowałby poprawnego stanu repliki. Walidacja trwałego dziennika sprawdza tę samą regułę. Dodano test regresyjny oraz test ponownego utworzenia klienta po usunięciu: scalanie późniejszych niezależnych pól nie może przywrócić telefonu ze starego, usuniętego wcielenia rekordu. Utworzenie resetuje także nieobecne pola w rejestrach. Wyniki wymagają ponownego CI.

### Granica raportów z lokalnymi zdjęciami

Ujednolicono kwalifikację raportów zawierających lokalne referencje zdjęć: także niewidoczne, zapamiętane photoIds w opcjach wymagają pozostawienia pełnego dokumentu lokalnie. Flaga tożsamości requiresAssets używa teraz tej samej reguły co wykluczanie pełnego raportu. Test sprawdza oba warianty, brak ID zdjęcia w projekcji oraz brak zmiany historycznego raportu w Data. Nie zmieniono numeracji ani generatora PDF.

### Regresja instalatora Windows — oczekiwanie na zakończenie zdjęcia

Na bab9eac szybkie kontrole przeszły (52/52 nowych, 735/735 pełnych jednostkowych, 6/6 nowych E2E, PWA 20/20, Android web 1/1, TypeScript i build). Windows zaliczył 14/14 rzeczywistych testów Electron oraz budowę instalatora, lecz scenariusz NSIS zatrzymał się przy tworzeniu danych w **starej wersji A**, przed aktualizacją do nowego kodu. Po dodaniu zdjęcia helper widział już miniaturę i natychmiast zmieniał hash na zakupy, nie czekając na koniec PhotoService/formularza. Istniejąca blokada pendingWrite mogła prawidłowo odmówić takiej nawigacji; test potem nie znajdował formularza zakupów. Dodano jawne oczekiwanie na zniknięcie photo-upload oraz aria-busy=false. Nie wyłączono ochrony niezapisanych zmian, nie zmieniono kodu fotografii ani asercji zachowania danych. Nie uznajemy pierwszego przebiegu NSIS za zaliczony; wymaga ponownej kontroli na poprawionym helperze.

## Punkt 4 — trwały odbiór i kontrolowane stosowanie (w realizacji)

Zakres tego punktu: klienci, ogrody/strefy, katalog oraz niezależne notatki/sprawy. Finanse, wizyty/czas, raporty, CSV, zakupy, planowanie i zdjęcia pozostają zablokowane jako całe jednostki. Nie dodajemy natywnego polecenia modyfikacji bazy ani pełnego UI.

Przegląd ujawnił problem bootstrapu: jedna operacja całego snapshotu wiązałaby klientów z nieobsługiwanymi finansami. Nowa jawna aktywacja zapisuje osobne operacje rekordów w tej samej transakcji aktywacji. Nie zmienia ani nie dzieli już istniejących operacji. Dawne wielotypowe operacje pozostają atomowe i mogą wymagać późniejszego onboardingu. Checkpointy oraz v12 / IDB v2 zostają zachowane.

Silnik zachowuje częściową wartość niekonfliktujących pól klienta do świadomej decyzji. Jawne rozstrzygnięcie może zawierać powiązaną, niekonfliktującą zmianę (np. tombstone notatki); każdy taki poprzednik nadal musi się dokładnie zgadzać i operacja musi rzeczywiście rozstrzygać co najmniej jeden konflikt. Dodano regresję. Nie jest to zgoda na automatyczne scalanie finansów.

Dodawany adapter podstawowy ma ścisłą białą listę, pełną walidację Data oraz próby istniejących reguł domenowych na odłączonej kopii. Nie zapisuje efektów pobocznych tych prób, lokalnych zdjęć ani stopera. Trwały odbiór/planowanie i testy trzech magazynów są następnymi podpunktami; nie deklarujemy ich ukończenia na tym commicie.

### Punkt 4b — inbox, plan i zatwierdzenie (implementacja do weryfikacji)

Dodano receiver-v1 w istniejącym magazynie sync (bez zmiany IDB v2 i Data v12). Oddzielne stany obejmują trwały odbiór, lukę przyczynową, sprawdzenie, plan, zależność rekordów, konflikt, blokadę typu, applied, jawne zastąpienie rozstrzygnięciem i odrzucenie. known pozostaje wyłącznie wiedzą przyczynową. Dane sieciowe nie mogą nadawać statusu applied.

Surowe operacje oczekujące są przechowywane w inbox; dopiero udowodnione następstwo trafia do log. Dzięki temu wadliwa opóźniona operacja nie blokuje odebrania poprawnego poprzednika i niezależnych rekordów. Nie zmieniono semantyki istniejącego czystego receive.

API wewnętrzne AtomicRepository: receiveSyncOperations, readSyncReceiver, planSyncOperations, applySyncPlan, resolveSyncConflict. Odbiór i plan nie zmieniają Data. Plan ma tokeny stanu/dziennika/inbox. Zastosowanie zapisuje Data, journal i receiver w tej samej transakcji, a odpowiedź powstaje dopiero po oncomplete. Zapisano checkpoint przed pierwszym i przed ostatnim zastosowaniem; powtórzony plan po utracie odpowiedzi zwraca poprzednie trwałe potwierdzenie.

Konflikty zawierają wspólną bazę wyłącznie z dowodem przyczynowym, wariant lokalny i głowy zdalne, operacje, powód oraz status. Decyzja tworzy oryginalną nową operację instalacji podejmującej decyzję. Warianty odrzucone decyzją mają status resolved, a nie fałszywe applied. Finanse i inne nieobsługiwane grupy pozostają blocked; zależność od niezastosowanej wersji tego samego rekordu oraz nieuzgodniony rodzic ogrodu wstrzymują odpowiednią grupę.

Dodano 16 testów integracyjnych na trzech oddzielnych instancjach fake-indexeddb, w tym forwarding, restart, jawny plan, konflikty i decyzje, tombstones, odwrócona kolejność, wadliwy opóźniony poprzednik, quota/rollback, powtórzone potwierdzenie, zakazane metadane applied oraz ochrona stopera/finansów. To jeszcze nie test trzech rzeczywistych magazynów Chromium ani natywnego LAN; taki test przeglądarkowy jest kolejnym podpunktem. Wyniki tego commitu wymagają CI.

Walidacja pierwszego commitu inbox zatrzymała się na typie parametru enableSyncJournal: TypeScript wywnioskował typ szablonowy UUID z domyślnego crypto.randomUUID, a tabela syntetycznych originów miała typ string[]. Parametr otrzymuje teraz jawny typ string; nie zmienia to runtime walidacji UUID przez newLog. Nowe testy odbiorcy nie zostały jeszcze uznane za zaliczone.

### Punkt 4c — rzeczywisty Chromium i dodatkowe granice

Na f4b0250 CI potwierdziło 69/69 jednostkowych synchronizacji, 752/752 pełnych jednostkowych oraz 6/6 dotychczasowych E2E dziennika. Nowe 16 scenariuszy odbiorcy przeszło na trzech oddzielnych instancjach fake-indexeddb. To wynik poprzedniego punktu, nie potwierdzenie testów dodanych poniżej.

Dodano osiem E2E rzeczywistych baz IndexedDB: trzy nazwane, oddzielne bazy A/B/C, wyłącznie przekazanie przez B, integralność kodeka, powtórzenia, rozłączne pola, konflikty po reload, decyzja do C, tombstones, odwrócone luki i klient/ogród/strefa, pełne zamknięcie i ponowny start procesu Chromium na tym samym profilu między odbiorem a zastosowaniem, quota/rollback, fałszywe applied i stale plany. Test lokalnego JPEG sprawdza rzeczywisty plik, zachowanie referencji notatki i aktywnego stopera oraz blokadę finansów. Nie jest to test natywnego LAN ani trzech aplikacji na fizycznych urządzeniach.

Dodatkowe jednostkowe sprawdzają niepodzielność operacji klient+nieobsługiwane ustawienie i zakaz jej obejścia późniejszą edycją oraz wspólną decyzję notatka/tombstone. Kontrola rodzica ogrodu obowiązuje także API rozstrzygnięć. Wyniki tych dodatków wymagają bieżącego CI.

### Punkt 4d — wynik pierwszej kontroli rzeczywistych baz

Na 31c3565 przeszły nowe testy odbiorcy oraz cały szybki workflow: osiem nowych E2E Chromium i sześć wcześniejszych E2E dziennika. Szczegóły API i stanów opisano w docs/GM011B_RECEIVER.md. Dla pewnej izolacji JPEG bazę plików B nazwano osobno od domyślnej aplikacji, aby jej porządkowanie nie traktowało pliku fixture jako osieroconego. Kod produkcyjnego magazynu zdjęć nie został zmieniony.

Dodano jeszcze regresje klienta-rodzica o tym samym ID w konflikcie (ogród nie może trafić do niewłaściwej osoby) oraz zakazu użycia API decyzji dla konfliktu wizyty/finansów. Końcowa pełna regresja będzie wskazana w opisie PR na ostatecznym HEAD; wyniki wcześniejszych podpunktów są historyczne.

Przegląd weryfikacji konfliktu dodał sprawdzenie, że jego głowy, token i warianty rzeczywiście odpowiadają niezmiennym operacjom dziennika. API decyzji pobiera wersję z oryginalnej operacji, zamiast ufać kopii wariantu w metadanych. Test uszkodzonego receiver-v1 potwierdza odrzucenie bez zmiany Data. Nie resetujemy uszkodzonego rejestru.

Doprecyzowano limit surowych luk inbox (2000) oraz walidację lokalnych wyników i wariantów konfliktów. Walidacja kompletności appliedLocal używa zbioru zamiast powtarzanych przeszukań tablicy; rygor sprawdzania pozostaje ten sam. Końcowy punkt zawiera 21 testów odbiorcy i osiem nowych E2E, do potwierdzenia na tym HEAD.

### Dodatkowa granica prywatności projekcji

Przegląd wykrył, że traktowanie każdego nieobsługiwanego prefiksu jako opaque/blocked pozwalałoby umieścić niedozwolone photos/timer/tożsamości w log i przekazać je dalej kodekiem. Dodano białą listę rodzajów biznesowych v12 oraz odrzucanie lokalnych referencji w notes/checklists i zależnych od plików snapshotów raportów. Takie wejścia trafiają wyłącznie do ograniczonego audytu odrzucenia, bez zachowania ich payloadu w inbox/log i bez forwarding. Legalne jednostki finansowe v12 nadal pozostają blocked, zamiast być ryzykownie zastosowane. Dodano test pięciu wariantów; nie wykorzystuje prawdziwych sekretów ani urządzeń.

## Wznowienie po 9bb3d01 — domknięcie punktu 4

Potwierdzono rzeczywisty HEAD i wszystkie zakończone workflow 9bb3d01: 758/758 pełnych jednostkowych (75/75 synchronizacji, w tym 22 odbiorcy), 380/380 pełnych Chromium, 14/14 szybkich E2E baz, PWA 20/20, Android web 1/1, TLS 21/21, polityki Electron 6/6, rzeczywisty Electron 14/14, NSIS 1/1 + 1/1, Android JVM 20/20, instrumentacja 9/9 i aparat/galeria 5/5. TypeScript, build i git diff --check były zielone. Opis PR wskazywał jeszcze starszy head; zostanie uaktualniony.

Przerwanie nastąpiło podczas zapisu dodatkowych testów; nie znalazły się na gałęzi. Odtworzono wyłącznie te zmiany: edycja/dodanie/usunięcie niepowiązanych stref, cena katalogowa bez zmiany historycznych cen zlecenia i odrzucenie powtórzonego ID strefy; rzeczywisty JPEG obejmuje także zdalne usunięcie klienta z lokalnym zdjęciem. Klient i plik muszą pozostać zachowane przy niezależnym postępie notatki. Zestaw odbiorcy ma teraz 23 testy; wynik dodatków wymaga ponownego CI. Nie wprowadzono nowej logiki finansowej przed zamknięciem tego punktu.


## Punkt 4 zamknięty; punkt 5a — adapter finansowy w walidacji

HEAD 9bc1161 przeszedł wszystkie uruchomione workflow: 759/759 jednostkowych (76 synchronizacji, 23 odbiorcy), 380/380 pełnych Chromium, 14/14 baz IndexedDB, PWA 20/20, Android web 1/1; workflow Windows/Electron/NSIS, Android/JVM/emulator/aparat oraz TLS/IPC zielone. TypeScript/build/diff-check zaliczone. Szczegóły przebiegów w PR. Nie jest to natywny biznesowy transport.

Audyt finansów wykazał cykliczne powiązanie import CSV ↔ wydatek i tożsamość bankową zależną od profilu. Dlatego nowe/zmienione CSV, nowe profile/reguły/importy są nadal blocked do osobnego uzgodnienia kont/profili. Nie deduplikujemy po opisie ani podobieństwie.

Podpunkt 5a dodaje ograniczony adapter: kategorie (bez fizycznego usuwania), wydatki ręczne z niezmiennym pochodzeniem i zachowaniem prefiksu historii, zakupy bez powiązań ze zleceniem i atomowe powiązanie z istniejącym/nowym wydatkiem. Soft-delete zakupu i powiązanie expenseId nie mogą zniknąć. Dopisywanie płatności jest dozwolone wyłącznie dla istniejącej zakończonej, zatwierdzonej i niezmienionej wizyty; job, seconds, timeHistory, settlement i reportIdentities nie są przypisywane z sieci. Stoper tej wizyty blokuje całą operację, bez zatrzymywania pomiaru. Równoległe finanse pozostają konfliktem całego rekordu; zarówno API decyzji, jak i odebrana operacja resolution pozostają blocked dla finansów.

Identyczny rekord już istniejący lokalnie może zostać potwierdzony jako zagraniczna baza bez zmiany Data i bez deklaracji wspólnego przodka zestawu danych. Inne jednostki i niepodzielne grupy mieszane pozostają zablokowane. Wszystkie faktyczne zmiany finansowe wymagają źródłowej, zastosowanej wersji zależności oraz istniejącej walidacji Data. Odbiór nadal nie jest applied.

Dodano 11 testów trwałych magazynów finansowych i E2E rzeczywistych trzech baz: A-klient, B-zakup, C-wydatek, przekazanie przez B i brak powielania kwot; historia, zakup/wydatek, stabilne płatności, trwałe konflikty, blokada CSV, quota/rollback i restart. Wyniki tego podpunktu wymagają CI; nie deklarujemy ich zaliczenia przed odczytem przebiegów.

Następna granica po potwierdzeniu 5a: tożsamość importów CSV i atomowe zależności, pełne zlecenia/czas/rozliczenia, bezpieczne decyzje finansowe oraz polityka kolizji numerów wydanych raportów. Nie włączono UI, natywnego przesyłania biznesowego, automatycznej aktywacji, GM-011C ani wydania 0.7.


Pierwszy przebieg 5a: TypeScript przeszedł; jednostkowe 85/87. Dwie asercje zakładały, że niezależna trzecia kopia identycznej wizyty ma już wspólną historię. Silnik bezpiecznie zgłosił independent-create zamiast zastosować wpłatę; test sekwencyjnego dopisywania nie wymienił korzeni C przed edycją A. Uzupełniono jawny obieg historii przez B przed tą edycją i dodano osobny test obowiązkowej blokady niezaobserwowanej bazy. Próby nadpłaty, zmiany czasu, rozliczenia i raportu mają teraz osobne, prawidłowo uzgodnione dwie bazy; testy nie korzystają z zanieczyszczonego wcześniej wstrzykniętą operacją dziennika. Nie obniżono walidacji ani nie zmieniono silnika przyczynowego. Dodano także deterministyczną losową sekwencję dziewięciu wydatków i powtórzeń A↔B↔C z kontrolą całkowitych groszy. Aktualny zestaw 5a ma 13 testów i wymaga nowego CI.


Drugi przebieg 5a: 88/89 szybkich testów; scenariusze kwot, historii, konfliktów i losowej idempotencji przeszły. Ostatnia próba stopera miała nieprawidłowy fixture: aktywny timer wskazywał zakończoną wizytę z zatwierdzonym rozliczeniem. Istniejąca walidacja słusznie odrzuciła bazę przed aktywacją. Fixture odwzorowuje teraz poprawny stan in-progress/settlement=null na odbiorcy i zakończoną wizytę na nadawcy; przychodząca płatność ma zostać blocked bez zmiany pomiaru. Kod produkcyjny i walidacja pozostają bez zmian.


## Punkt kontrolny 5a — zapisany, wynik kodu 630ecab

Potwierdzone na 630ecab9c5caea92da469132969057af2619c3dc:
- 772/772 pełnych testów jednostkowych; 89/89 synchronizacji, w tym 13/13 nowych finansowych i 23/23 wcześniejszych odbiorcy.
- 15/15 E2E dziennika/odbiorcy w rzeczywistym Chromium, w tym dziewięć E2E receiver.
- TypeScript i git diff --check w workflow fundamentów zaliczone.
- [Przebieg pull_request](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/45074561021) oraz [przebieg push](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/45074556478).

Najnowszy commit dokumentacji nie zmienia kodu. Wynik pełnych Chromium/PWA, Windows, Androida i TLS dla końcowego HEAD należy odczytać w [aktualnych checks PR #29](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/29/checks) i opisie PR. W chwili zapisu tego checkpointu te workflow nadal pracowały; nie utożsamiamy zakończenia szybkich testów z zakończeniem całej regresji.

### Stan gotowych i wstrzymanych podmodułów

Gotowe w wewnętrznym kontrolowanym API: punkt 4 i ograniczony 5a opisany w ARCHITECTURE, sekcja 8. Bezpieczne ręczne wydatki i kategorie, niezależne zakupy i link wydatku, append-only płatności niezmienionej zatwierdzonej wizyty. Cała grupa podlega walidacji i jednej transakcji. Konflikty finansowe przetrwają restart, ale ich decyzje pozostają niedostępne. Model v12, techniczna baza v2 i kopie JSON/ZIP nie zostały zmienione.

Wstrzymane: nowe/zmienione CSV i ustawienia importu, zakupy ze zleceniem, nowe/edytowane zlecenia, czas/korekty/rozliczenia, zmiany płatności, raporty/numery, pozostałe planowanie/checklisty/ustawienia. Dla niektórych identycznych istniejących jednostek finansowych wolno wyłącznie potwierdzić oryginalny wpis bez zmiany Data. Nie jest to obejście onboardingu ani decyzja finansowego konfliktu.

### Dokładne wznowienie — punkt 5b

1. Najpierw potwierdzić HEAD i zakończenie wszystkich checks tego checkpointu; ewentualne regresje usunąć przed dalszym adapterem.
2. Zaprojektować i przetestować tożsamość profili/rachunków CSV przy niezależnych instalacjach. Obecne origin.identity zależy od profileId; nie wolno zakładać, że dwa podobne profile to ten sam rachunek. Zachować oryginalne transactionId, statementKey, match, importId, line i occurrence.
3. Zastosować import i nowe wydatki jako nierozdzielną walidowaną grupę (cykl import.rows.expenseId ↔ expense.origin.importId); wykryć tę samą bankową operację pod innymi lokalnymi ID bez automatycznego podwojenia kosztu i bez nadpisania historii. Przewidzieć jawne decyzje oraz audit, nie utożsamiać po opisach.
4. Dopiero po tych testach dokończyć adaptery pełnej wizyty, historii czasu, zatwierdzonych rozliczeń i decyzji finansowych oraz bezpieczną politykę numerów raportów offline. Nie rozstrzygać ich ogólnym wyborem wariantu, który gubi drugi audyt.
5. Następnie onboarding/restore-review/retencja, natywny negocjowany LAN i trwałe potwierdzenia, GUI planu/konfliktów, pełna regresja i dopiero wtedy pakiety 0.7.0-test.1.

PR pozostaje Draft, bez automatycznej aktywacji dziennika lub sieciowego API zapisu biznesowego. Nie przygotowywać fizycznego odbioru GM-011B na podstawie 5a. Nie jest to natywna synchronizacja Windows ↔ Android; nie wdrożono GM-011C.


## Punkt 5b — CSV, pierwszy punkt implementacji (kontynuacja e5462a9)

Potwierdzono aktualny HEAD e5462a9, Draft/niescalony PR #29 oraz komplet pięciu zielonych workflow tego HEAD. Punkty 4 i 5a pozostają zachowane. Nie ma lokalnego środowiska wykonawczego; walidację prowadzi GitHub Actions. Nie zmieniono modelu biznesowego v12 ani technicznego IndexedDB v2.

Nowy adapter bank.ts waliduje pełne kształty profili/mapowań, reguł, historii importów i oryginalnych tożsamości CSV. Import i jego nowe wydatki muszą być tą samą operacją; pełny kandydat sprawdza cykl row.expenseId ↔ expense.origin.importId/line, profileId, statementKey i match oraz początkową i bieżącą historię decyzji. Istniejący audit importu jest niezmienny. Późniejsze kategorie/statusy wydatków dopisują historię, bez przepisywania dawnej decyzji importu. Nie uruchamiamy ponownie klasyfikacji.

Ryzyko bankRisk nie jest deduplikacją po podobieństwie: ta sama identity pod innym ID, to samo źródło plik/wiersz z inną identity, nieuzgodnione różne profile oraz niejednoznaczny match bez ID bankowego skutkują trwałym blocked. Profile nie są rachunkami zweryfikowanymi przez użytkownika; różne profile z wydatkami pozostają konserwatywnie wstrzymane do przyszłego jawnego uzgodnienia, niezależnie od nazw. Sam match nigdy nie uprawnia do utożsamienia transakcji. Różne occurrences w jednym wyciągu pozostają odrębnymi rekordami. Lokalny import przy aktywnym dzienniku również sprawdza nowe wpisy względem nieuzgodnionych profili i źródeł; błąd wycofuje Data + dziennik. Zwykły import bez aktywowanego dziennika i jawny restore zachowują dotychczasowe zachowanie.

Konkretna potrzeba zmiany bootstrapu: poprzedni seed rekord-po-rekordzie rozdzielał cykl import/wydatek i nie dawał się bezpiecznie zastosować. Wyłącznie NOWE aktywacje grupują import z należącymi do niego CSV expenses, po profilach/kategoriach i przed zakupami. Zależne audyty powtórnego importu są porządkowane topologicznie, bez dat. Istniejące UUID i operacje nie są przepisywane; starsze rozdzielone seedy wymagają późniejszego onboardingu. Przekroczenie limitu lub cykl między importami blokuje aktywację, zamiast kasować dane.

Dodano 17 testów trwałych magazynów: relay A→B→C, replay, audit i sumy groszy, niezależne profile/wyciągi, lokalna ochrona po odbiorze, konflikty kategorii/statusów/profili/reguł, braki i kolejność, restart, quota/rollback, utrata potwierdzenia, bootstrap CSV, archiwizacja, occurrences i nieprawidłowe wejścia. Wyniki wymagają CI. Dotychczasowy test 5a blokady każdego CSV zmieniono na pozytywną asercję pełnego atomowego importu i zachowania origin; asercje ochrony finansów pozostają.

Następnie: rzeczywiste E2E CSV w trzech bazach Chromium, dodatkowe próby integralności, pełna regresja i końcowa dokumentacja granicy 5b. Nie uruchomiono natywnego biznesowego LAN ani GM-011C; PR pozostaje Draft.


Pierwszy wynik f87764d: TypeScript zaliczony, 105/106 testów synchronizacji, dotychczasowe 15/15 E2E baz zielone. Test archiwizacji używał niezależnie zarchiwizowanej domyślnej kategorii, której korzeń na odbiorcy pozostawał aktywny. Bez wspólnego przodka było to prawidłowo conflict/waiting-records. Test historycznej archiwizacji używa teraz własnej kategorii źródła; dodano osobny test obowiązkowej blokady niezależnego korzenia domyślnej kategorii. Nie zmieniono silnika ani walidacji. Zestaw bankowy ma 18 testów.

Dodano trzy E2E w istniejącym rzeczywistym rig A/B/C: plan CSV zachowany przez reload i relay z lokalną płatnością w B, trwałe blokady niezależnych importów/profili oraz rzeczywisty abort IndexedDB wycofujący oba rekordy i applied. Nie ma połączenia A–C ani natywnego biznesowego transportu. Wyniki nowych testów wymagają CI.


Dodatkowy przegląd integralności dodał trzy regresje: różne prawidłowe ID bankowe nie są łączone pomimo identycznego match; nadanie ID wcześniej bez-ID transakcji wymaga review (również lokalnie przy aktywnym dzienniku); occurrence musi odpowiadać liczbie takich samych oryginalnych wierszy w uporządkowanym źródle. Bieżący import nie może twierdzić, że wpływ bankowy zatwierdzono jako koszt. Dla duplicate-only audytu zachowujemy oryginalne occurrence wcześniejszej transakcji, zamiast przeliczać go według nowego pliku. Zestaw CSV ma 21 testów; wyniki wymagają kolejnego CI.


Przegląd zgodności 5a→5b ujawnił konkretną granicę: wcześniej known/blocked mógł zawierać finansowy payload opaque, który nowa walidacja odrzuci. Adapter zatrzymuje taki rekord jako FINANCE_INVALID, zamiast abortować plan bezpiecznych niezależnych rekordów. Świeży odbiór nadal odrzuca nieprawidłowe dane przed known; nic nie zostaje zastosowane. Test odtwarza dawny inbox+log w IndexedDB i potwierdza przejście niezależnego klienta oraz trwałość blokady. Nie zmieniono silnika przyczynowego ani formatu receiver.

Dodano także deterministyczny test zbieżności sześciu importów A↔B↔C i sum groszy oraz test cyklicznej, starszej historii importów: nieudana aktywacja zachowuje cały Data i source-before-db-v2. Zestaw bankowy ma 24 testy; końcowe wyniki wymagają CI.


Wynik bb72dba: 112/113 testów synchronizacji oraz 18/18 E2E rzeczywistych baz. Nowy test cyklu próbował wykonać restore fixture przy aktywnym timerze; istniejące zabezpieczenie STOP słusznie odmówiło. Wyłącznie ten fixture startuje teraz bez pomiaru, aby badać właściwy błąd cyklu bootstrap. Pozostałe 23 scenariusze CSV nadal sprawdzają aktywny lokalny timer i wcześniej zatwierdzoną płatność. Nie zmieniono kodu stopera ani reguł restore.

Dokumentacja kontraktu, blokad i dalszej granicy znajduje się teraz w GM011B_CSV.md oraz uzupełnieniach ARCHITECTURE i RECEIVER. Po poprawce fixture wymagany jest pełny zielony przebieg na końcowym HEAD. Następne zadanie po zakończeniu 5b: ochrona pełnych rozliczeń i wizyt, historii czasu/korekt oraz numeracji raportów offline; nie jest to GM-011C i nie obejmuje natywnego biznesowego LAN.


## Punkt 5b — kod zweryfikowany na 0aa72b5, końcowa regresja

0aa72b5b6c7b34b8192e03329f450da26b209295 przeszedł 796/796 pełnych jednostkowych, 113/113 synchronizacji (24 bankowych) i 18/18 E2E rzeczywistych baz. TypeScript i diff-check zaliczone. [Fundamenty PR](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/45080414205), [fundamenty push](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/45080409887).

Przed końcową regresją dodano jeszcze dwa testy bez zmiany produkcyjnego kodu: przyczynowe edycje mapowania/reguły nie przeliczają historycznej klasyfikacji, a reinterpretacja tego samego pliku/wiersza z innym bankowym ID wycofuje lokalną komendę. Łącznie 26 bankowych testów. Wynik na końcowym HEAD należy odczytać w checks i opisie PR #29; nie deklarujemy pełnego sukcesu, zanim skończą się wszystkie workflow.

### Stan 5b i punkt wznowienia

Obsługiwane: profile/opcje/mapowania, reguły i kategorie, atomowe kompletne importy z expenses, duplicate-only audit bez kopii kosztów, oryginalny origin i pełna historia decyzji, przyczynowe korekty CSV, nowe grupy bootstrap, trwałe blokady/konflikty i idempotentny relay trzech replik. Nie zmieniono formatu v12, bazy v2, JSON/ZIP ani źródła kanonicznego Data.

Blokowane do świadomego uzgodnienia: różne niezweryfikowane profile z kosztami (także potencjalnie różne rzeczywiste banki), druga identity pod innym ID, niejednoznaczności bez pełnego bankowego ID, sprzeczne finanse/profile/reguły, fizyczne usunięcia i modyfikacje starych auditów, dawne rozdzielone seedy bez dowodu grupy oraz FINANCE_INVALID. Nie ma jeszcze GUI decyzji; żadna blokada nie oznacza applied ani utraty źródłowej operacji.

Dokładne następne zadanie po potwierdzeniu kompletu końcowych checks: osobny punkt ochrony pełnych wizyt/rozliczeń, historii czasu i korekt oraz polityki numeracji raportów offline. Zachować aktywny Timer lokalny i zatwierdzone kwoty; nie rozszerzać ogólnego wyboru wariantu finansowego bez audytu obu stron. Potem onboarding i jawne uzgadnianie profili/duplikatów, restore/retencja, native LAN i GUI. Nie rozpoczynać ich w ramach odbioru 5b.

PR #29 pozostaje Draft. Nie scalać. Nie przygotowywać fizycznego odbioru na rzeczywistych danych; nie wdrożono natywnego biznesowego przepływu ani GM-011C.


### Końcowa regresja 7817b01 — dwa niezwiązane z adapterem zatrzymania

798/798 jednostkowych (115 synchronizacji, 26 CSV), 18/18 E2E baz, PWA 20/20, Android web 1/1, TLS 21/21, polityki 6/6 oraz rzeczywisty Electron 14/14 i NSIS 1/1+1/1 przeszły. Windows potwierdził zachowanie profilu, klienta, pliku zdjęcia, wydatku i stopera przy A→B.

Android przerwał instalację kontrolnego aparatu na adb root: unable to connect for root: closed, po 20/20 JVM i sześciu zielonych instrumentacjach. To błąd połączenia z emulatorem w przygotowaniu fixture, nie niezaliczona asercja aplikacji ani historyczny Android Back. Ponowiono cały nieudany job 45080706393 na tym samym HEAD, bez pomijania testów.

Pełny Chromium miał 383/384: tests/reports.spec.ts:751 próbował zamknąć Podsumowanie wizyty natychmiast po kliknięciu zapisu. Modal/requestLeave prawidłowo odmawia zamknięcia podczas pendingWrite; helper nie sprawdzał zamknięcia i następny klik w kartę pod spodem był zasłaniany. Dodano oczekiwanie na komunikat zapisanego podsumowania, settled przed zamknięciem oraz asercję hidden dokładnie tego okna. Nie użyto force click, nie usunięto asercji ZIP/PDF i nie zmieniono kodu nawigacji, raportów ani stopera. Końcowy HEAD z poprawką testu wymaga pełnej regresji.


## Punkt 5c1 — wizyty i historia czasu (implementacja do kontroli CI)

Potwierdzono HEAD 1f5c04a oraz pięć zielonych workflow 5b. Nie powtarzano 4/5a/5b.
Zakres 5c został jawnie podzielony na 5c1 i 5c2, zgodnie z poleceniem. Nowy visits.ts
przyjmuje pełne, przyczynowe przejścia wizyty bez odtwarzania komend stopera, chroni
prefiks historii i niezmienne rozliczenie/wpłaty. Aktywny lokalny timer.jobId jest
blokowany osobno; inne wizyty mogą przechodzić. Zakupy mogą wskazywać udowodnioną wizytę.

Dodano testy trzech niezależnych trwałych baz: relay, oryginalne operacje, stan/history
start-pauza-wznowienie-stop-korekta-zakończenie, sprzeczne korekty i ceny, wpłaty,
restart, quota/rollback, zależności i deterministyczne sumy. Pełna walidacja nowej
wizyty odrzuca nadpłatę już przy odbiorze (wcześniej dopiero blokowała apply);
regresja nadal sprawdza zachowanie wszystkich danych. Wyniki wymagają CI tego commitu.

Kontrakt i jawne blokady: [GM011B_VISITS.md](GM011B_VISITS.md). Raporty/counters,
nowa numeracja offline i decyzje chroniące obie historie finansowe pozostają 5c2.
Nie deklarujemy ukończenia całego 5c. Nie zmieniono v12/IDB v2/JSON/ZIP, natywnego
LAN, zdjęć ani UI. Brak aktywacji w produkcji i brak pakietów do fizycznego odbioru.


### Przegląd 5c1 — granice właściciela i rewizji

Pierwszy 8a57f85 przeszedł TypeScript, 130 testów synchronizacji, pełne 813/813
jednostkowych, git diff --check oraz osobne 21/21 rzeczywiste E2E IndexedDB.
Pełne pozostałe workflow jeszcze trwały podczas tego punktu; nie uznano ich wcześniej
za zakończone. Dalszy przegląd dodał dowód właściciela ogrodu w kontekście źródła:
nowa wizyta nie może trafić pod innego klienta po niezaobserwowanym przeniesieniu
ogrodu. Dodano regresję tej granicy oraz kontrolę zdarzenia zakończenia i rewizji
szczegółów wizyty. Wyniki końcowego commitu wymagają nowego CI.


### 5c1 — dokumentacja lokalna i kopie

Dodano regresję rzeczywistego Chromium: aktualizacja wizyty z JPEG zapisanym wyłącznie
na odbiorcy, kontrola SHA256 jego bajtów, odczyt pełnego ZIP i JSON v12 z nową historią
czasu/rozliczeniem oraz restore-review. Dodatkowa regresja trzech baz obejmuje strefę,
katalog i właściwe źródłowe referencje. Zdjęcie nie jest przesyłane przez synchronizację.
Końcowe wyniki tego punktu są podawane w opisie PR na podstawie zakończonych workflow;
poniższe starsze liczniki nie są wynikiem końcowego HEAD. Pozostaje 5c2 opisane w VISITS.

Test stref jawnie wymienia korzenie trzech niezależnych domyślnych ogrodów przed ich edycją. Równość snapshotu nie zastępuje dowodu wspólnej historii; nie zmieniono ochrony niezależnych korzeni w silniku.


### 5c1 — otwarty pomiar źródłowy

Przegląd wykazał dodatkową potrzebę: odebrany otwarty audyt nie ma lokalnego Timer,
więc zwykła komenda mogłaby próbować START/korekty na niezamkniętej historii innego
urządzenia. Opt-in preflight dziennika blokuje takie polecenie atomowo, bez zmiany
Data/licznika. Po odebraniu oryginalnego STOP lokalny pomiar jest znowu możliwy.
Dodano test tych prób i rollbacku. Zwykły stoper bez aktywowanego dziennika pozostaje
bez zmian. Przypadki stanowią nadal fundament testowany syntetycznie, bez biznesowego LAN.

Preflight nie blokuje niezależnego lokalnego zapisu wyłącznie z powodu starej, niespójnej historii v12 niezmienianej wizyty. Dodano regresję zachowania tego kanonicznego źródła i dopisania niezależnego klienta; taka historia nadal nie staje się poprawną operacją odbioru.


### Regresja Androida 5c1 — systemowy selektor i gotowość CSV

HEAD a76ff05 zaliczył 817/817 jednostkowych (134/134 sync), 388/388 pełnych Chromium,
22/22 oddzielnych IDB E2E, PWA20 + Android web1, TLS21 + Electron policy6, rzeczywisty
Electron14 i aktualizację NSIS A/B. Android JVM20 i wstępne instrumentacje aktualizacji
przeszły, ale cały job nie był zielony: próba1 zakończyła się StaleObjectException
na document.click() w ExpensesTest.java:64; próba2 na tym samym kodzie dotarła do
mapowania, lecz nie otrzymała podglądu Nowe:2. Nie zaliczono żadnej z tych prób jako
pełnej regresji Androida i nie utożsamiono ich z dawną niestabilnością Android Back.

Przegląd testu i CsvImport wykazał, że nagłówek Przypisz kolumny pojawia się już po
setFile, przed końcem decode/headers/hash i końcowym setOptions. Test czeka teraz na
koniec statusu odczytu i rzeczywiste opcje nagłówków, następnie na wyrenderowanie
każdego wybranego mapowania. Sprawdza odczytaną wartość i błędy, zachowując Nowe:2,
liczby kosztów, import, wpłaty i ponowne otwarcie. Systemowy wybór pliku ponownie
wyszukuje wyłącznie zastąpiony węzeł UiAutomator w ograniczonym czasie; zatwierdzenie
biznesowe nie jest ponawiane. Nie zmieniono produktu, parsera ani reguł finansowych.
Nowy HEAD wymaga pełnego CI; wyniki końcowe są w opisie PR i checks.


## Punkt 5c2a — przestrzenie raportów i kolizje (implementacja do kontroli CI)

Potwierdzono HEAD c9f2d8d6755440ab6d9395a2013ad129b8f8cbc0 i pięć zielonych workflow
5c1. Nie implementowano go ponownie. Dalszy zakres podzielono na 5c2a/b/c zgodnie
z poleceniem; w tym punkcie weryfikujemy najpierw bezpieczną numerację i kolizje.

Nowe aktywne instalacje rezerwują BO/rok/pełny-UUID-przestrzeni/licznik w osobnym
report-numbering-v1 (ta sama baza v2, poza Data v12). Rezerwacja poprzedza generowanie
PDF; licznik nie jest cofany przez restart lub restore. Wersja rekordu dziennika 2
chroni ten etap przed starszym writerem 5c1, zachowując oryginalny checkpoint i operacje.
Nie jest to zmiana biznesowego v12 ani technicznego IndexedDB v2.

Receiver otrzymuje trwały audyt kolizji przestrzeni, numeru, pary numer/wersja i ID
raportu oraz niejednoznacznej repliki. Nie utożsamia po numerze. Znany konflikt
wstrzymuje właściwe dokumenty i własne wystawianie, bez kasowania oryginałów lub
blokowania niezależnych rekordów. UUID jest pełny, probabilistyczny; nie deklarujemy
absolutnej rozłączności niepołączonych urządzeń lub rozpoznawania identycznego klonu.

Kontrakt, limity, downgrade fence i granice kopii: [GM011B_REPORTS.md](GM011B_REPORTS.md).
Dotychczasowe single-device legacy numery zachowane. Po aktywacji nowa wersja obcej
lub historycznej rodziny wymaga uzgodnienia właściciela. Pełne reports/identities
pozostają blocked do 5c2b, świadome decyzje finansów/czasu do 5c2c. Nie wdrożono
biznesowego LAN, GM-011C, GUI ani odbioru fizycznego. Wyniki nowego kodu wymagają CI.

Pierwszy 6fbb468 zatrzymał TypeScript przed testami: kontrola przepływu nie zawężała wartości po wywołaniu funkcji błędu zapisanej jako const-arrow. Użyto deklaracji funkcji z never; nie usuwano warunków ani walidacji. Nowe testy nie zostały jeszcze uznane za zaliczone.

Dodano rzeczywiste Chromium dla trzech osobnych baz: kolizje historyczne i wymuszone przestrzenie, restart całego procesu przeglądarki, quota/ponowienie, PDF/JPEG/ZIP oraz ReportPanel na 360/390/430 px. Dodatkowe jednostkowe obejmują dwóch writerów ze starym mirrorem, brak PDF po nieudanej rezerwacji i brak własności przenoszonej przez kopię biznesową. Uzupełniono jawne typy callbacków walidatora diagnostyki po kolejnym zgłoszeniu TypeScript; warunki walidacji zachowane.

Na 9a17062 TypeScript przeszedł, a sync zaliczył 145/146. Jedyna porażka nowego testu kolizji wynikała z fixture: na C wymuszono UUID raportu zamiast drugiego wywołania (UUID przestrzeni). Poprawiono symetryczne wymuszenie na A i C, zachowując asercję rzeczywistej kolizji i blokady. Dodano także wykrycie cofniętego lokalnego high-water względem wydanych numerów w niezmiennym dzienniku, wraz z testem trwałej bazy; źródłowego stanu nie naprawiamy przez reset.

Na c6eaaaa szybki workflow push zaliczył TypeScript, 147/147 synchronizacji i 830/830 pełnych jednostkowych. Przed końcową regresją dodano test niezależności od reportSequence, zmiany roku i cofnięcia zegara. Test telefonu korzysta z rzeczywistej ścieżki Więcej → Historia prac (zgodnie z istniejącym testem raportów), zamiast niewidocznego przycisku menu desktopowego. Asercje numeru, pobrania i szerokości pozostają.

Przegląd usunął zależność nowej numeracji od inkrementacji starego reportSequence przy zapisie scoped raportu. Legacy marker pozostaje niezmieniony, a prywatny high-water rezerwuje numery. Dwa różne zlecenia mogą zatwierdzić własne rezerwacje równocześnie; dwa alternatywne raporty tej samej wizyty nadal nie przechodzą CAS. Dodano obie regresje, bez zmiany starej numeracji single-device.

## 5c2b — checkpoint B1, dowody dokumentów (w realizacji)

Potwierdzono HEAD 0e7d7f2 i zachowano 5c2a. Dodano rygorystyczny przenośny dokument,
źródłowe operacje reportDocuments z osobnymi SHA256, historyczny algorytm fingerprint
oraz lokalne metadane weryfikacji/dostępności. prepareSyncReports jest jawnym API
przygotowania dowodów przed przyszłą ofertą; nie uruchamia LAN ani synchronizacji.
WebCrypto przed transakcją, ponowna kontrola kanonicznego logu i rewizji wewnątrz IDB.
Planowanie nie zapisuje Data. Pełne stosowanie nadal zablokowane do checkpointu B2.
Pierwszy commit wymaga TypeScript i CI; nie deklarujemy jeszcze zaliczenia testów 5c2b.

### Checkpoint B2 — atomowa grupa raportów (w kontroli)

Dodano adapter grupujący wymagane oryginalne operacje snapshotu, tożsamości i dowodu,
bez dzielenia starych bootstrapów ani generowania nowych UUID na odbiorcy. Operacje
job/payments nadal przechodzą 5c1; tożsamości są dopuszczane dopiero z pełną rodziną.
Dokument zależny od plików ma trwały source-only i pozostawia oryginalną grupę blocked.
Nie powstaje fikcyjny VisitReport. Plan nie zmienia Data. Pełne przyjęcie korzysta
z istniejącego commitReceived i jednej transakcji Data/journal/receiver/checkpointy.
Pierwszy checkpoint CI wykrył niejawny any po Array.isArray; doprecyzowano parametr,
bez usuwania walidacji. Testy adaptera i pełna regresja pozostają do wykonania.

### Kontrola B2 i rzeczywiste kopie

Po poprawce typu TypeScript 80db311 zaliczył dotychczasowe 31 E2E IndexedDB.
Nowe jednostkowe wykryły dwie niepoprawne przesłanki fixture: niezależne wcześniej
utworzone klient/garden nie są dowodem wspólnej historii po edycji nazwy, a wizyta
z zatwierdzoną ceną nie może zostać otwarta do pomiaru. Test historii klienta używa
pustych B/C, timer jest tworzony na źródle bez zatwierdzonej ceny; ochrony domeny
pozostały bez zmian i asercje zachowania raportów pozostają.

Dodano rzeczywiste Chromium A/B/C, pełny restart procesu, uszkodzenia snapshotu/dowodów,
quota/abort, JPEG, logo i pełny ZIP. Analiza przywracania wykryła konkretną granicę:
Data może być za known historią niezastosowanego raportu, więc starego ZIP nie da się
zapisać jako zwykłej nowej operacji o fikcyjnym before. W takim restore zachowujemy
oryginalny log, nowy snapshot i checkpoint przed/po oraz restore-review w jednej
transakcji. Nie potwierdzamy zastosowania odebranych operacji i nie propagujemy cofnięcia.
Dotychczasowe restore, które miały poprawną bazę przyczynową, zachowują poprzedni audyt.

### Wznowienie od ece932f — kontrola Androida i końcowego 5c2b

Potwierdzono niezmieniony HEAD ece932f, Draft/niescalony. Business sync, LAN,
Windows i Shopping regression są zielone dla tego HEAD; Android run 45164924751
nie przeszedł NativeSmokeTest przy oczekiwaniu na natywny button2.
Skrypt uruchamiał wtedy niezmieniony APK A z 607baeab, PR #27, przed instalacją B.
ADB zgłaszał problemy podczas startu, po czym boot i instalacja zakończyły się sukcesem.
Nie stanowi to dowodu przyczyny. Brak dialogu nie jest uznany za zaliczony test lub
potwierdzoną regresję nowego adaptera. Dodano jednorazowy odczyt zachowanych
syntetycznych artefaktów (XML okna i filtrowany logcat), aby ustalić stan po Back.
Po diagnozie job inspekcyjny zostanie usunięty; właściwy test i asercje pozostają.

### Wyjaśniona awaria NativeSmoke na ece932f

Job 137907016414 odczytał oryginalny artefakt run 45164924751. XML miał pakiet
android, alertTitle „Pixel Launcher isn't responding” i aerr_close/aerr_wait,
zamiast widocznego button2 aplikacji. AppPlugin dostarczył backButton o 11:29:35.951
UTC, a onJsConfirm utworzył natywne okno; teardown nieudanego testu zgłosił
WindowLeaked tego okna. To dowód obcej nakładki ANR launchera emulatora, nie braku
wywołania potwierdzenia przez nowy adapter. Same wcześniejsze błędy ADB nie były
uzasadnieniem tej diagnozy.

NativeSmoke rozpoznaje i zamyka tylko dokładnie ten systemowy ANR launchera,
najwyżej raz, bez ponawiania Back. ANR Garden Managera i inne dialogi pozostają
błędem. Prawdziwy tekst niezapisanych zmian oraz button2/button1 nadal są wymagane;
po Anuluj podgląd pozostaje, po potwierdzeniu znika. Dodano negatywne asercje
polityki, rzeczywisty scenariusz także na nowym B oraz ponowną kontrolę niezmienionego
profilu finansów/JPEG/stopera po aktualizacji. Jednorazowy job inspekcji usunięto.
Inne historyczne przypadki Android Back bez takiego dowodu pozostają monitorowane.
Wynik poprawki wymaga CI końcowego HEAD; nie deklarujemy go przed zakończeniem.

### 5c2b — końcowe dopracowanie i granica wznowienia

Na ece932f Business sync, LAN, Windows/NSIS i pełny Shopping/Chromium/PWA przeszły;
Android nie został uznany za zaliczony. Jego konkretny błąd został wyjaśniony wyżej.

Dodano zachowanie kolejności pól buildera po kanonicznym dekodowaniu: bez tego
identyczne options mogły nie zostać rozpoznane przez istniejący ReportService
jako ten sam podgląd. Canonical treść i SHA pozostają takie same. Regresja wymaga
rzeczywistego ponownego użycia dokumentu na B, bez przydziału nowego numeru.

Dodatkowe testy: nowa przyczynowa próba zmiany wydanego snapshotu zachowuje oryginał
i konflikt; legacy BO/rok/licznik przechodzi A→B→C bez globalnej rezerwacji licznika;
finanse/czas raportu pozostają historyczne po zmianie bieżącej stawki. Chromium
sprawdza także SHA lokalnego JPEG po rzeczywistym odtworzeniu ZIP i roundtrip pełnego
raportu bez plików przez ZIP v12. Opisano kompletny kontrakt adaptera i jego blokady.

Wyniki nowego końcowego HEAD wymagają osobnej pełnej regresji i są wpisywane do
PR/checks tego HEAD. Nie przypisujemy mu wcześniejszych zielonych przebiegów.
Jeśli regresja wykaże błąd, najpierw naprawić 5c2b. Dopiero po jej pełnym zaliczeniu
punkt 5c2b można zamknąć; następny jest 5c2c. Nie podłączać biznesowego LAN,
pełnego GUI, zdjęć GM-011C ani fizycznego odbioru.

### Ostatni przegląd kompatybilności starego inbox

Na 9521317 szybkie sync/unit kontrole przeszły. Przegląd wykazał konkretną granicę
aktualizacji: wcześniejszy receiver mógł trwale znać opaque reports z samymi
pustymi options.photoIds/snapshot.photos, bez pełnej dzisiejszej struktury.
Nowsze planowanie SHA nie może przez taki dawny rekord przerwać niezależnego planu.
Dodano jawne REPORT_INVALID/blocked dla wcześniej known rekordu i test rzeczywistego
trwałego zapisu zgodnego ze starym kontraktem. Nowe wadliwe wejście nadal jest
rejected przed known; walidacja nie została osłabiona. Błędy WebCrypto nie są ukrywane.
Dodano także kolizje historyczne i przestrzeni z prawidłowymi pełnymi dowodami,
aby brak wcześniejszego dowodu nie maskował sprawdzenia blokady kolizji.

### Poprawka uprawnienia skryptu CI

Na 44dff16 jednostkowe 852/852 (169/169 sync), osobne Chromium 41/41,
TLS21, polityki6 i PWA20 przeszły. Android nie uruchomił instrumentacji: zapis
skryptu przez Git Data API zmienił jego mode 100755 na 100644, więc wykonanie
zatrzymało się Permission denied (exit 126). Przywrócono 100755 oraz dodano
test -x przed budową i emulatorem. To błąd metadanych commitu, nie uzasadnienie
zaliczenia testu dialogu. Pełna regresja musi przejść ponownie na nowym HEAD.

### Pełny Chromium 5ae4484 — wykryty wyścig startowego fixture

Windows/NSIS, Android (20 JVM, 13 instrumentacji, 5 aparat/galeria), TLS, PWA,
852 jednostkowe i 41 osobnych IDB przeszły na 5ae4484. Pełny Chromium dał 406/407:
tests/visits.spec.ts odczytał jeszcze version=2 z localStorage natychmiast po goto.
settled sprawdza jedynie brak aria-busy; przed uruchomieniem GardenProvider ten
atrybut też jest nieobecny. AtomicRepository.initialize kończy migrację i projekcję
przed zamontowaniem app-shell. Snapshot UI po błędzie pokazywał już zmigrowane 541 zł.

Fixture seed02 czeka teraz na rzeczywiste zamontowanie app-shell, bez sleep,
zwiększania limitów lub zmiany oczekiwanego formatu/kwot. Zachowano wszystkie
asercje v12, oryginalnej kopii v2, 541/100/441 zł, czasu i eksportu. Dodano odczyt
kanonicznego current z rzeczywistego IDB po oncomplete oraz równość z kopią localStorage.
Nie zmieniono migracji produktu, rozliczeń ani stopera. Osobny szybki krok uruchamia
ten istniejący test; pełny zestaw Chromium nadal uruchamia wszystkie testy.
406/407 nie jest pełnym sukcesem. Nowy końcowy HEAD wymaga ponownie wszystkich kontroli.


### 5c2c-A — rozpoczęcie od potwierdzonego 2efe5bd3

Potwierdzono HEAD 2efe5bd3 i wszystkie zielone workflow 5c2b; nie powtarzano jego
implementacji. Środowisko lokalne nie jest dostępne, prace i weryfikacja odbywają
się przez GitHub/Actions. Dodano resolution-model.ts: ścisły model świadomej
intencji, niezmienny audyt obu źródeł i udowodniona baza przyczynowa. Nie dodano
jeszcze biznesowego stosowania decyzji ani uprawnień LAN. Ogólne API nadal blokuje
finanse. Testy modelu muszą przejść CI tego commitu. Następny checkpoint to 5c2c-B,
zgodnie z docs/GM011B_RESOLUTIONS.md. Format v12 i techniczne IDB v2 bez zmian.


### 5c2c-B/C — kontrolowane decyzje (przed pełną regresją)

Checkpoint A 4661e654: kontrola TS i testy unit/sync przeszły CI. Dodano ograniczony
adapter jawnych decyzji wizyty (zatwierdzenie, dyspozycje oryginalnych wpłat,
spójna gałąź czasu + opcjonalna corrected) i wydatku (kwota/kategoria/status).
Źródła i oba audyty pozostają w niezmiennym logu. Zapis przechodzi tę samą
transakcję Data/journal/receiver/checkpointów. Osobne API ma token i stabilny retry.
Generic resolveSyncConflict nadal blokuje finanse. Trzy trwałe bazy jednostkowe
sprawdzają przekazywanie B→A/C, idempotencję, korekty, anulowanie i quota rollback.
Ta wersja wymaga CI; nie deklarujemy jeszcze pełnego 5c2c. Następne: analiza
wyników, uzupełnienie testów Chromium i pozostałych granic bezpieczeństwa.


### 5c2c-D — testy trwałości i wykryta granica stopera

Na ca966c4 kontrola TS i 190/191 testów sync przeszły; jeden nowy test błędnie
oczekiwał conflict także dla pierwszej decyzji, którą sam wcześniej zastosował.
Fixture teraz odbiera obie decyzje przed zatwierdzeniem, zachowując ścisłą asercję
conflict i test rzeczywistej równoległości. Nie zmieniono semantyki applied.

Dodano rzeczywiste Chromium z trzema odrębnymi DB, pełne restarty procesu,
niezmienny PDF/snapshot/SHA, lokalny JPEG i ZIP, kwoty/wpłaty/czas, quota/abort,
idempotentne przekazywanie i kontrole źródeł. Dodano kontrolę pierwszego
zatwierdzenia także dla alternatywy, która nigdy nie została zastosowana.

Konkretny otwarty problem: known alternatywa visits może uniemożliwić zwykłe
dopisywanie STOP lokalnej gałęzi, podczas gdy decyzja słusznie chroni Timer.
Kod zachowuje oba audyty i fail-closed; nie rozwiązano tego prowizorycznym
resolution ani manipulacją wektora. Szczegóły i dokładna granica w
GM011B_RESOLUTIONS.md. Nie można uznać pełnego 5c2c za zamknięty, nawet jeśli
regresja ograniczonego checkpointu będzie zielona. Następny punkt: bezpieczne
zamknięcie lokalnego pomiaru przy known konflikcie i jego późniejsze uzgodnienie,
następnie decyzje równoległe / grupy / pełna macierz testów akceptacyjnych.
