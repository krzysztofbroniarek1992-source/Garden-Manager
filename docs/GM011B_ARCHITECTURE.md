# GM-011B — architektura i granice bieżącego punktu kontrolnego

**Status: implementacja nieukończona, PR Draft.** To nie jest instrukcja uruchomienia synchronizacji danych firmowych. Działający natywny transport nadal obsługuje wyłącznie dotychczasowy test GM-011A. Nie dodano polecenia sieciowego zapisującego bazę ani zastępowania bazy kopią.

## 1. Stan kanoniczny i dziennik

Biznesowy format **v12** pozostaje w state/current. Jawna aktywacja enableSyncJournal tworzy obok magazyn sync w tej samej bazie garden-manager-state, podnosząc techniczną wersję DB do 2. Nie zmienia identyfikatorów aplikacji, originów ani klucza garden-manager:v1.

Starszy GM-011A otwierał DB z jawną wersją 1 i nie znał dziennika. Zostanie odrzucony przez VersionError po aktywacji. Nowy writer otwiera bieżącą wersję i odrzuca nieznany przyszły schemat. Otwarte starsze połączenia otrzymują versionchange i zamykają się; blokada lub błąd nie powodują resetu.

Checkpoint source-before-db-v2 zachowuje oryginalny rekord przed zmianą schematu; source-v12-before-activation zachowuje kanoniczny rekord sprzed aktywacji. To lokalne punkty odzyskiwania, nie wiadomości wysyłane do innego urządzenia.

Po aktywacji każda synchroniczna komenda GardenStore:
1. Czyta świeży current.
2. Wykonuje istniejące reguły domenowe i walidację.
3. Oblicza zmiany jednostek.
4. Zapisuje current oraz dziennik w **jednej** transakcji readwrite state+sync z durability strict.
5. Dopiero po oncomplete odświeża kopię localStorage i stan UI.

Nieudany journal.put, błąd walidacji, quota lub abort wycofują stan i dziennik razem. Nie ma fallbacku do nieaktualnego localStorage. Niezgodny licznik rewizji dziennika wykrywa writer, który ominął tę granicę, zamiast dopisywać wymyśloną historię.

Aktywacja jest API wewnętrznym, jeszcze bez kreatora w UI. Nie należy aktywować ręcznie tego nieukończonego etapu na danych produkcyjnych.

## 2. Tożsamość i przyczynowość

Lokalny UUID instalacji dziennika jest stały dla profilu i nie pochodzi z adresu IP. To identyfikator pochodzenia operacji, **nie klucz ani certyfikat**. Powiązanie z uwierzytelnioną tożsamością LAN GM-011A wymaga jeszcze kontrolowanego onboardingu; natywna tożsamość i zaufanie nie są przepisywane.

Operacja ma UUID, źródłową instalację, monotoniczny licznik, wektor wiedzy poprzedzającej, flagę jawnego rozstrzygnięcia oraz listę zmian before/after. Ta lista zachowuje jednostkę atomowej komendy. Utworzenie, edycja i usunięcie wynikają odpowiednio z null/wartość, wartość/wartość i wartość/null. Usunięty rekord pozostawia trwały ślad.

known jest zegarem **odebrania i walidacji przyczynowej**, nie potwierdzeniem trwałego zastosowania na bazie biznesowej. appliedLocal oznacza lokalne komendy już zapisane razem z current. Punkt 4 dodaje osobny receiver-v1: trwały inbox, stany i potwierdzenia zastosowania oraz konflikty. Szczegóły i granice poniżej.

Przekazanie A → telefon B → komputer C zachowuje id, origin, sequence i context; telefon nie rejestruje odebranej zmiany jako własnej. Powtórzenie jest idempotentne. Inna treść pod tym samym UUID/dotem jest odrzucana. Brakujący poprzednik trafia do kolejki, bez udawania zastosowanej zmiany. Zegary ścienne nie rozstrzygają konfliktów.

Wektory i pochodzenie są mechanizmem przyczynowości; nie są podpisem kryptograficznym każdego historycznego zdarzenia. Przyszła integracja ma uwierzytelniać bieżącego partnera przez istniejący mTLS i jawne powiązanie repliki. Nie wolno przedstawiać pochodzenia przekazanego wpisu jako niezależnie zweryfikowanego certyfikatu instalacji, której nie sparowano.

## 3. Jednostki v12

