# GM-005 — automatyczne harmonogramy zabiegów

## Obsługa

W istniejącym formularzu „Nowe zadanie” wybierz „Zabieg — kolejny termin od
faktycznego wykonania”. Wymagane są klient i ogród; strefa jest opcjonalna.
Dostępne są interwały dni, tygodni i miesięcy, opis, dodatkowe uwagi, materiał
lub preparat oraz coroczny sezon z dokładnością do dnia. Materiał jest wyłącznie
własną informacją użytkownika. Aplikacja nie dobiera dawek ani mieszanin.

Starsze harmonogramy nadal liczą terminy od daty rozpoczęcia. Tryb nowej serii
wybiera się świadomie przy jej zakładaniu. Nie ma automatycznej konwersji starej
serii ani zmiany jej wystąpień. Aby zmienić tryb, zakończ serię i załóż nową.

„Potwierdź wykonanie zabiegu” wymaga podania **faktycznej daty wykonania**.
Pole jest początkowo puste. Datę zapisu potwierdzenia przechowujemy osobno.
Można wskazać istniejące zlecenie tego ogrodu; wiele zabiegów może dotyczyć
jednej wizyty. Potwierdzenie nie tworzy wizyty, czasu pracy ani należności.
Zakończenie wizyty nie potwierdza automatycznie żadnego zabiegu.
Dotychczasowa jawna akcja „Rozpocznij pracę” nadal tworzy wizytę i uruchamia
stoper zgodnie z istniejącymi regułami.

## Jednoznaczne reguły dat

- Pierwszy termin wynika z daty rozpoczęcia, przesuniętej w razie potrzeby do
  pierwszego aktywnego dnia sezonu. Jeden oczekujący termin jest zapisany trwale.
- Kolejny termin = faktyczna data wykonania + interwał. Przykład: plan 1 IV,
  wykonanie 8 IV, 30 dni → 8 V. Ręczne przesunięcie planu na 5 IV niczego
  nie zmienia w tym obliczeniu.
- Dni i tygodnie są dniami kalendarzowymi, liczonymi przez dotychczasowe funkcje
  dat UTC. Zmiana czasu i strefa urządzenia nie dodają ani nie odejmują dnia.
- Miesiące: jeśli docelowy miesiąc nie ma danego dnia, wybieramy jego ostatni
  dzień (31 I → 28/29 II). Po kolejnym wykonaniu punktem wyjścia jest nowa
  faktyczna data, nie wcześniejszy dzień 31.
- Granice corocznego sezonu są włącznie; sezon może przechodzić przez Nowy Rok.
  Kandydat poza sezonem przechodzi do pierwszego aktywnego dnia na/po nim.
  Przykład: sezon 1 IV–30 IX, wykonanie 25 IX, 30 dni → 1 IV następnego roku.
  Uwzględniamy lata przestępne, także sezon obejmujący wyłącznie 29 II.
- Niewykonany termin pozostaje jedną zaległością. Zima nie generuje kolejnych
  zaległości ani nie usuwa tej, która wymaga decyzji użytkownika. Historia
  prawdziwego wykonania może zawierać datę poza sezonem — zapisujemy fakty.
- Pominięcie **nie jest wykonaniem**. Następny termin liczymy od pomijanego
  bieżącego terminu (także po jego ręcznym przesunięciu), dodając interwał i
  stosując tę samą regułę sezonu. Formularz pokazuje wynik przed potwierdzeniem.
- Edycja interwału dotyczy kolejnego potwierdzenia; nie zmienia bieżącego planu
  ani ukończonych wpisów. Zmiana sezonu może przenieść tylko oczekujący termin.
  Skrócenie daty końca może zamknąć go bez wykonania (powód zapisany w historii).
- Zakończenie serii zamyka niewykonany termin i blokuje kolejne. Zlecenia i
  ukończona historia pozostają. Rozszerzenie dat już wyczerpanej/zakończonej
  serii nie wznawia jej samoczynnie; nowy ciąg wymaga świadomego założenia serii.

## Model i trwałość

Najmniejsze rozszerzenie istniejących `taskSchedules` i `taskOccurrences`:

- opcjonalne `schedule.care`: sezon, materiał i uwagi;
- `occurrence.careCycle`: kolejny numer cyklu, `completion`: faktyczna data,
  czas zapisu, opcjonalny identyfikator/tytuł wizyty, migawka interwału i materiału;
