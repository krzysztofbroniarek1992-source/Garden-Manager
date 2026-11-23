# GM-011B — raporty i numeracja offline

Status: punkt 5c2a w kontroli CI. PR #29 pozostaje Draft. Nie ukończono 5c2b
(synchronizacja dokumentów) ani 5c2c (świadome decyzje finansów/czasu).
Nie ma biznesowego LAN i nie należy aktywować mechanizmu na danych produkcyjnych.

## Nowe numery

Po jawnej aktywacji dziennika synchronizacji ReportService używa trwałej rezerwacji:

    BO/2026/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/000001

Przykładowy UUID jest syntetyczny. Używamy pełnego losowego UUID v4 przestrzeni,
nie nazwy, IP, krótkiego kodu ani natywnej tożsamości/klucza urządzenia. UUID v4
ma 122 bity losowe. To probabilistyczna identyfikacja bez centralnego koordynatora,
nie absolutna matematyczna gwarancja rozłączności instalacji. Dla rozłącznych
przestrzeni i poprawnego trwałego licznika numery rodzin są rozłączne.
Dodatkowy niezależny claimId i właściciel-replika pozwalają wykryć niezgodne deklaracje.
Przypisania natywnego klucza mTLS do repliki nie są jeszcze częścią tego punktu.

Rok służy czytelności; nie gwarantuje unikalności. Licznik całej przestrzeni nie
resetuje się po zmianie roku ani zegara. reportSequence partnera nie rezerwuje numeru. Nowa rodzina scoped nie zwiększa
tego starego znacznika — używa wyłącznie własnego trwałego high-water. Dzięki temu
niezależne podglądy różnych wizyt mogą zostać zatwierdzone bez sztucznego konfliktu
przez cudzy licznik; historia tej samej wizyty nadal jest chroniona przez CAS.
Wersja kolejnego raportu własnej rodziny zachowuje numer i zwiększa version.
Dwie jednoczesne próby zapisu tej samej wersji nadal wymagają zgodnego świeżego
źródła i historii; druga nie nadpisze pierwszej.

Instalacja bez aktywowanego dziennika zachowuje BO/rok/licznik i dotychczasowe
zachowanie dla wcześniejszych dokumentów. Stare numery, PDF i snapshoty nie są
przepisywane. Oryginały można nadal odczytywać/regenerować.

## Rezerwacja i zapis

AtomicRepository.reserveReportIdentity czyta kanoniczny Data i źródło podglądu.
W tej samej transakcji state+sync zapisuje:
- niezależną lokalną przestrzeń i deklarację reportNamespaces w oryginalnym dzienniku;
- monotoniczny high-water i powiązanie rezerwacji z report.id, job.id, wersją,
  datą, fingerprintem oraz dokładnym źródłem podglądu;
- wymagany checkpoint i lokalne metadane odbiorcy.

Dopiero oncomplete pozwala generować PDF. Podgląd anulowany, awaria renderera lub
przerwanie po rezerwacji może pozostawić lukę — numer nigdy nie wraca do puli.
Restart zachowuje licznik. Cofnięcie licznika poniżej numeru już wydanego
w niezmiennym dzienniku jest wykrywane i blokuje wystawienie, zamiast resetować stan. Zapis PDF/metadata jest osobną transakcją; dokument nie
jest udostępniany użytkownikowi przed zatwierdzeniem jego historii.
Przy zapisie sprawdzana jest pierwotna rezerwacja i świeży snapshot. Data, journal,
usunięcie wykorzystanej rezerwacji i wszystkie wymagane metadane wycofują się razem
przy quota/abort. Ponowienie zapisu już wydanego identycznego ID jest idempotentne.

Lokalny report-numbering-v1 jest w istniejącej object store sync, poza Data v12.
Techniczny IndexedDB nadal ma wersję 2. Utworzenie przestrzeni podnosi **wersję
rekordu dziennika** z 1 do 2, zachowując klucz i wszystkie wcześniejsze UUID.
To fence dla wcześniejszego writera 5c1: nie może pominąć nowego rejestru rezerwacji,
nawet jeśli nie zapisano jeszcze pierwszego nowego raportu. Zachowano checkpoint
sprzed tego kroku. Nie zmieniono biznesowego v12.

Rejestr oczekujących podglądów ma limit 1000 i 8 MiB; źródło jednej rezerwacji
do 1 MiB. Przekroczenie zatrzymuje rezerwację, nie usuwa numerów ani historii.
Porządkowanie porzuconych podglądów i bezpieczne archiwizowanie pozostają dalszą pracą.

## Kolizje i dowody

