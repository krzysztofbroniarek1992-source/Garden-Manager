# GM-011B — punkt 4: kontrolowany odbiorca

Status: wewnętrzne API i testy, PR #29 nadal Draft. Nie ma jeszcze biznesowego połączenia LAN ani kompletnego GUI. Nie aktywować ręcznie na danych produkcyjnych. Ten dokument opisuje API do podłączenia kolejnego etapu; nie jest instrukcją fizycznej synchronizacji.

## Zapis i stany

Data v12 pozostaje w state/current, techniczna wersja IndexedDB pozostaje 2. Dziennik journal-v1, receiver-v1 i checkpointy znajdują się w tej samej bazie/object store sync. Nie powstaje drugi model danych klientów lub kopia zastępująca bazę odbiorcy.

| Stan | Co oznacza |
| --- | --- |
| received | Surowa operacja w trakcie przyjmowania |
| waiting-dependencies | Trwale odebrana operacja czeka na poprzedniki przyczynowe |
| verified | Zweryfikowana przyczynowo; obecna także w journal.log i known; Data nie zmieniono |
| planned | Przeszła symulację i oczekuje na zatwierdzenie |
| waiting-records | Nie zastosowano wersji rekordu lub brak/usunięcie/konflikt rodzica |
| conflict | Wymaga jawnej decyzji albo zastosowania odebranej decyzji |
| blocked | Nieobsługiwany typ, nierozerwalna grupa lub chronione lokalne powiązania |
| applied | Data i znacznik appliedRevision zatwierdzone razem |
| resolved | Wariant świadomie zastąpiony wskazaną operacją decyzji; nie oznacza applied |
| rejected | Wadliwa operacja nie może zostać zastosowana |

Samo istnienie w receipts dowodzi trwałego odbioru, a nie zastosowania. known opisuje wyłącznie sprawdzoną przyczynowość; nie jest zegarem zastosowania. Błędy niepoprawnych prób (np. podszycie applied w sieci lub UUID o innej treści) mają osobny audyt rejections i nie niszczą prawidłowego istniejącego potwierdzenia.

Surowe luki pozostają w inbox. Walidacja opóźnionego błędnego rekordu nie wycofuje poprawnego poprzednika ani innych źródeł. Odrzuconego źródłowego zdarzenia nie zastępujemy poprawioną treścią pod tym samym ID/licznikiem. Taki ciąg wymaga późniejszego jawnego uzgodnienia; zależne operacje pozostają wstrzymane.

## API AtomicRepository

- enableSyncJournal(installation): jawna aktywacja. Bootstrap nowych dzienników zapisuje niezależne rekordy jako osobne operacje w tej samej transakcji aktywacji. Istniejących operacji i źródeł nie przepisuje.
- receiveSyncOperations(operations): przyjmuje wyłącznie oryginalne operacje, nie statusy ani metadane odbiorcy. Zachowuje UUID/origin/sequence/context. Wynik jest zwracany po oncomplete.
- readSyncReceiver(): odczyt lokalnych receipts, konfliktów, planu i trwałych potwierdzeń; nie aktywuje synchronizacji.
- planSyncOperations(): symuluje całe operacje, zapisuje plan i konflikty, zwraca liczniki. Nie zmienia Data.
- applySyncPlan(planId): wymaga nadal aktualnej rewizji Data, inbox i wektora known. Atomowo zapisuje Data, dziennik i wynik. Powtórzenie zatwierdzonego planu zwraca oryginalne CommitReceipt.
- resolveSyncConflict({conflictId, token, choice}): świadoma decyzja lokalna. choice to local, remote z operationId albo custom z pełną wartością JSON. Token i aktualne głowy muszą się zgadzać.

Kod przyszłego UI powinien po planowaniu wyświetlić również blocked, dependencies i conflicts. Brak bezpiecznych operacji daje plan=null. Nie wolno prezentować tego jako pełnego sukcesu. Zatwierdzenie wyniku na jednym urządzeniu nie oznacza rozproszonej transakcji ani synchronizacji komputera pozostającego offline.

API nie zostało dodane do IPC, Capacitor ani GM-011A. Przyszły transport musi uwierzytelnić partnera, uzgodnić funkcjonalność biznesową/model, sprawdzić kodek pakietu i powiązać tożsamość repliki. Nie należy wystawiać tych metod jako dowolnego RPC. Prefiksy spoza jawnej listy jednostek v12 (w szczególności photos, timer i tożsamości/klucze) oraz payloady zawierające zabronione referencje zdjęć są odrzucane przed zapisem do dziennika/inbox, aby nie mogły być przekazywane dalej.

## Granice obsługiwanych danych

