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

known jest zegarem **odebrania i walidacji przyczynowej**, nie potwierdzeniem trwałego zastosowania na bazie biznesowej. appliedLocal oznacza lokalne komendy już zapisane razem z current. Pełne potwierdzenia operacji odebranych, ich statusy i konflikty oczekujące nie są jeszcze wdrożone.

Przekazanie A → telefon B → komputer C zachowuje id, origin, sequence i context; telefon nie rejestruje odebranej zmiany jako własnej. Powtórzenie jest idempotentne. Inna treść pod tym samym UUID/dotem jest odrzucana. Brakujący poprzednik trafia do kolejki, bez udawania zastosowanej zmiany. Zegary ścienne nie rozstrzygają konfliktów.

Wektory i pochodzenie są mechanizmem przyczynowości; nie są podpisem kryptograficznym każdego historycznego zdarzenia. Przyszła integracja ma uwierzytelniać bieżącego partnera przez istniejący mTLS i jawne powiązanie repliki. Nie wolno przedstawiać pochodzenia przekazanego wpisu jako niezależnie zweryfikowanego certyfikatu instalacji, której nie sparowano.

## 3. Jednostki v12

| Dane | Reprezentacja dziennika | Granica wymagająca dalszej implementacji |
| --- | --- | --- |
| Klient | Rekord z rejestrami pól | UI decyzji, onboarding niezależnych baz i trwałe zastosowanie |
| Ogród i strefy | Jeden rekord ogrodu, zachowane ID stref | Powiązania, odbiór/usuwanie z ochroną lokalnych zdjęć |
| Katalog materiałów | Rekord materiału | Walidacja odbioru i zależności |
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
- Trzeba odróżnić trwały inbox, konflikt, blokadę zależności i potwierdzenie zastosowania.
- Trzeba zachować granice finansowe i oryginalne ID płatności/CSV oraz wykryć kolizje niezależnych wyciągów.
- Trzeba chronić historię czasu i korekt również po wyborze wariantu oraz w nowej pełnej kopii.
- Trzeba zablokować właściwą część planu przy aktywnym stoperze bez jego zatrzymywania.
- Trzeba przetestować politykę numerów nowych raportów offline. Prosty reportSequence+1 w dwóch instalacjach jest niewystarczający; historyczna kolizja musi pozostać konfliktem bez cichego przepisywania wydanego dokumentu.

**Te punkty są blokadami uznania całego GM-011B za ukończony. Nie są rozwiązane samym dziennikiem lub pozytywnym testem kodeka.**

## 6. Kryteria dalszego odbioru

Wymagane są rzeczywiste dwie/trzy bazy i natywny transport, pełny scenariusz A ↔ B ↔ C bez połączenia A–C, trwałe konflikty i potwierdzenia, GUI analizy/zatwierdzenia, bezpieczne przywrócenie oraz pełna regresja i pakiety 0.7.0-test.1. Fizyczny odbiór pozostaje po stronie użytkownika. Szczegóły wyników i następnych zadań: GM011B_PROGRESS.md.

Nie scalać PR automatycznie. Nie implementować GM-011C, synchronizacji w tle ani internetowej.
