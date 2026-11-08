# GM-006 — Dostępność i blokowanie terminów

## Model i domyślna dostępność

Dostępność dotyczy właściciela firmy i wszystkich ogrodów, niezależnie od filtrów
kalendarza. Opcjonalna kolekcja `Data.availability` zawiera najwyżej jeden wpis
na datę: `date`, `kind`, `from`, `to`, `reason`, `note`, `revision`, `updatedAt`.
Brak kolekcji lub wpisu oznacza brak ograniczeń na dany dzień. Jawny wpis
„Cały dzień dostępny” może zawierać własną notatkę.

Rodzaje ustawień:

- `available`: cały dzień dostępny, zielony pasek;
- `unavailable`: cały dzień niedostępny, czerwony pasek;
- `until`: dostępny od północy do podanej godziny;
- `from`: dostępny od podanej godziny do końca dnia;
- `range`: jeden ciągły przedział między godziną od i do.

Częściowa dostępność ma pomarańczowy pasek. Kolor uzupełnia tekst we wszystkich
widokach miesiąca, tygodnia i dnia. Ustawienie nie zasłania wydarzeń. Opcjonalny
powód (Lombard, Prywatne, Urlop, Inne) i notatka do 500 znaków są wyłącznie
informacją; aplikacja nie tworzy na ich podstawie zleceń ani operacji finansowych.

## Godziny

Dni są lokalnymi datami kalendarzowymi. Godziny mają dokładność do minuty.
Początek przedziału należy do dostępności, koniec już nie: przy dostępności
8:15–20:45 start o 8:15 jest dozwolony, a o 20:45 wywoła ostrzeżenie.
Godzina końcowa musi być późniejsza od początkowej; dostępność do 00:00
zamiast pustego przedziału wymaga wyboru całego dnia niedostępnego.

Nie obsługujemy kilku rozdzielonych przedziałów ani przedziałów przez północ
w jednym wpisie. Dwa kolejne dni można ustawić oddzielnie.

## Ustawianie i zaznaczanie wielu dni

W planie wybranego dnia przycisk „Ustaw dostępność” otwiera wspólną, adresowaną
kartę formularza. Godziny pojawiają się tylko dla wybranego rodzaju ustawienia.
„Usuń ograniczenie dostępności” po potwierdzeniu przywraca domyślną dostępność,
pozostawiając wszystkie zlecenia i historię.

Przycisk „Zaznacz wiele dni” włącza wybór dat. Kliknięcie daty, obszaru dnia
lub wydarzenia zaznacza/odznacza tę datę zamiast otwierać wydarzenie.
Przycisk „Zaznaczono X dni” otwiera jeden formularz operacji masowej. Zaznaczenie
pozostaje przy zmianie miesiąca, powrocie i odświeżeniu. Limit jednej operacji
wynosi 366 dat; zaznaczenie można wyczyścić lub wyłączyć bez zapisu danych.
Po wyłączeniu trybu wydarzenia znów otwierają swoje dotychczasowe karty.

Wybrane dni można zablokować np. z powodem „Lombard”, ustawić dla nich wspólne
godziny albo usunąć ich ograniczenia. Istniejące ustawienia indywidualne są
pokazane na liście dat. Masowe nadpisanie i usuwanie wymagają osobnego
potwierdzenia. Cała operacja zapisuje się w jednej transakcji albo nie zapisuje
żadnego dnia.

## Kolizje i świadomy wyjątek

Formularz nowego zlecenia lub zmiany jego daty/godziny pokazuje ostrzeżenie,
gdy start wypada poza dostępnością. Przed zapisem użytkownik wybiera „Zmień
termin” albo „Zaplanuj mimo wszystko”. Ta zgoda dotyczy konkretnej daty, godziny
i aktualnego ustawienia dostępności. Jeśli inna karta zmieni ograniczenie
podczas oczekiwania na zapis, transakcja ponownie sprawdzi zgodę; nie zatwierdzi
jej na podstawie nieaktualnego stanu.

Model zlecenia przechowuje godzinę rozpoczęcia i rzeczywisty czas pracy,
a nie przewidywany czas trwania. Dlatego kontrolujemy wyłącznie start.
Nie interpretujemy sekund stopera jako długości przyszłej rezerwacji i nie
sprawdzamy konfliktów między samymi zleceniami jako wolnych przedziałów.

Zablokowanie dnia z istniejącą pracą nie usuwa jej i nie zmienia terminu.
Podgląd formularza pokazuje kolizje. Kalendarz oznacza je przy wydarzeniach,
a w planie dnia udostępnia odnośniki do właściwych zleceń i czynności.
Lista kolizji planu dnia obejmuje cały grafik, również poza aktywnym filtrem
ogrodu. Odrębne zdarzenia wizyty i niewykonanego zabiegu mogą wskazywać tę samą
wizytę; są pokazywane jako rzeczywiste, oddzielne elementy planu.

