# Etap 2 — nawigacja kalendarza i harmonogramów

Podstawa: scalony etap 1, PR #12, main `5b06761`. Zmiana rozwija ten sam
NavigationProvider i istniejące formularze, kalendarz oraz modele planowania.
Nie dodaje kolekcji biznesowych ani funkcji etapów 3–6.

## Przejścia

- Karta ogrodu, sekcja harmonogramu: otwarcie konkretnej serii albo jej terminu
  w kalendarzu. Po zamknięciu terminu pozostaje kalendarz; jego przycisk powrotu
  odtwarza kartę ogrodu i wcześniej wybraną sekcję.
- Szczegóły serii używają ScheduleManager/TaskForm do dotychczasowej edycji
  i zakończenia serii. Pokazują terminy oraz rzeczywiste, powiązane zlecenia.
- Planowana czynność prowadzi do klienta, ogrodu, konkretnej strefy, serii
  i właściwej daty kalendarza. Odłączona strefa pozostaje informacją historyczną.
- Czynność → rzeczywiste zlecenie → czynność → kalendarz zachowuje kolejne poziomy
  wspólnej historii. Zamknięcie zlecenia nie zamyka szczegółów czynności.
- Zlecenie z harmonogramu prowadzi do pierwotnego wystąpienia i serii.
- Pulpit ma oddzielne przyciski otwarcia zlecenia i wyboru do stopera. Obie
  operacje są neutralne dla danych. Przypomnienia o pracach otwierają czynność
  lub istniejące zlecenie przez ten sam kontroler.

## Adresy i kontekst

Przykłady z identyfikatorami zastępczymi:

- `/#calendar?date=2026-11-03&view=week&gardenFilter=garden-1`
- `/#calendar?schedule=series-1&date=2026-11-03&view=week`
- `/#calendar?task=series-1&original=2026-10-31&date=2026-11-03&view=week`
- `/#calendar?garden=garden-1&section=zones&zone=zone-1&date=2026-11-03&view=week`

`task` oznacza ID harmonogramu, a `original` — pierwotną datę wystąpienia.
Przesunięcie daty nie zmienia jego tożsamości. `date` jest datą wybraną
w kalendarzu; `anchor` zachowuje osobno pokazywany okres, gdy różni się od dnia.
`view` przyjmuje `month`, `week`, `day`. Filtry wydarzeń to `gardenFilter`,
`kindFilter` (zlecenie/praca/przypomnienie/sprawa) oraz `statusFilter`.
Filtry dotyczą siatki i agendy; zbiorcze sekcje zarządzania pozostają dostępne.

Zmiany kontrolek kalendarza aktualizują bieżący wpis historii. Otwarcie
szczegółów dodaje krok. Wstecz/Dalej i przyciski powrotu używają wspólnej
historii z etapu 1. W przypadku przejścia z ogrodu do kalendarza tworzony jest
osobny krok widoku kalendarza, a następnie czynności — dlatego powrót działa
w obu kierunkach bez pomijania poziomu.

URL odtwarza datę, okres, filtry i aktualne szczegóły po odświeżeniu lub otwarciu
linku. Historia sesji zachowuje poprzednie karty, stan list oraz fokus wydarzenia.
Wejście do kalendarza bez parametrów zapisuje dzisiejszy dzień i domyślny widok
w bieżącym adresie, aby powrót po zmianie dnia nadal odtwarzał wybraną datę.
Otworzenie linku w nowej karcie odtwarza jego cel i zapewnia bezpieczny powrót
na widok zbiorczy, bez odtwarzania wcześniejszej sesji innej karty.
Nieprawidłowe adresy i brakujące rekordy mają bezpieczny komunikat.

## Granice odczytu i operacji

`navigation/planning-links.ts` wyłącznie odczytuje dotychczasową projekcję
wystąpień z `planning/occurrences.ts`. Lista terminów i przyciski nie zapisują
wirtualnych wystąpień, nie tworzą zleceń i nie uruchamiają stopera.

Istniejąca akcja „Rozpocznij pracę” nadal jawnie wywołuje ten sam
beginTaskOccurrence. Nawigacja do już powiązanego zlecenia otwiera je bez
powtórnego rozpoczynania. Wyjątki, pominięcia, reguły powtarzania, zatwierdzone
kwoty, płatności i czas pracy zachowują dotychczasową logikę. Zmienione formularze
wyjątków korzystają z ochrony niezapisanych zmian z etapu 1.

Format pozostaje v9, z tym samym localStorage, IndexedDB oraz JSON/ZIP.
Stan nawigacji jest odrębny od danych firmy. Nie dodano automatycznych cykli
zabiegów liczonych od rzeczywistego wykonania ani synchronizacji.

## Zakres podglądu i testy

Podgląd serii pokazuje do 24 terminów w ciągu 12 miesięcy od wybranego dnia;
można zmienić dzień. Powiązane zlecenia mają porcjowanie po 20. Przycisk ogrodu
wybiera istniejący niewykonany termin z najbliższych 12 miesięcy; przy jego braku
udostępnia zachowany termin historyczny lub początek serii, jeśli istnieje.
Reguła harmonogramu nie jest przez to zmieniana.

Testy jednostkowe tras i projekcji: `src/navigation/*.test.ts`. Nowe E2E:
`tests/calendar-navigation.spec.ts`; regresja planowania: `tests/planning.spec.ts`.
PWA: `pwa-tests/calendar-navigation-offline.spec.ts`. Scenariusze obejmują
przesunięcia, pominięcia, powroty, nowe linki, odświeżenie, ochronę szkiców,
brak duplikatów i zapisów biznesowych oraz telefony 360/390/430 px.

## Wyniki walidacji i znane ograniczenie regresji

- Testy jednostkowe: 357/357 (12 plików).
- TypeScript: `npx tsc -b --pretty false` zakończony poprawnie.
- Produkcyjny build i 8/8 testów PWA offline: `npm run test:pwa -- --reporter=line`.
  Cache obejmuje 20 zasobów. Pozostaje wcześniejsze ostrzeżenie o wielkości
  odroczonego pakietu PDF/fontkit (około 717 kB).
- E2E: 141/142 w pełnym przebiegu; wszystkie 15 nowych scenariuszy nawigacji
  przeszło, w tym telefony 360/390/430 px.
- Jedyny błąd pełnego przebiegu dotyczył istniejącego testu równoległego zapisu
  raportów PDF: dwie karty pobrały raporty z tym samym numerem. Ponowienie tego
  scenariusza dało 6/6 zaliczeń na gałęzi etapu 2 oraz 6/6 na niezmienionym
  main `5b06761`, przy tych samych asercjach. Przyczyna niestabilności pozostaje
  niewyjaśniona; nie potwierdzono związku ze zmianami nawigacji. Ryzyko dotyczy
  równoległego generowania raportów, które wymaga osobnej diagnozy.

Nie zmieniano kodu raportów ani zapisu danych w celu usunięcia tej niestabilności.
Dłuższe scenariusze migracji i generowania PDF w dwóch kartach mają limit 60 s;
zachowano asercje unikalności numerów i odrzucania nieaktualnego podglądu.