| Dane | Reprezentacja dziennika | Granica wymagająca dalszej implementacji |
| --- | --- | --- |
| Klient | Rekord z rejestrami pól | Pełne GUI i onboarding niezależnych baz; API zastosowania i decyzji jest w punkcie 4 |
| Ogród i strefy | Jeden rekord ogrodu, zachowane ID stref | Punkt 4 sprawdza rodzica i blokuje zmiany naruszające lokalne zdjęcia/historię; pełne GUI pozostaje |
| Katalog materiałów | Rekord materiału | Podstawowe zastosowanie i walidacja w punkcie 4; usunięcie użytego materiału blokowane |
| Zlecenie, materiały, czynności, status, rozliczenie, czas i płatności | Jednostka visits: pełna wizyta i przypisane płatności | Zatwierdzone finanse, aktywny Timer, konflikty i historia korekt |
| Raport bez zdjęć | Niezmienny snapshot jako osobna jednostka oraz tożsamość dokumentu w visits | Polityka numeracji wielourządzeniowej i konflikty wydanych numerów |
| Raport ze zdjęciami/logo | Tylko tożsamość/rezerwacja numeru w visits; pełny raport lokalny | Bez synchronizacji metadanych obrazów; nie deklarować pełnej dostępności takiego dokumentu na odbiorcy |
| Wydatki, profile, kategorie, reguły i importy CSV | Osobne rekordy, oryginalne origin/identity/importId zachowane | Deduplikacja między niezależnymi importami i atomowe zależności |
| Zakupy | Rekord pozycji; zapis utworzonego wydatku i linku w jednej operacji | Odbiór i rozstrzygnięcia bez duplikacji kosztów |
| Harmonogramy, wystąpienia i dostępność | Istniejące ID, oryginalne terminy i cykle zachowane | Bez uruchamiania generatorów, stopera i zleceń przy samym odbiorze |
| Szablony, checklisty, notatki i zadania | Istniejące rekordy i tombstones | Lokalne powiązania zdjęć muszą pozostać lokalne po odbiorze |
| Ustawienia biznesowe i reportSequence | Jawne jednostki | reportSequence jest znacznikiem wysokiej wody, nie globalną rezerwacją offline |
| Timer, photos, photoRestoreId, pliki/miniatury | Wykluczone | GM-011C i pełna synchronizacja stopera nie są tym etapem |

Zmiany niepowiązanych rekordów mają się łączyć. Płaskie pola klienta mają rejestry ostatnich **rzeczywistych** zapisów każdego pola: późniejsza edycja notatki nie może zgubić wcześniejszego konfliktu telefonu. Pozostałe jednostki są konserwatywnie niepodzielne; nie stosujemy automatycznego LWW do pieniędzy.

Rekordy tworzone niezależnie pod tym samym ID nie dowodzą wspólnego przodka. Identyczna wartość może być rozpoznana jako taka sama treść, ale powiązanie historii wymaga podglądu i świadomego zatwierdzenia. Edycja kontra usunięcie pozostaje konfliktem, a powrót znanej starej operacji nie odtwarza tombstone.

## 4. Pakiety i porcjowanie

packets.ts implementuje sam kodek funkcjonalności biznesowej **businessProtocol=1 / dataVersion=12**. To wersja oddzielna od koperty TLS GM-011A. Nie jest jeszcze podłączona do natywnych Channel, IPC ani Capacitor.

Pakiet ma UUID transferu, nadawcę, wektor wiedzy i oryginalne operacje. Oferta określa dokładną długość, liczbę części i SHA256. Maksymalnie 10 MiB pakietu, 2000 operacji, części binarne po 64 KiB. Treść to kanoniczny JSON, walidowany także po odczycie; dodatkowe pola, złe wersje, powtórzone ID, uszkodzenie, zła długość i niespójna oferta są odrzucane. SHA256 korzysta ze standardowego WebCrypto.

Części mogą nadejść w innej kolejności. Powtórzenie identycznej części nie zwiększa liczby bajtów; inna treść pod tym samym indeksem unieważnia transfer. finish nie zwraca pakietu, dopóki wszystkie części i SHA256 nie są zgodne. Zwrot pakietu oznacza tylko sprawdzenie treści, nie zapis biznesowy lub rozproszoną transakcję.

Tryb restore-review musi być przekazany razem z dziennikiem; kodek odmawia przygotowania transferu. Nie ma domyślnej zgody ignorującej stan odtworzenia.

Integracja natywna musi jeszcze uzgodnić obsługę biznesową przed wysłaniem danych. Stary klient syntetyczny nie może dostać nowego ładunku przez istniejący test probe/data ani być uznany za zgodnego partnera. Nie dodano dowolnego RPC, API plików lub zapisu bazy.

## 5. Przywrócenie, retencja i finanse

