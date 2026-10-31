# Garden Manager 0.3

Polska aplikacja PWA do obsługi jednoosobowej firmy ogrodniczej. React, TypeScript,
Vite i Tailwind CSS. Wersja demonstracyjna działa bez konta, bazy danych i płatnych
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
`garden-manager:v1`, a wewnętrzny format eksportu i zapisu ma obecnie numer 4 (etap 2 wersji 0.3.1).
Błąd kopii lub migracji blokuje zapis zamiast zastępować dane przykładowymi
rekordami. Eksport JSON nadal zawiera pełne dane; import przez interfejs
pozostaje przyszłym etapem.

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

Rozbudowa bazuje na `main` ze scalonym PR #4 (etap 1). Numer pakietu pozostaje
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
Eksport zawiera wszystkie nowe pola. Import przez interfejs nadal nie jest
obsługiwany; aplikacja nie otrzymała logowania ani połączenia z Supabase.


Walidacja etapu 2: 84 testy jednostkowe, 30 testów przeglądarkowych (w tym
21 regresji etapu 1) oraz 1 test produkcyjnej PWA offline. Kontrola TypeScript,
kompilacja produkcyjna i `git diff --check` przechodzą bez błędów.
