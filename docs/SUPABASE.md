# Supabase: przygotowana struktura i plan synchronizacji

## Stan wersji 0.3

Aplikacja używa lokalnego repozytorium danych. Nie ma połączenia z Supabase,
logowania ani synchronizacji pomiędzy urządzeniami. Migracja SQL jest podstawą
następnego etapu; jej przygotowanie nie oznacza wykonania na działającej bazie.
Testy lokalne aplikacji nie weryfikują polityk RLS na serwerze Supabase.
Migracja 0.3 przeszła dodatkowo 41 sprawdzeń wizyt, wycen i izolacji danych
w osadzonym PostgreSQL, w tym aktualizację historycznych tombstonów.

Przyrostowa migracja płatności przeszła dodatkowe 35 sprawdzeń SQL/RLS
w osadzonym PostgreSQL: wpłaty częściowe, edycję i usunięcie, zaokrąglenia,
izolację właścicieli i odrzucanie nadpłat oraz zmian zmniejszających pokrycie
już otrzymanych wpłat. Ten test używa zastępników Auth; konkurencję transakcji
i rzeczywiste JWT trzeba jeszcze sprawdzić na osobnym projekcie Supabase.

Migrację wykonano kontrolnie w osadzonym PostgreSQL (PGlite), z minimalnymi
zastępnikami schematu Auth i ról Supabase. Przeszło 35 sprawdzeń izolacji danych,
kluczy obcych, ograniczeń wartości, sesji stopera i usuwania konta. To potwierdza
działanie SQL i RLS w tym teście; nie zastępuje integracji z prawdziwym Supabase Auth.

Interfejsy domenowe i oddzielna warstwa repozytorium pozwalają zastąpić lub
rozszerzyć lokalny zapis bez wiązania widoków z API bazy. Zanim zostanie
włączony tryb chmurowy, potrzebny jest adapter Supabase, przepływ Auth, kolejka
zmian i testy integracyjne opisane poniżej.

## Uruchomienie bazy w przyszłym etapie

1. Utwórz projekt Supabase; prototyp nie wymaga planu płatnego.
2. W SQL Editor wykonaj plik
   `supabase/migrations/202611010001_initial_schema.sql` w nowym projekcie lub
   zastosuj migracje przez Supabase CLI. Następnie wykonaj
   `supabase/migrations/202611010002_payments.sql`, a potem
   `supabase/migrations/202611010003_visits_and_settlements.sql`. Migracje są
   przyrostowe: nie usuwają istniejących klientów, ogrodów lub zleceń. Trzecia
   migracja dodaje zachowane wyceny do zakończonych zleceń. Migracje nie są przeznaczone do ponownego wykonania na tabelach,
   które już istnieją.
3. W Supabase Auth utwórz konto właściciela firmy i wyłącz publiczną rejestrację,
   jeżeli wdrożenie ma służyć tylko jednej osobie. Skonfiguruj dozwolone adresy
   przekierowań aplikacji i logowanie, np. e-mail/hasło lub magic link.
4. Dopiero po wdrożeniu adaptera skonfiguruj publiczny URL projektu i klucz
   publishable (ewentualnie starszy klucz anon). Same zmienne z `.env.example`
   nie włączają obecnie synchronizacji.
5. Nie umieszczaj w kodzie ani zmiennych `VITE_*` klucza `service_role`, hasła
   PostgreSQL lub innych sekretów. Vite udostępnia te zmienne przeglądarce.

Uwierzytelnienie użytkownika odbywa się przez Supabase Auth. Klient korzysta
z publicznego klucza projektu oraz krótkotrwałego JWT sesji. Hasło podaje się
wyłącznie w formularzu logowania obsługiwanym przez Auth, nie w repozytorium.

## Tabele i izolacja danych

| Tabela | Zawartość |
| --- | --- |
| `clients` | Klienci, kontakt i notatki |
| `gardens` | Ogrody/obiekty, klient, adres i powierzchnia |
| `jobs` | Termin, status, czynności, typ rozliczenia, stawka, korekta czasu i zatwierdzona wycena |
| `materials` | Materiały konkretnego zlecenia: ilość × cena jednostkowa |
| `work_sessions` | Przedziały pracy START/STOP |
| `settings` | Domyślna stawka godzinowa właściciela |
| `payments` | Wpłaty przypisane do zleceń: całkowite grosze, data, metoda i notatka |

