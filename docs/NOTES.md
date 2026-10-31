# Notatki i przypomnienia — 0.3.4

## Model i polecenia

`src/desk/model.ts` definiuje notatki, przypomnienia, sprawy i walidację.
`commands.ts` zawiera niezależne od React polecenia używane przez GardenStore.
Formularze i listy korzystają z tego samego repozytorium localStorage co reszta
aplikacji, działają również bez internetu.

- `Data.notes`: stabilny UUID, tytuł do 150 znaków, treść do 10 000 znaków,
  opcjonalna kategoria i priorytet, `createdAt`, `updatedAt`, `revision`,
  `archivedAt`, nullable `clientId`, `gardenId`, `zoneId`, `jobId`, `photoId`.
- Przypomnienie jest jednym obiektem wewnątrz notatki: lokalna data `YYYY-MM-DD`,
  opcjonalna godzina `HH:mm`, status `active/completed/cancelled` i `completedAt`.
  Nie tworzymy osobnej kopii przypomnienia dla pulpitu lub kalendarza.
- `Data.todos`: stabilny UUID, tytuł i opis, te same opcjonalne powiązania,
  priorytet, `dueDate`, `dueTime`, status `open/completed/cancelled`,
  daty utworzenia, edycji i wykonania oraz rewizja.
- `Data.deskTombstones`: identyfikator, rodzaj, rewizja i czas usunięcia.
  Nie przechowuje usuniętej treści. Chroni przed ponownym zapisaniem usuniętego
  wpisu ze starego formularza i przygotowuje model do przyszłej synchronizacji.

Powiązanie ze zleceniem wskazuje istniejący rekord wizyty, ponieważ aplikacja
używa wspólnego modelu zlecenia i wizyty. Wybór ogrodu lub zlecenia ustala jego
rodzica; walidacja odrzuca niezgodne powiązania. Istniejące pola tekstowe notatek
klientów, ogrodów, stref i zleceń pozostają zachowane, bez automatycznego kopiowania.

Każde polecenie odczytuje najnowszy zapis. Edycja/status/usunięcie wymagają
zgodnej rewizji, a zapis po błędzie localStorage pozostawia poprzedni stan.
Zmiana w innej karcie wymaga ponownego otwarcia formularza.

Po usunięciu powiązanego obiektu wpisy pozostają zachowane, a nieaktualny
identyfikator jest odłączany. Historyczne nazwy pozostają czytelne. Przeniesienie
zlecenia aktualizuje klienta i ogród oraz odłącza strefę z poprzedniego ogrodu.
Dotychczasowe ograniczenia usuwania klientów, ogrodów i zleceń nadal obowiązują.

## Kalendarz i terminy

`desk/events.ts` wyprowadza wydarzenia z aktualnych rekordów, bez zapisu nowych
zleceń lub wystąpień. Klucze `reminder:<noteId>` i `todo:<todoId>` pozostają te
same po zmianie daty. Kalendarz używa osobnych przestrzeni identyfikatorów także
dla prac ogrodniczych i zleceń, więc identyczne ID różnych rodzajów nie kolidują.
Przypomnienia i sprawy otwierają własne szczegóły.

Wykonanie i anulowanie pozostawiają wydarzenie z odpowiednim statusem. Notatka
w archiwum zachowuje termin i status, lecz przypomnienie znika z kalendarza i
pulpitu. Przywrócenie notatki pokazuje ten sam termin, który może być już zaległy.
Usunięcie przypomnienia w edycji lub usunięcie notatki usuwa też jego wydarzenie.
Odroczenie ponownie aktywuje przypomnienie na wskazaną datę.

Daty i godziny są lokalnymi terminami, bez przeliczania na UTC. Termin bez godziny
staje się zaległy następnego dnia. Z godziną — po upływie wskazanej minuty.
Przy podróży do innej strefy czasowej wyświetlana godzina pozostaje bez zmian.

## Fotografie

Powiązanie korzysta wyłącznie z `PhotoMetadata.id`; nie tworzy pliku, miniatury
ani base64. Szczegóły odczytują istniejącą miniaturę przez repozytorium zdjęć.
Usunięcie notatki nie usuwa zdjęcia. Usunięcie zdjęcia odłącza ID i pozostawia
historyczną nazwę w notatce. Przywrócenie ZIP zmienia techniczne ID plików,
ale zachowuje ID fotografii i połączenie notatki z fotografią.

## Migracja i kopie

Schemat danych ma numer **7**, klucz pozostaje `garden-manager:v1`. Migracja
v1–v6 dodaje tylko brakujące kolekcje. Obecne, wadliwe kolekcje nie są zastępowane
pustymi tablicami. Walidacja następuje przed zapisem; dokładna kopia źródła v6
trafia do `garden-manager:backup:v6` i nie jest nadpisywana. Błąd zapisu kopii
blokuje migrację i pozostawia oryginał. Dane finansowe, materiały, harmonogramy,
zdjęcia i wskaźnik odtwarzania pozostają zachowane.

JSON zawiera wszystkie dane i metadane, w tym nowe rekordy i znaczniki usunięcia,
ale nie pliki zdjęć. Pełny ZIP zawiera również zdjęcia i miniatury; jego manifest
pozostaje w formacie 1, a `data.json` ma format 7. Import obsługuje dane 6 i 7.
Dla 6 dodaje brakujące kolekcje po sprawdzeniu sumy kontrolnej oryginalnego JSON.
Zachowany wcześniej punkt odzyskiwania IndexedDB jest również uzupełniany o nowe
kolekcje przy odczycie, bez utraty plików. Można go pobrać lub odtworzyć.

Import nadal wymaga zaznaczenia potwierdzenia i wpisania ODTWÓRZ. Podgląd pokazuje
liczby notatek, przypomnień i spraw. Obecny zestaw jest zachowywany w punkcie
odzyskiwania. Obowiązują dotychczasowe limity ZIP (200 MB), rozpakowania (250 MB),
JSON (10 MB) i liczby zdjęć (5000), kontrola sum i zgodności referencji.

## Ograniczenia

Przypomnienia są widoczne wewnątrz otwartej aplikacji; nie działają jako systemowe
powiadomienia ani alarmy w tle. Nie ma synchronizacji, logowania ani integracji
Androida. Stabilne ID, czas edycji, rewizje, znaczniki usunięcia i polecenia poza
React pozwalają później dodać adapter synchronizacji, ale nie stanowią jeszcze
protokołu rozwiązywania konfliktów między urządzeniami.

Jedna notatka ma najwyżej jedno przypomnienie i jedno powiązane zdjęcie.
Sprawy nie mają cykliczności; do cyklicznych prac służy istniejący moduł kalendarza.
Import ZIP zastępuje pełny zestaw po potwierdzeniu, bez scalania rekordów.
Import samego JSON pozostaje niedostępny. Zasady rozliczeń i pomiaru wizyt nie są
zmienione. Żadne polecenie modułu notatek nie tworzy zlecenia ani należności.
