# GM-007 — Mobilny tryb terenowy

## Audyt i wykorzystane moduły

Bazą jest `main` po PR #20. Format pozostaje **v10**; nie ma nowego trwałego
pola, migracji, drugiej bazy wizyt ani drugiego kontrolera nawigacji.

| Potrzeba w terenie              | Wykorzystany mechanizm                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Jedna wizyta i łączny czas      | `Job`, `Data.timer`, funkcje czasu w `domain.ts`, `auditTimeChanges`                                           |
| Dodawanie nieplanowanej wizyty  | ten sam `JobForm` i `saveJob`, wraz z ostrzeżeniami GM-006                                                     |
| Czynności i materiały           | wspólne `VisitFields` wyodrębnione z `JobForm`; istniejące `Job.activities`, `Job.materials`, `addJobMaterial` |
| Zdjęcia, aparat i miniatury     | `PhotoGallery`, `PhotoService`, dotychczasowy magazyn plików IndexedDB                                         |
| Notatki i przypomnienia         | `ContextNotes`, `NoteForm`, istniejące karty notatek                                                           |
| Checklisty                      | `ChecklistPanel`, `ChecklistEditor`, istniejące karty i komendy                                                |
| Podsumowanie, korekty i raporty | `JobDetails`, `VisitSummary`, `TimeCorrection`, istniejące rozliczenie i raport PDF                            |
| Zabiegi i dostępność            | rzeczywiste powiązania GM-005, `jobSource`, `occurrenceCard`, `AvailabilityNotice`                             |
| Zapis i ochrona formularzy      | `AtomicRepository`, `pendingWrite`, `useUnsavedChanges`, wspólny `NavigationProvider`                          |

## Uruchamianie i wybór zlecenia

Na komputerze wybierz „Tryb terenowy” w głównej nawigacji lub na pulpicie.
Na telefonie zawsze widoczny przycisk „Teren” otwiera ten sam widok, bez dodawania
kolejnej pozycji dolnego menu. Pełna karta zlecenia także ma przycisk trybu.

Najpierw widać aktywną lub wstrzymaną wizytę, następnie prace na dziś i najbliższe
zaplanowane zlecenia. Wyszukiwanie obejmuje pracę, czynności, klienta, ogród i
adres; można też otworzyć wcześniejsze i zakończone zlecenia. Bez zleceń dostępne
jest tworzenie przez istniejący formularz. Bez ogrodów najpierw dodaj klienta
i ogród. Otwieranie widoku, wyszukiwanie i wybór **nie zapisują pustych rekordów
ani nie uruchamiają stopera**.

Adres `#field?field=<ID>` otwiera daną wizytę, a parametr `section` wybiera
`work`, `photos`, `notes`, `checklists` lub `materials`. Wspólny kontroler zachowuje
kontekst i obsługuje Wstecz/Dalej, odświeżanie, fokus oraz powrót z klienta,
ogrodu i dokumentacji. Błędne adresy i usunięte wizyty mają bezpieczny komunikat.

## Stoper i powrót po zablokowaniu ekranu

- **START**: świadomie uruchom pomiar po wyjściu z samochodu u klienta.
- **PAUZA**: przerwij naliczanie na czas przerwy.
- **WZNÓW**: kontynuuj tę samą wizytę.
- **STOP**: po pracy, sprzątnięciu i spakowaniu sprzętu potwierdź zakończenie pomiaru.

Dojazd i powrót nie są częścią czasu. Wszystkie czynności mają jeden łączny
pomiar. Nie działa dodatkowy zegar ani usługa w tle: ekran liczy sekundy z
trwale zapisanego `startedAt`, dotychczasowych sekund i reszty milisekund.
Po wznowieniu widoczności, odzyskaniu fokusu i ponownym otwarciu odczytywany jest
aktualny czas. Pauza nie dolicza czasu zamknięcia aplikacji.

W czasie zapisu przyciski są zablokowane; wielokrotne kliknięcia nie ponawiają
operacji. Polecenie w transakcji sprawdza widziany stan stopera i identyfikator
ostatniego istniejącego wpisu historii czasu. Stare potwierdzenie STOP nie
zatrzyma innej wizyty ani nowego odcinka tej samej wizyty, nawet przy identycznym
znaczniku czasu. Próba drugiego START-u wymaga zakończenia poprzedniego pomiaru.
Zmiana widoku nie zatrzymuje pomiaru.

STOP nie kończy zlecenia i nie zatwierdza ceny. Ręczna korekta czasu pozostaje
w pełnej karcie wizyty, po zakończeniu pomiaru.

## Czynności, notatki i checklisty

Dodaj lub edytuj czynności bez zatrzymywania stopera. Formularz korzysta z tych
samych pól co zwykła edycja zlecenia. Zapis zmienia wyłącznie `activities` we
wskazanym zleceniu i porównuje poprzednią listę w transakcji. Nie nadpisze czasu,
materiałów ani zmian innej karty. Konflikt zachowuje szkic; przed ponownym
zapisem otwórz aktualną listę.

Notatki dodaje się i edytuje istniejącym formularzem z kontekstem wizyty.
Nie są treścią publicznego raportu, dopóki użytkownik świadomie nie wpisze
odpowiednich informacji w podsumowaniu. Ochrona niezapisanych zmian obejmuje
zmianę sekcji, zamykanie okna, Wstecz i odświeżanie.

