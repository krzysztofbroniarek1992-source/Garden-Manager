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