- status `completed`, a dla anulowanych powód `skipped`, `ended` lub `limit`.

Licznik cyklu jest częścią ID i adresu URL: wczesne wykonania mogą legalnie
powodować, że dwa różne cykle mają tę samą datę planowaną. Stare ID oraz adresy
bez `cycle` zachowują działanie; niejednoznaczny adres wymaga wyboru z historii.
Wspólny kontroler zachowuje kalendarz, filtry, stos kart i Wstecz/Dalej.
Historia pokazuje plan, faktyczne wykonanie, zapis potwierdzenia, interwał,
materiał i rzeczywiste powiązanie z wizytą. Zlecenie z taką historią jest
chronione przed usunięciem lub przeniesieniem do innego ogrodu.

Nowy format JSON to **v10**; migracja v9 nie zmienia jego danych ani reguł.
Zachowujemy dokładny źródłowy zapis v9 w kopii migracyjnej. Dla istniejącej
bazy IndexedDB oryginalny stan jest zachowany w `state/format-v9-source`;
aktualny stan otrzymuje znacznik `formatVersion`. Nie zmienia się nazwa ani
wersja bazy, klucz `garden-manager:v1`, magazyn zdjęć ani manifest ZIP.
JSON i ZIP eksportują v10, a import nadal obsługuje wcześniejsze wersje.
Downgrade do aplikacji v9 po utworzeniu zabiegów nie jest obsługiwany.
Przed aktualizacją warto zachować pełną kopię ZIP; JSON zawiera tylko metadane zdjęć.

Potwierdzenie i dopisanie następnego terminu wykonują się w **jednej istniejącej
transakcji readwrite IndexedDB**, na aktualnym stanie. Powtórzenie tych samych
parametrów jest idempotentne, sprzeczne daty/edycje mają kontrolę rewizji.
Walidacja importu wymaga najwyżej jednego oczekującego cyklu i spójnych ID,
statusów oraz powiązań. Równoczesny import używa dotychczasowego porównania
stanu przed zatwierdzeniem: nie może po cichu nadpisać nowego wykonania.
localStorage pozostaje lustrem, nie źródłem nieatomowych zapisów.

Formularze blokują opuszczenie widoku podczas zapisu i pytają o odrzucenie
niezapisanej daty. Błąd zapisu zachowuje formularz oraz dotychczasowy stan.
Funkcja działa offline po pobraniu PWA. Brak synchronizacji między urządzeniami.
Wymagany jest dostępny IndexedDB; brak miejsca lub awaria transakcji blokują
zapis zamiast przełączać go na localStorage. Tak jak reszta lokalnej aplikacji,
wyczyszczenie danych witryny usuwa pamięć urządzenia — odzyskiwanie wymaga kopii.

## Wyniki weryfikacji

- `npm test`: **499/499**, 19 plików; 37 nowych przypadków jednostkowych.
- Pełne Chromium E2E: **240/241 w pierwszym przebiegu**. Jedynym niepowodzeniem
  była stara asercja wpisanej na sztywno wersji 9 w teście niezmienności formatu
  podczas nawigacji. Dane i stoper w tym teście pozostały bez zmian.
  Asercja porównuje teraz format przed/po nawigacji oraz bieżącą wersję modelu;
  ponowny przebieg całej grupy kart ogrodów: **16/16**. W efekcie zweryfikowano
  wszystkie **241 scenariuszy**, w tym 18 nowych GM-005. Kod aplikacji nie
  wymagał zmian po pełnym przebiegu.
- Produkcyjne PWA offline: **14/14**, w tym nowy scenariusz wykonania, przesunięcia,
  historii i ponownego otwarcia aplikacji bez sieci.
- `npx tsc -b` i `npm run build`: zaliczone. Build zachowuje dotychczasowe
  ostrzeżenia dotyczące rozmiaru PDF/fontkit i mieszanego importu checklist.
- Testy dat GM-005: dodatkowo **30/30 w Europe/Warsaw** i **30/30 w
  America/Los_Angeles**; obejmują granice miesięcy i zmiany czasu.
- Formularz sezonowy oraz szczegóły/potwierdzenie wykonania sprawdzone przy
  **360, 390 i 430 px**. Starsze moduły objęte pełną regresją.

Rekomendacja: gotowe do przeglądu i scalenia, z jawną migracją v9 → v10 oraz
opisanymi powyżej zasadami zakończenia i wznowienia serii. PR nie jest scalany automatycznie.