Oryginalne operacje zachowują deklaracje przestrzeni oraz tożsamości dokumentów.
Receiver zapisuje osobne reportConflicts, niezależne od konfliktu jednego rekordu:
- różni właściciele/claimId tego samego pełnego UUID przestrzeni;
- brak pierwotnego dowodu wystawienia dokumentu z danej przestrzeni;
- ten sam numer dla różnych wizyt;
- różne dokumenty pod tą samą parą numer/wersja;
- różna tożsamość pod tym samym report.id;
- niejednoznaczna tożsamość repliki, np. rozbieżna operacja pod jej istniejącym dotem.

Sam zgodny numer nie utożsamia dokumentów. Poprawny scoped dokument wymaga
oryginalnej operacji wystawienia właściciela, obserwującej jego deklarację przestrzeni.
Kopia JSON/ZIP nie nadaje praw wystawiania w skopiowanej przestrzeni.
Alert tożsamości oznacza także możliwość podszycia, nie dowód kryptograficzny
niezależnego podpisania każdego historycznego zdarzenia.

Kolizje pozostają po restarcie z oryginalnymi UUID i dowodami. Właściwe operacje
są conflict, nie applied; nie zmieniamy wydanych numerów ani nie usuwamy wariantu.
Źródła zachowują pełne oryginalne raporty, a dziennik zachowuje portable oryginały
i nagłówki. Nie wpuszczamy niezgodnych numerów do Data, gdzie naruszyłyby walidację.
Znana kolizja własnej przestrzeni/instalacji zatrzymuje wystawianie w tej przestrzeni.
Niezależne rekordy mogą nadal przechodzić.

To nie jest ogólne rozstrzygnięcie dokumentów. Decyzja dotycząca historycznych kolizji
musi później zachować oba dokumenty i audyt; nie ma tu kasowania lub renumerowania.
Wszystkie bity identycznie sklonowanej instalacji bez jakiejkolwiek rozbieżności
nie dają obserwowalnego dowodu kolizji. Nie deklarujemy rozpoznawania takiego klonu
przed otrzymaniem sprzecznej deklaracji/operacji. Nie kopiować całych profili urządzeń.

## Kopie i granice 5c2a

JSON i pełny ZIP pozostają v12; nowe aplikacje czytają wcześniejsze numery i kopie.
Starszy program nie rozumie nowej numeracji i po fence dziennika nie może zapisywać.
Nie zalecamy downgrade. To nie jest nowy format kopii danych biznesowych.

JSON/ZIP NIE zawierają lokalnego licznika, dziennika, konfliktów, certyfikatów lub
zaufania. Numery dokumentów zawierają tylko ich publiczną przestrzeń numeracyjną.
Nie przedstawiać biznesowego ZIP jako pełnej kopii audytu synchronizacji.
Odtworzenie zachowuje high-water i restore-review, blokując nowe wystawienie przed
uzgodnieniem historii. Nowa instalacja tworzy własną przestrzeń, nie przejmuje cudzej.

Nowe wersje rodzin historycznych/obcych po aktywacji są jawnie blocked do uzgodnienia
właściciela. Nie można bezpiecznie przydzielać im offline tego samego numeru/wersji
na dwóch instalacjach. Oryginały i idempotentne ponowne użycie pozostają dostępne.

**W 5c2a pełne reports oraz zmiany visits.reportIdentities/counters nadal nie są
zdalnie materializowane.** Deklaracje przestrzeni są trwale known i przekazywalne,
ale same nie udają applied do biznesowego Data. Kolizje są wykrywane przed tą
granicą. Nie wdrożono jeszcze SHA256 walidacji odbieranego snapshotu ani dostępności
dokumentu ze zdjęciami na drugim urządzeniu. Nie przesyłamy zdjęć/miniaturek i nie
tworzymy PhotoMetadata. Lokalne raporty i pliki pozostają zachowane.

## Weryfikacja i dalsze podpunkty

Testy 5c2a używają syntetycznych danych, trzech oddzielnych trwałych IndexedDB
i kodeka SHA256 z przekazywaniem przez B. Wyniki konkretnych HEAD: PROGRESS i opis PR.

5c2b: atomowy adapter tożsamości/snapshotów, pełna struktura i SHA256, wyraźna ograniczona
dostępność dokumentu bez plików, spójność visits/reports i własności rodziny.

5c2c: jawne decyzje finansów i alternatywnych historii czasu, zachowanie obu audytów
w trwałym dzienniku, idempotentne propagowanie decyzji oraz polityka przyszłego archiwum.
Dotychczasowy destrukcyjny wybór local/remote dla finansów pozostaje zablokowany.
Nie rozpoczynać biznesowego LAN, GM-011C ani fizycznego odbioru.