- Klienci: pełne rekordy, automatyczne scalanie rozłącznych pól z dowodem przyczynowym; kolizja ID niezależnych utworzeń nie jest dopasowaniem nazw.
- Ogrody/strefy: jedna jednostka ogrodu. Rodzic musi być udowodniony w kontekście źródła i obecny bez konfliktu; samo istnienie takiego samego ID na odbiorcy nie wystarcza.
- Katalog: ścisły kształt danych, pełna walidacja kwot/jednostek. Usunięcie materiału użytego w historii jest blokowane.
- Niezależne notatki i sprawy: brak powiązań klient/ogród/strefa/zlecenie; zachowane źródłowe metadane i tombstones. Powiązane notatki/sprawy są na razie blocked.
- Lokalne photoId/photoName notatki są zachowane przy aktualizacji; przychodzące referencje zdjęć są odrzucane. Pliki ani metadane zdjęć nie są przesyłane.

Istniejące reguły GardenStore są sprawdzane na odłączonej próbie. Jeżeli usunięcie lub zmiana ogrodu wymagałaby odpinania lokalnych zdjęć, historii, checklist albo notatek poza zatwierdzoną grupą, operacja pozostaje zablokowana. Wynik każdej jednostki przechodzi validateData. Nie zapisujemy wygenerowanych przez próbę timestampów lub rekoncyliacji.

Wizyta, czas, płatności, rozliczenie, raporty/numery, wydatki/CSV, zakupy, planowanie, checklisty, dostępność i ustawienia pozostają blocked. Również API decyzji odrzuca te typy. Jedna operacja mieszana jest blokowana w całości. Późniejsza edycja obsługiwanego fragmentu nie może obejść niezastosowanego poprzednika.

## Konflikty i decyzje

StoredConflict zachowuje klucz/typ rekordu, głowy i identyfikatory operacji, udowodnioną wspólną bazę lub baseAvailable=false, kanoniczny wariant lokalny, warianty głów oraz pola i przyczynę. Status open/resolved/superseded i resolvedBy pozostają po restarcie.

Wybór remote/local dla konfliktu pól klienta zachowuje pozostałe bezkonfliktowe pola. Decyzja tworzy nową lokalną operację przyczynową; odbiór i stosowanie oryginalnej operacji z innego urządzenia tego nie robi. Notatka i jej tombstone są rozstrzygane razem. Jeżeli decyzja rozdzielałaby starszą operację wielorekordową, API odmawia zapisu zamiast częściowo ją zastosować. Pełny kreator uzgadniania takich grup pozostaje dalszą pracą.

## Awaria, restart i kopie

Przed pierwszym zastosowaniem zachowujemy before-first-receive-apply, przed kolejnymi before-last-receive-apply. Checkpoint, Data, journal i receiver zapisują się w jednej transakcji. Quota, błąd magazynu, abort lub niespójność nie mogą pozostawić znacznika applied bez Data. localStorage jest aktualizowane dopiero po zatwierdzeniu i pozostaje kopią zgodności.

Po utracie odpowiedzi można wywołać ponownie applySyncPlan z tym samym ID. Trwałe CommitReceipt uniemożliwia ponowne naliczenie. Nie jest to automatyczna synchronizacja ani wznowienie połączenia LAN.

JSON/ZIP pozostają zgodne z v12 i nie przenoszą kluczy, zaufania ani lokalnego inbox. Import zachowuje wcześniejszy dziennik i ustawia restore-review; API odbioru, planu i zastosowania jest wstrzymane. Pełny kreator przywracania wspólnej historii i przenośne archiwum synchronizacji są nadal wymagane przed pełnym odbiorem GM-011B.

Nie wdrożono kompakcji. Łączny limit journal+receiver wynosi 64 MiB; do 20000 operacji. Przekroczenie cofa zapis, nie usuwa tombstones ani odebranych dowodów. Ograniczany audyt 128 niepoprawnych prób nie jest historią zaakceptowanych operacji.

## Testy i kolejny punkt

receiver.test.ts sprawdza oddzielne instancje fake-indexeddb. sync-receiver.spec.ts korzysta z trzech oddzielnych rzeczywistych baz A/B/C w Chromium, lokalnych syntetycznych danych, WebCrypto i kodeka oraz ponownego uruchomienia procesu przeglądarki. Dla JPEG B ma osobny magazyn plików. To nie jest test trzech natywnych urządzeń ani LAN.

Przed natywną integracją pozostają polityki obsługi finansów/CSV/zakupów i czasu, numeracji raportów offline, pełne grupy zależności i onboardingu, kreator restore, retencja/archiwum oraz negocjacja/wiązanie tożsamości i trwałe potwierdzenia przez GM-011A. GUI planu i konfliktów jest osobnym podłączeniem do powyższego API. Nie rozpoczynamy GM-011C.
