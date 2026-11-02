# Etap 2 — nawigacja kalendarza i harmonogramów

Podstawa: scalony etap 1, PR #12 oraz main `68e91a4` ze scalonym PR #14.
Zmiana rozwija ten sam
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

Format pozostaje v9, z kompatybilnymi kopiami JSON/ZIP. Wspólnym źródłem
zapisu jest transakcyjne IndexedDB z PR #14; `garden-manager:v1` pozostaje
kopią zgodności w localStorage. Baza plików zdjęć pozostaje bez zmian.
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

## Integracja z atomowym zapisem PR #14

Wszystkie zmienione operacje oczekują na asynchroniczną komendę istniejącego
store. Dotyczy to dodania zlecenia z kalendarza, rozpoczęcia rzeczywistej pracy,
przesunięcia i pominięcia terminu oraz kończenia serii w obu istniejących widokach.
Identyfikator zlecenia trafia do nawigacji dopiero po zakończeniu transakcji.
Nie ma nowego źródła danych, odczytów localStorage do zapisu ani zmiany reguł
biznesowych. Pliki modelu, komend planowania, rozliczeń, stopera i numerowania
raportów pozostają takie jak na main po PR #14.

Formularze używają asynchronicznego `guard.save`: zamknięcie następuje po zapisie,
a błąd przywraca ochronę szkicu. W trakcie zapisu wspólna ochrona z PR #14
blokuje zmianę karty i przywraca adres po próbie Wstecz. Formularz pozostaje
widoczny, z zachowaną treścią. Szczegóły czynności pokazują trwający zapis
oraz blokują ponowne wysłanie tej samej operacji. Zachowano strukturę historii i parametry kalendarza. Inicjalizacja kontrolera
ponownie odczytuje bieżący URL przed jego kanonizacją: zmiana adresu pomiędzy
pierwszym renderem a efektem nie może zostać zastąpiona starszą trasą pulpitu
ani domyślną datą kalendarza. Do czasu inicjalizacji starszy efekt widoku nie
może nadpisać nowszego adresu zewnętrznego.

`tests/calendar-atomic-navigation.spec.ts` używa bariery z prawdziwych żądań
IndexedDB, bez opierania kolejności na opóźnieniu. Pięć scenariuszy sprawdza
Wstecz i Zamknij w trakcie przesunięcia, błąd zapisu i ponowienie z zachowaniem
szkicu, otwieranie zlecenia po rozpoczęciu, nowe zlecenie z kalendarza oraz
zakończenie serii. Asercje obejmują brak duplikatów, właściwy termin pierwotny,
powrót do dnia i widoku, odświeżenie i brak ubocznych zmian finansowych.

Testy kalendarza odczytują kopię dopiero po potwierdzeniu zapisu. Testy przygotowujące
nową instalację przed migracją jawnie resetują bazę testową; nie traktują
podmiany localStorage po migracji jako komendy aplikacji.

Historyczna diagnoza błędu numerów PDF pozostaje w
[REPORT_NUMBERING_CONCURRENCY.md](REPORT_NUMBERING_CONCURRENCY.md). Błąd naprawiono
w osobnym PR #14, a jego deterministyczne testy są częścią regresji tego PR-a.
Granice gwarancji, zamykanie starych kart przy aktualizacji i wymagania odtwarzania
plików zdjęć nadal opisuje [ATOMIC_PERSISTENCE.md](ATOMIC_PERSISTENCE.md).

`tests/navigation-bootstrap.spec.ts` używa obserwatora pierwszego montowania DOM,
aby zmienić hash przed efektem inicjalizacji nawigacji. Obie kontrolowane próby
przed poprawką gubiły adres; test sprawdza zachowanie daty, widoku, filtrów oraz
niezmienione dane po poprawce. Nie opiera się na losowym opóźnieniu.

Podczas końcowej regresji po integracji ujawniono jeszcze zanik komunikatu
błędnego adresu po kanonizacji URL i ponowieniu efektu inicjalizacji. Stan błędu
jest teraz zachowywany dla adresu kanonizowanego przez kontroler, a nowy adres
zewnętrzny może go zastąpić. Test inicjalizacji obejmuje także przejście z błędnego
adresu do poprawnego kalendarza; istniejąca regresja sprawdza przycisk „Pokaż listę”.
