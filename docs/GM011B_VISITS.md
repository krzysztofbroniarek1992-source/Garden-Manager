# GM-011B — 5c1: wizyty, czas i niezmienne rozliczenia

PR #29 pozostaje Draft. To wewnętrzny odbiorca z jawnym planem i zatwierdzeniem,
bez natywnej wymiany biznesowej i bez pełnego GUI. Testy wykorzystują tylko syntetyczne dane.

## Podział 5c

5c1 obejmuje przyczynowe przejścia pełnej jednostki visits (job + payments +
reportIdentities), z zachowaniem lokalnych raportów. 5c2 pozostaje oddzielnym
punktem: raporty, bezpieczna numeracja offline, tożsamości dokumentów wymagających
lokalnych plików oraz świadome decyzje chroniące obie historie finansowe/czasowe.
**Nie ukończono pełnego 5c ani GM-011B.**

## Zapis i zakres

Biznesowy v12 i techniczny IndexedDB v2 pozostają bez zmian. Odbiór nie zapisuje
Data. Plan symuluje całą oryginalną operację; jawny apply zapisuje Data + journal +
receiver + checkpointy w jednej transakcji. Potwierdzenie dopiero po oncomplete.
Nie są generowane lokalne UUID, nowe pomiary lub komendy start/stop przy odbiorze.

Można przyjmować:
- Niezależne nowe wizyty oraz uporządkowane przyczynowo edycje tytułu, opisu,
  terminu, statusu, czynności, materiałów i szczegółów wizyty.
- Zdarzenia start/pauza/wznowienie/stop/zakończenie/korekta jako oryginalny audyt.
- Pierwsze zatwierdzenie ceny na źródłowym stanie oraz niezmienne stare rozliczenia.
- Nowe oryginalne payment.id, z zachowaniem wcześniejszych wpłat i limitu należności.
- Zakupy z jobId, gdy źródłowa wizyta jest udowodniona i zastosowana lub powstaje
  w tej samej operacji. Link wydatku nadal korzysta z ochrony 5a/5b.

Wymagana jest zgodność kształtu, pełna validateData, udowodnieni rodzice w kontekście
źródła i zgodność kanonicznego rekordu z zastosowaną historią. Nowa referencja
katalogu wymaga rodzica; nowa strefa materiału musi istnieć. Źródłowy właściciel ogrodu musi odpowiadać aktualnemu; niezaobserwowana zmiana
właściciela wstrzymuje wizytę i jej wpłaty. Zakończenie istniejącej wizyty wymaga
zdarzenia completed, szczegóły zachowują tożsamość i rosnącą rewizję. Zmiana terminu nie
omija ostrzeżenia o lokalnej dostępności. Nie odtwarzamy zgody udzielonej gdzie indziej.

## Czas i Timer

Kolejność tablicy zdarzeń jest kolejnością audytu. Zegar ścienny nie wybiera zwycięzcy.
Pełny prefiks historii, ID zdarzeń i ich kontekst pozostają niezmienne. Kolejne zdarzenia
muszą tworzyć poprawny automat pomiaru, a Job.seconds musi odpowiadać ostatniemu
zdarzeniu. Narastanie czasu jest dozwolone tylko przy zamykaniu mierzonego segmentu;
korekta wymaga własnego oryginalnego zdarzenia. Nie sumujemy alternatywnych seconds.

Starsze v12 mogły nie mieć historii lub zacząć ją w środku pomiaru po aktualizacji.
Nie dopisujemy im fikcyjnych zdarzeń. Pierwsze zdarzenie musi zachować bazowy czas;
kolejne podlegają pełnej kontroli ciągłości. Znaczniki czasu mogą być niemonotoniczne
po zmianie zegara — nie są dowodem kolejności przyczynowej.

Otwarty audyt z drugiego urządzenia może być zapisany jako historia stanu in-progress,
ale NIE uruchamia lokalnego Timer. Późniejszy oryginalny STOP zapisuje zamknięty czas.
Nie jest to synchronizacja aktywnego stopera. Przy aktywnym dzienniku lokalny START,
korekta, zakończenie lub zatwierdzenie takiej wizyty jest blokowane do odbioru
zamkniętego segmentu źródłowego. Preflight komendy i journal wycofują się razem;
nie można wytworzyć drugiego pomiaru na otwartym audycie innego urządzenia.