Każda tabela ma `owner_id` odnoszące się do `auth.users`. Wszystkie mają włączone
RLS, a zasady SELECT, INSERT, UPDATE i DELETE pozwalają zalogowanemu użytkownikowi
pracować wyłącznie z własnymi rekordami. Rola anonimowa nie ma uprawnień do tych
tabel. Klucze obce `(owner_id, parent_id)` zapobiegają przypisaniu ogrodu do
cudzego klienta, zlecenia do cudzego ogrodu oraz materiału lub sesji do cudzego
zlecenia — samo sprawdzenie `owner_id` nowego rekordu tego nie zapewnia.

Wartości ujemne stawek, cen, czasu i powierzchni są odrzucane. Liczby materiałów
muszą być dodatnie. Przedziały pracy nie mogą kończyć się przed rozpoczęciem.
Częściowy indeks unikatowy dopuszcza tylko jedną aktywną sesję pracy na
właściciela, również gdy START zostanie naciśnięty równocześnie na dwóch
urządzeniach. Na kolejny etap pozostaje atomowa operacja API/RPC łącząca START,
STOP i zmianę statusu zlecenia; sama struktura nie realizuje całego procesu.

Przed wdrożeniem należy przetestować na osobnej bazie: anonimowy odczyt i zapis,
izolację dwóch kont, podmianę `owner_id`, odwołanie do cudzego rodzica, kaskadowe
usunięcie konta oraz konkurencyjny START. Konto administracyjne Supabase może
omijać RLS i nie może być używane przez aplikację przeglądarkową.

## Mapowanie lokalnego modelu

Nazwy pól domeny są w camelCase, a bazy w snake_case; adapter odpowiada za
przekształcenie. `Job.date` → `scheduled_date`, `Job.time` → `scheduled_time`,
`Job.rate` → `hourly_rate`, `Job.fixedPrice` → `fixed_price`. `Job.materials`
staje się kolekcją rekordów tabeli `materials`.

Lokalne `Job.seconds` zawiera już zakończony czas pracy. Przy jednorazowym,
świadomym imporcie danych rzeczywistych można zapisać go w `imported_seconds`.
Kolejne sesje trafiają do `work_sessions`; widoczny czas to suma importu,
zakończonych sesji i aktualnie biegnącej sesji. Tego samego czasu nie wolno
zapisać jednocześnie w imporcie i sesjach. Aktywnego lokalnego stopera nie
importuje się automatycznie: najpierw STOP i potwierdzenie importu. Przykładowe
dane testowe nie powinny być automatycznie wysyłane do produkcyjnej bazy.

Planowany termin to lokalna data i godzina pracy (domyślnie Polska), natomiast
sesje i znaczniki synchronizacji używają `timestamptz`/UTC. Płatność godzinowa
to czas w sekundach / 3600 × stawka zlecenia. Przy ryczałcie robocizna ma
wartość stałą. Materiały dolicza się w obu przypadkach oddzielnie; zaokrąglenie
do groszy następuje osobno dla robocizny oraz łącznej wartości materiałów,
a potem sumowane są całkowite grosze. Zmiana domyślnej stawki nie powinna
zmieniać już ustalonych stawek istniejących zleceń.

## Plan synchronizacji

- Utrzymuj lokalny cache i trwałą kolejkę operacji w IndexedDB, osobną dla
  zalogowanego `owner_id`. Generuj UUID przed wysłaniem — ponowienie wysyłki
  nie powinno tworzyć drugiego rekordu.
- Po zalogowaniu pobierz własne rekordy i dopiero wtedy udostępnij tryb chmurowy.
  Wysyłaj rodziców przed potomkami, a powiązane zmiany (np. zlecenie i materiały)
  zapisuj atomowo przez przetestowaną operację serwerową.
- Tabele mają serwerowe `updated_at` i rosnącą `revision`. Zapisuj zmianę z
  warunkiem oczekiwanej rewizji; brak zmienionego wiersza oznacza konflikt,
  nie sukces. Nie stosuj bezwarunkowego „ostatni zapis wygrywa” dla rozliczeń
  ani czasu pracy. Pokaż obie wersje i pozwól właścicielowi rozstrzygnąć konflikt.
