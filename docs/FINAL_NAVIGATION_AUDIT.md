# Finalny audyt nawigacji Garden Manager — etap 6/6

Punkt wyjścia: `main` po scaleniu PR #17, commit `453d461`. Audyt obejmuje
istniejący interfejs React/PWA i dane v9. To dopracowanie nawigacji, formularzy
i dostępności, bez nowych funkcji biznesowych. Nie korzystano z osobnej,
niedokończonej gałęzi trybu terenowego.

## Podsumowanie etapów 1–6

| Etap      | Rezultat                                                                                                                      | Dokumentacja                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1, PR #12 | Wspólny kontroler kart klienta, ogrodu i zlecenia, URL, historia, ochrona formularzy                                          | [Historia nawigacji](NAVIGATION_HISTORY.md)        |
| 2, PR #13 | Kalendarz, seria i termin, źródło zlecenia, zachowanie daty i filtrów                                                         | [Kalendarz i harmonogramy](CALENDAR_NAVIGATION.md) |
| 3, PR #15 | Zdjęcia, notatki, checklisty i zapisane raporty otwierają rzeczywiście powiązane obiekty                                      | [Dokumentacja](DOCUMENTATION_NAVIGATION.md)        |
| 4, PR #16 | Rozliczenia i wpłaty prowadzą do klienta i właściwych zleceń, z domenowymi podsumowaniami                                     | [Finanse](FINANCE_NAVIGATION.md)                   |
| 5, PR #17 | Strefy, opisy roślin i zabiegów, przypisane plany, harmonogramy, zlecenia i dokumentacja                                      | [Strefy i pielęgnacja](ZONES_CARE_NAVIGATION.md)   |
| 6, ten PR | Domknięcie nawigacji spraw, menu i ustawień, kontekst kalkulatorów, skrót dodawania zlecenia, komunikaty i sterowanie mobilne | Niniejszy raport                                   |

Bazowe karty i historia z PR #11 pozostają. Atomowy zapis PR #14 jest zachowany;
regresja obejmuje jego współbieżność i import, a kod trwałego zapisu nie został
zmieniony.

## Sprawdzone moduły i rzeczywiste ścieżki

Przegląd obejmował komponenty, kontroler, reguły wiązania przez ID oraz automatyczne
przejścia w przeglądarce. Tabela wskazuje pokrycie; nie oznacza ręcznego testu
każdej możliwej kombinacji danych.

| Moduł                                | Sprawdzona ścieżka / zachowanie                                                                      | Testy                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pulpit                               | Szczegóły zlecenia, wybór do stopera, przypomnienie, sprawa, nowy szkic                              | `calendar-navigation`, `final-navigation`, `app`                             |
| Klienci i ogrody                     | Klient → każdy ogród, powrót, istniejący formularz zlecenia z kontekstem klienta i ogrodu            | `garden-navigation`, `shared-navigation`, `stage1`                           |
| Strefy, roślinność i opisane zabiegi | Ogród → strefa → plan/seria, teksty i rzeczywiste powiązania, identyczne ID stref w różnych ogrodach | `zones-navigation`, testy modelu stref                                       |
| Zlecenia i historia                  | Szczegóły, edycja, chronione usuwanie, miesięczne grupy, powrót do ogrodu/klienta                    | `garden-navigation`, `visits`, `reports`                                     |
| Kalendarz i harmonogramy             | Dzień/tydzień/miesiąc, filtry, seria, przesunięty/pominięty termin, źródło wizyty                    | `calendar-navigation`, `calendar-atomic-navigation`, `planning`              |
| Stoper                               | Samo otwarcie szczegółów nie zmienia wyboru ani pomiaru; pauza/wznowienie i restart                  | `final-navigation`, `app`, `visits`                                          |
| Finanse i płatności                  | Klient → należności → rozliczenie → zlecenie, wpłata i powroty, duża historia z leniwymi wierszami   | `finance-navigation`, testy finansów i historii                              |
| Raporty                              | Zapisana wersja, źródłowa wizyta, współbieżny zapis dwóch kart, PDF i ZIP                            | `reports`, `atomic-reports`, `atomic-import`, `documentation-navigation`     |
| Galerie                              | Zdjęcie → rzeczywisty obiekt/notatka, obraz po odtworzeniu ZIP i offline                             | `photos`, `documentation-navigation`, `zones-navigation`, `final-navigation` |
| Notatki i przypomnienia              | Edycja, odroczenie, powiązania, kalendarz, ochrona szkicu, brak operacji finansowych                 | `notes`, `documentation-navigation`                                          |
| Sprawy „Do zrobienia”                | Lista/pulpit/kalendarz → ta sama karta → klient/ogród/strefa/zlecenie, URL i filtry                  | `final-navigation`, wcześniejsze `notes`                                     |
| Checklisty i szablony                | Biblioteka → plan/wizyta, zapis i zdjęcia, ochrona istniejących kopii                                | `checklists`, `documentation-navigation`, PWA checklist                      |
| Materiały i kalkulatory              | Wyszukiwanie, edycja, powrót z katalogu i rozliczenia do wpisanych obliczeń; jawne dodanie materiału | `stage2`, `final-navigation`, testy kalkulatorów                             |
| Ustawienia i kopie                   | URL, Wstecz/Dalej, błędny/opóźniony zapis, JSON/ZIP, odtworzenie zdjęcia i sprawy                    | `final-navigation`, `atomic-import`, `photos`                                |
| Menu i widoki zbiorcze               | Wszystkie 11 głównych zakładek, menu mobilne, klawiatura, dotyk, rozdzielczości                      | `final-navigation`, `app`, PWA końcowej integracji                           |

