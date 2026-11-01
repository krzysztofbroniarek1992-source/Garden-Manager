# Garden Manager 0.3.6

Polska aplikacja PWA do obsługi jednoosobowej firmy ogrodniczej. React, TypeScript,
Vite i Tailwind CSS. Wersja demonstracyjna działa bez konta, zewnętrznej bazy danych i płatnych
usług. Przykładowe rekordy są oznaczone jako dane testowe.

## Uruchomienie na Windows

1. Zainstaluj Node.js 22.12 lub nowszy z linii LTS.
2. Otwórz terminal w katalogu `Garden-Manager`.
3. Wykonaj:

   ```powershell
   npm ci
   npm run dev
   ```

4. Wpisz w przeglądarce `http://localhost:5173`.

Zatrzymanie serwera: `Ctrl+C`. Nie trzeba tworzyć pliku `.env`.
Adres `localhost` odnosi się do komputera, na którym uruchomiono serwer.
Proces uruchomiony w środowisku chmurowym nie udostępnia automatycznie aplikacji
pod tym adresem na Twoim komputerze.

## Co działa

- Panel z odrębną wartością wykonanych prac, otrzymanymi płatnościami i saldem do zapłaty.
- Dodawanie, edycja i usuwanie klientów oraz wielu ogrodów jednego klienta.
- Karta klienta z kontaktem, wszystkimi ogrodami, historią prac i filtrami.
- Płatności częściowe, edycja i usuwanie wpisów po potwierdzeniu, niezależne statusy rozliczeń.
- Kwoty płatności i sumy finansowe liczone w całkowitych groszach.
- Zlecenia, kalendarz oraz historia wykonanych prac.
- Jeden stoper wizyty START/PAUZA/WZNÓW/STOP, z czasem zapisanym co do sekundy i odtwarzanym po odświeżeniu.
- Kilka czynności w jednym zleceniu, bez oddzielnych stoperów.
- Ręczna korekta czasu po zatrzymaniu pomiaru.
- Propozycja zaokrąglenia robocizny do najbliższych 50 zł i jawne zatwierdzenie ceny.
- Zatwierdzona należność pozostaje stała; jej korekta jest osobną, świadomą operacją.
- Stawka domyślna 120 zł/h, indywidualna stawka zlecenia lub ryczałt.
- Materiały doliczane oddzielnie od robocizny.
- Układ komputerowy z panelem bocznym i mobilny z dolną nawigacją.

Dane są zapisywane lokalnie w pamięci przeglądarki. Każda przeglądarka i profil
mają osobny zestaw danych. Wyczyszczenie danych witryny usuwa lokalne rekordy.
Tryb demo **nie synchronizuje danych między telefonem a komputerem**.
Stoper wylicza czas na podstawie zapisanych momentów START i WZNÓW. Otwarta
wizyta nalicza czas także po zamknięciu aplikacji. PAUZA utrwala dotychczasowy
czas i nie nalicza przerwy, również po odświeżeniu lub ponownym otwarciu.

## Aktualizacja z wersji 0.1 lub 0.2 na Windows

1. W dotychczasowej aplikacji otwórz **Ustawienia → Eksportuj dane** i zachowaj
   plik JSON jako dodatkową kopię. Zatrzymaj serwer przez `Ctrl+C`.
2. Pobierz z GitHub zatwierdzone zmiany wersji 0.3 do tego samego katalogu
   projektu. Przy pracy przez Git pobierz i przełącz gałąź wskazaną w opisie
   wydania; jeśli została scalona do Twojej bieżącej gałęzi, użyj `git pull`.
   Najpierw zachowaj własne niezapisane zmiany.
3. Uruchom ponownie:

   ```powershell
   npm ci
   npm run dev
   ```

4. Otwórz **ten sam adres** `http://localhost:5173` w tej samej przeglądarce
   i profilu. Nie czyść danych witryny. Zmiana portu, `localhost` na
   `127.0.0.1`, protokołu albo profilu oznacza inny lokalny magazyn danych.

Wersja 0.3 automatycznie migruje zapis 0.2 lub 0.1, pozostawiając klientów,
ogrody, zlecenia, czynności, materiały, płatności, ustawienia i aktywny stoper.
Przed zapisem nowego formatu zachowuje dokładną kopię źródła:
`garden-manager:backup:v2` dla 0.2 lub `garden-manager:backup:v1` dla 0.1.
Kopie nie są nadpisywane przy kolejnych uruchomieniach. Główny klucz pozostaje
`garden-manager:v1`, a wewnętrzny format eksportu i zapisu ma obecnie numer 9 (wersja 0.3.6).
Błąd kopii lub migracji blokuje zapis zamiast zastępować dane przykładowymi
rekordami. Eksport JSON obejmuje dane i metadane zdjęć. Pełne pliki zdjęć
oraz możliwość odtworzenia zapewnia kopia ZIP dostępna od wersji 0.3.3.

Dotychczasowe zakończone zlecenia otrzymują zapis dokładnej należności z
poprzedniej wersji. **Nie są automatycznie przeliczane według nowego
zaokrąglania do 50 zł.** Ich płatności i kwoty pozostające do zapłaty są
zachowane. Nowe zasady stosuje się przy nowym, jawnym zatwierdzeniu rozliczenia.

