# Karty klienta, ogrodu i historia zleceń

Zmiana bazuje na scalonej wersji 0.3.6 (`767368a`, PR #10). Nie zawiera
niedokończonego trybu terenowego. Format danych pozostaje **v9**; migracja nie
jest potrzebna. Klucz **garden-manager:v1**, IndexedDB, adres **localhost:5173**,
JSON, pełny ZIP i mechanizmy odzyskiwania pozostają bez zmian.

## Nawigacja i widoki

Nazwę ogrodu i **Otwórz ogród** w karcie klienta obsługuje ten sam GardenDetails,
który otwieramy z listy obiektów. Edycja pozostaje osobną akcją GardenForm.
Pełnoekranowa karta ma siedem sekcji: Przegląd, Strefy i rośliny, Zlecenia
i historia prac, Harmonogram i plany czynności, Rozliczenia, Galeria oraz
Notatki i dokumentacja. Zakładki obsługują także strzałki, Home i End.
Sekcje są montowane dopiero po pierwszym otwarciu.

RelatedCards przechowuje stos wyłącznie powiązanych kart. Przejście do karty
już obecnej w stosie wraca do niej. Powrót do klienta lub zlecenia, z którego
otwarto ogród, przywraca pierwotny widok. Nieaktywne okna są ukryte i inert;
ich filtry, sekcje, rozwinięcia miesięcy i przewijanie pozostają zachowane.
Zamykanie i Escape wracają o jeden poziom. Po zamknięciu całości fokus wraca
do elementu otwierającego. JobDetails ma przejścia **Ogród: …** i **Klient: …**.

Pozostałe moduły zachowują dotychczasową nawigację. Stan widoków jest lokalny
dla otwartej sesji kart; po pełnym odświeżeniu sekcje wracają do domyślnych.
Zapisane dane pozostają zachowane.

## Istniejące moduły

Dodawanie i edycja zlecenia korzystają z JobForm i GardenStore. Formularz ma
uzupełnionego klienta i ogród; zapis nie uruchamia stopera. Wizyta i rozliczenie
otwierają JobDetails. Strefy, rośliny, zabiegi, kalkulator, ChecklistPanel,
PhotoGallery i ContextNotes pozostają dotychczasowymi komponentami.

Sekcja harmonogramu pokazuje reguły przypisane do ogrodu i plany czynności.
Harmonogramy i wyjątki nadal edytuje się w kalendarzu; jego logika nie jest
zmieniana. Nie dodano nowego modelu wizyt, finansów, chmury ani APK.

## Historia i kwoty

Wspólny GroupedJobHistory obsługuje klienta i ogród. Grupuje po roku i miesiącu
daty zlecenia, z sortowaniem od najnowszych lub najstarszych. Domyślnie rozwija
bieżący miesiąc według lokalnej daty urządzenia. Starsze miesiące są zwinięte,
a ich wiersze nie są montowane. Otwarty miesiąc pokazuje 50 pozycji i pozwala
doładować kolejne 50. Cały zapis pozostaje bez zmian.

Podsumowania odpowiadają filtrom. Liczba i czas obejmują wszystkie wyniki.
Czas pochodzi z elapsedSeconds, bez zaokrąglania sum; reportDuration prezentuje
także historyczne ułamki sekund. Wartość wykonanych prac obejmuje zakończone
zlecenia z zatwierdzoną ceną, jak dotychczasowe podsumowanie klienta. Używa
jobTotalCents i sumCents, bez nowej wyceny ze stawki i czasu. Kwoty historyczne,
ryczałty, osobne materiały i ręczne zatwierdzenia pozostają wiążące.

Rozliczenia ogrodu korzystają z clientSummary ograniczonego do danego ogrodu.
Wiersze używają paidCents, remainingCents i settlementStatus. Wpłaty obejmują
także zaliczki. Żaden widok podsumowania nie zapisuje czasu ani kwot.

## Bezpieczeństwo zleceń

Wspólny JobDeleteDialog działa z ogrodu i głównej listy zleceń. GardenStore
sprawdza te same reguły na najnowszym zapisie:

- Aktywny stoper, wpłaty, zatwierdzone rozliczenie, zapisane raporty lub termin
  kalendarza blokują usunięcie. Rozliczone zlecenie pozostaje w historii.
- Dla pozostałych zleceń potwierdzenie wymienia usuwane dane, pokazuje liczbę
  zdjęć, notatek i checklist oraz wymaga zaznaczenia zgody. Usuwane są karta,
  zakres, materiały, notatka formularza, podsumowanie, czas i historia przerw.
- Odrębne zdjęcia, notatki i checklisty pozostają przy ogrodzie w istniejących
  modułach, z historyczną nazwą wizyty i odłączonym jobId. Operacja nie kopiuje
  ani nie usuwa plików IndexedDB.
- Zmiana zlecenia lub dokumentacji po otwarciu potwierdzenia unieważnia zgodę.

Formularze edycji z ogrodu i szczegółów wizyty przekazują migawkę edytowanych
pól. Nowsza zmiana lub usunięcie w innej karcie blokuje zapis starego szkicu.
Dotychczasowy zapis nadal zachowuje nowszą historię czasu i raportów,
podsumowanie, zatwierdzone kwoty oraz wpłaty.

## Weryfikacja

- `npm test`: **330/330**, w tym 21 nowych testów grupowania, sum i ochrony danych.
- `npm run test:e2e`: **112/112 Chromium**, w tym 16 nowych scenariuszy kart,
  dwóch kart przeglądarki, zachowania przewijania i ekranów 360/390/430 px.
- `npm run test:pwa`: **6/6**, w tym pierwsze otwarcie kart offline i zapis
  nowego zlecenia. Dotychczasowe scenariusze odtwarzają ZIP ze zdjęciami,
  notatkami, checklistami, harmonogramami i raportami.
- `npx tsc -b --pretty false`, build produkcyjny i `git diff --check`: poprawne.

Scenariusze regresji wybierają teraz sekcję zawierającą dany moduł. Trzy
wieloetapowe testy ZIP mają limit 60 sekund; asercje danych i kwot są zachowane.
Test dokładnie 13 sekund korzysta ze stałej daty testowej, bez zmiany stopera.
Build nadal zgłasza znane z wersji 0.3.6 ostrzeżenie o wielkości pakietu fontkit
(około 717 kB po minifikacji), ładowanego na żądanie. Modułu PDF nie przebudowano.
