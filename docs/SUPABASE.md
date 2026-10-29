# Supabase: przygotowana struktura i plan synchronizacji

## Stan wersji 0.2

Aplikacja używa lokalnego repozytorium danych. Nie ma połączenia z Supabase,
logowania ani synchronizacji pomiędzy urządzeniami. Migracja SQL jest podstawą
następnego etapu; jej przygotowanie nie oznacza wykonania na działającej bazie.
Testy lokalne aplikacji nie weryfikują polityk RLS na serwerze Supabase.

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
   `supabase/migrations/202611010002_payments.sql`. Druga migracja jest
   przyrostowa: nie zmienia ani nie usuwa istniejących klientów, ogrodów lub
   zleceń. Migracje nie są przeznaczone do ponownego wykonania na tabelach,
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
| `jobs` | Termin, status, typ rozliczenia, stawka i ryczałt |
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
