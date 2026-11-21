# GM-010A — Lista zakupów firmowych

Wspólny moduł React/TypeScript dla Windows (boczne menu), Androida (Więcej → Lista zakupów) oraz PWA. Pracuje offline. Lista dotyczy wyłącznie BRONIAREK OGRODY; nie jest magazynem ani księgą podatkową.

## Codzienna obsługa

- **Szybko dodaj produkt** zapisuje jedną nazwę jako 1 szt., Do kupienia, normalny priorytet, bez ceny. **Dodaj wiele produktów** przyjmuje do 100 nazw, po jednej w wierszu; cały pakiet zapisuje się w jednej transakcji.
- **Edytuj zakup** obejmuje nazwę, ilość (do trzech miejsc po przecinku), jednostkę, kategorię, priorytet, status, planowaną i faktyczną cenę, sprzedawcę, link HTTP/HTTPS, notatkę i opcjonalne istniejące zlecenie. Link można skopiować do przeglądarki urządzenia.
- Każda cena ma własny wybór: **jednostkowa** albo **łączna całej pozycji**. Kwoty są przechowywane w całkowitych groszach; ilość w tysięcznych jednostki. Iloczyn jest obliczany całkowitoliczbowo, a ułamkowy grosz zaokrąglany raz, do najbliższego grosza (połowa w górę).
- **Oznacz jako zamówione** pozostawia produkt na bieżącej liście. **Odebrano — kupione** zapisuje status i datę zakupu, nie koszt.
- **Archiwizuj zakup** przenosi kupioną pozycję do Archiwum kupionych. Można ją przywrócić. **Ponów zakup** tworzy nową pozycję Do kupienia, bez faktycznej ceny, daty i powiązania z wydatkiem; historia oryginału pozostaje.
- Usunięcie wymaga potwierdzenia i zachowuje znacznik usunięcia. Nie usuwa powiązanego wydatku.
- Filtry: status, kategoria i priorytet; wyszukiwanie po nazwie; sortowanie według priorytetu (pilny, okazja cenowa, normalny), daty utworzenia malejąco lub nazwy A–Z.
- Podsumowanie planowanych wydatków obejmuje wyłącznie niekupione, niearchiwalne pozycje z ceną, również Zamówione. Jest niezależne od filtrów i pokazuje liczbę pozycji bez ceny.
- Otwieranie rzeczywistego zlecenia używa wspólnej nawigacji i zachowuje kontekst listy. Usunięte zlecenie ma historyczną nazwę; nie powstaje sztuczne powiązanie.

## Zakup a wydatek

Status Kupione nie tworzy kosztu. **Dodaj do wydatków firmowych** otwiera dotychczasowy formularz wydatku. Sprawdź faktyczną łączną kwotę, datę i kategorię; dopiero **Zapisz wydatek** tworzy zatwierdzony koszt i powiązanie w tej samej transakcji. Planowana cena nie zastępuje faktycznej kwoty.

Jeśli wydatek już istnieje (także po imporcie CSV), wybierz **Powiąż istniejący wydatek**, wyszukaj operację i potwierdź. Nie powstaje kolejny koszt. Jeden paragon może obejmować kilka pozycji. Wpis wyłączony z kosztów pozostaje oznaczony jako wyłączony — powiązanie nie zatwierdza go.

Ponowne kliknięcie oraz dwa równoczesne zapisy tej samej pozycji nie mogą utworzyć drugiego wydatku. Edycja zakupów nie zmienia wydatku; powiązany wydatek otwiera się we wspólnym formularzu. Płatności klientów, rozliczenia zleceń, materiały i stoper są niezależne.

## Dane v11 → v12 i konflikty

- Kanonicznym źródłem pozostaje istniejąca baza IndexedDB `garden-manager-state`, magazyn `state`, rekord `current`. Nie zmieniono nazwy bazy, wersji struktury IndexedDB, pochodzenia aplikacji ani profilu.
- Migracja v11 dodaje tylko `shoppingItems: []`. Przed zapisem zachowuje dokładny rekord źródłowy pod `format-v11-source` w tej samej transakcji. Błąd walidacji lub brak miejsca wycofuje całą transakcję.
- localStorage `garden-manager:v1` pozostaje kopią zgodności. Starsza kopia nie nadpisuje nowszego IndexedDB. Import starego lokalnego zapisu zachowuje oryginalne bajty pod `garden-manager:backup:v11`.
- Pozycja ma UUID, rewizję, createdAt/updatedAt oraz deletedAt. Zapis oczekuje konkretnej rewizji. Konflikt nie nadpisuje nowej wersji; formularz zachowuje szkic i pokazuje błąd. Otwórz aktualną wersję i świadomie przenieś zmiany.
- Zapis listy, pakietu, powiązania lub kosztu jest atomowy i ponownie odczytuje bieżące dane wewnątrz transakcji. Dotychczasowy mechanizm importu blokuje zapis na nieaktualnym zestawie danych.
- Nie wdrożono synchronizacji między urządzeniami. Znaczniki rewizji przygotowują dane do osobnego przyszłego etapu.