Starsze zlecenia **nie otrzymują domyślnej zapłaty**. Zakończone zlecenie bez
wpłaty jest nierozliczone. Historyczne, faktycznie otrzymane wpłaty można
uzupełnić w szczegółach zlecenia, podając datę i metodę. Zakończenie pracy
nie tworzy płatności. Usunięcie błędnej płatności nie usuwa zlecenia.

Wartość prac oraz saldo do zapłaty uwzględniają tylko zakończone zlecenia
z zatwierdzoną należnością. Nowa zakończona wizyta bez zatwierdzenia ceny ma
wartość roboczą; jej czas pozostaje w statystykach, ale nie zwiększa jeszcze
potwierdzonej wartości prac ani salda. Migracja zachowuje zatwierdzone
dotychczasowe należności, więc historyczne zestawienia nie znikają.
Otrzymane płatności obejmują wyłącznie zarejestrowane wpisy, także ewentualne
zaliczki na zaplanowane prace. Dlatego przy zaliczkach wskaźnik wpływów nie musi
być różnicą wartości wykonanych prac i salda. Filtry historii w karcie klienta
zmieniają tabelę; główne wskaźniki dotyczą całego klienta.

## Wizyta, czynności i zatwierdzenie ceny

1. Naciśnij **START — Rozpocznij wizytę**, gdy wychodzisz z samochodu u klienta.
   Czas dojazdu i powrotu nie jest częścią rozliczenia.
2. W ramach tego samego zlecenia zapisuj kolejne czynności, np. koszenie,
   przycinanie i sprzątanie. Wszystkie korzystają z jednego czasu wizyty;
   dodanie czynności nie wymaga zatrzymania pomiaru.
3. W czasie przerwy naciśnij **PAUZA**, a po przerwie **WZNÓW**. Naciśnij
   **STOP — Zakończ pomiar** dopiero po zakończeniu pracy, sprzątaniu i
   całkowitym spakowaniu sprzętu do samochodu.
4. Jeśli trzeba, otwórz szczegóły zlecenia i wybierz **Popraw czas pracy**.
   Korekta wymaga zakończenia pomiaru. Wpisujesz godziny, minuty i sekundy;
   czas nie jest zaokrąglany do minut ani kwadransów.
5. Po zakończeniu zlecenia sprawdź obliczoną robociznę, propozycję ceny i
   materiały. Zaakceptuj propozycję albo wpisz własną **cenę robocizny**,
   a następnie jawnie zatwierdź cenę. Materiały są zawsze doliczane osobno.

Robociznę godzinową system proponuje zaokrąglić matematycznie do najbliższych
50 zł, z połową w górę: 270 → 250, 420 → 400, 454 → 450, 475 → 500,
520 → 500, 690 → 700. Ryczałt nie otrzymuje takiej propozycji i zachowuje
ustaloną wartość; jego rzeczywisty czas nadal jest zapisywany.

Przykład: 454 zł wyliczonej robocizny, zaakceptowane 450 zł i 87 zł materiałów
daje **537 zł ostatecznej należności**. Ręcznie ustalona cena dotyczy samej
robocizny, zgodnie z osobnym rozliczaniem materiałów. Robocizna wyliczona,
proponowana i zatwierdzona oraz materiały są zapisane oddzielnie.

Zatwierdzona należność nie zmienia się samoczynnie po zmianie stawki, materiałów
lub korekcie czasu. Do ustalenia nowej ceny służy jawna korekta rozliczenia.
Kwota po korekcie nie może spaść poniżej sumy już otrzymanych wpłat. Samo
zatwierdzenie ceny ani zakończenie pracy nie oznacza, że klient zapłacił.

## Sprawdzenie projektu

```powershell
npm test
npx tsc --noEmit
npm run build
```

Testy przeglądarkowe wymagają dodatkowo Chromium dla Playwright:

```powershell
npx playwright install chromium
npm run test:e2e
npm run test:pwa
```

`test:pwa` buduje wersję produkcyjną i sprawdza jej działanie offline, ikony,
zapis klienta, stref, katalogu materiałów oraz stopera. W środowisku chmurowym testy wykorzystują systemowy
Chromium; opcjonalna zmienna `CHROMIUM_PATH` wskazuje inną instalację przeglądarki.

Kompilacja produkcyjna trafia do katalogu `dist`. Polecenie `npm run preview`
służy do lokalnego sprawdzenia tej kompilacji.

## Instalacja jako PWA

Po zbudowaniu aplikacji udostępnij katalog `dist` przez HTTPS. Na Windows użyj
opcji instalacji aplikacji w Chrome lub Edge, a na Androidzie wybierz w Chrome
„Dodaj do ekranu głównego” / „Zainstaluj aplikację”. Instalacja i tryb offline
wymagają bezpiecznego kontekstu: HTTPS lub lokalnego `localhost`.
Zwykły adres HTTP komputera w sieci Wi-Fi nie zapewnia instalowalnej PWA na
telefonie. Pierwsze otwarcie wymaga połączenia; po zapisaniu zasobów aplikacja
może działać offline. Zmiana protokołu, portu lub domeny tworzy osobny magazyn
danych przeglądarki.

## Supabase i dalsza rozbudowa