restoreSnapshot nie cofa lokalnej tożsamości, licznika ani dziennika; pozostawia restore-review do czasu uzgodnienia historii. Nowy kreator oraz przenośny eksport historii synchronizacji nie są jeszcze dostępne. Obecne JSON/ZIP zachowują v12 i zdjęcia; nie zawierają dziennika, natywnych kluczy ani zaufania. Nie wolno traktować ich jako kompletnego archiwum wszystkich przyszłych rozstrzygnięć synchronizacji.

Limity: do 8 MiB operacji, 64 MiB dziennika, 20000 operacji, 2000 oczekujących luk, 64 źródła, maksymalna głębokość JSON 48. Przekroczenie wycofuje komendę; nie kasuje historii. Obecny backend zapisuje walidowany dokument dziennika; nie ma jeszcze bezpiecznej kompakcji ani optymalizacji długiej historii. Zwykłe operacje po aktywacji mogą zostać zablokowane po dojściu do limitu zamiast zostać zapisane bez dziennika. To jawne ograniczenie wymagające dopracowania przed odbiorem.

Zanim będzie możliwe zatwierdzanie zmian odbieranych:
- Punkt 4 odróżnia inbox, konflikt, blokadę zależności i applied dla podstawowych typów; pozostałe typy nadal blokuje.
- Trzeba zachować granice finansowe i oryginalne ID płatności/CSV oraz wykryć kolizje niezależnych wyciągów.
- Trzeba chronić historię czasu i korekt również po wyborze wariantu oraz w nowej pełnej kopii.
- Trzeba zablokować właściwą część planu przy aktywnym stoperze bez jego zatrzymywania.
- Trzeba przetestować politykę numerów nowych raportów offline. Prosty reportSequence+1 w dwóch instalacjach jest niewystarczający; historyczna kolizja musi pozostać konfliktem bez cichego przepisywania wydanego dokumentu.

**Te punkty są blokadami uznania całego GM-011B za ukończony. Nie są rozwiązane samym dziennikiem lub pozytywnym testem kodeka.**

## 6. Kryteria dalszego odbioru

Punkt 4 testuje trzy rzeczywiste bazy dla podstawowych typów. Nadal wymagany jest natywny transport, pełny scenariusz A ↔ B ↔ C bez połączenia A–C, trwałe konflikty i potwierdzenia, GUI analizy/zatwierdzenia, bezpieczne przywrócenie oraz pełna regresja i pakiety 0.7.0-test.1. Fizyczny odbiór pozostaje po stronie użytkownika. Szczegóły wyników i następnych zadań: GM011B_PROGRESS.md.

Nie scalać PR automatycznie. Nie implementować GM-011C, synchronizacji w tle ani internetowej.

## 7. Punkt kontrolny 4 — kontrolowany odbiorca podstawowych jednostek

Ta sekcja aktualizuje granice opisane dla punktów 1–3. Nie dodaje natywnego transportu ani kompletnego GUI.

- receiver-v1 istnieje w tej samej object store sync; nie wymaga nowej wersji bazy lub formatu biznesowego.
- received / waiting-dependencies oznaczają trwałą surową operację; known oznacza dodatkowo poprawną przyczynowość.
- verified / planned / waiting-records / conflict / blocked nie oznaczają zapisu biznesowego.
- applied ma lokalny numer rewizji transakcji, która zapisała Data; sieć nie może przesłać tej metadanej.
- resolved oznacza wariant świadomie zastąpiony operacją decyzji; nie udajemy, że taki wariant został zastosowany.
- rejected zachowuje wadliwą operację, jeśli miała poprawną tożsamość; osobny ograniczony audyt opisuje niepoprawne próby. Nie usuwa historii zaakceptowanych operacji.

Kontrolowane API znajduje się na AtomicRepository, poza GardenStore, Electron IPC i Capacitor. receiveSyncOperations przechowuje oryginalne operacje bez tworzenia własnych. planSyncOperations symuluje podstawowe jednostki i zapisuje plan/konflikty. applySyncPlan sprawdza tokeny i zatwierdza Data + journal + receiver w jednej transakcji. Ponowienie po utracie odpowiedzi zwraca oryginalny CommitReceipt. resolveSyncConflict przyjmuje jawną decyzję i aktualny token konfliktu, waliduje wynik i emituje nową operację przyczynową.

Obsługiwane są klienci, ogrody ze strefami, katalog oraz niezależne notatki/sprawy z powiązanymi tombstones. Pola klienta mogą łączyć się tylko przy dowodzie przyczynowym; pozostałe jednostki pozostają konserwatywnie całymi rekordami. Lokalne referencje zdjęć notatki są zachowywane. Zmiana wymagająca modyfikacji lokalnych zdjęć, odpinania historii lub innych nieobsługiwanych rekordów jest blokowana. Stoper, wizyty, płatności, wydatki, CSV, zakupy, rozliczenia, raporty, planowanie i ustawienia nie są jeszcze materializowane. Nie ma zastępowania bazy.