## Kopie

Eksport JSON obejmuje pozycje, rewizje, powiązania i znaczniki usunięcia. Zdjęcia w nim są wyłącznie metadanymi. **Pełna kopia ZIP** obejmuje dane v12 i istniejące pliki zdjęć; pozostaje zalecanym sposobem przenoszenia urządzeń.

Import starszych ZIP i JSON migruje dane przez istniejącą walidację. Import JSON jest dostępny w Ustawieniach i nie zapisuje nic przed podglądem, zaznaczeniem zgody i wpisaniem ODTWÓRZ. Wykorzystuje ten sam punkt odzyskiwania co ZIP. JSON można odtworzyć tylko gdy wszystkie wymagane pliki zdjęć już istnieją na urządzeniu i ich skróty się zgadzają. JSON z aktywnym stoperem nie ma daty wykonania kopii potrzebnej do bezpiecznego odtworzenia pomiaru — użyj ZIP. JSON nie jest pełną kopią zdjęć.

Odtworzenie zastępuje zestaw danych, nie scala dwóch baz. Najpierw wykonaj pełny ZIP bieżących danych. Import wymaga zatrzymania lub bezpiecznego zakończenia bieżącego pomiaru zgodnie z istniejącym mechanizmem.

## Aplikacje testowe i aktualizacja

Windows: wersja 0.5.1-test.1 x64, instalator NSIS dla bieżącego użytkownika. Zamknij program i uruchom nowy instalator. Stały profil `%APPDATA%\\GardenManager`, origin `app://garden-manager/`, bez serwera i Node.js. Wersja testowa może nie mieć podpisu Authenticode; SmartScreen może ostrzegać. Nie usuwać profilu podczas aktualizacji.

Android: wersja 0.5.1-test.1, versionCode 5, ten sam applicationId i origin `https://localhost`. Zachowanie danych przez instalację aktualizacji wymaga zgodnego certyfikatu podpisu. Test A → B używa wspólnego klucza CI, co nie dowodzi zgodności z APK wcześniej zainstalowanym na fizycznym telefonie. Sprawdź APK-METADATA.json. Przy innym podpisie **wykonaj pełny ZIP przed odinstalowaniem**, dopiero potem reinstaluj i odtwórz ZIP. Odinstalowanie bez kopii usuwa dane.

Dane Windows, przeglądarki i Androida nie przenoszą się automatycznie. ZIP zastępuje dane zamiast je scalać; synchronizacja nie jest częścią GM-010A.

## Lista odbioru na fizycznych urządzeniach

1. Na dotychczasowej wersji wykonaj pełny ZIP. Zapisz liczby klientów, zleceń, wydatków i zdjęć; zanotuj stan aktywnego stopera.
2. Windows 10/11 x64: aktualizacja instalatorem, skrót Start, uruchomienie bez sieci i Node.js; sprawdź dane i kontynuację pomiaru. Android: najpierw porównaj certyfikat; aktualizacja bez odinstalowania tylko przy zgodnym podpisie.
3. Dodaj pojedynczy produkt i trzy nazwy naraz. Ustaw 2,5 jednostki × 12,34 zł = 30,85 zł; sprawdź cenę łączną, filtry, klawiaturę/touch i widok archiwum.
4. Zamówione pozostaje widoczne. Kupione nie zwiększa kosztów. Anuluj formularz kosztu; następnie świadomie zapisz kwotę, datę i kategorię. Powtórz kliknięcie — koszt ma pozostać jeden.
5. Powiąż inny zakup z istniejącym wydatkiem CSV. Ponów zakup, przywróć z archiwum i usuń z potwierdzeniem; powiązany wydatek pozostaje.
6. Wpisz szkic. Android Wstecz / Windows zamknięcie / Wstecz w aplikacji: anulowanie potwierdzenia zachowuje tekst. Powtórz podczas trwającego zapisu.
7. Zamknij i ponownie uruchom offline; porównaj zakupy, zdjęcia, rozliczenia, raporty PDF, CSV i stoper.
8. Eksportuj pełny ZIP ze zdjęciem, zmień dane, odtwórz po potwierdzeniu; sprawdź zdjęcie i powiązany wydatek. Odtwórz punkt odzyskiwania. Nie wykonuj prób niszczących na jedynej kopii danych.

Automatyczne wyniki, artefakty i SHA256 są podane w opisie PR #27. Testy Windows używają Windows Server 2022 i rzeczywistego Electron/NSIS; Android — emulatora API 35 i rzeczywistego Capacitor/WebView. Nie zastępują odbioru na fizycznym Windows 10/11 i telefonie.
