# Supabase: przygotowana struktura i plan synchronizacji

## Stan wersji 0.1

Aplikacja używa lokalnego repozytorium danych. Nie ma połączenia z Supabase,
logowania ani synchronizacji pomiędzy urządzeniami. Migracja SQL jest podstawą
następnego etapu; jej przygotowanie nie oznacza wykonania na działającej bazie.
Testy lokalne aplikacji nie weryfikują polityk RLS na serwerze Supabase.

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
   zastosuj migrację przez Supabase CLI. Migracja nie jest przeznaczona do
   ponownego wykonania na tabelach, które już istnieją.
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
| `jobs` | Termin, status, typ rozliczenia, stawka i ryczałt |
| `materials` | Materiały konkretnego zlecenia: ilość × cena jednostkowa |
| `work_sessions` | Przedziały pracy START/STOP |
| `settings` | Domyślna stawka godzinowa właściciela |

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
do groszy następuje przy podsumowaniu. Zmiana domyślnej stawki nie powinna
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
