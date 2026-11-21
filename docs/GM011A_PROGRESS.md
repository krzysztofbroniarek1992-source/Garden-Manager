# GM-011A — bieżący stan

Baza: main 607baeabac46c593a1780591181763c303e79353, scalony PR #27, model biznesowy v12.

Użytkownik zatwierdził publikację kodu i PR w tym publicznym repozytorium. Klucze i dane rzeczywistych urządzeń nigdy nie są częścią kodu, testów ani artefaktów. Testy używają wyłącznie tożsamości tworzonych podczas przebiegu i danych syntetycznych.

## Granice

Tylko warstwa komunikacji LAN. Bez synchronizacji rekordów, zdjęć, scalania baz, dziennika biznesowego ani zmian w danych v12, kopiach, rozliczeniach i stoperze. Pełna zwykła praca offline pozostaje niezależna od innych urządzeń.

## Projekt transportu

- Tymczasowy serwer TLS w głównym procesie Electron, wybrany prywatny interfejs IPv4. Android inicjuje połączenie natywnie.
- Stały UUID i certyfikat P-256 instalacji; Windows chroni magazyn DPAPI, Android używa AndroidKeyStore. Magazyn oddzielony od danych firmowych i eksportów.
- Zaproszenie o krótkiej ważności z przypiętym publicznym certyfikatem serwera, jednorazowym losowym uprawnieniem i potwierdzeniem tożsamości na obu ekranach. Osobny kanał parowania nie udostępnia testów ani danych. Ponowne połączenie wymaga wzajemnego TLS i zapisanych przypięć.
- Standardowe mDNS i ręczny adres IP/port. Rozgłaszany tylko identyfikator, wersja protokołu i port.
- Wersjonowane, ograniczone ramki i ścisła walidacja, numery sesji/kolejności/wiadomości. Testy JSON/binarne 1 KB, 100 KB, 1 MB i 10 MB z SHA256; brak wejścia przyjmującego dane biznesowe.
- Zakończenie sesji, wyjście z modułu, zamknięcie/reload/crash aplikacji i wygaśnięcie zamykają transport. Brak automatycznego uruchamiania.

## Kolejne punkty kontrolne

1. Implementacja i rzeczywiste testy TLS/protokołu, ograniczeń, parowania i odwołania zaufania.
2. Chronione magazyny, ograniczony IPC i mostek Capacitor.
3. Wspólny ekran Synchronizacja, wykrywanie i diagnostyka.
4. Testy emulatora do tej samej implementacji serwera, rzeczywisty Electron i aktualizacje pakietów.
5. Pełna regresja, EXE/APK 0.6.0-test.1, metadane i SHA256, instrukcja fizycznego odbioru.

Na tym punkcie nie zadeklarowano żadnych zaliczonych testów nowej funkcji. Dokument będzie aktualizowany w kolejnych commitach.

## Źródła zasad platform

- https://nodejs.org/docs/latest-v24.x/api/tls.html
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://developer.android.com/privacy-and-security/local-network-permission
- https://developer.android.com/reference/android/net/nsd/NsdManager

Target Android pozostaje 36. Zgodnie z dokumentacją platformy nie dodajemy ACCESS_LOCAL_NETWORK przed podniesieniem target do 37. Odmowa dostępu do LAN ma być obsłużona diagnostycznie; nie obchodzimy zabezpieczeń systemu.

## Checkpoint transportu i aplikacji

- Gałąź codex/gm011a-secure-lan; roboczy PR #28.
- Rzeczywiste testy Node/TLS: 9/9, w tym wzajemny TLS, parowanie, ataki na ramki, zmiana adresu, dwa serwery i testy 1 KB–10 MB w obu kierunkach. Nie są to fizyczne testy Windows/Android.
- TypeScript, dotychczasowe jednostkowe i kompilacja Android JVM/APK na punktach kontrolnych zaliczone.
- Dodano natywne magazyny, ścisły IPC, mostek Capacitor i wspólny ekran. Format danych firmowych pozostaje v12.
- Trwa integracja testu rzeczywistego klienta AndroidKeyStore/JSSE z tą samą implementacją serwera na runnerze. Nie zadeklarowano jeszcze wyniku tej integracji ani fizycznego odbioru.
- Pozostałe zadania: rozszerzone testy transportu, rzeczywisty Electron/DPAPI i NSIS z v12, testy emulatora, pełne E2E/PWA/regresja aparatu, końcowa dokumentacja, artefakty i SHA256.

