# Karta wizyty i raport PDF — 0.3.6

## Jedna wizyta, istniejące źródła danych

Rozszerzona jest istniejąca karta `JobDetails`. Widok podsumowania korzysta z Job,
Client, Garden, materiałów zlecenia, checklist, galerii, notatek i rejestru wpłat.
Nie tworzy alternatywnego systemu wizyt. Wstępny zakres pochodzi z tytułu zlecenia,
a wykonane czynności z istniejącej tablicy activities. Nawigacja prowadzi do tych
samych formularzy edycji, korekty czasu, galerii i rozliczenia.

Opcjonalne `Job.visitDetails` zawiera publicWork, clientRemarks, zoneId/zoneName,
czas edycji i rewizję. Są to przygotowane teksty dla klienta, a nie kopia
wewnętrznych notatek. Brak tego pola w starszej wizycie nie wymaga uzupełnienia:
opis do podglądu pochodzi z activities. Pusty opis wymaga uzupełnienia przed PDF.
Niepełne checklisty ostrzegają, bez blokowania zakończenia lub raportowania.

## Historia czasu bez nowego stopera

`Job.timeHistory` jest opcjonalną tablicą zdarzeń: started, paused, resumed,
stopped, completed i corrected. Każde ma UUID, znacznik czasu, sekundy przed/po
oraz opcjonalną długość zakończonej pauzy w milisekundach. Obserwator w GardenStore
zapisuje wynik dotychczasowych poleceń. Nie zmienia ich timerów, reszt milisekund,
sekund, stawek ani algorytmów zaokrąglania. Sam raport i zapis publicznej treści
nie dopisują zdarzeń czasu. Ręczna korekta korzysta z istniejącego formularza.

Dla starszych danych nie fabrykujemy przerw ani korekt. W karcie i raporcie jest
informacja o zakresie dostępnej historii. Trwająca pauza jest pokazywana osobno,
a suma udokumentowanych przerw obejmuje zamknięte odcinki. Czas pracy zachowuje
dokładne sekundy; historyczny ułamek sekundy jest prezentowany bez zaokrąglenia.

## Publiczna migawka i prywatność

`buildReportSnapshot` tworzy osobny DTO z jawną listą dozwolonych pól.
Nie serializujemy obiektu Job ani danych z całego kontekstu do pliku PDF.
Walidacja migawki odrzuca nadmiarowe pola. Migawka obejmuje nazwę klienta,
ogrodu, adres i strefę, datę prac, przygotowany opis oraz wybrane sekcje.

Domyślnie czas i materiały są włączone, a finanse, checklisty, zdjęcia i uwagi
wyłączone. Nazwa i ilość materiału są publiczne; cena zakupu i cena jednostkowa
nie są kopiowane. Opcjonalne finanse pokazują zatwierdzoną robociznę, zatwierdzoną
sumę materiałów, należność, otrzymane wpłaty i saldo, korzystając z istniejących
funkcji rozliczeń. Nie wyliczamy nowej ceny. Jeżeli później zmieniono listę
materiałów, zatwierdzone sumy nadal pochodzą z rozliczenia; lista ilości pozostaje
aktualną dokumentacją. Opcjonalne finanse wymagają zatwierdzenia należności.

Nigdy nie kopiujemy do raportu klient.notes, danych kontaktowych, garden.notes,
job.notes, notatek modułu desk, uwag checklist, opisów ani oryginalnych nazw
fotografii, cen zakupu, danych katalogu lub prywatnych opisów płatności. Checklisty
mogą pokazać tytuły, statusy i daty wykonania. Zalecenia to wyłącznie jawne pole
clientRemarks i wymagają zaznaczenia. Publiczny podgląd stosuje również neutralne
teksty alternatywne obrazów. Wpisany przez właściciela publiczny opis należy
sprawdzić przed udostępnieniem; aplikacja nie klasyfikuje znaczenia tekstu.

## Przygotowanie, zapis i wersje

