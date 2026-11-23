# GM-011B — świadome decyzje finansowe i czasowe (5c2c)

## Granica bezpieczeństwa

To dokumentacja mechanizmu technicznego, nie instrukcja fizycznej synchronizacji.
PR #29 pozostaje Draft. Nie włączono biznesowego LAN, GUI ani synchronizacji zdjęć.

### 5c2c-A — model dowodów

Dodano oddzielny model FinancialDecisionRequest / FinancialEvidence. Propozycja
wskazuje pełny token aktualnych głów przyczynowych, ich oryginalne UUID, źródła,
liczniki, konteksty, before/after i udowodnioną wspólną bazę (albo jawny jej brak).
Jawna intencja opisuje wizytę lub wydatek; żądanie nie przyjmuje dowolnego docelowego
JSON ani poleceń start/stop. Wymagane są stabilne UUID decyzji oraz uzasadnienie.

Dowód należy do nowej operacji resolution o tym samym UUID, obejmującej dokładnie
rekord biznesowy i niezmienny rekord financialDecisions. Dowód musi odpowiadać
źródłom w kontekście tej operacji, a nie bieżącemu zegarowi lub nazwie urządzenia.
Weryfikacja modelu nie jest upoważnieniem do zapisu Data: wymagane są dodatkowo
kontrolowany adapter domenowy, walidacja zależności i atomowy zapis odbiorcy.

Obie alternatywne historie pozostają w dzienniku źródłowych operacji i jawnych
wariantach dowodu. Model nie wymaga zmiany biznesowego v12 ani IndexedDB v2.
Nie ma retencji usuwającej oryginały; po osiągnięciu dotychczasowych limitów zapis
zatrzymuje się bez utraty historii. Zwykły JSON/ZIP v12 nie jest pełną kopią tego
audytu. Restore-review nadal wymaga późniejszego uzgodnienia historii.

## Stan implementacji

Checkpoint A dodaje wyłącznie ścisły model i testy dowodów. Nie odblokowuje jeszcze
stosowania finansowych decyzji, nie dodaje ich do białej listy sieciowej i nie
zmienia generic resolveSyncConflict. Jego blokada finansów pozostaje obowiązująca.

Następny checkpoint B: deterministyczne odtworzenie wyniku z intencji, ochrona
stopera/otwartego audytu, kontrolowane lokalne API, walidacja otrzymanej decyzji,
atomowy zapis Data + journal + receiver i status resolved dla niezastosowanych
alternatyw. Dopiero po tym można uznać decyzje za stosowalne.


## 5c2c-B/C — kontrolowany adapter (weryfikacja w toku)

Dodano resolveFinancialSyncConflict jako lokalne API AtomicRepository. Decyzja
musi zawierać aktualne conflictId/token, UUID, uzasadnienie i ograniczoną intencję.
Nie ma nowego IPC ani polecenia sieciowego. Ogólne resolveSyncConflict nadal odmawia
finansów. Pełny dowód financialDecisions jest częścią tej samej niepodzielnej
operacji resolution co wynik wizyty/wydatku; nie jest osobnym zapisem Data.

Wizyta: wybór źródłowego zatwierdzenia albo jawnej kwoty robocizny w groszach;
wybór źródłowej historii czasu albo nowa korekta corrected z UUID decyzji;
jawne keep/correct/cancel dla KAŻDEGO oryginalnego payment.id. Różne ID tej samej
kwoty pozostają różnymi wpłatami. Nie są tworzone nowe ID wpłat. Domena sprawdza
nadpłaty, rodziców, dostępność i integralność. Nie przelicza się zatwierdzeń z
aktualnej stawki. Reports i reportIdentities muszą pozostać niezmienione.

Job.timeHistory przedstawia świadomie wybraną spójną gałąź, z nową corrected tylko
gdy żądano wyniku w sekundach. Inkompatybilnych 7200/9000 nie skleja się w fikcyjny
ciąg ani nie sumuje. Pełne obie gałęzie, pierwotne ID zdarzeń, before/after i
wcześniejsze operacje pozostają w niezmiennym dzienniku i źródłach dowodu decyzji.
Anulowana wpłata znika z bieżącej projekcji salda v12, ale NIE z tego audytu.

Wydatek: jawna kwota/kategoria/status i dopisana pozycja historii na świadomie
wybranej gałęzi. Obie źródłowe historie pozostają w dowodzie. Tożsamość, kierunek,
source/origin i inne dane źródłowe muszą być identyczne. CSV o tej samej udowodnionej
tożsamości przechodzi istniejącą walidację profilu/importu/wiersza; niezależnych
profili i niejednoznacznych transakcji nie można połączyć tym API. Nie zmieniono
transactionId, statementKey, identity, match, importId, line ani occurrence.

### Blokady