Nowy bootstrap aktywacji rozdziela rekordy na operacje, nadal zatwierdzane razem podczas aktywacji. Istniejących operacji wielotypowych nie dzielimy i nie przepisujemy. Takie stare grupy mogą pozostać blocked do późniejszego onboardingu.

Przed zastosowaniem zapisywane są before-first-receive-apply i before-last-receive-apply; nie są eksportem kluczy ani zaufania. restore-review blokuje odbiór/planowanie/stosowanie do czasu przyszłego kreatora. Limity historii nadal obowiązują; pełna kompakcja, GUI i przenośne archiwum dziennika pozostają poza tym punktem.


## 8. Punkt 5a — ograniczony adapter finansowy

Sekcja aktualizuje granicę punktu 4; nie oznacza zakończenia punktu 5 ani GM-011B.

Finanse pozostają całymi jednostkami przyczynowymi, bez scalania pojedynczych pól. visits obejmuje job, płatności i tożsamości raportów. Adapter nigdy nie przypisuje job z sieci. Może dopisać nowe ID płatności, gdy istniejąca zakończona wizyta ma identyczne zatwierdzone rozliczenie, czas, historię, materiały i nagłówki raportów, żaden wcześniejszy wpis płatności nie został zmieniony/usunięty, a lokalny stoper tej wizyty nie działa. Oryginalna komenda savePayment na odłączonej próbie sprawdza limit należności; trwały zapis obejmuje wyłącznie payments. Równoległe wpłaty są konfliktem całej wizyty, a nie automatyczną sumą.

Kategorie wydatków mogą być tworzone i edytowane; fizyczne usuwanie pozostaje blocked. Wydatki ręczne zachowują createdAt, rosnącą rewizję, source/origin/direction i pełny prefiks historii; końcowa pozycja historii musi odpowiadać aktualnej kwocie, statusowi, kategorii i updatedAt. Nie deduplikujemy różnych ID po podobnej nazwie.

Zakupy bez jobId mogą przechodzić przez statusy, archiwum i soft-delete. Nie wolno skasować expenseId ani odtworzyć deletedAt. Operacja utworzenia wydatku i powiązania zakupu jest stosowana jako jedna grupa; samo oznaczenie kupione nie tworzy wydatku. Źródłowa wersja kategorii/wydatku musi być udowodniona i zastosowana (lub utworzona w tej samej grupie).

Identyczny, już istniejący lokalnie rekord finansowy może dostać potwierdzenie swojej oryginalnej obcej operacji bez zmiany Data. To nie dowodzi wspólnego przodka całego zbioru danych. Niezależny, niezaobserwowany korzeń o tym samym ID nadal może powodować konflikt po późniejszej edycji. Przyszły onboarding musi wymienić i zatwierdzić historie przed edycją finansów; nie wolno usuwać tej ochrony tylko dlatego, że początkowe snapshoty wyglądają tak samo.

Nowe/zmienione CSV, profile/reguły/importy, pełne zlecenia/czas/rozliczenia i raporty pozostają zablokowane. Import ma cykl zależności rows.expenseId ↔ expense.origin.importId. Bankowe identity jest związane z profileId; niezależne profile nie są jeszcze uzgodnionymi tożsamościami rachunku. Rozwiązanie wymaga osobnego adaptera grup i onboardingu, zamiast obchodzenia walidacji lub przepisywania origin.

API decyzji finansowych i przychodzące resolution dla tych jednostek pozostają blocked. Konflikty są trwałe i nie zatrzymują niezależnych bezpiecznych rekordów. Pełne decyzje finansowe muszą zachować oba audyty i reguły zależnych jednostek. Adapter nie zmienia timer, jobs, timeHistory, photos, reportSequence ani historycznych dokumentów; obowiązuje dotychczasowa atomowa transakcja state + journal + receiver.


## 9. Punkt 5b — CSV i jego źródłowa grupa

Ta sekcja aktualizuje blokadę wszystkich CSV z punktu 5a. Szczegółowy kontrakt i jawne ograniczenia: [GM011B_CSV.md](GM011B_CSV.md).

bank.ts stosuje profile, mapowania i reguły oraz niepodzielne importy z ich CSV expenses. Wzajemne odwołania, oryginalne identity/match/statementKey, źródłowe wiersze i occurrence, pierwsza decyzja i pełny prefiks historii podlegają kontroli. Nie tworzymy wydatków na podstawie samych wierszy, nie przeliczamy klasyfikacji, nie zmieniamy starego audytu importu.