Nazwy w tabeli odnoszą się do plików `tests/*.spec.ts` i `pwa-tests/*.spec.ts`.
Pełna regresja obejmuje także migracje starszych danych i wcześniejsze etapy.

## Wykryte i poprawione problemy

1. **Sprawy miały osobny, lokalny stan otwarcia.** Lista, pulpit i kalendarz
   otwierały lokalny `DeskDetails`, bez adresu i wspólnego stosu. Dodano kartę
   `todo` do tego samego kontrolera; wszystkie trzy źródła wykorzystują istniejący
   komponent. Sprawa ma również odnośniki wynikające z jej zapisanych ID.
2. **Niepełne etykiety powrotu.** Karta otwarta nad kalkulatorami lub listą spraw
   mogła oferować powrót do zleceń. `pageReturnLabel` obejmuje wszystkie zakładki,
   a stos rozpoznaje powrót do sprawy.
3. **Utrata filtrów.** Lista spraw i katalog materiałów używały lokalnego stanu
   wyszukiwania. Korzystają teraz z istniejącego `useViewState`, podobnie jak
   klienci, ogrody, notatki i biblioteka checklist.
4. **Utrata obliczeń i zbędne menu.** Powrót do kalkulatora zerował wymiary,
   wybrany materiał i zlecenie. Stan prezentacji zachowuje te wartości. Kalkulator
   otwiera wybrany ogród, strefę, rozliczenie zlecenia i katalog. Dodawanie materiału
   nadal jest osobną, jawną operacją, z niezmienioną komendą domenową.
5. **Mylący skrót na pulpicie.** „Dodaj zlecenie” prowadziło wyłącznie do listy.
   Otwiera teraz istniejący `JobForm`; samo otwarcie tworzy tylko szkic w pamięci.
   Zapis następuje wyłącznie po zatwierdzeniu. Stoper ma dodatkowo odnośnik do
   szczegółów wybranego zlecenia, oddzielony od uruchamiania pomiaru.
6. **Menu i ustawienia nie uczestniczyły w historii.** Są teraz stanem widoku
   wspólnego kontrolera. Menu wykorzystuje ten sam `Modal`, trap fokusu, Escape
   i zamknięcie co pozostałe okna. Wstecz zamyka okno, Dalej je przywraca.
   Formularz nowego zlecenia również ma adresowany stan otwarcia.
7. **Niejednolita informacja o zapisie.** `PendingStatus` pokazuje istniejącą
   blokadę zapisu (`aria-busy`), bez nowego mechanizmu zapisu. Ustawienia używają
   tej samej osłony `guard.save`, zachowują szkic przy błędzie i prezentują błąd
   jako `alert`, sukces jako `status`. Kalkulator blokuje własne kontrolki do
   zakończenia komendy, ograniczając przypadkowy ponowny zapis.
8. **Za małe kontrolki i tekst formularzy mobilnych.** Ikony 36 px powiększono do
   minimum 44 px; przyciski tekstowe i wybrane odnośniki mają minimum 44 px wysokości.
   Mobilne pola mają 16 px, także po załadowaniu pozostałych arkuszy CSS. Przyciski
   formularzy zawijają się, długie nagłówki mieszczą się w oknie, a układ 320 px
   uwzględnia mniejszy margines i większy przycisk ustawień.
