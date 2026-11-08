# Etap 3 — Nawigacja dokumentacji

Zakres pochodzi z nowego, zatwierdzonego polecenia „Etap 3/6 — Nawigacja dokumentacji”.
To nie jest rekonstrukcja pierwotnego audytu. Podstawa: main `0899b15`, z PR #11–14.

## Stan zastany i zmiany

Karty klientów, ogrodów i zleceń już zawierały galerie, notatki, checklisty oraz historię prac.
PR #12–13 zapewniły wspólny kontroler historii, adresowanie kart i nawigację kalendarza.
Szczegóły dokumentacji nadal korzystały z lokalnych okien i nie miały wspólnego adresu.
Etap 3 podłącza te same komponenty do kontrolera; nie powstają nowe formularze ani dane.

| Miejsce | Przejście |
| --- | --- |
| Klient / ogród / strefa / zlecenie | Dotychczasowe galerie, notatki i checklisty otwierają wspólne karty dokumentacji |
| Zdjęcie | Powrót do źródła, aktywny klient, ogród z galerią, strefa, zlecenie ze zdjęciami, istniejące notatki do zdjęcia |
| Notatka | Powrót, aktywny klient, ogród z notatkami, strefa, zlecenie z notatkami, powiązane zdjęcie |
| Checklista wizyty / plan ogrodu | Powrót, rzeczywiste powiązania, źródłowy plan przez sourcePlanId, zdjęcia czynności przez photoId |
| Zlecenie / podsumowanie wizyty | Historia raportów i przygotowanie raportu w istniejącym komponencie |
| Zapisana wersja raportu | Powrót do historii, klient i ogród zlecenia, podsumowanie właściwej wizyty |
| Pulpit / kalendarz | Istniejące przypomnienie otwiera tę samą kartę notatki |

`documentationLinks` odczytuje wyłącznie istniejące identyfikatory i klucze obce.
Nie wyszukuje obiektów według historycznych nazw. Raport należy do zlecenia, którego
`reports` zawiera jego ID; wersja z innego zlecenia nie może zostać otwarta pod obcym adresem.
Raporty w obecnym modelu dotyczą jednej wizyty. Snapshot publiczny przechowuje historyczne
nazwy, a nie dodatkowe relacje. Nie są one podstawą tworzenia linków.

## Adresy i kontekst

Przykładowe adresy (ID należy zastąpić rzeczywistymi identyfikatorami):

- `/#gardens?garden=garden-1&section=gallery`
- `/#notes?note=note-id`
- `/#gardens?photo=photo-id`
- `/#templates?checklist=checklist-id`
- `/#jobs?report=job-1` — istniejący panel przygotowania i historii raportów
- `/#jobs?report=job-1&reportVersion=report-id` — konkretna zapisana wersja
- `/#jobs?job=job-1&section=summary` — istniejące podsumowanie wizyty

Karty dokumentacji korzystają z tego samego stosu, powrotów, Wstecz/Dalej, ochrony
formularzy, przewijania i fokusu co karty z etapów 1–2. Odświeżenie odtwarza kartę i stos
wpisu historii; bezpośrednie otwarcie nowego adresu odtwarza wskazaną kartę, bez wymyślania
wcześniejszego stosu. Zamknięcie takiej karty prowadzi do jej zakładki zbiorczej.

Filtry notatek, biblioteki checklist i galerii, zakres dat, kolejność, limit oraz wybór
PRZED/PO korzystają z istniejącej pamięci prezentacji `useViewState` i `history.state`.
Nie są dodawane do danych biznesowych ani kopii. Formularze i wybrane pliki nie są
serializowane: odświeżenie z niezapisanym szkicem korzysta z ostrzeżenia przeglądarki.
Ostateczne wymuszenie zamknięcia karty/przeglądarki może odrzucić niezapisany szkic.

Brakująca/usunięta dokumentacja wyświetla informację i pozwala zamknąć kartę. Brakujące
powiązania nie stają się aktywnymi linkami; historyczne opisy pozostają zachowane.