Zakończone zlecenia, wykonane/pominięte czynności, notatki i prywatne przypomnienia
nie są traktowane jako kolidujące przyszłe prace. Edycja opisu zlecenia bez
zmiany terminu nie wymaga ponownego zatwierdzania istniejącej kolizji.
Świadomie zaakceptowany wyjątek nadal jest oznaczony jako kolizja z deklaracją.

## GM-005 i wcześniejsze harmonogramy

Nie zmieniamy silnika wystąpień, interwałów ani zasad wykonania. Automatyczny
zabieg zachowuje swój termin nawet w dniu zablokowanym. Kalendarz i karta czynności
pokazują kolizję; użytkownik może ręcznie przełożyć wykonanie dotychczasowym
formularzem. Przy nowej serii ostrzeżenie odnosi się do pierwszego terminu
wyznaczonego przez istniejący silnik, z uwzględnieniem sezonu.

Przełożenie nie rozpoczyna nowego cyklu. Kolejny termin GM-005 nadal wynika
wyłącznie z jawnie podanej faktycznej daty wykonania. Dostępność nie zatrzymuje
ani nie uruchamia stopera i nie zmienia jawnego rozpoczynania rzeczywistej wizyty.

## Najbliższe dostępne terminy

Kalendarz pokazuje do 7 dni z deklarowaną możliwością pracy, szukając w horyzoncie
60 dni od wybranej daty, najwcześniej od dziś. Pomija całe dni zablokowane oraz
zakończone już okno dostępności dzisiaj. Uwzględnia częściową dostępność.
Przy każdym dniu podaje liczbę istniejących zleceń i planowanych czynności
ze wszystkich ogrodów. Kliknięcie otwiera ten dzień w kalendarzu.

„Cały dzień dostępny” oznacza deklarację, a nie brak innych zleceń. Lista nie
wyznacza wolnych przerw pomiędzy wizytami ani czasu przejazdu.

## Zapis, zgodność i bezpieczeństwo

Pozostaje format **v10**, klucz `garden-manager:v1` i dotychczasowe bazy IndexedDB.
Opcjonalne rozszerzenie nie wymaga migracji, uzupełniania ani nadpisywania
starszych rekordów: samo otwarcie v10 bez dostępności pozostawia dane bez zmian.
Nie jest tworzona dodatkowa kopia migracyjna, ponieważ nie ma operacji migracji.
Istniejące źródła i kopie z wcześniejszych migracji pozostają zachowane.

Każdy zapis korzysta z aktualnego stanu w tej samej atomowej transakcji
IndexedDB co pozostałe operacje aplikacji. Sprawdzamy podpisy wybranych wpisów
przed modyfikacją całej partii. Równoczesne zmiany różnych dat łączą się;
stare potwierdzenie tego samego dnia lub importu jest odrzucane. Błąd/brak
miejsca nie uruchamia zapisu awaryjnego do localStorage i nie usuwa starego
stanu. Formularz zachowuje szkic i zgłasza błąd; w razie konfliktu trzeba
sprawdzić aktualne ustawienia przez ponowne otwarcie formularza.

Walidacja obejmuje daty, unikalność wpisów, rodzaje, godziny, powody, notatkę
i rewizje. JSON oraz pełny ZIP obejmują dostępność. Stare kopie bez tej kolekcji
pozostają obsługiwane; po świadomym odtworzeniu całego takiego zestawu nie ma
ograniczeń dostępności. Podgląd ZIP pokazuje liczbę ustawień dni. Zdjęcia nadal
są plikami w swoim IndexedDB; JSON zawiera jedynie ich metadane, pełną kopią
plików jest ZIP. Do wyświetlania i kontroli dostępności potrzebna jest wersja
GM-006 lub nowsza; starsze wydania v10 nie pokazują tych ustawień.

## Nawigacja, telefon i offline

Karty dostępności korzystają ze wspólnego kontrolera, historii Wstecz/Dalej,
adresu URL i ochrony niezapisanych formularzy. Zapis musi zakończyć się przed
opuszczeniem formularza. Bezpośrednie i masowe adresy są walidowane. Powrót
zachowuje datę, widok, filtry i zaznaczenie. Interfejs działa dotykowo bez
przeciągania palcem i mieści się na 320, 360, 390, 430 oraz 1280 px.

Przeglądanie, zapis, godziny, operacje masowe i wyszukiwanie dni działają offline
po pobraniu PWA. Dane zachowują się po ponownym otwarciu na tym urządzeniu.
Nie dodano synchronizacji, importu grafiku etatowego, integracji z zewnętrznym
kalendarzem ani aplikacji natywnych.
