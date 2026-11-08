# Etap 4 — Nawigacja rozliczeń i finansów

Baza: main `c448673`, po sprawdzeniu, że PR #15 został scalony.
Zakres: wyłącznie połączenie istniejących rozliczeń, wpłat i raportów z kartami.

## Analiza i wykorzystane komponenty

W kartach klientów już istniały `clientSummary`, filtry historii oraz `GroupedJobHistory`.
Karta ogrodu miała sekcję Rozliczenia z `gardenSummary` i tą samą historią miesięczną.
Rozliczenie, korekta ceny oraz dodawanie/edycja/usuwanie płatności znajdowały się w
`JobDetails`, `BillingEditor` i `TimeCorrection`. PR #15 nadał adresy raportom.
Brakowało przejścia od łącznej kwoty do jej składników oraz adresowanych szczegółów wpłaty.

Etap 4 dodaje odczytowy, adresowany zakres historii klienta lub ogrodu. Historia nadal
korzysta z `GroupedJobHistory`, tych samych zleceń i domenowych funkcji finansowych.
Nie powstaje druga baza ani niezależny mechanizm historii. Dotychczasową tabelę wpłat
wydzielono do `PaymentHistory`; karta zlecenia zachowuje jej oryginalne formularze,
walidację, potwierdzenia oraz komendy. Ta sama tabela służy jako odczyt wpłat w historii.
Komponent kafelka `Metric` pochodzi z dotychczasowej karty klienta.

## Przejścia

| Źródło | Cel |
| --- | --- |
| Karta klienta / jego wskaźniki | Wszystkie rozliczenia, zatwierdzone wykonane prace, wpłaty lub składniki salda |
| Ogród → Rozliczenia | Historia i wskaźniki wyłącznie tego ogrodu, zlecenia, wpłaty i raporty |
| Historia klienta/ogrodu | Zlecenie, jego rozliczenie, historia wpłat, konkretna wpłata, panel raportów |
| Wpłata | Klient, jego wpłaty, ogród z rozliczeniami, właściwe rozliczenie i historia wpłat zlecenia, raporty |
| Zlecenie | Adresowana sekcja Płatności i istniejące rozliczenie, klient, ogród oraz raporty |
| Raport lub jego zapisana wersja | Rozliczenie zlecenia będącego właścicielem raportu |

Wszystkie przejścia wykorzystują kontroler z etapów 1–3. Nie generują dokumentu, numeru,
wpłaty ani należności. Powroty i Wstecz/Dalej zachowują ten sam stos kart.

## Adresy i kontekst

- `/#clients?finance=client-1&owner=client&financeFilter=outstanding`
- `/#gardens?finance=garden-1&owner=garden&financeFilter=received`
- `/#jobs?payment=payment-id`
- `/#jobs?job=job-1&section=payments`
- Dotychczasowe `section=billing` dla ogrodu i zlecenia oraz adresy raportów pozostają zgodne.

`owner` rozróżnia ID klienta i ogrodu; nieprawidłowy zakres/filtr nie otwiera obcego obiektu.
Zakres jest zapisany w URL; pozostałe filtry, wyszukiwanie, kolejność, miesiące, rozwinięte
wpłaty i limit korzystają z istniejącego `history.state`/`useViewState`.
Odświeżenie i bezpośredni adres odtwarzają właściwy widok. Brakujące obiekty pokazują
komunikat oraz możliwość powrotu. Nawigacja uwzględnia dotychczasowe przewijanie i fokus.

Kliknięcie łącznej kwoty wyjaśnia pełny zakres i usuwa wcześniejsze filtry wyszukiwania
historii (dopiero po akceptacji istniejącej ochrony formularzy). Zwykły powrót zachowuje
filtry i rozwinięcia. Obsługiwany jest również powrót do karty pozostającej w stosie.

## Znaczenie kwot i ochrona reguł

- Wartość wykonanych prac: wyłącznie zakończone, zatwierdzone zlecenia — `clientSummary`.
- Otrzymane płatności: rzeczywiste wpłaty, także zaliczki — `paidCents` z tej samej domeny.
- Pozostałe należności: `remainingCents` zakończonych, zatwierdzonych zleceń.
- Prace przed zatwierdzeniem są oznaczone jako orientacyjne i nie zwiększają salda.
- Zaliczka za inną planowaną pracę nie spłaca należności za zakończone zlecenie.
- Kwoty miesiąca i podsumowania ogrodu pochodzą z `groupJobHistory`/`gardenSummary`.
- Grupowanie i filtr dat dotyczą dnia pracy. Każda wpłata pokazuje własną datę otrzymania.

Wskaźniki obejmują cały wskazany zakres, a filtry dotyczą listy poniżej. Przykład testowy:
1500 zł zatwierdzonych prac, 850 zł wpłat (w tym 100 zł zaliczki za planowaną pracę),
750 zł pozostałej należności wynikającej z konkretnego częściowo opłaconego zlecenia.
Nie zastępujemy tych reguł prostym odejmowaniem łącznych wpływów od wartości prac.