- Pobieraj zmiany z deterministycznym kursorem `(updated_at, id)` i zakładką
  czasową lub pełnym okresowym odświeżeniem. Nie opieraj spójności wyłącznie
  na zdarzeniach Realtime, które mogą zostać pominięte podczas braku sieci.
- `deleted_at` w tabelach danych pozwala rozsyłać usunięcia. W trybie synchronizacji
  używaj takich znaczników zamiast natychmiastowego DELETE; sprzątanie po okresie
  retencji musi uwzględniać urządzenia długo pozostające offline.
- Równoczesny START rozstrzyga baza, nie zegar urządzenia. Adapter musi obsłużyć
  konflikt unikatowego indeksu i pokazać aktywną sesję z serwera. Operacje offline
  wymagają jawnego uzgodnienia przedziałów, aby nie naliczać czasu podwójnie.
- Status interfejsu powinien odróżniać zapis lokalny, zmiany oczekujące,
  synchronizację, konflikt i błąd. Przy wylogowaniu odłącz kanały oraz zamknij
  magazyn konta; następne konto nie może zobaczyć jego danych.

## Kolejne moduły

Moduły sprzętu, serwisów, kosztów i zdjęć powinny mieć własne tabele, repozytoria
i widoki oraz stosować ten sam `owner_id`, wersjonowanie i polityki RLS.
Koszty mogą odnosić się do zlecenia lub sprzętu; serwisy do sprzętu. Zdjęcia
przechowuj w prywatnym bucketcie Supabase Storage, w ścieżkach zaczynających
się od identyfikatora użytkownika, z osobnymi politykami Storage. Dostęp przez
krótkotrwałe podpisane URL; metadane i powiązania zdjęć w tabeli właściciela.
Te moduły i bucket nie są częścią obecnej migracji.

## Rejestr płatności i migracja 0.2

Lokalna płatność `Payment` zawiera `id`, `jobId`, `amountCents`,
`receivedDate`, `method` i `note`. Adapter mapuje je odpowiednio do
`id`, `job_id`, `amount_cents`, `received_date`, `method` i `note`.
Metody to `cash`, `transfer`, `blik`, `other`; interfejs wyświetla polskie nazwy.
Identyfikator klienta nie jest powielany w płatności: wynika z powiązania
płatność → zlecenie → ogród → klient, co zapobiega podwójnemu zliczaniu.

Kwoty płatności są dodatnimi całkowitymi groszami, ograniczonymi do bezpiecznego
zakresu liczb JavaScript. SQL używa `bigint` dla wpłat i dokładnego `numeric`
dla pośrednich obliczeń. Robocizna godzinowa to
`round(sekundy × stawka_w_groszach / 3600)`, ryczałt to stała kwota w groszach,
a materiały to `round(sum(ilość × cena_jednostkowa_w_groszach))`.
Zachowana jest kolejność zaokrągleń wersji 0.1, także dla ułamkowych ilości. Nie sumuje się kwot
płatności z wartością zlecenia jako jednego przychodu.

Statusy rozliczeń są wyliczane, a nie przechowywane jako edytowalna flaga:
bez wpłat — nierozliczone, suma wpłat mniejsza niż należność — częściowo
rozliczone, suma równa należności — rozliczone. Zlecenie zerowe bez wpłat
pozostaje bez wpłat i nie tworzy zaległości. Status wykonania pracy jest
oddzielnym polem. Zakończenie zlecenia nie dodaje wpisu do `payments`.

Migracja SQL nie generuje płatności na podstawie historii. Nowa tabela jest
pusta do chwili jawnego wprowadzenia otrzymanych wpłat. Analogicznie lokalna
migracja formatu 1 → 2 zachowuje istniejące dane, zapisuje ich oryginał pod
`garden-manager:backup:v1` i dodaje pusty rejestr płatności. Główny klucz
`garden-manager:v1` pozostaje bez zmian dla zgodności originu; wewnętrzna
wersja koperty zmienia się na 2. Nie wolno resetować localStorage podczas
aktualizacji ani rozsyłać pustego demo jako zastępstwa dla nieudanej migracji.

