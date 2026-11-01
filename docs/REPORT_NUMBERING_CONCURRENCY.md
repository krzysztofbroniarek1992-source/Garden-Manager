# Weryfikacja numeracji PDF przed scaleniem PR #13

## Wniosek i rekomendacja

To rzeczywisty błąd współbieżnego zapisu, istniejący przed PR #13. Test E2E
ujawnił poprawnie naruszenie unikalności numerów dwóch różnych wizyt. Zwykłe
powtórzenie testu może przejść, ponieważ trafienie w wyścig zależy od kolejności
zdarzeń przeglądarki.

**Rekomendacja: wstrzymać scalenie PR #13 do osobnej naprawy zapisu raportów.**
Zmiany nawigacji nie są źródłem błędu, ale potwierdzono również utratę wpisu
raportu w historii. Nie należy uznawać udanych ponowień E2E za usunięcie problemu.
PR #13 pozostaje otwarty; nie zmieniono kodu aplikacji, schematu danych,
rozliczeń ani stopera w ramach tej weryfikacji.

## Jak działa obecny mechanizm

1. `ReportService.prepare()` odczytuje stan i wylicza numer podglądu jako
   `BO/rok/(reportSequence + 1)`. Nowa wersja raportu tej samej wizyty zachowuje
   numer, co jest prawidłowym zachowaniem. Podgląd nie rezerwuje numeru.
2. `ReportService.save()` używa wyłącznej blokady Web Locks
   `garden-manager-photos`, wspólnej z fotografiami i odtwarzaniem kopii.
3. `GardenStore.commit()` wykonuje odczyt przez `LocalRepository.load()`,
   sprawdzenie `reportSourceSignature()` i zapis **całego** stanu JSON.
4. `saveVisitReport()` porównuje licznik, historię i migawkę ze stanem podglądu.
   Przy aktualnym odczycie drugi podgląd powinien zostać odrzucony.
5. Po przyjęciu zapisu `ReportPanel` udostępnia PDF do pobrania.

## Przyczyna i zaobserwowany przebieg

W badanym Chromium 154 drugi dokument może odczytać starszy stan `localStorage`
również po przejęciu zwolnionej blokady. Web Locks szereguje wywołania, ale sam
nie zapewnia transakcyjnego odczytu i zapisu stanu przechowywanego w innym API.
Odczyt nadal zawiera licznik `0`, więc walidacja nie wykrywa konfliktu. Drugi
zapis zastępuje stan zawierający pierwszy raport.

Przykład z diagnostyki PR #13, dwóch różnych zleceń `job-1` i `job-2`:

| Punkt pomiaru | Odczytany licznik | Zapis |
| --- | --- | --- |
| Oba podglądy | 0 | numer `BO/2026/000001`, wersja 1, oba nowe |
| A: odczyt w komendzie zapisu | 0 | — |
| A: wywołanie zapisu | — | licznik 1, raport `job-1` |
| B: odczyt w komendzie zapisu | 0 | — |
| B: wywołanie zapisu | — | licznik 1, raport `job-2` |
| Odczyt końcowy obu kart | 1 | tylko raport `job-2` |

Oba `save()` zakończyły się sukcesem. Kolejka dwóch żądań blokady była sprawdzona
przed jej zwolnieniem. Nie chodzi o dwa dozwolone pobrania wersji tego samego
raportu: podglądy dotyczyły dwóch różnych zleceń, a `reused` było `false`.

Potwierdzone ryzyko obejmuje dwa dokumenty o tym samym numerze oraz brak jednego
raportu w zapisanej historii. W próbie nie wykonywano operacji finansowych.
Sam przyrost licznika o jeden nie dowodzi poprawności — musi pozostać również
właściwa historia i jawne odrzucenie nieaktualnego zapisu.

## Porównanie z main

Punkty porównania: main `5b06761` i PR #13 `bd4d28b`. Pliki
`reports/service.ts`, `reports/commands.ts`, `reports/model.ts`, `data/store.ts`
oraz `data/repository.ts` są identyczne w obu wersjach. Plik usługi numerowania
jest niezmieniony od commitu `2418a2d`, wprowadzającego raporty 0.3.6.

Diagnostyka importuje te same rzeczywiste klasy z serwowanego kodu. Nie montuje
Reacta, kontrolera nawigacji ani kart z PR #13. Zastąpiony jest wyłącznie encoder
bajtów PDF; numerowanie, walidacja, odczyt i zapis oraz Web Locks pozostają
rzeczywiste. Błąd odtworzono bez działania nowej nawigacji:

| Serwowany kod | Próby | Prawidłowy konflikt | Dwa przyjęte zapisy z tym samym numerem |
| --- | ---: | ---: | ---: |
| PR #13 `bd4d28b` | 30 | 14 | 16 |
| main `5b06761` | 30 | 20 | 10 |