## Weryfikacja po uruchomieniu natywnym

- Head fd80bb1: rzeczywiste testy transportu 19/19, aplikacja 683/683, polityki Electron 6/6, TypeScript i JVM zaliczone.
- Poprawiono odbiór multicastu mDNS: wildcard UDP z członkostwem i wysyłaniem na wybranym interfejsie; rzeczywisty test sieciowy przechodzi.
- Usunięto możliwość ponownego użycia przyjętego zaproszenia, wyścig równoległych zaproszeń i wyścigi zamykania starych połączeń Androida. Magazyn chroniony pozostaje poza modelem danych.
- Rzeczywisty Electron: 12 dotychczasowych testów zaliczonych. Nowe parowanie zapisuje zaufanie, ale ponowne połączenie mTLS nie kończy się poprawnie; trwa odrębna macierz TLS 1.2/1.3 i początkowe/dodane zaufanie. Bez wyłączania walidacji certyfikatów.
- Emulator: aktualizacja rzeczywistego A (main v12) → B, odczyt po restarcie, wydatki, zakupy i dotychczasowy aparat zaliczone. Nowy test LAN zatrzymał się przy pierwszym parowaniu; dodano bezpieczną diagnostykę publicznego błędu i osobny szybki przebieg natywny.
- Nie uznajemy tych dwóch nowych testów za zaliczone. PR #28 pozostaje draft. Pakiety z niezaliczonego przebiegu nie są odbiorem GM-011A.
- Pełna instrukcja architektury, protokołu, parowania, sieci i odbioru fizycznego: GM011A_LAN.md.

## Potwierdzone poprawki integracyjne

- Macierz rzeczywistego Electron: TLS 1.2 i TLS 1.3, początkowe i dodane zaufanie, wszystkie 4 warianty zaliczone; obcy certyfikat odrzucany. Wymagane jawne kotwice przypiętych certyfikatów oraz standardowy SecureContext przez SNI. Szczegóły w GM011A_LAN.md.
- Rzeczywisty test Electron/DPAPI z transferem, ZIP ze zdjęciem, restartem i widokami 360/390/430 px zaliczony.
- Test zainstalowanego EXE znalazł pomijanie peerDependencies biblioteki X509. asn1-schema i asn1js są teraz jawnymi zależnościami produkcyjnymi, a kontrola ASAR sprawdza ich obecność.
- Android przeszedł pierwsze parowanie i oba potwierdzenia. Test mTLS został zatrzymany na uwierzytelnianiu klienta; weryfikujemy obsługę wyboru aliasu dla SSLEngine/Conscrypt. Dodano standardowy chooseEngineClientAlias i jawny SNI, bez wyłączania walidacji TLS.
- Dodano test połączenia podczas zapisu odwołania zaufania oraz kontrolę świeżego zaufania przy zatwierdzaniu połączenia Androida.
- Ostateczna pełna regresja i odbiór pakietów nadal wymagają zielonego przebiegu. Nie wykonano fizycznego testu dwóch urządzeń.

## Wymaganie platformy Android potwierdzone w źródłach

Conscrypt używa NONEwithECDSA do podpisania skrótu obliczonego przez TLS. Klucz był uprawniony tylko do SHA256withECDSA dla parowania, co nie wystarczało dla stosu TLS. Dodano DIGEST_NONE zgodnie z dokumentacją Android KeyGenParameterSpec. Test czyta rzeczywiste uprawnienia KeyInfo, a osobne wywołanie instrumentacji po am force-stop sprawdza tożsamość, zaufanie, brak automatycznej sesji i skrót danych biznesowych. Wynik uruchomienia tej poprawki pozostaje do potwierdzenia w CI.
