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
