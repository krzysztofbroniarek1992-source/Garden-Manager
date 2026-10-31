# Planowanie 0.3.2

Plan i wykonanie są osobnymi częściami danych. Wygenerowanie daty w kalendarzu
nie zapisuje zlecenia, czasu ani należności. Istniejące rozliczenia pozostają
w `domain.ts`, `GardenStore` i wspólnej karcie zlecenia.

## Model i trwała tożsamość

- `TaskSchedule`: stały identyfikator, zakres klient/ogród/strefa, tytuł, opis,
  data początkowa, opcjonalna końcowa, godzina, częstotliwość, odstęp i miesiące.
  `endedOn` oznacza ostatni dzień zakończonej serii.
- `TaskOccurrence`: zapis powstaje dopiero przy przesunięciu, pominięciu lub
  rozpoczęciu. Zawiera pierwotną datę, faktyczną datę i godzinę, opis, zakres,
  status oraz opcjonalne powiązanie z rzeczywistym zleceniem.
- Identyfikator wystąpienia jest deterministyczny: `task:<zakodowany ID serii>:<pierwotna data>`.
  Przesunięcie nigdy nie zmienia tej tożsamości. Kilka różnych wystąpień może
  wypaść tego samego dnia. Każde ma odrębny identyfikator.
- Rzeczywiste zlecenie ma deterministyczne ID `job:<ID wystąpienia>` i pole
  `taskOccurrenceId`. Wystąpienie przechowuje zwrotne `jobId`.
- `revision` i `updatedAt` na seriach oraz zapisanych wystąpieniach pozwalają
  wykrywać nieaktualną edycję i przygotowują encje do późniejszej synchronizacji.

`planning/dates.ts` liczy cykle na datach kalendarzowych, korzystając z UTC jako
narzędzia arytmetycznego. Nie przelicza godzin przez UTC. Dni pozostają tymi
samymi dniami podczas zmiany strefy lub czasu letniego. Kotwicą miesięcy i lat
jest pierwotna data, a dzień jest ograniczony do ostatniego dnia danego miesiąca.
Sezon jest filtrem miesięcy, nie restartuje rytmu po przerwie zimowej.

`planning/occurrences.ts` generuje wyłącznie zadany zakres i nakłada zapisane
wyjątki. Przy przesunięciu do innego miesiąca znika termin pierwotny, a zapis
pojawia się w nowym miesiącu. Zapisane wyjątki zachowują tożsamość także po
zmianie reguły. Listy zaległości mają limit zapytania; nie materializują całej
wieloletniej serii. Kalendarz pozwala przeglądać dowolny zakres.

## Polecenia i ochrona historii

`planning/commands.ts` przyjmuje aktualny `Data` i zwraca nowy snapshot bez
operacji przeglądarkowych. `GardenStore` odczytuje najnowszy zapis przed poleceniem,
waliduje wynik w repozytorium i publikuje go do React dopiero po udanym zapisie.

Przesunięcie lub pominięcie sprawdza wersję serii i wystąpienia. Edycja serii
sprawdza jej rewizję. Formularz z nieaktualnej karty nie nadpisuje nowszego planu.
Przesunięcie zachowuje datę tożsamości; pominięcie jest zapisem statusu odwołanego,
bez usuwania wpisu. Zakończenie serii jest znacznikiem końca, a przyszłe zapisane
wyjątki są odwoływane. Faktyczna data wcześniejszego przesunięcia rozstrzyga, czy
wyjątek mieści się przed końcem serii. Skrócenie zwykłej daty końcowej również
odwołuje wykraczające poza nią, nierozpoczęte wyjątki.

Edycja opisu i zakresu serii aktualizuje nierozpoczęte wyjątki, zachowując ich
daty i godziny. Odwołane wpisy oraz rzeczywiste zlecenia zachowują historyczny opis.
Usunięta strefa zachowuje swoją nazwę w planie i opisie późniejszej wizyty.
Klient/ogród użyty w planowaniu nie może zostać usunięty z pominięciem historii.

Rozpoczęcie zadania tworzy i uruchamia jedną wizytę w jednym zapisie. Zajęty
stoper blokuje całą operację. Kolejne kliknięcie, również z innej karty, odnajduje
istniejącą wizytę zamiast tworzyć kolejną lub wznawiać zapauzowany pomiar.
W kalendarzu powiązana wizyta zastępuje wirtualne zadanie i korzysta z daty,
godziny i statusu rzeczywistego zlecenia. Edycja daty zlecenia przenosi więc
wydarzenie bez duplikowania go. Zlecenie utworzone z planu jest chronione przed
usunięciem, które odtworzyłoby możliwość powtórnej wizyty.

## Migracja, eksport i przyszła synchronizacja

Format v5 zachowuje wszystkie wcześniejsze pola. Migracja v4 jedynie dodaje
puste kolekcje planowania. v1/v2/v3 przechodzą przez dotychczasowe migracje
z tym samym zachowaniem należności i wizyt. Oryginał jest kopiowany przed
zapisem v5; błąd kopii lub zapisu nie nadpisuje źródła. Kopie nie są zastępowane
przy ponownym uruchomieniu. Eksport używa tego samego wersjonowanego snapshotu.

Przyszły adapter Android może współdzielić model, reguły i polecenia przez granicę
`DataRepository`. Backend powinien zapewnić unikalność ID wystąpienia i powiązanej
wizyty oraz atomowe zatwierdzanie rewizji. Synchronizacja powinna przesyłać reguły,
wyjątki i rzeczywiste wizyty, bez zapisywania wszystkich wirtualnych terminów.
Lokalny zapis nie implementuje rozproszonej transakcji ani synchronizacji wielu
urządzeń. Przy dodaniu serwera potrzebne będą obsługa konfliktów, kolejka zmian
i transakcje po stronie serwera; same znaczniki czasu nie rozstrzygają konfliktów.

W tej wersji nie dodano kont, komunikacji z Supabase, synchronizacji Android,
powiadomień systemowych ani zmian finansowych. Przypomnienia są listami
wewnątrz aplikacji: 5 widocznych pozycji, do 20 po rozwinięciu, nadchodzące
z kolejnych 365 dni oraz najstarsze niewykonane zaległości.