Przygotowane migracje: [struktury Supabase](supabase/migrations/202611010001_initial_schema.sql),
[płatności](supabase/migrations/202611010002_payments.sql)
oraz [migracja wizyt i cen](supabase/migrations/202611010003_visits_and_settlements.sql)
zawierają uwierzytelnianie przez Supabase Auth, RLS i rozdzielenie danych według
właściciela. Nie są automatycznie wykonywane przez aplikację. Obecna wersja
nie łączy się z Supabase ani nie obsługuje logowania.

[Opis architektury i następnego etapu synchronizacji](docs/SUPABASE.md) wyjaśnia
mapowanie danych, ochronę dostępu oraz sposób dodawania kolejnych modułów.
W repozytorium nie ma haseł ani tajnych kluczy. `.env.example` pokazuje wyłącznie
przyszłą, publiczną konfigurację klienta.

## Aktualizacja 0.3.1 — etap 1

Karta zlecenia jest wspólna dla listy zleceń, historii, karty klienta i kalendarza.
Przycisk „Edytuj zlecenie” w karcie udostępnia dane wizyty, czynności, materiały
oraz stawkę. Czas, korekta czasu, zatwierdzenie należności i płatności pozostają
w tej samej karcie. Zmiana danych nie przelicza zatwierdzonej należności.

Na karcie klienta można edytować kontakt, dodawać i edytować ogrody oraz tworzyć
zlecenia. Formularz zlecenia pokazuje ogrody wybranego klienta; przy jednym ogrodzie
wybiera go automatycznie. Klient bez ogrodu może dodać go na swojej karcie.
W kalendarzu tytuł zlecenia otwiera wspólną kartę, a przycisk
„+ Nowe zlecenie na ten dzień” ustawia wybraną datę w formularzu.

Etap nie zmienia formatu localStorage ani numeru wydania 0.3.0 w pakiecie.
Adres uruchomienia pozostaje `http://localhost:5173/`.


## Aktualizacja 0.3.1 — etap 2

Rozbudowa bazuje na `main` ze scalonym PR #4 (etap 1). W etapie 2 numer pakietu pozostawał
0.3.0 do zakończenia prac nad wydaniem 0.3.1. Wszystkie funkcje etapu 1 są zachowane.

- **Obiekty i ogrody → Karta ogrodu**: dane ogrodu, dowolna liczba stref,
  powierzchnia w m², długość w m, rośliny, szczególne wymagania i wykonane
  zabiegi. Zapis formularza zatwierdza edycję; usuwanie strefy wymaga osobnego
  potwierdzenia. Karta pokazuje zlecenia i historię prac z dostępem do wspólnej
  karty zlecenia. Jest też dostępna z karty klienta.
- **Materiały**: katalog nazw, kategorii, jednostek, domyślnych cen zakupu,
  opakowań i notatek. Można dodawać, edytować i wyszukiwać materiały oraz wybierać
  je w formularzu zlecenia i w kalkulatorze. Cena w katalogu dotyczy jednej
  jednostki miary, nie całego opakowania.
- **Kalkulatory**: prostokąt, koło (promień), trójkąt (podstawa i wysokość),
  ręczna powierzchnia, objętość warstwy z cm na m³/l, dawka na 1 lub 100 m²,
  bryła żywopłotu i koszt materiału. Przeliczanie g/kg oraz ml/l/m³ zachowuje
  wymiar fizyczny. Przeliczanie masy na objętość wymagałoby gęstości i nie jest
  wykonywane automatycznie. Wynik jest zaokrąglany jedynie do wyświetlania;
  do zlecenia trafia pełna obliczona ilość. Kwoty nadal są rozliczane w groszach.
- Przy środkach ochrony roślin należy przepisać dawkę z **aktualnej etykiety
  konkretnego preparatu**. Pole dawki początkowo jest puste. Aplikacja nie
  proponuje dawek ani mieszanin.

Przepływ: **Karta ogrodu → Oblicz materiały przy strefie → kalkulator → materiał
z katalogu → zlecenie tego ogrodu → Dodaj materiał do zlecenia**. Kalkulator
można również otworzyć ze szczegółów zlecenia. Na telefonie katalog i kalkulatory
znajdują się w menu **Więcej**.

Pozycja zlecenia przechowuje niezależnie cenę zakupu i cenę jednostkową dla
klienta. Początkowo obie są równe cenie katalogowej; marża nie jest dodawana.
Informacja o liczbie pełnych opakowań służy do zaplanowania zakupu; koszt
rozliczany w kalkulatorze dotyczy obliczonego zużycia. Zakup całych opakowań
można wycenić ręcznie w kalkulatorze materiałów. Zmiana katalogu lub usunięcie
strefy nie zmienia wcześniej zapisanych materiałów ani historii zlecenia.

Dodanie materiału do zlecenia z zatwierdzoną ceną **nie zmienia należności**.
Aby uwzględnić materiał w należności, otwórz zlecenie i wybierz **Skoryguj cenę**.
Dokładny czas, dotychczasowa cena robocizny i historia płatności pozostają
zachowane do jawnej korekty; nie dodano żadnego nowego zaokrąglania robocizny.

