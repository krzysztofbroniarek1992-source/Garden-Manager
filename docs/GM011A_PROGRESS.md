# GM-011A — stan weryfikacji

Baza: main 607baeabac46c593a1780591181763c303e79353 (scalony PR #27). Gałąź: codex/gm011a-secure-lan; jedyny PR: [#28](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/28). Wersja testowa: **0.6.0-test.1**. Model biznesowy pozostaje **v12**.

Użytkownik zatwierdził publikację w tym publicznym repozytorium. Testy automatyczne korzystają z danych syntetycznych i tożsamości tworzonych podczas przebiegu. Fizyczne testy użytkownika również przesyłają wyłącznie zestawy syntetyczne, a tożsamości jego instalacji pozostają lokalnie. Prywatne klucze, zaproszenia oraz rzeczywiste dane firmowe i zaufane urządzenia nie są publikowane.

## Testy automatyczne CI

Pełna regresja head **7a9b63ef11947076e9b3599c428e387794e85bfe** jest zielona; kod aplikacji pozostaje zgodny z 9b8143575086ccda2fdb0f7f12e7dd64ee6d0025, a późniejsze zmiany dotyczą dokumentacji. Sprawdzono istniejące wyniki, nie uruchamiano ręcznie kolejnej regresji bez zmiany kodu. Zwykłe workflow PR mogą automatycznie ponowić kontrole po commicie dokumentacji; ich bieżący stan jest widoczny w PR. Poniższe wyniki CI są odrębne od zgłoszenia fizycznego użytkownika.

| Kontrola | Rzeczywisty wynik | Przebieg GitHub Actions |
| --- | --- | --- |
| Aplikacja — jednostkowe | **683/683**, 26 plików | [44973731737](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731737) |
| TCP/TLS, protokół, mDNS, magazyn | **21/21**, rzeczywiste gniazda i kryptografia | [44973731737](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731737) |
| Polityki Electron | **6/6** | [44973731737](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731737) |
| Pełne Chromium E2E | **366/366**, bez pomijania testów | [44973731747](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731747) |
| PWA offline | **20/20** | [44973731747](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731747) |
| Android web | **1/1** zbiorczy scenariusz | [44973731747](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731747) |
| Rzeczywisty Electron / Windows | **14/14**, w tym DPAPI, mTLS, restart, ZIP ze zdjęciem, 360/390/430 px | [44973731687](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731687) |
| Zainstalowany NSIS A → B | **2/2** fazy, rzeczywisty main v12 → GM-011A, ten sam profil | [44973731687](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731687) |
| Android JVM | **20/20**, bez błędów i pominięć | [44973731757](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731757) |
| Instrumentacja Androida | **9 udanych wywołań**; aktualizacja A → B, pliki, wydatki, zakupy, LAN, restart procesu | [44973731757](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731757) |
| Aparat i galeria | **5 scenariuszy** natywnych, z syntetycznym zewnętrznym aparatem | [44973731757](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731757) |
| Osobny kontrolny Android LAN | **2/2**: LanTest i LanRestartTest po am force-stop, ponowienie nr 2 | [44953961314](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953961314) |
| TypeScript, build produkcyjny, Windows i Android, git diff --check | **Zaliczone** | powyższe przebiegi |

W workflow Shopping regression zadanie shopping-ui jest pomijane warunkiem zdarzenia push; nie jest to pominięcie testów w pełnym przebiegu E2E. Wszystkie 366 testów Chromium wykonano.

### Wcześniejszy niezaliczony punkt kontrolny

Pierwsza próba osobnego przebiegu Android LAN na tym samym kodzie nie pokazała oczekiwanego potwierdzenia niezapisanej nazwy po Wstecz. Pełny przebieg Androida zaliczył tę asercję, a ponowienie osobnego przebiegu również ją zaliczyło, **bez zmiany kodu i bez usunięcia asercji**. Nie potwierdzono przyczyny tej niestabilności. Zachowano oba wyniki; nie przedstawiamy pierwszej próby jako zaliczonej. Wymaga obserwacji przy kolejnych przebiegach i odbiorze fizycznym.

## Zakres zaimplementowany

- Ręcznie uruchamiany serwer TLS w głównym procesie Electron; natywny klient Android JSSE/Capacitor.
- Wspólny ekran Synchronizacja, nazwa instalacji, sesja, wykrywanie, zaufane urządzenia, ręczny prywatny IPv4/port, testy i diagnostyka. Web/PWA wyjaśnia brak transportu natywnego.
- Losowy stały UUID i P-256, niezależne od adresu IP; Windows DPAPI i AndroidKeyStore. Magazyn oddzielony od IndexedDB, klientów i kopii JSON/ZIP.
- Pierwsze parowanie przez zaproszenie QR lub lokalne przekazanie zaproszenia, przypięty certyfikat, krótki jednorazowy token i oba potwierdzenia tożsamości.
- Ponowne połączenie przez wzajemny TLS, dokładne przypięcia certyfikatów, usuwanie zaufania i zamknięcie połączenia.
- mDNS/DNS-SD oraz ręczne połączenie awaryjne. Rozgłoszenie zawiera wyłącznie UUID, protokół, adres i port.
- Protokół v1 niezależny od v12: ścisłe ramki i walidacja, identyfikatory, kolejność, limity rozmiaru/czasu/prób, ochrona przed powtórzeniami.
- Dwukierunkowe testy syntetycznego JSON i danych binarnych 1 KB, 100 KB, 1 MB, 10 MB, z SHA256 i pomiarem czasu.
- Zamknięcie sesji i unieważnienie zaproszenia po stop, wyjściu, zamknięciu/reload/crash; Android także po przejściu w tło. Brak automatycznego nasłuchiwania.

Bez wymiany danych biznesowych, zdjęć, zastępowania baz, dziennika zmian, rozwiązywania konfliktów, chmury, kont lub GM-011B/C. Nie zmieniono rozliczeń, stopera, zakupów, wydatków, backupów, identyfikatorów aplikacji, originów i lokalizacji profili.

## Co sprawdzono natywnie w CI

Windows: rzeczywisty Electron na windows-2022, sandbox/izolacja, ograniczony IPC, natywne potwierdzenie, DPAPI i bezpieczny błąd uszkodzenia magazynu, TLS 1.2/1.3 z początkowym i nowym zaufaniem. Aktualizacja rzeczywiście zainstalowanego A → B zachowuje dane, zdjęcia, wydatki, zakupy i działający stoper; zainstalowany B potrafi uruchomić LAN i wygenerować QR. Sprawdzono kompletność ASAR oraz uruchomienie bez deweloperskiego Node.js/serwera.

Android: emulator API 35, rzeczywisty spakowany WebView, nieeksportowalne klucze AndroidKeyStore i JSSE. Partnerem jest produkcyjna implementacja serwera w Node na runnerze. Zaliczone parowanie dwóch tożsamości komputerów, oba kierunki inicjowania testu, wszystkie rozmiary/formaty, błędny certyfikat, ponowne połączenie, odwołanie zaufania i odmowa, Back z niezapisaną nazwą. Oddzielna instrumentacja po am force-stop sprawdza zachowanie UUID/odcisku/nazwy/zaufania, wyłączoną sesję i ten sam skrót danych firmowych. Dostęp aplikacji do internetu jest blokowany w teście.

Testy transportu dodatkowo pokrywają replay, niezgodny protokół, uszkodzone/przerośnięte ramki, przerwany transfer, zmianę rzeczywistego adresu loopback, ograniczenia prób, wyścig start/stop i połączenie nadchodzące podczas asynchronicznego usuwania zaufania. Wyniki nie są dowodem fizycznego połączenia Windows ↔ Android.

### Przykładowe rzeczywiste pomiary kontrolne

Node/TLS, runner CI, każdy test przesyła zestaw w obu kierunkach. Czasy nie są prognozą szybkości Wi-Fi ani hotspotu. SHA256 wysłanych i odebranych danych zgadza się we wszystkich wierszach.

| Bajty w każdym kierunku | Format | Inicjuje klient — ms | Inicjuje serwer — ms |
| --- | --- | --- | --- |
| 1024 | JSON | 155 | 124 |
| 1024 | binary | 125 | 125 |
| 102400 | JSON | 44 | 43 |
| 102400 | binary | 45 | 43 |
| 1048576 | JSON | 55 | 52 |
| 1048576 | binary | 60 | 54 |
| 10485760 | JSON | 164 | 144 |
| 10485760 | binary | 168 | 169 |

Emulator osobno wykonał wszystkie osiem kombinacji rozmiaru/formatu z telefonu i test inicjowany przez serwer. Szczegółowe wyniki i czasy są w Android-test-reports (android-lan-test.txt, android-lan-metrics.jsonl); nie publikujemy zaproszeń ani prywatnych kluczy.

## Aktualne pakiety testowe

Pakiety 0.6.0-test.1 pochodzą z zielonych przebiegów dla head 7a9b63ef11947076e9b3599c428e387794e85bfe. Metadane Windows wskazują testowy merge-ref 9fef930b793c02fcaf4f2d48708e6578b40c3038; metadane APK zawierają wersję v12 i informacje podpisu. Aktualizacja dokumentacji nie zmienia binariów ani kodu i **nie wymaga reinstalacji tych pakietów**. Poniższe sumy dotyczą **samego EXE/APK**, nie archiwum artefaktu. Te linki pozostają zestawem do odbioru; ewentualny nowy APK wygenerowany automatycznie przez CI może mieć kolejny inny podpis.

- [Windows EXE, metadane i SHA256SUMS](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731687/artifacts/14735210107)
  - GardenManager-Windows-0.6.0-test.1-x64-test.exe
  - SHA256: 977da1dee5d19fbf7973af2d0427325aeeaab7915e9bf9f91404eeb7fc075bce
  - Windows 10/11 x64, per-user NSIS, testowy instalator bez Authenticode.
- [Android APK, metadane i SHA256SUMS](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44973731757/artifacts/14734877583)
  - GardenManager-Android-debug.apk
  - SHA256: f98e9c73e3a98fef6cdca1ebb5db0bc467b4fe27c177a781ad9bc24510e0ecf9
  - Certyfikat podpisu SHA256: b152a0ece8722e20a85b67eef5fb63e6567d2cd054d07d3a02d63129b46b752c
  - Podpis ephemeral-debug; **nie jest zgodny z potwierdzonym poprzednim artefaktem GM-010A**. Przed ewentualną reinstalacją konieczny pełny ZIP z danymi i zdjęciami oraz sprawdzenie kopii. Reinstalacja wymaga ponownego parowania LAN.

Artefakty pakietów są przechowywane przez 30 dni. Aktualizacja Android A → B w jednym przebiegu używa zgodnego podpisu obu pakietów; nie dowodzi możliwości aktualizacji wcześniejszego APK na fizycznym telefonie.

## Odbiór fizyczny — Windows ↔ Android — 22.11.2026

**Źródło: wyniki rzeczywistych testów wykonanych i zgłoszonych przez użytkownika 22 listopada 2026 r.** Nie są to wyniki CI, emulatora ani testów wykonanych przez agenta. Testowano komunikację aplikacji Windows i Android na danych syntetycznych; nie synchronizowano danych firmowych.

| Test | Sieć | Dane w każdym kierunku | Format | Czas | Wynik |
| --- | --- | --- | --- | --- | --- |
| 1 | Domowe Wi-Fi | 1024 B | JSON | 364 ms | OK |
| 2 | Domowe Wi-Fi | 102400 B | JSON | 421 ms | OK |
| 3 | Domowe Wi-Fi | 1048576 B | JSON | 4664 ms | OK |
| 4 | Domowe Wi-Fi | 1048576 B | Binary | 1219 ms | OK |
| 5 | Domowe Wi-Fi | 10485760 B | Binary | 8857 ms | OK |
| 6 | Domowe Wi-Fi, po restarcie aplikacji | 1024 B | Binary | 426 ms | OK |
| 7 | Hotspot telefonu | 10485760 B | Binary | 4126 ms | OK |

**Wynik: 7/7 transmisji zakończonych powodzeniem.** W każdej próbie aplikacja wyświetliła „Test komunikacji zakończony — sumy SHA256 zgodne”, a sumy danych wysłanych i odebranych były identyczne. Dla obu binarnych transferów 10 MB użytkownik zgłosił ten sam SHA256 syntetycznego zestawu:
8c20c34cc89036501ecebf47131f542290ba98dfecf8256bd7dff5c24e27ef34.

Potwierdzone zachowania:
- Pierwsze parowanie Windows z Androidem, nawiązanie połączenia i poprawne testy dwukierunkowe.
- Zakończenie sesji, zamknięcie obu aplikacji i ich ponowne uruchomienie; ponowne połączenie bez nowego parowania, z udanym testem binarnym 1 KB.
- Android wykrywał komputer. Brak telefonu na liście „Wykryte urządzenia” w Windows jest zgodny z architekturą serwer Windows / klient Android i nie jest zgłoszonym błędem.
- Połączenie komputera z hotspotem telefonu, wybór nowego interfejsu LAN na Windows i ponowne rozpoczęcie sesji. Zaufanie pozostało ważne bez ponownego parowania; test binarny 10 MB zakończył się poprawnie.
- Użytkownik nie wykrył błędów podczas wykonanych prób.

Nie podano adresów IP, zaproszeń, kluczy, identyfikatorów instalacji, list zaufania ani danych firmowych. Zgłoszenie nie wyszczególnia metody odczytu pierwszego zaproszenia; nie dopisujemy osobnego wyniku fizycznego testu aparatu QR.

### Scenariusze fizyczne jeszcze niewykonane lub niepotwierdzone

- Drugi komputer Windows i kolejne sesje komputer domowy → telefon → komputer w pracy.
- Komputer podłączony przez Ethernet z telefonem w Wi-Fi.
- Pełne fizyczne scenariusze negatywne: izolacja sieci, odrzucenie parowania, przerwanie transferu i odwołanie zaufania.
- Praca transportu bez dostępu do internetu: **nie została jednoznacznie potwierdzona fizycznie**. Sam udany hotspot tego nie dowodzi. Wyników automatycznych offline nie przenosimy na tę kategorię.
- Pełna pozostała macierz rozmiarów/formatów i niezależny fizyczny test ochrony niezapisanej nazwy przez Android Back nie zostały zgłoszone jako wykonane.

Brak dostępu użytkownika do drugiego komputera nie jest dowodem błędu implementacji ani blokadą recenzji tego fundamentu. Dwie tożsamości komputerów i kolejne połączenia pokrywa CI; fizyczny odbiór tego wariantu pozostaje jawnym warunkiem późniejszego testu końcowego. W GM-011A chodzi o kolejne sesje i utrzymanie zaufania do dwóch komputerów, nie o przenoszenie rzeczywistych rekordów przez telefon.

## Końcowy przegląd kodu — 22.11.2026

Przejrzano aktualny kod aplikacji z head 7a9b63ef11947076e9b3599c428e387794e85bfe oraz różnicę względem main. Aktualizacja odbioru zmienia tylko dokumentację; nie zmienia kodu transportu ani danych użytkownika.

| Obszar | Sprawdzone zabezpieczenie / granica |
| --- | --- |
| TLS i mTLS | TLS 1.2/1.3, szyfry AEAD, standardowa walidacja, przypięty certyfikat i dokładny odcisk DER. Android weryfikuje także HTTPS/SNI stałej tożsamości. Serwer transportowy wymaga certyfikatu klienta i świeżego zaufania; resumption/tickets nie omijają odwołania. allowPartialTrustChain dotyczy jawnie przypiętych kotwic i nie wyłącza walidacji. |
| Pierwsze parowanie | Osobny TLS z przypiętym serwerem, jednorazowy token 256-bit / 120 s, podpis ECDSA SHA256 telefonu, kod porównawczy i potwierdzenia obu stron. Natywne okna ponownie sprawdzają aktualnego kandydata. To etap parowania, nie anonimowy dostęp do kanału danych. |
| Trwałość i odwołanie zaufania | Windows kolejkuje zapis zaszyfrowanego magazynu; Android zatwierdza zaszyfrowany zapis przed zmianą stanu pamięci. Ponowne połączenie sprawdza aktualne przypięcie. Usunięcie zaufania zamyka powiązane połączenie; zabezpieczono też wyścig z zapisem odwołania. |
| DPAPI i AndroidKeyStore | Windows używa safeStorage/DPAPI bez jawnego fallbacku, z zapisem tymczasowym/fsync/rename. Android używa nieeksportowalnych kluczy P-256 i AES-GCM, z uwierzytelnionymi metadanymi. Uszkodzenie magazynu nie resetuje bazy firmowej ani tożsamości po cichu. |
| Sesja i serwer | Świadomy start na wybranym prywatnym IPv4, 15 min sesji; stop/wyjście/reload/crash zamykają gniazda, mDNS i zaproszenie. Android zatrzymuje sesję także przy pause/destroy. Znaczniki generacji blokują zatwierdzanie starych operacji po zamknięciu. |
| Android i sieć | Target 36; INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE i CHANGE_WIFI_MULTICAST_STATE. Natywne JSSE/NsdManager, brak cleartext HTTP i allowMixedContent=false. Target 37/runtime LAN pozostaje osobnym wymaganiem przyszłej aktualizacji platformy. |
| Electron IPC | Kontrola głównej ramki i originu, zamknięta lista poleceń oraz walidacja pól. sandbox/contextIsolation/webSecurity włączone, nodeIntegration wyłączone, CSP bez poszerzenia. Renderer nie dostaje prywatnego klucza ani dowolnego API sieciowego/plikowego przez LAN. |
| Kopie i klucze | Magazyny LAN są poza biznesowym IndexedDB. Eksport JSON oraz ZIP obejmuje model Data i pliki zdjęć, nie cały profil aplikacji. Import nie przenosi UUID, kluczy ani zaufania; Android allowBackup=false. |
| Protokół i przerwanie transferu | Ramki do 8192 B nagłówka / 10 MiB ciała, ścisłe typy i stany, ID/sesja/kolejność, SHA256 i porównanie znanego zestawu, limity czasu i prób. Błąd zamyka kanał, kończy oczekiwanie i nie zapisuje niepełnych danych jako rekordów firmowych. |
| Offline i model v12 | Transport nie importuje magazynu biznesowego ani nie wykonuje operacji rozliczeń, stopera lub importu bazy. Zwykła praca lokalna nie zależy od sesji LAN; modele, originy, profile oraz formaty JSON/ZIP pozostają bez zmian. Offline jest pokryte CI, ale nie zgłoszono jeszcze jednoznacznego fizycznego testu bez internetu. |
| Prywatność | Rozgłoszenia mDNS zawierają lokalizację/UUID/protokół, bez danych klientów i zaproszeń. Włączono brak logowania argumentów Capacitor; błędy transportu są ograniczone do bezpiecznej diagnostyki. W dokumentacji odbioru opublikowano tylko syntetyczne wyniki, nie dane rzeczywistych instalacji. |

**Wynik przeglądu: nie stwierdzono błędów blokujących w zakresie GM-011A. Nie ma przyczyny do zmiany kodu lub modelu v12.** Pozostaje jawna wcześniejsza niestabilność testu Android Back: pierwsza próba nie pokazała potwierdzenia niezapisanej nazwy, kolejne przebiegi zaliczyły asercję bez jej usuwania; przyczyna nie została potwierdzona i wymaga dalszego monitorowania.

Po zielonych wymaganych kontrolach aktualizacji dokumentacyjnej PR może być Ready for review. Rekomendacja: GM-011A jest gotowy do scalenia po recenzji, przy zachowaniu jawnej listy późniejszych testów fizycznych. Nie scalać automatycznie. Po scaleniu można rozpocząć osobno zatwierdzony GM-011B; ten PR nie implementuje wymiany rzeczywistych danych ani GM-011C.

## Pozostałe ograniczenia platformowe

Prototyp obsługuje prywatny IPv4. Izolacja klientów/routera/VLAN/polityka firmowa może uniemożliwić komunikację, a ręczny IP tego nie omija. Brak transportu lub klucza nie blokuje zwykłej pracy lokalnej. Niewykonane testy fizyczne pozostają wyszczególnione powyżej; pełna lista końcowa jest w [GM011A_LAN.md](GM011A_LAN.md#odbiór-na-fizycznym-windows-1011-i-androidzie).

Testowe profile utworzone przez robocze APK sprzed poprawki DIGEST_NONE mogą wymagać świadomego odtworzenia i nowego parowania po pełnym ZIP-ie. Nie kasujemy ani nie zastępujemy kluczy po cichu.

## Najważniejsze poprawki przed wznowieniem

1. Bezpieczne zużycie jednorazowego zaproszenia, ograniczenia i walidacja, wyścigi stop/połączeń/odwołania zaufania oraz poprawny odbiór końcowych ramek.
2. mDNS na wybranym interfejsie z prawidłowym odbiorem multicastu.
3. Electron/BoringSSL: standardowy SecureContext i allowPartialTrustChain dla jawnych kotwic przypiętych certyfikatów, bez trust-all i bez wyłączenia TLS.
4. Zależności produkcyjne X509 wymagane w zainstalowanym ASAR dodane jawnie i sprawdzane w pakiecie.
5. AndroidKeyStore: DIGEST_NONE dla podpisywanego przez Conscrypt skrótu TLS oraz SHA256 dla podpisu parowania; alias socket/engine i SNI.
6. Bezpieczna diagnostyka asynchronicznych błędów magazynu i ignorowanie nieaktualnych odpowiedzi UI.

Źródła i szczegóły techniczne: [GM011A_LAN.md](GM011A_LAN.md). Kompletne wcześniejsze punkty kontrolne pozostają w historii commitów.