## Bezpieczeństwo

- Model v9, klucz localStorage, transakcje IndexedDB i format JSON/ZIP są bez zmian.
- Nie zmieniają się komendy biznesowe, numeracja raportów, płatności, czas ani harmonogramy.
- Nawigacja jest odczytem. Otworzenie raportu nie generuje PDF, nie zapisuje historii
  i nie nadaje numeru. Zapisana wersja od razu pokazuje snapshot HTML; przygotowanie
  pliku PDF następuje dopiero po wyraźnym kliknięciu istniejącej usługi regeneracji.
- Zapis raportu jest oznaczony jako oczekujący również podczas czekania na blokadę
  współdzieloną z odtwarzaniem zdjęć. Wstecz, zamknięcie i linki nie przerywają zapisu.
- Dodawanie zdjęć i logo jest chronione od przetwarzania pliku do końca zapisu metadanych.
- Formularz notatki ma jawny zakres ochrony. Formularze odroczenia i przypisania szablonu
  zachowują niezapisane dane i oczekują na zatwierdzenie transakcji przed zamknięciem.
- Zdjęcia pozostają w dotychczasowym magazynie IndexedDB. Nowe linki nie kopiują plików.
  Brak pliku na urządzeniu nadal wymaga odtworzenia pełnej kopii ZIP.

## Weryfikacja

Testy `src/documentation/links.test.ts`, `tests/documentation-navigation.spec.ts` oraz
`pwa-tests/documentation-offline.spec.ts` obejmują ID i adresy, kontekst i powroty,
raporty bez skutków biznesowych, restart, brakujące obiekty, notatka–zdjęcie, checklistę
ze źródłowym planem, telefony 360/390/430 px oraz kontrolowane opóźnienie i błąd zapisu.
Test odtworzenia ZIP w `tests/photos.spec.ts` dodatkowo otwiera przywrócone zdjęcie przez
jego adres i prowadzi do ogrodu. Pełna regresja zachowuje testy etapów 1–2, raportów
w wielu kartach, importu/eksportu, rozliczeń, stopera oraz działania offline.

Pełna regresja zakończona 8 listopada 2026 r.:

| Sprawdzenie | Wynik |
| --- | --- |
| `npm test` | **389/389** (15 plików) |
| `npm run test:e2e -- --output=/tmp/garden-doc-e2e-results --reporter=line` | **169/169**, bez ponawiania (8,5 min) |
| PWA na produkcyjnym buildzie: `npx playwright test --config=playwright.pwa.config.ts --output=/tmp/garden-doc-pwa-results --reporter=line` | **10/10** |
| `npx tsc -b --pretty false` | zaliczone |
| `npm run build` | zaliczone, service worker wygenerowany |
| `git diff --check` | zaliczone |

Ponadto dedykowany przebieg dokumentacji i odtwarzania zdjęć ZIP: **13/13**.
Automatyczne testy telefonu obejmują **360, 390 i 430 px**. Dodatkowo obejrzano
zrzuty ekranu szczegółów dokumentacji przy 360 i 1280 px.
Regresja przeglądarkowa korzysta z Chromium, a nie z natywnej aplikacji Android.
Build zgłasza ostrzeżenia Vite o dużym pakiecie biblioteki PDF oraz mieszanym
imporcie statycznym/dynamicznym checklist; nie są to błędy TypeScript ani builda.

**Rekomendacja:** etap gotowy do przeglądu i scalenia na podstawie pełnej regresji.
Scalenie nie jest wykonywane automatycznie.

## Granice etapu

Bez etapów 4–6, Androida, synchronizacji, nowych funkcji biznesowych, nowej bazy zdjęć
ani przebudowy głównych kart. Zadania „Do zrobienia” i edycja samych szablonów pozostają
przy dotychczasowych oknach; zakres obejmuje dokumentację i istniejące notatki/przypomnienia.