Nowa tabela ma cztery polityki RLS ograniczone do `auth.uid() = owner_id`,
odmowę dostępu anonimowego oraz złożony klucz obcy do własnego zlecenia.
Wyzwalacze działają jako `SECURITY INVOKER`, z pustym `search_path`,
i nie omijają zasad właściciela. Przy dodawaniu lub zmianie wpłaty blokowany
jest wiersz zlecenia; ponowne obliczenie salda odrzuca nadpłatę, również przy
konkurencyjnych zapisach do tego samego zlecenia. Edycja nie dolicza starej
wersji tej samej płatności po raz drugi. Korekta kwoty, daty, metody i notatki
pozostaje możliwa; istniejącej płatności nie można przepiąć do innego zlecenia.
Zapis wpłaty lub składnika kosztu podnosi też rewizję rodzica, dzięki czemu
transakcja z nieaktualnym obrazem w trybie REPEATABLE READ otrzyma błąd
serializacji. Adapter musi po zapisie odświeżyć zarówno wpłatę, jak i zlecenie.

Zmiany materiałów i sesji pracy blokują ten sam wiersz rodzica. Zmniejszenie
wartości pracy lub kosztu materiałów poniżej otrzymanych wpłat jest odrzucane.
Zlecenie z aktywnymi wpisami płatności nie może zostać usunięte ani przeniesione
do innego ogrodu; ogród z takimi zleceniami nie może zmienić klienta. Najpierw
trzeba jawnie skorygować błędne wpłaty. Te kontrole nie są synchronizacją:
adapter nadal wymaga transakcji/RPC, obsługi konfliktów i testów na prawdziwym
Supabase. Przy błędach serializacji lub blokad adapter powinien ponowić całą
transakcję z tym samym UUID, zamiast tworzyć drugi wpis.

Zestawienie klienta sumuje wykonane prace i saldo wyłącznie z zakończonych
zleceń wszystkich jego ogrodów. Wpływy są sumą faktycznych aktywnych wpisów
płatności wszystkich jego zleceń, łącznie z zaliczkami. Czas pracy pochodzi
z zleceń, nie z płatności; dwa przelewy nie podwajają liczby godzin.

## Powtórzenie kontroli SQL bez projektu Supabase

Opcjonalny test korzysta z PGlite zainstalowanego w oddzielnym katalogu,
bez dodawania zależności do aplikacji. Przykład PowerShell na Windows:

```powershell
$sqlTestDir = Join-Path $env:TEMP 'garden-manager-sql-tests'
npm install --prefix $sqlTestDir @electric-sql/pglite --no-audit --no-fund
node supabase/tests/payments.test.mjs $sqlTestDir
```

Skrypt wykonuje obie migracje na nowej bazie w pamięci. Nie łączy się z
Supabase, nie czyta lokalnych danych aplikacji i nie zawiera poświadczeń.

## Wizyta i zatwierdzona cena w wersji 0.3

Lokalny `Timer.paused` utrwala przerwę, która nie nalicza czasu. Wizytę rozpoczyna
wyjście z samochodu u klienta, a kończy zakończenie pracy, sprzątania i całkowite
spakowanie sprzętu. Dojazd i powrót są poza czasem rozliczeniowym. Lista
`Job.activities` jest mapowana na `jobs.activities`; wiele czynności korzysta
z tego samego czasu. Migracja zachowuje dawny tytuł jako pierwszą czynność.

W przyszłym adapterze PAUZA zamyka bieżący przedział `work_sessions`, a WZNÓW
zaczyna kolejny. Sumowane są wyłącznie sekundy pracy, nie odstęp między
przedziałami. Nie należy zaokrąglać czasu do minut. Dotychczasowy indeks nadal
ogranicza liczbę aktywnych przedziałów do jednego na właściciela. Przed
uruchomieniem synchronizacji trzeba dodać atomową koordynację całej wizyty,
w tym rezerwację wizyty zapauzowanej; sam brak aktywnego przedziału w bazie
nie jest dowodem zakończenia wizyty.