9. **Fokus i komunikat opuszczenia formularza.** Trap fokusu pomija kontrolki
   wewnątrz `hidden`/`inert`. Dodano przycisk „Przejdź do treści” i widoczny fokus.
   Wspólne potwierdzenie mówi o opuszczeniu bez zapisu, bez obietnicy usunięcia
   szkicu, który część kart może nadal zachować w pamięci.

10. **Powrót z błędnego adresu.** „Pokaż listę” usuwa komunikat także wtedy,
    gdy adres został już skanonizowany do tej samej listy. Zmiana komunikatu
    następuje dopiero po zaakceptowaniu ochrony formularza.

11. **Brak ogrodu przy bezpośrednim otwarciu nowego zlecenia.** Pusta baza ma
    komunikat w tym samym oknie z jawnym powrotem i przejściem do klientów,
    zamiast nieaktywnej listy pod nieistniejącym formularzem. Nie tworzy rekordu.

Nie usuwano równoległych odnośników tytuł/przycisk, jeśli zapewniają tę samą
funkcję w czytelny sposób. Nie powielono kart, formularzy ani źródeł danych.

## Wspólne zasady nawigacji

- Główne zakładki nadal otwierają widoki zbiorcze.
- Szczegóły przechodzą przez `NavigationProvider` i `RelatedCards`. Identyfikatory
  i rzeczywiste klucze obce wyznaczają odnośniki; historyczne nazwy nie tworzą relacji.
- `Wstecz`, `Dalej` i przyciski powrotu korzystają ze wspólnej historii. Powrót do
  obiektu nadrzędnego wykorzystuje już otwartą kartę, gdy jest w stosie.
- Strefę identyfikuje ogród + ID strefy, a termin serii ID harmonogramu + data
  pierwotna. Reguły generowania wystąpień nie zostały zmienione.
- Nowe adresy: `#todos?todo=…`, `#calendar?todo=…&date=…&view=week`,
  `#dashboard?dialog=menu`, `#materials?dialog=settings`, `#jobs?dialog=new-job`.
  Otwierają istniejący widok, bez wykonywania komendy biznesowej. Nowe parametry
  są walidowane; wcześniejsze adresy, w tym `?client=…#clients`, pozostają.
- Nieaktywne karty są ukryte i `inert`. Filtry, sekcje, rozwinięte miesiące,
  przewinięcie i fokus korzystają z dotychczasowej pamięci prezentacji.
- Niezapisany formularz wymaga potwierdzenia opuszczenia. Oczekujący atomowy zapis
  blokuje przejścia i zamknięcie w aplikacji; przed odświeżeniem przeglądarka
  wyświetla własne ostrzeżenie. Błąd pozostawia szkic do poprawienia/ponowienia.

## Najczęstsze ścieżki

- **Nowa praca:** klient → ogród → istniejący formularz z przypisaniem klienta
  i ogrodu. Z pulpitu formularz otwiera się jednym kliknięciem.
- **Należności:** klient → kwota/historia rozliczeń → rozliczenie → zlecenie.
  Finansowe obliczenia i zatwierdzone kwoty pozostają domenowe.
- **Pielęgnacja:** ogród → strefa → seria → termin/czynność → powiązane zlecenie.
  Powrót zachowuje strefę oraz pierwotną tożsamość przesuniętego terminu.
- **Dokumentacja:** zlecenie → zdjęcie → powiązana notatka lub obiekt → powrót.
  ZIP zachowuje ID zdjęcia; istniejący importer przydziela nowy wewnętrzny
  `assetId`, aby oddzielić odtworzone pliki od punktu odzyskiwania.
- **Kalendarz:** kalendarz → czynność/sprawa → ogród → powrót do wydarzenia
  i kalendarza z tą samą datą, widokiem i filtrami.

## Bezpieczeństwo i granice zmian

Nie zmieniono `domain.ts`, `src/data`, `src/planning`, `src/photos` ani modułów
raportów. Model pozostaje v9; nie ma nowej migracji. IndexedDB, klucz zgodności
localStorage, JSON/ZIP, zdjęcia, raporty i ich numeracja pozostają zgodne.
Obliczenia finansowe, zaokrąglenia, stawki zapisanych zleceń i komendy stopera
nie zostały przebudowane. Ustawienia wywołują dotychczasowe `setRate`.

