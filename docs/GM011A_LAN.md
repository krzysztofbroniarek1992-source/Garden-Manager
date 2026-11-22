# GM-011A — bezpieczna komunikacja LAN

Wersja testowa 0.6.0-test.1. Dane biznesowe pozostają w formacie v12. Moduł **Synchronizacja** sprawdza wyłącznie transport danych syntetycznych. Nie wymienia klientów, zleceń, finansów, zdjęć ani zmian bazy. Zwykła praca Garden Managera pozostaje lokalna i nie wymaga drugiego urządzenia ani internetu.

## Architektura

Windows uruchamia tymczasowy serwer w głównym procesie Electron. Użytkownik wybiera jeden aktualny prywatny interfejs IPv4. Android jest klientem natywnym Capacitor/JSSE; telefon nie utrzymuje serwera w tle. Jedno uwierzytelnione połączenie pozwala obu stronom inicjować testy. Komputer domowy i komputer w pracy mają odrębne tożsamości, które telefon może zachować w swojej liście zaufania.

Warstwy:
- desktop/lan-wire.cts i Android LanWire: ramki, limity, kolejność i walidacja;
- desktop/lan-identity.cts, lan-vault.cts i Android LanIdentity: tożsamość, certyfikaty i zaufanie;
- desktop/lan-server.cts, lan-channel.cts i Android LanTls/LanEngine/LanChannel: sesja, standardowy TLS, parowanie i testy;
- desktop/lan-ipc.cts oraz GardenLanPlugin: wąskie, sprawdzane polecenia natywne;
- src/lan: jeden interfejs React dla obu aplikacji.

Nie ma połączenia transportu z portem IndexedDB, systemem plików danych firmowych, aparatem dokumentacji ani API wykonującym dowolne komendy. Nie ma dowolnego adresu URL, payloadu lub kodu przekazywanego z renderera do sieci. Przyszłe GM-011B i GM-011C wymagają osobnych implementacji i przeglądu protokołu; nie są częścią tego etapu.

Sesja trwa maksymalnie 15 minut. Wyjście z modułu, zamknięcie lub przeładowanie okna i awaria renderera zamykają nasłuch. Android kończy sesję również po przejściu aplikacji w tło. Po ponownym uruchomieniu nic nie zaczyna nasłuchiwać automatycznie.

## Tożsamość i magazyn

Instalacja otrzymuje losowy UUIDv4 niezależny od IP i własny klucz ECDSA P-256. Certyfikat jest lokalny, samopodpisany, ważny 10 lat, powiązany ze stałą nazwą gm-UUID.local. Zmiana nazwy urządzenia nie zmienia klucza ani UUID.

Windows przechowuje zaszyfrowany magazyn w userData/lan/identity.dpapi. Ochrona korzysta z Electron safeStorage i Windows DPAPI, bez zapisu jawnego klucza jako rozwiązania awaryjnego. Zapis jest kolejkowany i zastępuje plik przez plik tymczasowy po fsync. Aplikacja korzysta z istniejącej blokady pojedynczej instancji i profilu.

Android przechowuje nieeksportowalny klucz podpisujący oraz klucz AES w AndroidKeyStore. Metadane i przypięte certyfikaty zaufanych urządzeń są szyfrowane AES-256-GCM w prywatnych SharedPreferences. Nie są częścią IndexedDB ani firmowych kopii JSON/ZIP.

Uszkodzenie lub niedostępność magazynu blokuje komunikację bez resetowania danych firmowych. Nie odtwarzamy po cichu nowej tożsamości w miejsce uszkodzonej. Nie przenoś plików magazynu ręcznie pomiędzy urządzeniami. Reinstalacja lub utrata kluczy wymaga ponownego świadomego parowania. Ważność certyfikatów wymaga poprawnej daty na obu urządzeniach.

## Zabezpieczenia TLS i pierwszego parowania