Podpisana korekta `time_correction_seconds` pozwala poprawić łączny czas bez
kasowania historycznych przedziałów. `correct_job_time` ustala nowy czas w
pełnych sekundach, blokuje aktywny pomiar i wymaga oczekiwanej rewizji zlecenia.
Nie zmienia kolumn zatwierdzonej ceny. Przyszły adapter powinien dodać dziennik
korekt z przyczyną i poprzednią wartością przed użyciem produkcyjnym.

`Job.settlement` jest mapowany na kolumny migawki w `jobs`:

| Pole lokalne | Kolumna SQL |
| --- | --- |
| `calculatedLaborCents` | `labor_calculated_cents` |
| `suggestedLaborCents` | `labor_suggested_cents` |
| `materialsCents` | `materials_approved_cents` |
| `finalLaborCents` | `labor_approved_cents` |
| `approvedAt` | `settlement_approved_at` (czas w UTC) |
| `source` | `settlement_source` |

Źródło to `legacy`, `rounded`, `manual`, `fixed` lub `exact`. Wyliczona
robocizna zachowuje dokładny czas i stawkę. Propozycja dla rozliczenia
godzinowego to `floor((grosze + 2500) / 5000) * 5000`: najbliższe 50 zł,
a połowa w górę. Dla ryczałtu oraz starszej zachowanej ceny propozycja jest
pusta. Materiały i zarejestrowane płatności nie są zaokrąglane do 50 zł.
Ręcznie ustalana cena dotyczy tylko robocizny. Ostateczna należność to
`labor_approved_cents + materials_approved_cents`.

`approve_job_settlement` działa jako `SECURITY INVOKER`, wybiera tylko wiersz
należący do `auth.uid()`, blokuje zlecenie i wymaga oczekiwanej rewizji. Wymaga
zakończenia pracy oraz zatrzymania aktywnego pomiaru. Przy zapisie zachowuje
jednocześnie wyliczenie, propozycję, materiały i zatwierdzoną cenę; kontrola z migracji 0002
odrzuca cenę poniżej już otrzymanych płatności. Aktualizacja danych roboczych
stawki, czasu lub materiałów nie zmienia migawki. Usunięcie istniejącej migawki
jest blokowane — nowa należność wymaga jawnej korekty. Adapter powinien używać
RPC do wycen zamiast bezwarunkowo zapisywać pola migawki.

Nowe zakończone zlecenie bez zatwierdzonej ceny ma wyliczenie robocze. Nie
powiększa jeszcze potwierdzonej wartości wykonanych prac ani salda do zapłaty;
czas i licznik zakończeń pozostają widoczne. Wpłata zaliczkowa na planowane
zlecenie jest nadal wpływem pieniężnym. Po zakończeniu przed dodaniem nowej
wpłaty trzeba zatwierdzić cenę. Istniejące wpisy można nadal korygować i usuwać.
Przyszłe zapytania finansowe muszą sumować wartość prac i saldo tylko dla
`status = 'completed' and settlement_approved_at is not null`, a wpłaty jako
osobny rejestr rzeczywistych wpływów.

Migracja 0003 najpierw zapisuje **dokładną dotychczasową należność** wszystkich
zakończonych zleceń jako źródło `legacy`. Nie używa nowego zaokrąglania i nie
zmienia żadnej płatności. Dopiero potem `job_value_cents` zaczyna korzystać
z zapisanej migawki. RLS i zasady właściciela z poprzednich migracji pozostają
włączone. Lokalny format 3 zachowuje klucz `garden-manager:v1`, przed migracją
formatu 2 zapisuje jego dokładne źródło w `garden-manager:backup:v2` i nie
nadpisuje istniejących kopii. Bezpośrednia aktualizacja z formatu 1 również
jest obsługiwana z kopią `garden-manager:backup:v1`. Błąd kopii lub migracji
nie może skutkować resetem danych.

Opcjonalny test migracji wizyt i wycen działa bez projektu Supabase:

```powershell
node supabase/tests/visits-and-settlements.test.mjs $sqlTestDir
```

Wykonuje trzy migracje, sprawdza zachowanie starego salda i wpłat,
zaokrąglenia, zatwierdzanie cen, korektę czasu, ryczałt i ochronę właściciela.
Zastępcze role Auth oraz PostgreSQL w PGlite nie są testem integracji
z rzeczywistymi sesjami JWT ani konkurencją serwera Supabase.