Nie rozstrzyga się usunięć, niezależnych korzeni, różnych danych niefinansowych,
różnych tożsamości raportów, wizyt powiązanych z harmonogramem ani starszych
wielorekordowych grup biznesowych. Nie rozstrzyga się otwartego źródłowego audytu
ani wizyty objętej lokalnym Timerem. Inne rekordy mogą być nadal stosowane.
Równoległe decyzje pozostają trwałym konfliktem; brak wspólnej spójnej bazy
wstrzymuje kolejne rozstrzygnięcie zamiast wymyślania nowej historii.

### Trwałość

Wszystkie zmiany Data, journal, receiver, audyt, status konfliktu i checkpointy
przechodzą istniejące syncTransition. Dopiero IDB oncomplete zwraca wynik.
Niezastosowane alternatywy otrzymują resolved, nie applied; już rzeczywiście
zastosowane zachowują applied. Identyczny retry UUID i treści zwraca pierwotny
wynik bez nowej operacji. Ta sama tożsamość z inną treścią jest odrzucana.
Nowy odbiorca ponownie odtwarza wynik z intencji i źródeł, weryfikuje pełny kontekst
przyczynowy i waliduje domenę. Sam odbiór nadal nie oznacza zastosowania.

Implementacja wymaga testów CI tego commitu i dalszych testów Chromium. Nie jest
jeszcze zakończeniem 5c2c ani gotową synchronizacją natywną.


## Wykryta otwarta granica — aktywny pomiar i przyczynowość komend

Test nowego API wykazał istotny nierozwiązany przypadek: jeżeli alternatywa wizyty
jest już known podczas lokalnego aktywnego Timer, zwykłe captureJournal nie może
dopisać STOP do sprzecznego visits. Nie wolno udawać, że sam STOP rozstrzyga obcą
historię. Obecny kod odmawia obu niebezpiecznych zapisów (decyzji i STOP), zachowując
Timer, Data i oba audyty. Dotyczy to samej spornej wizyty, nie innych decyzji.

To nie jest ukończona obsługa scenariusza „zamknij pomiar, potem rozstrzygnij”.
Wymaga osobnego bezpiecznego modelu zamykania lokalnej gałęzi pomiaru przy known,
ale niezastosowanej alternatywie (bez fikcyjnego resolution lub utraty audytu).
Nie wprowadzono doraźnego manipulowania wektorami ani cofania known. Dodano test
utrzymania danych i jawnego fail-closed; nie uznano tego za zaliczenie pełnego
kryterium aktywnego stopera. Ten przypadek blokuje zamknięcie całego 5c2c i odbiór.

Także ponowne uzgodnienie dwóch równoległych decyzji bez spójnej wspólnej bazy,
pełne uzgodnienie jednostek CSV i historycznych grup wielorekordowych pozostają
otwarte. Bieżący checkpoint jest bezpieczną, ograniczoną implementacją, nie
deklaracją ukończenia 5c2c. PR musi pozostać Draft.


### Sprawdzanie wariantów nigdy wcześniej niezastosowanych

Sam poprawny kształt v12 nie wystarcza. Przed decyzją adapter ponownie sprawdza
źródłowe przejście historii czasu (w tym pierwszy beforeSeconds), pierwsze
zatwierdzenie i końcową zgodność historii wydatku z jego bieżącą wartością.
Rama niefinansowa musi być zgodna także ze wspólną bazą. Jawny wybór nie może
stać się sposobem zatwierdzenia wadliwego źródła.


Daty nie wybierają zwycięzcy. Dla wydatku updatedAt i wpis końcowy są ograniczone
od dołu wyłącznie przez istniejące createdAt, aby zachować invariant v12 przy
źle ustawionym lokalnym zegarze. Faktyczne lokalne at decyzji pozostaje w dowodzie;
nie określa kolejności przyczynowej ani poprawnej kwoty. Odtworzenie na odbiorcy
jest deterministyczne również przy różnych zegarach.


## Kontynuacja STOP — projekt gałęzi pomiaru

Operacja localTimeBranches jest audytem faktycznego lokalnego pause/resume/stop
i wskazuje konkretny parentId własnej wersji visits. UUID operacji jest oryginalnym
UUID zdarzenia z auditTimeChanges. Dowód wiąże before/after, Timer przed/po oraz
dokładny przyrost sekund z istniejącym silnikiem. Nie zawiera polecenia wykonania
stopera na odbiorcy. Nie zmienia Data v12 ani technicznego schematu IndexedDB v2.

Pełny wektor operacji nadal zawiera wszystkie known. Oddzielna projekcja wersji
rekordu przedłuża wyłącznie wskazanego rodzica, więc sama wiedza o obcej wersji nie
jest jej zastąpieniem. Zapisane operacje, ich UUID i wektory pozostają niezmienne.
Dopiero późniejsza jawna operacja resolution może zamknąć obie alternatywy.
Model nie używa LWW ani cofania known.

Pierwszy checkpoint dodaje model i testy przyczynowości. Automatyczne tworzenie
dowodu podczas komendy stopera i kontrolowane stosowanie odbiorcy są kolejnym
krokiem; sam ten checkpoint jeszcze nie odblokowuje STOP aplikacji.