Format zapisu/eksportu v4 dodaje `gardens[].zones`, `materialCatalog` oraz
opcjonalne pola jednostki, ceny zakupu i pochodzenia materiału w zleceniu.
Starsze pozycje zachowują swoje nazwy, ilości i ceny, bez wymyślania kosztu zakupu.
Migracje v1, v2 i v3 zachowują dane. Przed aktualizacją v3 powstaje dokładna kopia
`garden-manager:backup:v3`; kopie v1/v2 również pozostają zachowane. Klucz główny
`garden-manager:v1` i adres `http://localhost:5173/` nie zmieniają się.
Eksport zawiera wszystkie nowe pola. W etapie 2 import przez interfejs nie był
obsługiwany; aplikacja nie otrzymała logowania ani połączenia z Supabase.


Walidacja etapu 2: 84 testy jednostkowe, 30 testów przeglądarkowych (w tym
21 regresji etapu 1) oraz 1 test produkcyjnej PWA offline. Kontrola TypeScript,
kompilacja produkcyjna i `git diff --check` przechodzą bez błędów.


## Wersja 0.3.2 — kalendarz i zadania cykliczne

Wersja bazuje na `main` po scaleniu PR #5. Zachowuje wszystkie moduły klientów,
ogrodów, materiałów, wizyt i rozliczeń. Adres pozostaje `http://localhost:5173/`.

Kalendarz przełącza się między widokami **Miesiąc**, **Tydzień** i **Dzień**.
Można przejść do dowolnej daty, kliknąć wydarzenie i dodać zadanie albo zlecenie
z wybranego dnia. Statusy to: zaplanowane, w trakcie, wykonane i odwołane
(pominięte wystąpienie zadania). Na telefonie widok tygodnia układa dni pionowo.

**Nowe zadanie na ten dzień** pozwala wybrać klienta, ogród i opcjonalną strefę,
wskazać początek, godzinę, opcjonalny koniec oraz powtarzanie: jednorazowo,
co 1/N dni, tygodni, miesięcy lub lat. Zaznaczenie miesięcy ogranicza realizację
do sezonu. Dla żywopłotu przycinanego w kwietniu i październiku wybierz co
1 miesiąc oraz te dwa miesiące. Dni miesięczne są liczone od pierwotnej daty:
31 stycznia → 28/29 lutego → 31 marca; rocznica 29 lutego wraca w roku przestępnym.
Przerwa zimowa nie przesuwa rytmu, np. co 14 dni.

W szczegółach zadania można:

- **Przesunąć ten termin** — zmienić jedną datę i godzinę.
- **Pominąć ten termin** — po potwierdzeniu oznaczyć go jako odwołany.
- **Edytować całą serię** — zmienić regułę i opis, zachowując przesunięcia,
  pominięcia i istniejące wizyty. Opis niewykonanych, przesuniętych terminów
  aktualizuje się wraz z serią. Skrócenie daty końca odwołuje wyjątki wypadające
  po nowym końcu, bez usuwania ich zapisów.
- **Zakończyć serię** — wskazać ostatni dzień; istniejące zlecenia i wcześniejsze
  terminy pozostają. Zakończone serie nie wznawiają się przy edycji opisu.
- **Rozpocząć pracę** — utworzyć jedną rzeczywistą wizytę i uruchomić istniejący
  stoper. Zadanie bez ogrodu wymaga wybrania ogrodu przed rozpoczęciem.

Przeglądanie kalendarza, utworzenie harmonogramu i samo nadejście daty **nie
naliczają czasu ani należności**. Ponowne rozpoczęcie tego samego wystąpienia
otwiera tę samą wizytę; nie resetuje stopera i nie tworzy drugiego zlecenia.
Inny aktywny stoper blokuje utworzenie nowej wizyty. Jej dalsza obsługa,
rozliczenie, korekty i płatności korzystają z dotychczasowej karty zlecenia.

Listy przypomnień w pulpicie i kalendarzu pokazują zaległe, niewykonane prace
oraz nadchodzące terminy z kolejnych 365 dni. Domyślnie pokazują po 5 pozycji,
po rozwinięciu do 20; kolejne można znaleźć w kalendarzu lub obsłużyć po
wcześniejszych. Wykonane i odwołane terminy nie trafiają do zaległości.
Przypomnienia działają wewnątrz aplikacji; nie wysyłają powiadomień systemowych.

Format v5 dodaje `taskSchedules`, `taskOccurrences` oraz opcjonalne
`jobs[].taskOccurrenceId`. Migracja v4 zachowuje dokładną kopię źródła pod
`garden-manager:backup:v4`; starsze kopie i klucz główny `garden-manager:v1`
pozostają bez zmian. Obsługiwane są również migracje v1/v2/v3. Eksport JSON
obejmuje harmonogramy, wyjątki i powiązania wizyt. W wersji 0.3.2 import przez interfejs
nie był dostępny (pełna kopia ZIP jest obsługiwana od 0.3.3). Nie uruchomiono synchronizacji ani logowania.

[Architektura planowania i przygotowanie do synchronizacji Android](docs/PLANNING.md).

Walidacja 0.3.2: **123/123 testy jednostkowe**, **40/40 przeglądarkowych**
(30 dotychczasowych regresji i 10 scenariuszy nowego kalendarza) oraz
**1/1 test PWA offline** z harmonogramem i przesuniętym terminem.
`npx tsc --noEmit`, kompilacja produkcyjna i `git diff --check` przechodzą.