bank-identity.ts wykrywa ryzyka, nie nadaje tożsamości rachunkom. Nowy koszt innego, nieuzgodnionego profilu, istniejąca identity pod drugim ID oraz niejednoznaczne źródła trafiają do trwałej blokady. Same podobne nazwy/kwoty/daty/opisy nie dają zgody na scalanie. Ochrona nowych lokalnych importów działa także po aktywacji dziennika; brak automatycznej aktywacji.

bootstrap.ts grupuje cykl import/wydatek tylko dla nowych aktywacji; stare UUID nie są przepisywane. Dawne opaque rekordy mogą pozostać FINANCE_INVALID bez blokowania niezależnych operacji. Potwierdzenie zastosowania nadal oznacza zakończenie transakcji Data + journal + receiver, nie samą znajomość operacji.

Nie zmieniono biznesowego v12, technicznego IndexedDB v2, JSON/ZIP, zdjęć, stopera, numerów raportów ani natywnego LAN. Profile/finanse w konflikcie nadal wymagają przyszłego świadomego rozstrzygnięcia. Nie jest to ukończenie GM-011B.


## 10. Punkt 5c1 — kontrolowane wizyty

[GM011B_VISITS.md](GM011B_VISITS.md) aktualizuje wcześniejsze ograniczenie wizyt do samych wpłat. visits.ts stosuje pełne przyczynowe przejścia job i append-only payments, zachowując reports i lokalne assets. Automat audytu i prefiks historii chronią seconds i korekty. Timer pozostaje lokalny; operacje jego wizyty są blocked. Nie ma LWW, automatycznego sumowania alternatywnych pomiarów ani ogólnego destrukcyjnego rozstrzygnięcia finansów. Zmiana zatwierdzonej ceny/wpłaty, reports, counters i jednostki planowania wymagają dalszych punktów. Brak zmiany Data v12 i IndexedDB v2.


## 11. Punkt 5c2a — przestrzenie dokumentów

[GM011B_REPORTS.md](GM011B_REPORTS.md) opisuje osobny licznik report-numbering-v1, pełny UUID v4, rezerwację przed PDF, kontrolę źródła i trwałe kolizje. Data nadal v12, IndexedDB nadal v2; wersja samego rekordu dziennika 2 blokuje wcześniejszego writera po utworzeniu przestrzeni. Operacje techniczne reportNamespaces są oryginalnie przekazywalne, nie zastępują biznesowego Data. Pełne dokumenty i decyzje finansów/czasu pozostają 5c2b/c. Żaden JSON/ZIP biznesowy nie jest pełnym archiwum dziennika lub własności przestrzeni.

## 12. Punkt 5c2b — niezmienne dokumenty

report-documents.ts definiuje reportDocuments/1 i rozdziela sumę pakietu, SHA256
kanonicznego dokumentu, SHA256 snapshotu, historyczny fingerprint oraz tekstowy CAS
reportSourceSignature. prepareSyncReports dodaje dowody jako nowe oryginalne operacje
źródła, nie przepisuje już wydanych UUID i nie przekazuje praw właściciela przez ZIP.

report-apply.ts grupuje całe niezmienne operacje snapshotu/tożsamości/dowodów.
Adapter job/payments nadal sprawdza 5c1, a cała rodzina reports jest kontrolowana przed
jednym zatwierdzeniem Data + journal + receiver + checkpointów. Nie generuje PDF,
zdarzeń czasu ani nowych wpłat. Przekazanie A→B→C zachowuje źródłowe pochodzenie A.

reportChecks to lokalny wynik WebCrypto, nie payload z sieci. reportAvailability
jest trwałym rejestrem outside Data: pending, portable, source-only lub conflict.
portable nie jest receipt applied. source-only zachowuje informację o dokumencie
zależnym od zdjęć/logo, bez lokalnych PhotoMetadata i pełnego VisitReport.

Restore przy known, ale niezastosowanej historii nie fabrykuje nowego before;
zachowuje oryginalny log, checkpoint przed/po, zastąpiony biznesowy snapshot i
restore-review atomowo. Przyszły kreator onboardingu musi uzgodnić tę historię.
Zwykłe kopie v12 nie są archiwum całego audytu synchronizacji.

Dokładny kontrakt oraz algorytmy: GM011B_REPORTS.md. 5c2c, natywny biznesowy LAN,
pełne GUI, GM-011C i fizyczny odbiór nie zostały uruchomione.