Zwykłe połączenie wymaga wzajemnego TLS: certyfikat klienta, zapisany certyfikat serwera oraz zgodność UUID i SHA256 certyfikatu z listą zaufania. Włączona pozostaje standardowa walidacja certyfikatów; Android sprawdza także nazwę HTTPS gm-UUID.local nad połączeniem do prywatnego IP. Nie stosujemy trust-all, wyłączenia weryfikacji, cleartext HTTP ani globalnego wyjątku CSP. Electron/BoringSSL otrzymuje allowPartialTrustChain, aby jawnie zapisany certyfikat końcowy był kotwicą zaufania, tak jak w magazynie JSSE. Lista CA zawiera wyłącznie przypięte certyfikaty. Nadal sprawdzane są poprawność certyfikatu, ważność, tożsamość i dokładny odcisk DER; nie ufamy dowolnemu certyfikatowi wystawionemu przez drugi klucz. Zasada kotwic jest opisana w [dokumentacji Node TLS](https://nodejs.org/docs/latest-v24.x/api/tls.html) i [BoringSSL X509_V_FLAG_PARTIAL_CHAIN](https://boringssl.googlesource.com/boringssl/+/HEAD/include/openssl/x509.h). Serwer przekazuje jawny standardowy SecureContext przez SNI gm-UUID.local, ponieważ implementacja Node Server.setSecureContext nie przekazuje tej opcji do konstruktora kontekstu. Nie używamy prywatnych pól Node ani własnego weryfikatora certyfikatów.

Pierwsze parowanie ma osobny, ograniczony kanał TLS. Telefon ufa wyłącznie certyfikatowi serwera przekazanemu fizycznie w zaproszeniu. Jest to na tym etapie TLS uwierzytelniający serwer, a nie jeszcze obustronny TLS z zapisanym zaufaniem. Telefon dowodzi posiadania własnego klucza przez podpis ECDSA SHA256 standardowym API platformy.

Zaproszenie zawiera wersję, prywatne IP i porty, UUID, publiczny certyfikat i odcisk serwera, losowy token 256-bitowy oraz termin ważności 120 sekund. Token jest jednorazowy i zostaje zużyty po przyjęciu poprawnego kandydata. Transkrypt podpisu wiąże token, UUID obu urządzeń, odcisk oraz nazwę telefonu. Oba ekrany pokazują ośmiocyfrowy kod kontrolny wyprowadzony z SHA256 tego transkryptu i publiczny odcisk kandydata. Użytkownik potwierdza oba ekrany oraz natywne okno potwierdzenia. Zaufanie nie jest zapisywane bez obu potwierdzeń.

Kanał parowania nie obsługuje testów, bazy ani plików. Próby parowania są ograniczone do pięciu na minutę, dopuszczony jest jeden kandydat i najwyżej cztery otwarte połączenia TCP. Nieudane lub przerwane parowanie wymaga nowego zaproszenia. Telefon zapisuje zaufanie po otrzymaniu potwierdzenia końcowego. Jeśli zerwanie nastąpi pomiędzy zapisami na obu urządzeniach, ponowne parowanie tego samego klucza bezpiecznie uzupełnia drugą stronę.

Usunięcie zaufania zamyka aktywne połączenie tego urządzenia i zmienia zbiór dopuszczonych certyfikatów. Sesje TLS nie są wznawiane na podstawie starych ticketów. Zakończenie sesji zamyka porty, połączenia, mDNS i unieważnia zaproszenie.

Electron zachowuje sandbox, contextIsolation i dotychczasowy CSP. IPC sprawdza główną ramkę aplikacji oraz dokładny schemat polecenia. Renderer nie otrzymuje Node.js ani prywatnego klucza. Capacitor nie loguje argumentów mostka; to ważne, ponieważ zaproszenie zawiera krótkotrwały sekret.

## Protokół v1

Protokół ma osobną wersję, niezależną od formatu biznesowego v12.

Ramka: 4 bajty długości nagłówka big-endian, JSON UTF-8, 4 bajty długości binarnego ciała big-endian, ciało. Nagłówek ma dokładne pola: v, type, id, seq, sid, payload. UUID wiadomości jest unikalny, sid identyfikuje świeżą sesję, seq rośnie osobno w każdym kierunku. Powtórzenie ID, numeru lub starej sesji jest odrzucane. Maksymalnie 8192 numery sekwencji na sesję, nagłówek do 8192 bajtów, ciało do 10 MiB; długość i stan są sprawdzane przed alokacją ciała. Nieprawidłowy UTF-8 i dodatkowe pola są odrzucane.

Komunikaty:
- hello: UUID urządzenia, nazwa, nonce, lista wspieranych wersji, limit i tryb synthetic-only; obecnie zgodny jest tylko protokół 1;
- pair, pair-pending, pair-confirm, pair-approved, pair-done: ograniczone pierwsze parowanie;
- probe: UUID testu, rozmiar i rodzaj znanego zestawu syntetycznego;
- data: binarne ciało, rozmiar, rodzaj i SHA256;
- ack: potwierdzenie UUID testu i SHA256;
- done: wynik dwukierunkowy, obie sumy i czas;
- bye i error: zakończenie lub błąd; błędna ramka kończy połączenie.

Test inicjowany z dowolnej strony przesyła po jednym zestawie w każdym kierunku. Poza SHA256 odbiorca sprawdza zgodność z deterministycznym zestawem syntetycznym. Nie istnieje polecenie przyjmujące dowolny JSON klienta, plik lub rekord biznesowy. Jednocześnie działa najwyżej jeden test; limit czasu testu wynosi 120 sekund, bezczynności 90 sekund, połączenia TCP 5 sekund, uzgadniania TLS 10 sekund.

Rozmiary interfejsu: 1 KB = 1024 B, 100 KB = 102400 B, 1 MB = 1048576 B, 10 MB = 10485760 B. Wynik pokazuje rzeczywiste bajty w każdym kierunku, czas, datę i obie sumy SHA256. „Test komunikacji zakończony” nie oznacza synchronizacji danych firmowych.

## Pierwsze parowanie

1. Uruchom obie aplikacje. Na Windows wybierz Synchronizacja w bocznym menu; na Androidzie Więcej → Synchronizacja.
2. Nadaj rozpoznawalne nazwy, np. „Dom”, „Praca”, „Telefon”. Zapis nazwy korzysta z ochrony niezapisanych zmian.
3. Windows: wybierz interfejs używany w tej sieci i Rozpocznij sesję. Pokaż nowy kod parowania.
4. Android: Odczytaj kod QR aparatem i sfotografuj kod. Zdjęcie jest tymczasowe i nie trafia do galerii prac. Dostępne jest także wklejenie zaproszenia jako bezpieczna metoda awaryjna. Zaproszenie traktuj jak krótkotrwały sekret, nie umieszczaj go w logach ani zgłoszeniach.
5. Powrót z zewnętrznego aparatu wymaga rozpoczęcia sesji na telefonie. Wybierz Połącz i porównaj kody.
6. Porównaj kod i tożsamość na obu ekranach. Zaznacz zgodność i zatwierdź parowanie na obu urządzeniach, także w natywnym oknie. Gdy kod lub klucz się różnią, zakończ sesję.
7. Po zapisaniu zaufania wybierz wykryty komputer albo podaj jego aktualny IP i port TLS z ekranu Windows. Wybierz Testuj połączenie. Test można również zainicjować na Windows.

Wygaśnięcie kodu: pokaż nowy kod i powtórz. Brak aparatu lub trudny odczyt: skopiuj zaproszenie i przekaż lokalnie zaufanym kanałem, bez publikacji.

## Wi-Fi i Ethernet

Komputer i telefon powinny należeć do tej samej sieci lokalnej. Ethernet komputera i Wi-Fi telefonu mogą działać przez jeden router; komputer nie musi mieć Wi-Fi. Nie używaj izolowanej sieci gościnnej.

Wykrywanie korzysta ze standardowego mDNS/DNS-SD _gardenmanager._tcp.local przez UDP 5353. Rozgłaszane są wyłącznie UUID instalacji, wersja, adres i port, bez nazwy urządzenia i danych biznesowych. Gniazdo multicast odbiera na wildcard zgodnie z wymaganiami systemu, a członkostwo grupy i wysyłanie są ograniczone do wybranego interfejsu IPv4. Serwer TLS jest przypisany do wybranego adresu.

mDNS jest wskazówką lokalizacji, nie dowodem zaufania. Po wykryciu nadal obowiązuje przypięty certyfikat. Jeśli router blokuje multicast, użyj ręcznego IP i portu; jeżeli blokuje cały ruch między urządzeniami, ręczny adres tego nie ominie.

## Hotspot telefonu bez internetu

Włącz hotspot Wi-Fi na telefonie i połącz z nim komputer. Dane mobilne mogą pozostać wyłączone. Wybierz adres interfejsu komputera należący do hotspotu, rozpocznij sesję Windows i połącz z Androida. Telefon nadal inicjuje połączenie do komputera. Nie otwieraj portów na routerze.

Niektóre telefony lub polityki firmowe blokują ruch pomiędzy hostem hotspotu i klientem. Funkcja nie może zagwarantować działania takiej sieci. Jeśli połączenie ręczne nie działa, sprawdź komunikację w zwykłej prywatnej sieci Wi-Fi.

## Zmiana sieci i dwa komputery

Po zmianie IP zakończ starą sesję i rozpocznij nową na aktualnym interfejsie. Telefon wyszuka UUID ponownie lub przyjmie nowy adres ręczny. Zaufanie nie zależy od IP ani portu. Port serwera jest przydzielany na każdą sesję.

Sparuj telefon osobno z komputerem domowym i komputerem w pracy. W kolejnych sesjach wybieraj właściwy komputer. Komputery nie muszą być włączone jednocześnie. Ten etap testuje łączność; telefon jeszcze nie przenosi danych firmowych pomiędzy nimi.

## Diagnostyka

- Brak interfejsu: sprawdź lokalne Wi-Fi/Ethernet/hotspot i prywatny IPv4. Prototyp nie obsługuje publicznego IP, DNS wpisywanego ręcznie, IPv6 ani adresów link-local.
- Brak wykrywania: sprawdź aktywną sesję Windows, multicast, tę samą sieć i ręczny IP/port. Android używa NsdManager i blokady multicast wyłącznie podczas sesji.
- Timeout/brak dostępu do LAN: sprawdź izolację klientów, VLAN, gościnną sieć, zaporę lub zasady administratora. Zezwól aplikacji Garden Manager na komunikację w zaufanej sieci prywatnej zgodnie z polityką organizacji. Nie wyłączaj zapory, TLS ani innych zabezpieczeń.
- Zmiana certyfikatu: nie akceptuj jej automatycznie. Sprawdź urządzenie, datę oraz ewentualną reinstalację; świadomie usuń stare zaufanie i sparuj nową instalację.
- Błąd chronionego magazynu: sesja pozostaje wyłączona, dane firmowe nie są zmieniane. Nie kasuj profilu ani aplikacji bez pełnej kopii ZIP.
- Web/PWA: transport natywny jest niedostępny; ekran wyjaśnia wymaganie aplikacji Windows lub Android. Nie próbuje używać HTTP.
- Android target pozostaje 36. Uprawnienia normalne sieci/Wi-Fi/multicast nie dają dostępu do klientów. Przy przejściu na target 37 należy uwzględnić runtime ACCESS_LOCAL_NETWORK zgodnie z wymaganiami platformy. Jeśli aktualny system lub administrator odmawia LAN, pokaż diagnostykę; nie obchodź odmowy.

## Instalacja, aktualizacja i bezpieczeństwo danych

Testowy instalator Windows może nie mieć podpisu Authenticode. Zachowano identyfikator aplikacji, origin app://garden-manager oraz lokalizację profilu. Nie wymaga Node.js, Vite, serwera deweloperskiego ani przeglądarki.

APK jest wersją testową. Każdy przebieg CI bez stałego sekretu podpisującego tworzy inny klucz debug. Nie zakładaj zgodności podpisu z wcześniejszym APK. **Przed ewentualną reinstalacją wykonaj pełny ZIP z danymi i zdjęciami oraz sprawdź możliwość odczytu kopii.** Reinstalacja usuwa też lokalne klucze parowania; po niej sparuj urządzenia ponownie. Test aktualizacji A→B w CI używa jednego klucza dla obu pakietów i nie dowodzi zgodności z podpisem zainstalowanym na fizycznym telefonie.

Dane Windows, Androida i przeglądarki są osobnymi zestawami. Pełny ZIP przenosi dane i zdjęcia przez zastąpienie zestawu, bez scalania baz i bez przenoszenia tożsamości LAN. Nie zmieniono formatu JSON/ZIP ani modelu v12.

## Odbiór na fizycznym Windows 10/11 i Androidzie

CI nie zastępuje tego odbioru. Zapisz wersje systemów, rodzaj sieci i wynik bez ujawniania zaproszeń, kluczy, listy rzeczywistych zaufanych urządzeń lub danych klientów.

1. Wykonaj pełne kopie ZIP istniejących danych przed instalacją testową. Zainstaluj/aktualizuj pakiety; sprawdź klientów, zakup, wydatek CSV, zdjęcie, raport, kalendarz i działający stoper.
2. Bez internetu uruchom obie aplikacje. Potwierdź brak automatycznej sesji i poprawne działanie zwykłych modułów.
3. Domowe Wi-Fi: odszukaj komputer, odczytaj rzeczywisty QR aparatem, porównaj oba ekrany i zatwierdź. Przetestuj wszystkie cztery rozmiary JSON i binarne z telefonu i Windows. Porównaj obie sumy oraz zanotuj czas.
4. Zakończ sesję i spróbuj połączyć ponownie bez uruchomienia Windows. Po uruchomieniu nowej sesji połącz ponownie bez parowania. Zamknij i uruchom aplikacje; tożsamość i zaufanie powinny pozostać, sesja powinna być wyłączona.
5. Powtórz przez Ethernet+Wi-Fi i hotspot telefonu z wyłączonymi danymi mobilnymi. Zweryfikuj ręczny IP/port przy niedziałającym mDNS.
6. Zmień sieć/adres IP. Uruchom nową sesję, odszukaj zaufany UUID i sprawdź połączenie bez nowego parowania.
7. Sparuj drugi komputer. Zakończ pierwszą sesję, połącz telefon z drugim komputerem; oba sparowania mają pozostać.
8. Odrzuć jedno z potwierdzeń; nie powinno powstać kompletne zaufanie. Spróbuj starego/wygasłego zaproszenia. Usuń zaufanie i potwierdź odmowę ponownego połączenia do czasu parowania.
9. W czasie testu 10 MB wyłącz Wi-Fi/zamknij sesję/przenieś Androida w tło. Sprawdź błąd, brak zapisu danych firmowych i możliwość nowego połączenia.
10. Sprawdź Android Back oraz anulowanie wyjścia przy niezapisanej nazwie; po zapisie wyjście ma zakończyć sesję. Sprawdź analogicznie zamknięcie okna Windows.
11. Na sieci z izolacją/zablokowanym LAN potwierdź czytelny timeout i brak obchodzenia zabezpieczeń.
12. Wyeksportuj i odtwórz syntetyczny ZIP ze zdjęciem. Tożsamość LAN bieżącej instalacji ma pozostać bez zmian; import na innym urządzeniu nie może skopiować sparowania.

Rzeczywiste sieci firmowe, hotspoty i zasady zapory różnią się. Fizyczne wyniki będą osobnym protokołem odbioru, nie są domyślnie uznane za zaliczone.

## Wyniki automatyczne i artefakty

Bieżące wyniki oraz linki do dokładnych przebiegów są utrzymywane w docs/GM011A_PROGRESS.md i opisie PR #28. Nie utożsamiaj testów Node loopback, rzeczywistego Electron na runnerze Windows i klienta Android w emulatorze z fizycznym połączeniem dwóch urządzeń.

Testy transportu używają rzeczywistego TCP/TLS, standardowych bibliotek kryptograficznych i tożsamości tworzonych podczas przebiegu. Emulator używa prawdziwego AndroidKeyStore/JSSE oraz produkcyjnej implementacji serwera uruchomionej w Node na runnerze. Świadome automatyczne potwierdzenie jest dozwolone wyłącznie w syntetycznym fixture, a test Electron osobno sprawdza rzeczywisty mostek potwierdzenia. Testy nie mają dostępu do danych użytkownika. Klucze i zaproszenia nie są publikowane w artefaktach.

Pełna regresja kodu 9b8143575086ccda2fdb0f7f12e7dd64ee6d0025 została zaliczona. Zweryfikowane EXE/APK, metadane, sumy SHA256, dokładne wyniki i wcześniejszy niestabilny punkt kontrolny Back są zapisane w [GM011A_PROGRESS.md](GM011A_PROGRESS.md). Pakiety służą fizycznemu odbiorowi; zielone CI nie zastępuje testu dwóch docelowych urządzeń.

### Klucz AndroidKeyStore i standardowy stos TLS

Conscrypt przekazuje do klucza nieeksportowalnego skrót obliczony przez TLS i podpisuje go przez NONEwithECDSA. Dlatego klucz uprawnia do DIGEST_NONE oraz SHA256: pierwsze uprawnienie służy standardowemu stosowi TLS, drugie podpisowi parowania SHA256withECDSA. Nie wyłącza to haszowania TLS ani weryfikacji certyfikatów. Zobacz [oficjalne wymagania KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setDigests(java.lang.String...)) i [implementację Conscrypt](https://github.com/google/conscrypt/blob/master/common/src/main/java/org/conscrypt/CryptoUpcalls.java).

Klucze utworzone przez nieodebrane robocze APK GM-011A sprzed tej poprawki mogą nie mieć uprawnienia wymaganego przez TLS. Nie zastępujemy ich automatycznie. Taki profil testowy wymaga świadomego ponownego przygotowania po zabezpieczeniu danych pełnym ZIP-em; nowa instalacja oznacza nowe parowanie. Stabilny main v12 nie zawierał jeszcze tych kluczy. Dane firmowe nie są resetowane przez aktualizację.