## Wersja 0.3.3 — dokumentacja fotograficzna

Wersja bazuje na `main` po scaleniu PR #6 (`8ace236`). Zdjęcia są dostępne
w **Galerii klienta**, **Galerii i historii ogrodu**, przez przycisk **Zdjęcia
strefy** oraz w **Galerii zlecenia i wizyty**. Jeden wybór może obejmować do
20 plików. Aparat telefonu udostępnia przeglądarka; można również wybrać zdjęcia
z urządzenia.

Kategorie: **PRZED PRACĄ**, **W TRAKCIE**, **PO PRACY**, **PROBLEM / CHOROBA
ROŚLINY** i **INNE**. Każde zdjęcie ma opis, datę dodania i opcjonalną, ręcznie
wpisaną datę wykonania. Kategorię, opis i powiązania z klientem, ogrodem, strefą
lub zleceniem można zmieniać. Filtry obejmują kategorię, zakres dat i strefę;
chronologię można odwrócić. Kliknięcie miniatury powiększa zdjęcie. Wybierz jedno
zdjęcie PRZED i jedno PO, aby porównać je obok siebie, także na telefonie.

Zabiegi są obecnie tekstem w notatkach strefy, bez własnych identyfikatorów.
Dokumentację zabiegu przypisz do strefy lub zlecenia i opisz na zdjęciu.
Usunięcie strefy albo zlecenia zachowuje zdjęcia w galerii ogrodu wraz z opisem
wcześniejszego powiązania. Usunięcie ogrodu pozostawia je przy kliencie.
Usunięcie klienta obejmuje jego zdjęcia i wymaga potwierdzenia.

### Pliki i pamięć urządzenia

**Pełne zdjęcia nie są zapisywane jako base64 w localStorage.** Baza IndexedDB
`garden-manager-photos` przechowuje pliki JPEG jako `Blob` oraz ich miniatury.
Dotychczasowy klucz `garden-manager:v1` przechowuje wyłącznie dane aplikacji,
metadane zdjęć i identyfikatory plików. Format v6 migruje v1–v5, zachowując
wcześniejsze dane, należności, materiały i harmonogramy. Przed aktualizacją v5
powstaje dokładna kopia `garden-manager:backup:v5`.

Obsługiwane są JPEG, PNG i WebP do 25 MB oraz 50 megapikseli. Zdjęcia są
przygotowywane jako JPEG o dłuższym boku do 1920 px, a miniatury do 320 px.
Mniejsze zdjęcia nie są powiększane. Kopia ZIP przechowuje te przygotowane wersje,
bez oryginałów w pełnej rozdzielczości. HEIC, GIF i SVG nie są obsługiwane;
zdjęcie HEIC należy wcześniej wyeksportować jako JPEG. Automatyczny odczyt daty
EXIF nie jest wdrożony; data wykonania pozostaje opcjonalna.

Błąd zapisu plików nie dodaje niekompletnych metadanych. Błąd localStorage
wycofuje nowe pliki. Usuwanie zdjęcia wymaga potwierdzenia i obejmuje miniaturę;
przerwane usuwanie jest dokańczane po ponowieniu dostępu lub uruchomieniu.
Gdy IndexedDB jest zablokowane, istniejące moduły aplikacji nadal działają.
Pliki potrzebne zachowanemu punktowi odzyskiwania pozostają do czasu usunięcia
tego punktu. Dane są lokalne — wykonuj pełne kopie poza przeglądarką przed
czyszczeniem pamięci witryny.

### Pełna kopia i odtwarzanie

W **Ustawieniach** dostępne są dwie różne operacje:

- **Eksportuj dane**: JSON wszystkich danych i metadanych zdjęć. Nie zawiera
  plików zdjęć i nie jest ich pełną kopią.
- **Pobierz pełną kopię ZIP**: dane, zdjęcia i miniatury z sumami kontrolnymi.
  Brakujący lub uszkodzony plik blokuje utworzenie kopii zamiast pomijać zdjęcie.

**Wczytaj pełną kopię ZIP** najpierw sprawdza format, limity, powiązania, wymiary
zdjęć i sumy SHA-256. Pokazuje liczby klientów, ogrodów, zleceń, płatności,
harmonogramów oraz zdjęć. Nie zmienia danych do czasu zaznaczenia potwierdzenia
i wpisania **ODTWÓRZ**. Odtwarzanie zastępuje cały zestaw, bez scalania rekordów.
Zmiana bieżących danych po podglądzie wymaga ponownego wczytania kopii.

Przed zastąpieniem aplikacja zachowuje lokalny **punkt odzyskiwania** poprzednich
danych i plików. Można pobrać go jako ZIP albo przywrócić poprzedni zestaw.
Kolejny import wymaga wcześniejszego uporządkowania tego punktu. Jego usunięcie
ma osobne potwierdzenie. Przed odtwarzaniem zakończ bieżący pomiar przyciskiem
STOP. Wizyta uruchomiona w kopii zostanie zapauzowana według czasu wykonania
kopii, aby nie doliczać czasu od jej utworzenia do odtworzenia.

