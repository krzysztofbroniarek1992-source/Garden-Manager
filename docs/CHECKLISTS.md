# Checklisty i szablony prac — 0.3.5

## Trzy rodzaje danych

- `Data.workTemplates`: szablon usługi z nazwą, opisem, kategorią i uporządkowanymi
  czynnościami. Ma UUID, daty utworzenia i edycji, rewizję i `archivedAt`.
- `Data.checklists`, `kind: plan`: plan przypisany do ogrodu i opcjonalnie strefy.
  Nie jest zleceniem, wydarzeniem kalendarza ani dokumentem rozliczenia.
- `Data.checklists`, `kind: visit`: niezależna lista konkretnej istniejącej wizyty.
  Zlecenie i wizyta korzystają w aplikacji z tego samego modelu `Job`.

Czynności checklisty mają własne UUID, tytuł, status `pending/done/not-applicable`,
uwagę, `completedAt`, `photoId`, historyczną nazwę fotografii, daty utworzenia/edycji
oraz rewizję. Uporządkowana tablica wyznacza kolejność. `templateId`, nazwa i rewizja
źródła dokumentują pochodzenie, ale nie sterują treścią kopii. Opcjonalny
`sourcePlanId` wskazuje plan ogrodu, z którego utworzono listę wizyty.

Szablon i checklista mają limit nazwy/czynności 150 znaków, opisu 5000, kategorii
100; uwaga czynności do 2000 znaków. Szablon zawiera 1–200 czynności, a checklista
0–500. Pustą checklistę można utworzyć, aby uzupełnić ją w terenie.

Cztery przykłady startowe mają stałe ID i są zwykłymi edytowalnymi szablonami.
Migracja dodaje je wyłącznie wtedy, gdy kolekcja szablonów nie istniała.
Usunięcie przykładów lub pozostawienie pustej biblioteki nie uruchamia ponownego
zasiewania danych. Dla migrowanych przykładów techniczna data utworzenia to 0,
co zapewnia deterministyczny odczyt dawnych punktów odzyskiwania; nie są to
historyczne wpisy użytkownika. Własne szablony otrzymują czas faktycznego zapisu.

## Kopie i ochrona przed duplikatami

Zastosowanie szablonu kopiuje treść i nadaje nowe UUID czynnościom. Postęp i daty
wykonania zaczynają się od zera. Edycja lub usunięcie źródła nie zmienia kopii.
Archiwizacja ukrywa szablon z wyboru nowych przypisań. Usunięcie odłącza go od
harmonogramów, zachowując istniejące listy i ich historyczne pochodzenie.

`assignmentKey` zapewnia jedno przypisanie danego szablonu do wizyty. Jest wspólny
dla biblioteki, karty wizyty i rozpoczęcia zadania z kalendarza, także gdy zadanie
wskazuje strefę. Dla planów klucz obejmuje ogród i strefę. Ponowne zastosowanie
otwiera dotychczasową listę. Dla kopii planu do wizyty klucz obejmuje ID planu
i wizyty. Listy tworzone od zera są niezależnymi rekordami.

Skopiowanie planu do wizyty resetuje statusy i daty, zachowuje uwagi oraz istniejące
referencje zdjęć. Nie zmienia planu. Różne szablony lub plany mogą utworzyć kilka
list tej samej wizyty. Usunięcie checklisty wymaga potwierdzenia; późniejsze
jawne zastosowanie źródła może utworzyć nową listę. Samo otwarcie widoku niczego
nie tworzy.

## Kalendarz, stoper i rozliczenia

Opcjonalne `TaskSchedule.checklistTemplateId` wskazuje szablon. Wystąpienia są
nadal wyprowadzane z reguł dat; nie materializujemy przyszłych checklist.
`beginTaskOccurrence` ma dodatkową opcję zastosowania listy. Tylko jawne
„Rozpocznij pracę” tworzy wizytę i uruchamia istniejący stoper, a wybrana checklista
jest dopisywana w tym samym zapisie. Opcję można odznaczyć. Zarchiwizowane źródło
nie jest stosowane automatycznie. Istniejąca wizyta nie jest tworzona ponownie.

Wszystkie pozostałe polecenia checklist są niezależne od czasu i rozliczeń.
Nie wywołują startu, pauzy, wznowienia ani zatrzymania stopera. Nie zmieniają
robocizny, cen materiałów, zatwierdzonych należności i płatności. Ostrzeżenie
w karcie wizyty i na liście zleceń pozwala świadomie zakończyć pracę z niepełną
listą. Jej postęp pozostaje zapisany. Lista z samymi „Nie dotyczy” nie jest
zaległą pracą; pusta lista wymaga jeszcze uzupełnienia.

