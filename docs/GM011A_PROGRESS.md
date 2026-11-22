# GM-011A — stan weryfikacji

Baza: main 607baeabac46c593a1780591181763c303e79353 (scalony PR #27). Gałąź: codex/gm011a-secure-lan; jedyny PR: [#28](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/28). Wersja testowa: **0.6.0-test.1**. Model biznesowy pozostaje **v12**.

Użytkownik zatwierdził publikację w tym publicznym repozytorium. Wszystkie testy korzystają z danych syntetycznych i tożsamości tworzonych podczas przebiegu. Prywatne klucze, zaproszenia oraz rzeczywiste dane firmowe i zaufane urządzenia nie są publikowane.

## Stan po wznowieniu — 22 listopada 2026

Implementacja i poprawki natywne były już zapisane przed wznowieniem, na commicie **9b8143575086ccda2fdb0f7f12e7dd64ee6d0025**. Zweryfikowano zakończone przebiegi, ponowiono jeden niezaliczony kontrolny przebieg Androida i uzupełniono wyniki. Nie dodano kolejnego modułu ani synchronizacji danych biznesowych.

| Kontrola | Rzeczywisty wynik | Przebieg GitHub Actions |
| --- | --- | --- |
| Aplikacja — jednostkowe | **683/683**, 26 plików | [44953965631](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965631) |
| TCP/TLS, protokół, mDNS, magazyn | **21/21**, rzeczywiste gniazda i kryptografia | [44953965631](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965631) |
| Polityki Electron | **6/6** | [44953965631](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965631) |
| Pełne Chromium E2E | **366/366**, bez pomijania testów | [44953965625](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965625) |
| PWA offline | **20/20** | [44953965625](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965625) |
| Android web | **1/1** zbiorczy scenariusz | [44953965625](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965625) |
| Rzeczywisty Electron / Windows | **14/14**, w tym DPAPI, mTLS, restart, ZIP ze zdjęciem, 360/390/430 px | [44953965647](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965647) |
| Zainstalowany NSIS A → B | **2/2** fazy, rzeczywisty main v12 → GM-011A, ten sam profil | [44953965647](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965647) |
| Android JVM | **20/20**, bez błędów i pominięć | [44953965620](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965620) |
| Instrumentacja Androida | **9 udanych wywołań**; aktualizacja A → B, pliki, wydatki, zakupy, LAN, restart procesu | [44953965620](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965620) |
| Aparat i galeria | **5 scenariuszy** natywnych, z syntetycznym zewnętrznym aparatem | [44953965620](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965620) |
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

## Co sprawdzono natywnie

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

## Pakiety do fizycznego odbioru

Kod aplikacji: 9b8143575086ccda2fdb0f7f12e7dd64ee6d0025. Pakiety workflow PR mają w metadanych commit scalający testowy ref GitHub c860d65baf54d7cde377cc40a316f04a901f4a5a. Poniższe sumy dotyczą **samego EXE/APK**, nie archiwum artefaktu.

- [Windows EXE, metadane i SHA256SUMS](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965647/artifacts/14726922610)
  - GardenManager-Windows-0.6.0-test.1-x64-test.exe
  - SHA256: 1116bbaf9b286137cb28b513e7f984a0c75bde9f12700350451a2feadace2b27
  - Windows 10/11 x64, per-user NSIS, testowy instalator bez Authenticode.
- [Android APK, metadane i SHA256SUMS](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/actions/runs/44953965620/artifacts/14726672079)
  - GardenManager-Android-debug.apk
  - SHA256: eaab8e63e8fd44fe31eb9629d70e183bd6b6b97e699addb86c2587fea3e92b1f
  - Certyfikat podpisu SHA256: e555b26b52757aa15797b3c025a0bf407a9ebb08f6ab72b8c49bff70bc6cfd58
  - Podpis ephemeral-debug; **nie jest zgodny z potwierdzonym poprzednim artefaktem GM-010A**. Przed ewentualną reinstalacją konieczny pełny ZIP z danymi i zdjęciami oraz sprawdzenie kopii. Reinstalacja wymaga ponownego parowania LAN.

Artefakty pakietów są przechowywane przez 30 dni. Aktualizacja Android A → B w jednym przebiegu używa zgodnego podpisu obu pakietów; nie dowodzi możliwości aktualizacji wcześniejszego APK na fizycznym telefonie.

## Ograniczenia i odbiór

**Nie wykonano fizycznego połączenia komputera Windows z telefonem Android.** Rzeczywisty Electron i natywny emulator były testowane oddzielnie; nie należy łączyć tych wyników w deklarację fizycznego testu dwóch aplikacji. Domowe Wi-Fi, Ethernet + Wi-Fi, hotspot bez internetu, rzeczywiste mDNS/NsdManager, zapora oraz odczyt QR aparatem wymagają odbioru z [GM011A_LAN.md](GM011A_LAN.md#odbiór-na-fizycznym-windows-1011-i-androidzie).

Prototyp obsługuje prywatny IPv4. Izolacja klientów/routera/VLAN/polityka firmowa może uniemożliwić komunikację, a ręczny IP tego nie omija. Android target pozostaje 36; target 37 wymaga osobnego uwzględnienia runtime ACCESS_LOCAL_NETWORK. Brak transportu lub klucza nie blokuje zwykłej pracy lokalnej.

Testowe profile utworzone przez robocze APK sprzed poprawki DIGEST_NONE mogą wymagać świadomego odtworzenia i nowego parowania po pełnym ZIP-ie. Nie kasujemy ani nie zastępujemy kluczy po cichu.

**Rekomendacja:** kod ma zieloną pełną regresję i może zostać poddany recenzji. Przed uznaniem łączności Windows ↔ Android za odebraną na docelowych urządzeniach należy wykonać fizyczny scenariusz oraz obserwować wspomniany niestabilny test Back. Nie scalać automatycznie.

## Najważniejsze poprawki przed wznowieniem

1. Bezpieczne zużycie jednorazowego zaproszenia, ograniczenia i walidacja, wyścigi stop/połączeń/odwołania zaufania oraz poprawny odbiór końcowych ramek.
2. mDNS na wybranym interfejsie z prawidłowym odbiorem multicastu.
3. Electron/BoringSSL: standardowy SecureContext i allowPartialTrustChain dla jawnych kotwic przypiętych certyfikatów, bez trust-all i bez wyłączenia TLS.
4. Zależności produkcyjne X509 wymagane w zainstalowanym ASAR dodane jawnie i sprawdzane w pakiecie.
5. AndroidKeyStore: DIGEST_NONE dla podpisywanego przez Conscrypt skrótu TLS oraz SHA256 dla podpisu parowania; alias socket/engine i SNI.
6. Bezpieczna diagnostyka asynchronicznych błędów magazynu i ignorowanie nieaktualnych odpowiedzi UI.

Źródła i szczegóły techniczne: [GM011A_LAN.md](GM011A_LAN.md). Kompletne wcześniejsze punkty kontrolne pozostają w historii commitów.