Pliki domeny, magazynu i komend biznesowych pozostają bez zmian. Zachowane są zasady
stawek, ryczałtu, czasu, materiałów, zatwierdzonych wycen i płatności istniejącej wersji.
Nie są wprowadzane brakujące rodzaje umów, rabatów ani nowe operacje finansowe.

## Model i bezpieczeństwo

Model v9 wymaga `Payment.jobId` i waliduje istnienie zlecenia. Nie obsługuje samodzielnej
wpłaty klienta bez zlecenia. Nie rozszerzamy schematu: taki rekord jest odrzucany przy
walidacji importu, a projekcja brakującego powiązania nie zgaduje klienta ani ogrodu.
Szczegóły płatności są odczytem; edycja pozostaje w istniejącym formularzu zlecenia.

Atomowy IndexedDB, kopia zgodności localStorage, JSON/ZIP, pliki zdjęć, numeracja raportów,
stoper, kalendarz i harmonogramy nie zmieniają się. Nowe dane widoków nie trafiają do
modelu biznesowego ani kopii. Chronione formularze i globalny stan oczekującego zapisu
blokują nawigację podczas transakcji; wymuszone zamknięcie przeglądarki nadal może odrzucić
niezapisany szkic. Nie wprowadzono jego automatycznego zapisywania.

## Wydajność i testy

Wspólna historia montuje tylko rozwinięte miesiące i po 50 wierszy. Wpłaty są grupowane
raz na zmianę danych, odczytywane po rozwinięciu i również pokazywane po 50. Test obejmuje
274 zlecenia klienta, zwinięty starszy rok oraz przywrócenie limitu po odświeżeniu.

`src/finance/model.test.ts` sprawdza zakresy, znaczenie kwot, pełne/niepełne wpłaty,
zaliczki, nieobsługiwane powiązania, poprawność adresów i brak mutacji danych.
`tests/finance-navigation.spec.ts` obejmuje cały łańcuch nawigacji, stary kontekst,
Wstecz/Dalej, restart, brakujące obiekty, ochronę szkiców i transakcję zatrzymaną
kontrolowaną barierą IndexedDB, JSON oraz odtworzenie ZIP ze zdjęciem i raportem.
`pwa-tests/finance-offline.spec.ts` sprawdza te widoki offline i jawny zapis wpłaty
bez zmiany zatwierdzonej należności. Testy telefonów obejmują 360, 390 i 430 px.

Pełna regresja zakończona 8 listopada 2026 r.:

| Sprawdzenie | Wynik |
| --- | --- |
| `npm test` | **413/413**, 16 plików |
| `npm run test:e2e -- --output=/tmp/garden-finance-e2e-complete-results --reporter=line` | **185/185**, pełny końcowy przebieg, bez ponawiania testów (10,1 min) |
| PWA na produkcyjnym buildzie: `npx playwright test --config=playwright.pwa.config.ts --output=/tmp/garden-finance-pwa-verified-results --reporter=line` | **11/11** |
| `npx tsc -b --pretty false` | zaliczone |
| `npm run build` | zaliczone, service worker wygenerowany |
| `git diff --check` | zaliczone |

Kontrolny przebieg galerii, podsumowania i nawigacji podczas zapisu wpłaty:
**9/9** (3 scenariusze po 3 powtórzenia). Ustabilizowano istniejący helper zamykania
okien: czeka na zapis, klika konkretny modal i uwzględnia pojawiające się lub znikające
okna. Nie zmienia to aplikacji ani reguł finansowych. Osobna asercja testu galerii
czeka na zakończenie edycji zdjęcia przed dalszą nawigacją.

Testy automatyczne obejmują **360, 390 i 430 px**, a widoki historii, podsumowań
i płatności dodatkowo obejrzano przy 360 i 1280 px. Potwierdzono obszar dotyku 44 px
nowych linków kwot na telefonie. Build zgłasza nieblokujące ostrzeżenia Vite dotyczące
wielkości biblioteki PDF i mieszanego importu checklist.

**Rekomendacja:** etap gotowy do przeglądu i scalenia. Pełna końcowa regresja jest
zielona; nie stwierdzono błędów blokujących. Scalenie nie jest wykonywane automatycznie.

## Ograniczenia i ryzyka

- Automatyczna regresja przeglądarkowa korzysta z Chromium.
- Bezpieczne wyjaśnienie kwoty wymaga istniejących ID; nie ma dopasowywania nazw/opisów.
- Brak ogólnych płatności klienta w v9 jest ograniczeniem istniejącego modelu, a nie
  nowym rodzajem płatności do zaimplementowania w tym etapie.
- Widok historii jest grupowany według pracy, nie tworzy księgowej ewidencji okresów wpłat.
- Główne ryzyko UI to utrata filtrów lub przypadkowe otwarcie formularza; scenariusze
  regresyjne sprawdzają kontekst, brak zapisów przy nawigacji i ochronę szkiców.

Bez etapów 5–6, nowych harmonogramów, platform natywnych i synchronizacji.