Limit pełnej kopii to 200 MB, rozpakowanych danych 250 MB, a liczba zdjęć do
5000. Zwykły import samego JSON nie jest dodany w tym etapie. Logowanie,
synchronizacja chmurowa i integracja aparatu przez Capacitor pozostają przyszłymi
etapami. Architektura korzysta z przenośnych identyfikatorów i interfejsów
repozytorium plików oraz przygotowania zdjęć.

[Szczegóły przechowywania, odzyskiwania i adaptera Android](docs/PHOTOS.md).

Walidacja 0.3.3: **160/160 testów jednostkowych**, **53/53 przeglądarkowych**
(w tym 40 wcześniejszych regresji) i **2/2 testy produkcyjnej PWA offline**.
Kontrola TypeScript, build produkcyjny i `git diff --check` przechodzą.

## Wersja 0.3.4 — notatki i przypomnienia

Na pulpicie dostępne są szybkie przyciski **Dodaj notatkę**, **Dodaj przypomnienie**
i **Dodaj sprawę**. Widok **Notatki** zbiera zapiski ogólne oraz zapiski klientów,
ogrodów, stref i zleceń/wizyt. Można je wyszukiwać, filtrować, edytować,
archiwizować, przywracać i usuwać z potwierdzeniem. Notatka ma opcjonalną
kategorię, priorytet i odniesienie do istniejącego zdjęcia z galerii.
Przyciski tworzenia są także na odpowiednich kartach i przy zdjęciach.

Przypomnienie należy do notatki i ma datę oraz opcjonalną godzinę. Dostępne są
wykonanie, anulowanie, ponowne aktywowanie i odroczenie. Archiwizacja notatki
wstrzymuje widoczność przypomnienia na pulpicie i w kalendarzu; przywrócenie
pokazuje ten sam wpis. Historia wykonanych i anulowanych terminów pozostaje
w kalendarzu oraz filtrach notatek. Odroczenie przenosi ten sam termin.

Osobny widok **Do zrobienia** obsługuje samodzielne sprawy, także bez klienta
lub daty. Zakładki: wszystkie, na dziś, nadchodzące, zaległe, wykonane,
bez terminu i anulowane. Sprawę można szybko wykonać lub przywrócić.
Notatki i sprawy mają filtry klienta, priorytetu, statusu i terminu;
notatki również kategorii. Na telefonie oba widoki są w menu **Więcej**.

Kalendarz miesiąca, tygodnia i dnia rozróżnia **pracę ogrodniczą**, **zlecenie**,
**przypomnienie** i **sprawę**. Wybrany dzień umożliwia utworzenie przypomnienia
lub sprawy. Pulpit pokazuje do pięciu najwcześniejszych aktywnych wpisów każdego
rodzaju, w tym zaległości. Pełne listy dostępne są w nowych widokach.
Termin bez godziny dotyczy całego lokalnego dnia; z godziną staje się zaległy
po jej upływie. **Notatki, przypomnienia i sprawy nie tworzą zleceń, nie uruchamiają
stopera i nie naliczają należności.**

Format v7 automatycznie migruje v1–v6, a oryginalny zapis v6 zachowuje w
`garden-manager:backup:v6`. Klucz `garden-manager:v1`, adres `localhost:5173`
i magazyn zdjęć IndexedDB pozostają te same. JSON oraz pełny ZIP obejmują nowe
kolekcje, powiązania i znaczniki usunięć. Import ZIP zachowuje walidację,
podgląd, potwierdzenie i punkt odzyskiwania. Obsługiwane są także ZIP-y oraz
punkty odzyskiwania z 0.3.3. **JSON nadal nie zawiera plików zdjęć.**

[Szczegóły modelu, migracji i ograniczeń](docs/NOTES.md).

Walidacja 0.3.4: **206 testów jednostkowych**, **66 scenariuszy przeglądarkowych**
(w tym wszystkie 53 wcześniejsze regresje) oraz **3 testy produkcyjnej PWA offline**.
Kontrola TypeScript, build produkcyjny i `git diff --check` przechodzą.

## Wersja 0.3.5 — checklisty i szablony prac

Widok **Szablony prac** zawiera własne standardy usług i cztery edytowalne
przykłady: koszenie trawnika, cięcie żywopłotu, pielęgnację drzew i krzewów oraz
zabieg ochrony roślin. Możesz tworzyć, edytować, kopiować, archiwizować,
przywracać i usuwać szablony z potwierdzeniem. Wyszukiwanie obejmuje nazwę,
opis i czynności; filtry dotyczą kategorii usługi oraz archiwum. Kolejność
czynności zmieniają przyciski strzałek, dostępne również na telefonie.

Zastosowanie szablonu tworzy **niezależną checklistę**. Można przypisać kilka
różnych list do jednej wizyty lub utworzyć listę od zera. Zmiana, archiwizacja
lub usunięcie szablonu nie zmieniają istniejących list i ich postępu. Ponowne
zastosowanie tego samego szablonu do tej samej wizyty otwiera istniejącą listę.