Sekcja checklist pokazuje postęp. Otwarcie listy pozwala odznaczać punkty,
zapisywać uwagi i korzystać z istniejącego edytora. Licznik w skrótach pokazuje
niewykonane punkty. Niepełna lista nie blokuje świadomego zakończenia wizyty.

## Aparat i zdjęcia

„Zrób zdjęcie” otwiera aparat wyłącznie po świadomym kliknięciu, przez
`input type=file` z `capture=environment`. To wskazówka dla przeglądarki;
może ona zaoferować aparat albo wybór pliku. Samo otwarcie trybu nie prosi o
uprawnienia. W galerii jest również zwykły wybór zdjęć z urządzenia.

Kontekst klienta, ogrodu i zlecenia wyznacza istniejący model. Strefę można
wybrać opcjonalnie. Zdjęcie z szybkiego aparatu domyślnie ma kategorię
„W trakcie”; dostępne pozostają wszystkie dotychczasowe kategorie, opis i data.
Przed zapisem wyświetlane są wybrane nazwy plików, jak w istniejącym formularzu.
Pliki JPEG/PNG/WebP są przetwarzane, zmniejszane i zapisywane z miniaturą
w dotychczasowym IndexedDB, nigdy jako base64 w localStorage.

Anulowanie aparatu nie tworzy wpisu. Niepoprawny plik, niedostępna pamięć albo
brak miejsca pokazują błąd i nie zmieniają historii wizyty ani pomiaru.
Metadane pojawiają się dopiero po zapisie plików i zatwierdzeniu transakcji.

## Materiały i zakończenie wizyty

Materiały korzystają ze wspólnych pól nazwy, ilości, jednostki, ceny zakupu,
ceny dla klienta i katalogu. Jedna partia nowych materiałów dopisuje się do
najnowszego zlecenia w jednej transakcji, bez zastępowania istniejących wpisów.
Przy wyborze katalogu pusty początkowy wiersz zostaje zastąpiony wyborem.
Materiały pozostają oddzielne od robocizny. Zatwierdzona należność i płatności
nie zmieniają się automatycznie; potrzebna jest istniejąca świadoma korekta.

Po STOP przycisk „Podsumowanie wizyty” otwiera istniejące podsumowanie w karcie
zlecenia: klient, ogród, data, czas, czynności, materiały, zdjęcia, notatki i
checklisty. Z zamkniętego podsumowania wrócisz przez przycisk „Wróć do wizyty
w terenie” w karcie zlecenia albo przez historię przeglądarki.

„Zakończ wizytę” jest osobną operacją z potwierdzeniem i jest niedostępne podczas
własnego pomiaru. Transakcja ponownie sprawdza ten warunek. Nie zatwierdza ceny,
płatności ani zabiegów cyklicznych. Rzeczywiście powiązana czynność GM-005 oraz
wykonane podczas wizyty zabiegi prowadzą do ich istniejących kart. Wykonanie
potwierdź oddzielnie z faktyczną datą; reguły kolejnego terminu pozostają bez zmian.
Ostrzeżenie GM-006 informuje o kolizji, bez automatycznego przekładania pracy.

## Offline i zabezpieczenia

Po pierwszym pobraniu PWA działa bez internetu: stoper, czynności, aparat i
pliki, notatki, checklisty, materiały i przeglądanie danych. Informacje pozostają
na tym urządzeniu; **nie ma synchronizacji między telefonem i komputerem**.

Wszystkie komendy korzystają z aktualnego stanu i atomowych transakcji
IndexedDB. localStorage pozostaje wyłącznie kopią zgodności. Widoczny stan
„Zapisywanie…” trwa do zakończenia operacji. Dopiero wtedy widok potwierdza zapis
lub pokazuje nową listę. Błąd pozostawia poprzedni stan i szkic formularza.
W trakcie operacji nawigacja czeka, a zamknięcie aplikacji wywołuje standardowe
ostrzeżenie przeglądarki, jeśli system je udostępnia.

Stare dane v10, raporty, zdjęcia, GM-005 i GM-006 są zachowane. JSON i ZIP nadal
zawierają te same modele. JSON nie zawiera plików zdjęć; pełną kopią jest ZIP.
Import zachowuje istniejące zabezpieczenia i punkt odzyskiwania. Przywrócenie
kopii aktywnego pomiaru nadal wstrzymuje go według czasu utworzenia kopii.

## Testy i ograniczenia

Automatyczne testy obejmują Chromium, dotyk, klawiaturę, szerokości 320, 360,
390, 430 i 1280 px, uśpienie symulowane skokiem zegara i ponownym otwarciem,
dwie karty, opóźnione transakcje, quota, uszkodzony plik, ZIP z prawdziwym
zdjęciem oraz produkcyjne PWA offline. Zachowane są pełne testy wcześniejszych
modułów.

Nie wykonywano prób na fizycznym telefonie Android. Rzeczywisty aparat,
blokowanie ekranu, klawiatura ekranowa i polityka zamykania PWA wymagają
sprawdzenia na docelowym urządzeniu. Przeglądarka może usunąć pamięć witryny;
wykonuj pełne kopie ZIP. Pomiar zależy od poprawnego zegara urządzenia.

Do przyszłej aplikacji Android można wykorzystać obecne komendy, znaczniki czasu
i adapter plików, a aparat podłączyć przez Capacitor. Osobno potrzebne będą
testy cyklu życia aplikacji, uprawnień, przywracania po ubiciu procesu oraz
trwałości pamięci. Ten etap nie dodaje APK, natywnej usługi, GPS ani synchronizacji.
