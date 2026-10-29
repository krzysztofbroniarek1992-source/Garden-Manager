# Garden Manager 0.1

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

- Panel z podsumowaniem zleceń, czasu pracy i wartości wykonanych usług.
- Dodawanie, edycja i usuwanie klientów oraz wielu ogrodów jednego klienta.
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
zawiera uwierzytelnianie przez Supabase Auth, RLS i rozdzielenie danych według
właściciela. Nie jest automatycznie wykonywana przez aplikację. Obecna wersja
nie łączy się z Supabase ani nie obsługuje logowania.

[Opis architektury i następnego etapu synchronizacji](docs/SUPABASE.md) wyjaśnia
mapowanie danych, ochronę dostępu oraz sposób dodawania kolejnych modułów.
W repozytorium nie ma haseł ani tajnych kluczy. `.env.example` pokazuje wyłącznie
przyszłą, publiczną konfigurację klienta.