Logika w `src/reports` jest niezależna od React. ReportService ma adapter danych,
repozytorium obrazów i wymienny generator PDF; może być użyty z przyszłym
adapterem Capacitor. Interfejs wywołuje kolejno:

1. prepare: odczyt najnowszych danych, publiczna migawka, SHA-256 treści,
   proponowany numer/wersja i wygenerowanie PDF w pamięci. Nie zapisuje historii.
2. Podgląd HTML tej samej treści oraz opcjonalny podgląd pliku PDF.
3. save: po jawnym przycisku zapisuje metadane i migawkę, sprawdzając aktualność
   wybranych danych i numeracji, po czym interfejs pobiera PDF.
4. regenerate: odtwarza konkretną zapisaną wersję, bez zmian danych wizyty.

Zapis korzysta z Web Locks i tej samej blokady, którą obsługuje istniejący
mechanizm zdjęć/odtwarzania ZIP. Raporty z dwóch kart nie przydzielają sobie tego
samego numeru; nieaktualny podgląd wymaga ponownego przygotowania. Gdy Web Locks
nie są dostępne, działa kolejka w ramach jednej strony i kontrola aktualności;
na takich przeglądarkach raporty należy zapisywać z jednej karty.

`Data.reportSequence` jest monotonicznym licznikiem numerów. `Job.reports`
przechowuje UUID, numer BO/rok/licznik, wersję, generatedAt, rendererVersion=1,
odcisk treści, opcje i publiczną migawkę. Pierwszy raport wizyty rezerwuje numer,
a następne publiczne zmiany zwiększają wersję tego numeru. Ponowny podgląd tych
samych danych ostatniej wersji oraz pobranie nie tworzą duplikatów. Wcześniejsze
wersje zachowują nazwę klienta, treść i kwoty z chwili generacji.

Nie zapisujemy pełnych PDF-ów w żadnym lokalnym magazynie. Bajty i adres Blob
istnieją w pamięci podczas podglądu/pobierania; adresy są zwalniane po zamknięciu.
Zapisany plik trafia do pobrań urządzenia. Ponowne generowanie zachowuje treść,
numery i daty; nie obiecuje identycznego binarnie pliku PDF. Wczytywanie i generacja
niczego nie wysyłają. Nie dodano automatycznej poczty ani synchronizacji.

## PDF, czcionki i zdjęcia

Renderer używa pdf-lib i fontkit, lokalnych podzbiorów DejaVu Sans oraz osadzania
użytych glifów. Obejmuje polskie znaki, łacinę, grekę, cyrylicę i typowe symbole.
Nieobsługiwany znak daje komunikat przed zapisem, zamiast uszkodzonego dokumentu.
Pochodzenie, licencja i polecenie przygotowania czcionek: public/fonts/README.txt
oraz LICENSE-DejaVu.txt. Generator, czcionki i nowe widoki są objęte cache PWA.
Pierwsze pełne uruchomienie online przygotowuje zasoby na późniejszą pracę offline.
Pakiety generatora są ładowane na żądanie. Vite sygnalizuje wielkość odroczonego
pakietu fontkit (około 717 kB po minifikacji); nie jest to pakiet startowy aplikacji.

Wybrane zdjęcia PRZED/PO mogą pochodzić z wizyty lub galerii jej ogrodu bez
przypisania do innej wizyty. Wybór jest jawny, z datami. Opcjonalne logo można
wybrać z tej galerii lub dodać do niej w kategorii INNE. Dotychczasowy procesor
zmniejsza i zapisuje JPEG/miniaturę w IndexedDB. Raport przechowuje wyłącznie
photoId, sumę kontrolną, wymiary, rozmiar, kategorię i datę. Nie kopiuje obrazów
ani base64 do localStorage. Przy generacji sprawdza obecność i SHA-256 obrazu.