W karcie wizyty przycisk **Checklisty wizyty** prowadzi do list kontrolnych.
Każda czynność ma wygodne odhaczanie, status **Nie dotyczy**, datę wykonania,
uwagę oraz opcjonalny odnośnik do istniejącego zdjęcia. Edycja, status i kolejność
zapisują się automatycznie. Błąd zapisu pozostawia szkic pola do ponowienia.
Postęp to wykonane / wszystkie czynności z wyłączeniem „Nie dotyczy”, wyliczany
bez zapisywania zaokrąglonego procentu. Pusta lista i lista zawierająca wyłącznie
„Nie dotyczy” pokazują **—**, zamiast pozornego 100%.

Karty ogrodu i strefy pozwalają tworzyć **plany czynności**. Plan nie tworzy
zlecenia ani należności. W karcie wizyty można skopiować plan tego ogrodu,
zachowując uwagi i odnośniki do zdjęć, z nowym postępem wykonania. Plany i listy
wizyt są wyraźnie oznaczone. Zakładka **Checklisty i plany** w bibliotece zachowuje
dostęp również do historii po usunięciu powiązanego zlecenia lub ogrodu.

Harmonogram kalendarza może wskazywać szablon. Przy **Rozpocznij pracę** można
zastosować go do rzeczywistej wizyty lub odznaczyć tę opcję. Przyszłe terminy nie
generują kopii list. Ponowne otwarcie wizyty niczego nie tworzy i nie restartuje
stopera. W samej karcie wizyty można także zastosować szablon harmonogramu.

Niepełna checklista daje czytelne ostrzeżenie, ale **nie blokuje zakończenia
wizyty**. Odhaczanie, edycja lub usuwanie list nie zmienia stopera, cen,
materiałów ani płatności. Przykłady ochrony roślin przypominają o aktualnej
etykiecie; nie podają dawek ani mieszanin.

Format v8 migruje v1–v7 i zachowuje dokładną kopię źródła v7 w
`garden-manager:backup:v7`. Klucz `garden-manager:v1` i `localhost:5173` pozostają
bez zmian. JSON i pełny ZIP obejmują szablony, checklisty, postęp, uwagi,
identyfikatory zdjęć i znaczniki usunięcia. Import odczytuje ZIP-y v6, v7 i v8
oraz wcześniejsze punkty odzyskiwania. Zdjęcia pozostają w dotychczasowym
IndexedDB; checklisty ich nie kopiują. JSON nadal nie zawiera plików fotografii.

[Szczegóły modelu, automatycznego zapisu i migracji](docs/CHECKLISTS.md).

Walidacja 0.3.5: **256/256 testów jednostkowych**, **81/81 przeglądarkowych**
(w tym wszystkie 66 wcześniejszych regresji) oraz **4/4 testy produkcyjnej PWA offline**.
Sprawdzono również TypeScript, build produkcyjny bez ostrzeżenia o wielkości
pakietu, `git diff --check` i układ przy szerokości 1440 oraz 390 px.

## Wersja 0.3.6 — karta wizyty i raport PDF

Istniejąca karta zlecenia/wizyty ma nawigację do zakresu i czasu, materiałów,
rozliczenia, checklist, notatek i zdjęć oraz przycisk **Podsumowanie wizyty**.
Podsumowanie zbiera dane dotychczasowych modułów, pokazuje zaplanowany zakres,
wykonane czynności, materiały i ilości, postęp checklist, dokumentację PRZED /
W TRAKCIE / PO oraz saldo i wpłaty. Z jego poziomu wrócisz do istniejących
formularzy edycji, korekty czasu, galerii i rozliczenia. Niepełna checklista daje
ostrzeżenie i pozwala zakończyć wizytę.

Nowe pola **Opis wykonanych prac dla klienta** i **Uwagi i zalecenia dla klienta**
są oddzielone od notatek wewnętrznych. Można wskazać strefę wizyty. Przed raportem
zapisz zmieniony opis. Samo otwieranie podsumowania, podglądu lub PDF nie zmienia
stopera ani należności. Od 0.3.6 karta zapisuje historię startu, pauzy, wznowienia,
zatrzymania, zakończenia i ręcznych korekt czasu. Starszy czas pracy pozostaje
zachowany; nie odtwarzamy nieznanych wcześniejszych przerw.

Po zakończeniu wizyty **Generuj raport PDF** otwiera ustawienia. Wybierzesz czas,
materiały, checklisty, zdjęcia PRZED/PO, zalecenia i finanse. **Finanse i zalecenia
są domyślnie wyłączone.** Finanse wymagają istniejącej zatwierdzonej należności;
raport bez finansów można przygotować także przed jej zatwierdzeniem.
Notatki wewnętrzne, uwagi czynności checklist, opisy/oryginalne nazwy zdjęć, dane
kontaktowe klienta i koszty zakupu nie są treścią raportu.

**Przygotuj podgląd raportu** tworzy PDF w pamięci, bez zapisu historii. Podgląd
na telefonie pokazuje tę samą publiczną treść; można również otworzyć plik PDF.
**Zapisz raport i pobierz PDF** zapisuje metadane oraz migawkę treści i pobiera
plik na urządzenie. Nagłówek: **BRONIAREK OGRODY**. Opcjonalne logo wybierzesz
z galerii lub dodasz do niej jako INNE. Nie są wysyłane żadne wiadomości ani dane.

