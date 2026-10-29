# Garden Manager 0.2

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
- Stoper START/STOP przypisany do zlecenia, zachowujący stan po odświeżeniu.
- Stawka domyślna 120 zł/h, indywidualna stawka zlecenia lub ryczałt.
- Materiały doliczane oddzielnie od robocizny.
- Układ komputerowy z panelem bocznym i mobilny z dolną nawigacją.

Dane są zapisywane lokalnie w pamięci przeglądarki. Każda przeglądarka i profil
mają osobny zestaw danych. Wyczyszczenie danych witryny usuwa lokalne rekordy.
Tryb demo **nie synchronizuje danych między telefonem a komputerem**.
Stoper wylicza czas na podstawie zapisanego momentu START, więc uwzględnia czas
zamknięcia aplikacji do chwili naciśnięcia STOP.

## Aktualizacja z wersji 0.1 na Windows

1. W dotychczasowej aplikacji otwórz **Ustawienia → Eksportuj dane** i zachowaj
   plik JSON jako dodatkową kopię. Zatrzymaj serwer przez `Ctrl+C`.
2. Pobierz z GitHub zatwierdzone zmiany wersji 0.2 do tego samego katalogu
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

Wersja 0.2 automatycznie migruje zapis 0.1, pozostawiając wszystkich klientów,
ogrody, zlecenia, stawki, materiały i aktywny stoper. Najpierw zachowuje dokładną
kopię starszego zapisu pod kluczem `garden-manager:backup:v1`, a nowy format
wersji 2 zapisuje pod dotychczasowym kluczem `garden-manager:v1`. Kopia nie jest
nadpisywana przy kolejnych uruchomieniach. Błąd kopii lub migracji blokuje zapis,
zamiast zastępować dane przykładowymi rekordami. Eksport z wersji 0.2 zawiera
format 2 i rejestr płatności; import przez interfejs pozostaje przyszłym etapem.

Starsze zlecenia **nie otrzymują domyślnej zapłaty**. Zakończone zlecenie bez
wpłaty jest nierozliczone. Historyczne, faktycznie otrzymane wpłaty można
uzupełnić w szczegółach zlecenia, podając datę i metodę. Zakończenie pracy
nie tworzy płatności. Usunięcie błędnej płatności nie usuwa zlecenia.

Wartość prac oraz saldo do zapłaty uwzględniają tylko zakończone zlecenia.
Otrzymane płatności obejmują wyłącznie zarejestrowane wpisy, także ewentualne
zaliczki na zaplanowane prace. Dlatego przy zaliczkach wskaźnik wpływów nie musi
być różnicą wartości wykonanych prac i salda. Filtry historii w karcie klienta
zmieniają tabelę; główne wskaźniki dotyczą całego klienta.

## Sprawdzenie projektu

```powershell
npm test
npm run build
```

Testy przeglądarkowe wymagają dodatkowo Chromium dla Playwright:

```powershell
npx playwright install chromium
npm run test:e2e
npm run test:pwa
```

`test:pwa` buduje wersję produkcyjną i sprawdza jej działanie offline, ikony,
zapis klienta oraz stopera. W środowisku chmurowym testy wykorzystują systemowy
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

Przygotowana migracja [struktury Supabase](supabase/migrations/202611010001_initial_schema.sql)
oraz [migracja płatności](supabase/migrations/202611010002_payments.sql)
zawierają uwierzytelnianie przez Supabase Auth, RLS i rozdzielenie danych według
właściciela. Nie są automatycznie wykonywane przez aplikację. Obecna wersja
nie łączy się z Supabase ani nie obsługuje logowania.

[Opis architektury i następnego etapu synchronizacji](docs/SUPABASE.md) wyjaśnia
mapowanie danych, ochronę dostępu oraz sposób dodawania kolejnych modułów.
W repozytorium nie ma haseł ani tajnych kluczy. `.env.example` pokazuje wyłącznie
przyszłą, publiczną konfigurację klienta.
