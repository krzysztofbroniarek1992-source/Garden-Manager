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