Limit: 6 fotografii PRZED/PO i jedno logo, razem do 12 MB obrazów, 1000 czynności
checklist, 8000 znaków opisu, 5000 znaków zaleceń, 60 stron i 20 MB gotowego PDF.
Brak lub uszkodzenie pliku blokuje generację z komunikatem. Usunięcie zdjęcia
z galerii nadal usuwa jego plik; widok potwierdzenia ostrzega, gdy obraz jest
używany przez raport. Historyczna migawka pozostaje, lecz do odtworzenia PDF z
usuniętym obrazem potrzebna jest wcześniejsza pełna kopia ZIP. Już pobrane PDF-y
pozostają niezależnymi plikami na urządzeniu. Nie pomijamy brakującego obrazu
po cichu i nie zmieniamy treści zapisanej wersji.

## Migracja i kopie

Schemat **v9** dodaje reportSequence=0 do danych v1–v8. Pola wizyty, historia
czasu i raporty są opcjonalne: stare Job pozostają bez pustych sztucznych rekordów.
Wymagane dane schematów v7/v8 nadal muszą przejść walidację. Dokładna kopia
źródła v8 trafia do garden-manager:backup:v8, bez nadpisywania wcześniejszej.
Główny klucz garden-manager:v1 oraz localhost:5173 pozostają zachowane.

JSON i pełny ZIP obejmują nowe metadane i migawki. Manifest ZIP nadal ma format 1,
a data.json format 9. Import akceptuje dane ZIP v6–v9, a stare punkty odzyskiwania
IndexedDB uzupełnia deterministycznie. Przywrócenie zmienia techniczne ID plików,
lecz zachowuje photoId, więc zapisane raporty mogą korzystać z odtworzonych obrazów.
Przy odtwarzaniu licznik numerów przyjmuje większą z wartości bieżącej i kopii,
aby nie przydzielać ponownie numerów już znanych na tym urządzeniu. Numeracja
jest lokalna; niezależnie rozwijane kopie na innych urządzeniach wymagają przyszłego
mechanizmu synchronizacji. Wszystkie dotychczasowe limity, sumy kontrolne, podgląd, potwierdzenie ODTWÓRZ
i lokalny punkt odzyskiwania obowiązują nadal. JSON nie zawiera plików fotografii.

Zwykła edycja zlecenia zachowuje nowszą historię raportów, czasu i podsumowanie.
Po poprawkach kart klienta i ogrodu zlecenia z zapisanymi raportami, zatwierdzonym
rozliczeniem lub wpłatami są chronione przed usunięciem. Pozostałe zlecenia można
usunąć po sprawdzeniu skutków i potwierdzeniu; usuwa to również zdarzenia czasu.
Licznik raportów nie jest cofany. Zakończenie, częściowe płatności,
ryczałty i zatwierdzone należności zachowują dotychczasowe reguły.

## Weryfikacja

- `npm test`: 309/309 testów, w tym 53 nowe testy raportów. Parser PDF.js sprawdza
  tekst rzeczywistych PDF-ów, polskie znaki i brak prywatnych danych. Testy obejmują
  zdjęcia/logo, brak plików, limity, wersjonowanie, stare migracje i kopie ZIP,
  historię dokładnego czasu oraz nienaruszone zatwierdzone kwoty i wpłaty.
- `npm run test:e2e`: 96/96 scenariuszy Chromium, w tym 15 nowych. Sprawdzono
  pobieranie i analizę PDF, ustawienia prywatności, historię, konflikty podglądu,
  zapis z dwóch kart, odtworzenie ZIP i telefon 390 px.
- `npm run test:pwa`: 5/5 scenariuszy produkcyjnych. Nowy test odłącza internet
  przed pierwszym otwarciem raportu, generuje PDF z polskim tekstem i zdjęciem,
  odtwarza ZIP oraz pobiera ponownie zapisaną wersję po odświeżeniu offline.
- `npx tsc -b --pretty false`, build produkcyjny i `git diff --check`: poprawne.
  Jedno ostrzeżenie Vite dotyczy wielkości pakietu fontkit opisanego wyżej.

Dodatkowo obejrzano pobrany PDF i interfejs na komputerze oraz telefonie;
sprawdzono brak poziomego przewijania przy szerokości 390 px. Testy przeglądarkowe
obejmują Chromium; nie zastępują przyszłego sprawdzenia natywnego adaptera Android.