Każda operacja dotykająca lokalnego timer.jobId (także pauzy) pozostaje blocked.
Nie zatrzymujemy ani nie modyfikujemy pomiaru; inne wizyty i niezależne rekordy
mogą przechodzić. Równoległe korekty i pomiary tej samej wizyty tworzą trwały
konflikt całej jednostki z obiema historiami; nie wybieramy LWW.

## Finanse

Kwoty, zatwierdzone wyliczenia i źródło ceny są kopiowane dokładnie. Nie stosujemy
aktualnej stawki ustawień do ponownego przeliczania zatwierdzonych należności.
Pierwsze nowe zatwierdzenie istniejącej wizyty musi odpowiadać swojemu źródłowemu
stanowi; istniejący snapshot legacy pozostaje historyczną bazą.

Istniejącego zatwierdzenia i wpłaty nie wolno nadpisać ani usunąć automatycznie,
nawet jeśli nowa operacja jest przyczynowo późniejsza. Takie przejście jest blocked
z czytelnym kodem. Równoległe rozbieżne zatwierdzenia/wpłaty są durable conflict.
Różne ID płatności nie są utożsamiane na podstawie kwoty. Powtórzony UUID operacji
nie daje drugiej wpłaty. ID należące do innej wizyty nie może zostać przejęte.

Ogólne resolveSyncConflict nadal odmawia finansowego wyboru wariantu. Świadoma
decyzja zachowująca oba audyty jest wymagana w dalszym punkcie; nie zastępujemy jej
destrukcyjnym wyborem local/remote. Na tym etapie nie deklarujemy obsługi takich decyzji.

## Jawne blokady i dokumentacja

- Usunięcie/przeniesienie wizyty, powiązanie z wystąpieniem harmonogramu oraz zmiana
  tożsamości raportu wymagają dalszego adaptera grup, bez rozdzielania źródłowej operacji.
- Pełne reports i counters/reportSequence pozostają blocked. **Dotychczasowa numeracja
  nie jest jeszcze bezpieczna między urządzeniami offline.** Nie włączać biznesowego LAN.
- Raporty ze zdjęciami nie tworzą brakujących metadanych ani pozornie kompletnych PDF.
  Nie zapisujemy ich zdalnie w 5c1. Lokalne reports/photos/Timer/photoRestoreId są zachowane.
- Starsze wielotypowe grupy pozostają niepodzielne; nie zmieniamy UUID ani pochodzenia.
- JSON/ZIP nadal eksportuje lokalny v12, bez dziennika, tożsamości i zaufania.
  Restore-review i ograniczenia retencji nie zostały usunięte.

## Weryfikacja i wznowienie

visits.test.ts: trzy oddzielne fabryki i bazy IndexedDB, kodek SHA256, relay wyłącznie
A↔B↔C, replay, restart, quota/rollback, prefix historii, alternatywne korekty/ceny/wpłaty,
aktywny i wstrzymany lokalny pomiar, zależności i deterministyczna sekwencja sum.
Testy w Chromium sprawdzają te granice także w rzeczywistym IndexedDB.

Wyniki konkretnych commitów znajdują się w GM011B_PROGRESS i checks PR.
Nie są to testy natywnej synchronizacji biznesowej Windows ↔ Android.

Następne zadanie 5c2: niezmienne raporty i walidacja snapshotu/hash, trwała tożsamość
przy brakujących plikach bez nowej metadanej zdjęcia, przestrzeń numerów instalacji
dla NOWYCH rodzin raportów (bez zmiany starych PDF), kolizje historyczne, zachowujące
obie historie decyzje dla konfliktów wizyty i finanse. Potem dopiero kolejne punkty
onboardingu/restore/retencji, natywny LAN i GUI.


## 5c2c — jawne uzgodnienie alternatyw

Ograniczone resolveFinancialSyncConflict zachowuje źródłowe operacje i oba audyty
w financialDecisions. Bieżąca wizyta zawiera świadomie wybraną spójną linię czasu,
ewentualną nową corrected i jawne dyspozycje wszystkich oryginalnych wpłat.
Nie sumuje alternatywnych sekund ani nie zmienia wydanych raportów. Lokalny Timer,
źródłowy otwarty audyt, nieuzgodnione raporty i nierozdzielne starsze grupy pozostają
chronione. Szczegóły i stan testów: [GM011B_RESOLUTIONS.md](GM011B_RESOLUTIONS.md).
