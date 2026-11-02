# Wspólna nawigacja i historia widoków — etap 1

Rozszerzenie o kalendarz i planowanie opisuje [etap 2](CALENDAR_NAVIGATION.md).
Poniższy dokument zachowuje zakres i wyniki etapu 1.

Podstawa: `main`, PR #11, commit `c907898`. Zakres obejmuje istniejące karty
klienta, ogrodu i zlecenia. Nie dodaje połączeń z etapów 2–6.

## Adresy i historia

Jedynym właścicielem stosu kart jest `NavigationProvider`. `RelatedCards` nadal
wyświetla dotychczasowe komponenty z PR #11. Karta klienta otwarta z Klientów
pozostaje widokiem strony; ogród i wizyta zachowują dotychczasowe okna.

Przykładowe adresy (ID należy zastąpić identyfikatorami własnych danych):

- `/#clients?client=client-1`
- `/#gardens?garden=garden-1&section=zones`
- `/#history?job=job-6&section=billing`

Zakładka przed `?` wskazuje widok zbiorczy, z którego otwarto szczegóły.
Obsługiwane sekcje ogrodu: `overview`, `zones`, `jobs`, `plans`, `billing`,
`gallery`, `notes`; zlecenia: `work`, `billing`, `checklists`, `notes`, `photos`.
Przypomnienia, zadania, raport PDF i formularze nie otrzymują w tym etapie
osobnych adresów.

Stare `?client=ID#clients` jest odczytywane i normalizowane bez dodawania
sztucznego kroku historii. Pozostawiony dawny parametr klienta nie wpływa na
inne główne zakładki. Wybranie zakładki otwiera jej listę zbiorczą.

Otwarcie nowej karty dodaje wpis historii. Powrót aplikacji i Wstecz/Dalej
przeglądarki korzystają z tego samego stosu. Otwarcie przodka wraca do jego
wpisu, aktualizując żądaną sekcję. Zmiana sekcji zastępuje bieżący wpis.
Bezpośredni link ma bezpieczny powrót do listy, bez opuszczania aplikacji.
Nieprawidłowy adres i brakujący obiekt mają komunikat oraz powrót.

## Kontekst

Adres odtwarza aktualną kartę i sekcję także w nowej karcie przeglądarki.
`history.state` zachowuje poprzednie karty i niewielki stan prezentacji:
filtry, rozwinięte miesiące, kolejność i limity historii oraz przewinięcie okien.
Stan prezentacji jest ograniczony i walidowany. Fokus jest przywracany, jeśli
element źródłowy nadal istnieje w DOM. Nowy proces/karta bez historii odtwarza
cel z URL; wcześniejszy fokus i niezapisane szkice nie są częścią linku.

Po odtworzeniu zestawu danych cache prezentacji jest czyszczony, a karty
odczytują odtworzone rekordy. Nie dopasowujemy brakujących obiektów po nazwach.

## Niezapisane formularze

Wspólny rejestr chroni zmienione formularze przed zamknięciem, przejściem,
Wstecz/Dalej oraz odświeżeniem lub opuszczeniem dokumentu. Ochrona dotyczy
również formularzy osadzonych i dokumentacji otwieranej z kart. Nieudany zapis
nie wyłącza ochrony. Udany zapis nie wymaga potwierdzania odrzucenia.
Ukryta karta nie blokuje pracy w aktywnym widoku.

Przy cofnięciu przeglądarki najpierw odtwarzany jest bieżący wpis, następnie
pojawia się jedno pytanie. Anulowanie zachowuje formularz i adres. Zgoda
pozwala wykonać pierwotne przejście. Przy odświeżeniu/opuszczeniu strony tekst
i dostępność ostrzeżenia zależą od przeglądarki; szkice nie są automatycznie
zapisywane do danych firmy.

## Bezpieczeństwo danych

Otwarcie sekcji rozliczenia jest odczytem. Nie otwiera samoczynnie korekty ceny.
Dotychczasowa jawna akcja zakończenia pracy zachowuje swój formularz
zatwierdzenia. Istniejące przyciski stopera i zatwierdzania pozostają operacjami
użytkownika, niezależnymi od kontrolera nawigacji.

Brak zmian `Data`, formatu v9, klucza `garden-manager:v1`, IndexedDB,
JSON/ZIP, reguł rozliczeń i silnika harmonogramów. Stan nawigacji nie trafia
do kopii danych biznesowych. Adaptery wejścia do karty z kalendarza i list
przypomnień korzystają ze wspólnego kontrolera; zachowanie samych planów
pozostaje dotychczasowe.

## Weryfikacja

Testy tras: `src/navigation/routes.test.ts`. Historia, linki, formularze,
powroty i telefon 360/390/430 px: `tests/shared-navigation.spec.ts` oraz
dotychczasowe `tests/garden-navigation.spec.ts`. Otwieranie adresów bez sieci:
`pwa-tests/shared-navigation-offline.spec.ts`. Pełna regresja obejmuje istniejące
zlecenia, płatności, stoper, dokumentację, harmonogramy i kopie ZIP.

Wyniki: 341/341 testów jednostkowych, 7/7 PWA offline, TypeScript i build
produkcyjny poprawne. Pełny przebieg E2E zaliczył 126/127 scenariuszy; pozostały
test wymagał wskazania numeru telefonu w karcie klienta zamiast także w ukrytej
liście zbiorczej. Po poprawce ponownie uruchomiono cały moduł płatności: 6/6.
Łącznie zweryfikowano wszystkie 127 scenariuszy. Dwa wieloetapowe scenariusze
płatności mają budżet 60 s; asercje migracji, kwot i trwałości danych zachowano.
Testy przeglądarkowe wykonano w Chromium, również przy 360, 390 i 430 px.
Pozostaje dotychczasowe ostrzeżenie builda o odroczonym pakiecie PDF/fontkit.