## Automatyczny zapis i historia

Polecenia w `src/checklists/commands.ts` odczytują aktualny zapis przez GardenStore,
sprawdzają rewizje i zapisują nową rewizję. Duże pola odhaczania i wybór statusu
zapisują się od razu. Pola tekstowe zapisują każdą zmianę; po błędzie przechowują
lokalny szkic i pokazują „Ponów zapis”. Nowe listy/czynności oraz edycja szablonu
mają jawny przycisk zatwierdzenia. Przesuwanie i potwierdzone usuwanie czynności
zapisują się natychmiast. Szkic po błędzie zapisu istnieje w otwartym formularzu;
nie jest kopią zapasową i nie przetrwa zamknięcia strony.

`checklistTombstones` zachowują ID, rodzaj, czas i rewizję usunięcia szablonu lub
listy, bez usuniętej treści. Usunięcie czynności chroni rewizja jej listy. Stabilne
ID, rewizje i daty przygotowują dane do późniejszego adaptera synchronizacji;
nie dodano synchronizacji ani protokołu rozwiązywania konfliktów urządzeń.

Usunięcie strefy, ogrodu lub zlecenia odłącza nieaktualne identyfikatory, zachowując
listę, czynności i historyczne nazwy. Dotychczasowe ograniczenia usuwania obiektów
z płatnościami lub harmonogramami nadal obowiązują. Przeniesienie wizyty aktualizuje
ogród i odłącza strefę poprzedniego ogrodu. Zakładka biblioteki „Checklisty i plany”
umożliwia przegląd oraz edycję zachowanej historii.

## Fotografie i uwagi

Uwagi są tekstem konkretnej czynności. Zdjęcie wskazuje `PhotoMetadata.id` i korzysta
z istniejącej miniatury przez repozytorium fotografii. Checklisty nie tworzą bloba,
miniatury ani base64. Przycisk w karcie wizyty prowadzi do jej istniejącej galerii.
Usunięcie checklisty lub czynności nie usuwa pliku. Usunięcie zdjęcia odłącza ID,
pozostawiając nazwę, uwagę, status i datę wykonania. Przywrócenie ZIP zachowuje ID
fotografii, mimo zmiany technicznych ID plików IndexedDB.

## Migracje i kopie

Format danych to **8**, klucz `garden-manager:v1` pozostaje bez zmian. Migracja
v1–v7 dodaje brakujące kolekcje; nie zastępuje obecnych, wadliwych kolekcji pustymi
listami. Dane wymagane przez format v7 (np. notatki) nadal muszą przejść walidację.
Dokładne źródło v7 jest zapisywane w `garden-manager:backup:v7`, bez nadpisywania
wcześniejszej kopii. Awaria walidacji, zapisu kopii lub localStorage pozostawia
oryginał. Wcześniejsze klucze kopii i wszystkie istniejące dane są zachowane.

Eksport JSON obejmuje nowe kolekcje, postęp, daty wykonania, uwagi i referencje
zdjęć, ale nie zawiera ich plików. Pełny ZIP nadal ma manifest formatu 1 i zawiera
`data.json` w formacie 8 oraz pliki i miniatury. Import obsługuje dane 6, 7 i 8,
sprawdzając najpierw sumę kontrolną oryginału. Stare kopie i punkty odzyskiwania
IndexedDB są uzupełniane deterministycznie o nowe kolekcje. Dotychczasowe limity,
walidacja, potwierdzenie ODTWÓRZ i ochrona przez punkt odzyskiwania pozostają.

## Ograniczenia

Checklisty nie są dziennikiem wszystkich poprzednich wersji czynności. Ostatni stan,
daty, rewizje i źródło są zachowane; usunięta po potwierdzeniu treść nie zostaje
w znaczniku usunięcia. Archiwum dotyczy szablonów, a historia checklist pozostaje
przy wizytach i w bibliotece. Terminy i cykliczność nadal obsługuje moduł kalendarza.
Nowe listy nie tworzą samodzielnie wydarzeń ani zleceń. Procent jest wyliczany
z aktualnych statusów; dla zera czynności podlegających wykonaniu pokazujemy —.
Nie ma logowania, synchronizacji, powiadomień Androida ani nowych funkcji
finansowych, magazynowych lub ewidencji sprzętu.