Nowe pola `Route` są wyłącznie stanem interfejsu w adresie/historii przeglądarki.
Nie trafiają do modelu firmy ani kopii danych. Otwieranie szczegółów jest
sprawdzane przez porównanie całego zapisanego zestawu danych przed i po przejściu.

## Walidacja

Końcowa pełna regresja po poprawkach:

- `npm test`: **462/462 testów jednostkowych**, 18 plików.
- `npm run test:e2e`: **223/223 E2E Chromium** w jednym przebiegu (11,9 min).
- Produkcyjne PWA offline: **13/13**.
- `npx tsc -b --pretty false`, `npm run build` oraz `git diff --check`: zaliczone.
- Osobno obejrzano menu 320 px, formularz przy wysokości 360 px, kartę sprawy
  390 px i historię rozliczeń 1280 px; kontrolki mieszczą się w ekranie.

Pozostają wcześniejsze ostrzeżenia Vite o rozmiarze odroczonego pakietu fontkit
oraz mieszanym statycznym/dynamicznym imporcie `ChecklistPanel`. Build kończy się
poprawnie. Nie pominięto ani nie usunięto testów.

**Rekomendacja: gotowy do przeglądu i scalenia.** Brak znanych błędów blokujących
w sprawdzonym zakresie. PR pozostaje do ręcznego scalenia.

Weryfikacja wykryła także wyścig w starszym teście zakończenia serii: ślad
Playwright pokazał zmianę daty podczas `aria-busy=true`, przed zakończeniem zapisu.
Kontroler prawidłowo zablokował przejście. Test oczekuje teraz na zamknięcie okna
i commit oraz sprawdza faktyczną datę w URL i zapisaną datę zakończenia serii.
Nie zmieniono reguł harmonogramów.

Nowe testy sprawdzają przejścia spraw i kalkulatorów, filtry, głęboki powrót,
odświeżenie, brakujące/usunięte wpisy, błędy i opóźniony commit IndexedDB,
rzeczywiste `beforeunload`, menu, klawiaturę, dotyk oraz ZIP ze zdjęciem i sprawą.

Macierz szerokości: **320, 360, 390, 430, 768 i 1280 px**. Sprawdzane są widoki
zbiorcze, karty, rozliczenia, formularz z materiałami i brak przewijania poziomego.
Zmniejszenie wysokości do 360 px sprawdza przewijanie do przycisku zapisu w warunkach
podobnych do otwartej klawiatury. Osobny kontekst mobilny wykonuje przejścia przez
`tap`, z włączonym `hasTouch`.

## Znane ograniczenia i przyszłe usprawnienia

- Testy dotyczą Chromium, responsywnej przeglądarki i produkcyjnej PWA. Nie
  wykonano testu fizycznej klawiatury Androida, natywnych przycisków systemowych
  ani instalatora Windows. Zmniejszony viewport jest symulacją klawiatury.
- URL wskazuje aktualną kartę, sekcję lub okno. Pełna ścieżka powrotu i filtry
  pochodzą z historii tej przeglądarki. Sam skopiowany URL na innym urządzeniu
  nie przenosi filtrów ani całego stosu; pozostają odnośniki do powiązanych obiektów.
- Pamięć prezentacji ma istniejący limit 400 wpisów, stos 20 kart. Filtry i
  obliczenia nie są kopią danych firmy. Niezapisane szkice nie są odtwarzane po
  wymuszonym zamknięciu procesu; ostrzeżenie przeglądarki nie jest blokadą systemową.
- Edytory istniejących rekordów pozostają lokalnymi, chronionymi formularzami.
  Nie wszystkie mają osobny URL. Nie ma potrzeby przenoszenia szkiców do modelu v9.
- Rośliny i opisane zabiegi pozostają tekstem strefy. Brak rzeczywistego klucza
  obcego oznacza brak odnośnika. Nie wdrożono GM-005, nowych cykli, synchronizacji,
  aplikacji systemowych ani trybu terenowego.
- To przegląd funkcjonalnej nawigacji i wybranych zasad dostępności, nie certyfikacja
  WCAG ani test każdego czytnika ekranu. Szersze testy kontrastu, czytników i realnych
  urządzeń można wykonać osobno.
- Dalsze przenoszenie lokalnych edytorów do adresów, przenoszenie całego kontekstu
  między urządzeniami lub przebudowa stronicowania list wymaga odrębnego zakresu.
  W tym etapie pozostawiono istniejące grupowanie i leniwe wiersze historii.