Raporty mają UUID, numer `BO/rok/000001`, wersję i datę utworzenia. Zmieniona
publiczna treść lub opcje tworzą kolejną wersję tego samego numeru. Ponowne
pobranie korzysta z zapisanej migawki i nie dubluje historii ani nie pobiera
aktualnych cen. Numery przy zapisie są chronione blokadą między kartami i kontrolą
aktualności podglądu. PDF generujemy na żądanie; **pełnych plików PDF nie zapisujemy
w localStorage ani IndexedDB**. Zdjęcia pozostają w dotychczasowym IndexedDB.

Limit: 6 zdjęć PRZED/PO, łącznie z logo do 12 MB obrazów, 60 stron i 20 MB PDF.
Brakujące lub uszkodzone zdjęcie blokuje generację z czytelnym komunikatem.
Usuwanie fotografii użytej w raporcie ostrzega o skutkach dla ponownej generacji.
Lokalne czcionki zapewniają polskie znaki; także generator i czcionki są objęte
cache PWA, aby raport dało się przygotować bez internetu.

Format danych **v9** migruje v1–v8, zachowując dokładną kopię v8 w
`garden-manager:backup:v8`. Klucz `garden-manager:v1` i `localhost:5173` pozostają
bez zmian. JSON oraz pełne ZIP-y obejmują podsumowania, historię czasu, migawki
raportów i licznik numerów. Import obsługuje ZIP-y v6–v9 i wcześniejsze punkty
odzyskiwania, ze wszystkimi dotychczasowymi potwierdzeniami.

[Sposób generowania, przechowywania, prywatność i ograniczenia](docs/REPORTS.md).

Walidacja 0.3.6: **309/309 testów jednostkowych**, **96/96 przeglądarkowych**
(w tym wszystkie 81 wcześniejszych regresji) oraz **5/5 testów produkcyjnej PWA offline**.
Przeszły TypeScript, build produkcyjny i `git diff --check`. Sprawdzono również
wygląd pobranego PDF oraz widok 390 px bez przewijania poziomego. Build zgłasza
ostrzeżenie o wielkości odroczonego pakietu fontkit (717 kB); generator jest
ładowany na żądanie i dostępny w cache offline.

## Poprawki kart klientów i ogrodów po 0.3.6

Z karty klienta otworzysz pełną kartę każdego ogrodu przez nazwę lub **Otwórz
ogród**. Osobny przycisk nadal otwiera edycję. Karta ogrodu zajmuje cały ekran
z siedmioma sekcjami, korzystając z istniejących modułów. Zachowano wejście
z listy **Obiekty i ogrody** oraz przejścia klient → ogród → zlecenie i zlecenie
→ ogród → klient, z zachowaniem kontekstu powrotu.

Z ogrodu można dodać zlecenie istniejącym formularzem z uzupełnionym klientem
i ogrodem, edytować je, sprawdzić wizytę i rozliczenie oraz bezpiecznie usunąć
niechroniony wpis. Zlecenia z płatnościami, zatwierdzonym rozliczeniem,
raportami lub terminem kalendarza pozostają chronione. Dokumentacja odłączona
od usuniętego zlecenia pozostaje przy ogrodzie w dotychczasowych modułach.

Historia klienta i ogrodu jest grupowana latami i zwijanymi miesiącami.
Bieżący miesiąc jest domyślnie rozwinięty; widok pokazuje po 50 zleceń i pozwala
doładować kolejne. Filtry, dokładny czas i podsumowania korzystają z istniejących
zasad rozliczeń. Format pozostaje **v9**; migracja nie jest potrzebna.

[Nawigacja, historia, zasady usuwania i ograniczenia](docs/CLIENT_GARDEN_NAVIGATION.md).

Walidacja poprawek: **330/330 testów jednostkowych**, **112/112 przeglądarkowych**
(w tym 16 nowych scenariuszy) i **6/6 produkcyjnej PWA offline**. TypeScript,
build produkcyjny i `git diff --check` przeszły. Sprawdzono ekrany 360, 390 i
430 px. Pozostaje wcześniejsze ostrzeżenie o wielkości odroczonego pakietu fontkit.


## Wspólna historia i adresowanie kart — etap 1

Istniejące karty klienta, ogrodu i zlecenia korzystają ze wspólnego kontrolera
nawigacji. Wstecz/Dalej i przyciski powrotu obsługują ten sam stos, a URL
odtwarza kartę i sekcję po odświeżeniu lub ponownym otwarciu. Dawne adresy
`?client=…#clients` pozostają obsługiwane. Główne zakładki otwierają listy
zbiorcze. Formularze z niezapisanymi zmianami wymagają potwierdzenia opuszczenia.

Stan widoków pozostaje poza danymi firmy: bez zmian formatu v9, localStorage,
IndexedDB, JSON/ZIP, stopera i rozliczeń.

[Adresy, zachowanie historii, ochrona formularzy i ograniczenia](docs/NAVIGATION_HISTORY.md).

Walidacja etapu: **341/341 jednostkowych**, **7/7 PWA offline**, TypeScript
i build poprawne. E2E: 126/127 w pełnym przebiegu, następnie 6/6 testów płatności
po doprecyzowaniu selektora; zweryfikowano wszystkie 127 scenariuszy.