Te liczby dowodzą odtworzenia błędu w obu wersjach; nie są pomiarem zmiany jego
częstotliwości. Nie ma podstaw do przypisania przyczyny zmianom PR #13.

## Odtworzenie

Uruchom serwer wybranej wersji przez `npm run dev` na dotychczasowym porcie 5173.
W drugim terminalu, z checkoutu zawierającego skrypt:

```sh
node scripts/diagnose-report-concurrency.mjs 30 pr13
```

Skrypt tworzy świeży kontekst przeglądarki i dane demonstracyjne. Nie korzysta
z profilu użytkownika. Obydwa podglądy są przygotowane przed zapisem; żądania
zapisu czekają za wspólną blokadą i są następnie zwalniane. Oczekiwanie na reset
fixture dotyczy wyłącznie przygotowania kolejnej próby. Nie dodano opóźnienia
między zapisami aplikacji ani nie wyłączono Web Locks.

Wykryte naruszenie kontraktu zapisu kończy się kodem wyjścia **1**. JSON ze śladem odczytów,
zapisów, identyfikatorów i odczytów końcowych trafia do katalogu tymczasowego
systemu; ścieżkę wypisuje podsumowanie. Diagnostyka wymaga środowiska Vite
i przeglądarki Playwright; `CHROMIUM_PATH` pozwala wskazać własny Chromium.
Nie jest dołączona jako automatycznie pomijany test ani jako test oczekujący
błędnego działania. Obecny E2E z asercjami unikalności pozostaje bez zmian.

Test jednostkowy korzysta ze wspólnego `MemoryStorage` i kolejki w jednym
procesie. Nie modeluje opóźnienia widoczności stanu między dokumentami. E2E
przez interfejs nie synchronizuje obu żądań na granicy blokady, dlatego kilka
udanych powtórzeń nie wyklucza wyścigu.

## Rekomendowane osobne zadanie

**Atomowy zapis numeru i historii raportu między kartami.** Trzeba wybrać trwałe,
transakcyjne źródło numeracji i historii, np. pojedynczą transakcję IndexedDB,
oraz uzgodnić je z pozostałymi zapisami całego stanu i importem kopii.
Zmiana dotknie granicy repozytorium i obsługi komend, więc wykracza poza drobną
poprawkę nawigacji. Sama osobna rezerwacja numeru nie zabezpieczy historii przed
nadpisaniem. Nie należy naprawiać tego przez `sleep`, zwiększenie timeoutu,
ponowne pobranie PDF ani automatyczne przenumerowanie istniejących dokumentów.

Warunki odbioru osobnego zadania:

- Dwa jednoczesne zapisy różnych nowych raportów dają jeden sukces i jeden
  jawny konflikt albo dwa różne, atomowo zarezerwowane numery; oba zachowane
  wpisy muszą odpowiadać faktycznie udostępnionym dokumentom.
- Ponowne przygotowanie odrzuconego raportu daje kolejny numer. Powtórzenie
  tego samego zapisu pozostaje idempotentne; kolejne wersje jednej wizyty
  zachowują jej numer i dotychczasową historię.
- Test z barierą dwóch kart sprawdza także oba trwałe wpisy po odświeżeniu,
  nie tylko pobrania i licznik. Osobno należy sprawdzić import, błędy zapisu,
  offline oraz środowisko bez Web Locks: obecna kolejka modułowa działa tylko
  w jednym dokumencie.
- Istniejące numery i UUID pozostają zachowane. Ewentualna zmiana warstwy
  przechowywania wymaga osobnego planu migracji, odzyskiwania i zgodności kopii.

Nie rozpoczęto etapu 3 nawigacji ani implementacji tego osobnego zadania.

## Powtórzone kontrole PR #13

- `npm run test -- --reporter=dot`: **357/357**, 12 plików.
- `npx playwright test tests/reports.spec.ts tests/calendar-navigation.spec.ts
  tests/shared-navigation.spec.ts`: **45/45**, także 360/390/430 px.
- `npx tsc -b --pretty false`: poprawny.
- `npm run test:pwa -- --reporter=line`: świeży build produkcyjny oraz **8/8**
  PWA offline. Pozostaje wcześniejsze ostrzeżenie o pakiecie PDF/fontkit.
- `node --check scripts/diagnose-report-concurrency.mjs` oraz `git diff --check`:
  poprawne.
- Kontrolowana próba zapisu: **nadal błędna** — oba przebiegi po 30 prób
  zakończyły się kodem 1, z wynikami opisanymi w tabeli porównania. Udane
  kontrole UI i offline nie usuwają tego wyniku.

Poprzedni pełny przebieg pozostaje wynikiem 141/142, nie powtarzano wszystkich
142 scenariuszy w tej weryfikacji. Nie osłabiono ani nie pominięto jego asercji.
