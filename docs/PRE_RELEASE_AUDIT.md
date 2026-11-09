# GM-008 — Przedwydawniczy przegląd Garden Managera

Data: 9 listopada 2026. Podstawa: `main` po scaleniu PR #21,
`d06b447905a2cc34be33639d1a16519243b96cb7`.
Kod poprawki objęty regresją: `a487bc19d54a5f753e02052bc07a1fc7882cd4a5`.

## Wniosek i granice przeglądu

**Można rozpocząć osobny projekt pełnej aplikacji Android po przyjęciu poprawki
GM-008.** Następnie można przygotować Windows. Przegląd nie ujawnił innego
potwierdzonego problemu blokującego dotychczasową aplikację web/PWA w sprawdzonym
zakresie. Nie jest to jeszcze potwierdzenie gotowości APK ani instalatora Windows:
tych projektów w repozytorium nie ma, a ich adaptery i rzeczywiste aktualizacje
wymagają osobnego wykonania i testów.

Znaleziono i naprawiono jeden wspólny błąd starszych edytorów: zapis całego
rekordu ze starego formularza mógł cofnąć nowsze pola zapisane w innej karcie.
Dotyczył klienta, danych ogrodu, strefy i materiału katalogowego. Naprawa nie
zmienia formatu v10, stopera, obliczeń, reguł GM-005/GM-006 ani galerii.

Nie powstała wersja Lite, nowy moduł biznesowy, APK, aplikacja Windows,
synchronizacja, nowy silnik zapisu ani nowy mechanizm przechowywania fotografii.

## Źródła i sposób weryfikacji

- Przejrzano README i dokumenty w `docs`, w szczególności nawigację etapów 1–6,
  atomowy zapis, dawny raport diagnostyczny numeracji, fotografie, notatki,
  checklisty, raporty oraz GM-005, GM-006 i GM-007.
- Odczytano aktualne opisy i statusy wszystkich PR #11–21; wszystkie są scalone.
  Dostępne dyskusje tych PR-ów nie zawierają komentarzy ani zgłoszonych recenzji.
  Wyszukiwanie GitHub Issues w tym repozytorium zwróciło zero zgłoszeń.
  Nie zakładano istnienia innych, niedostępnych list zadań.
- Wyszukiwanie `TODO`, `FIXME`, `XXX`, `HACK` w kodzie, testach i dokumentacji
  nie ujawniło zaległych oznaczeń wymagających implementacji.
- Sprawdzono faktyczne komponenty, komendy i walidatory, a nie tylko dawne opisy.
  Testy nowych konfliktów czytają główne IndexedDB, a nie jego kopię localStorage.
- Wykonano pełne testy oraz oględziny zależności od przeglądarki i żądań JS
  produkcyjnego builda w Chromium 154.0.8037.57.

Nie udostępniono prywatnej kopii produkcyjnych danych. Regresja używa pełnych
zestawów kontrolnych v9/v10, prawdziwego IndexedDB Chromium i plików zdjęć.
Symulacje viewportu, dotyku i przerwy zegara nie są testami fizycznego Androida.

## Aktualny stan funkcjonalny i sprawdzone moduły

Format danych wynosi **v10**. `garden-manager-state/state/current` jest źródłem
danych, `garden-manager:v1` w localStorage jest kopią zgodności. Pliki zdjęć
i miniatury pozostają w `garden-manager-photos`. UI jest wspólne dla komputera
i telefonu; tryb terenowy jest dodatkowym ekranem, nie zastępuje reszty aplikacji.

| Moduł             | Aktualna funkcja i sprawdzenie                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Klienci           | Kontakty, edycja, usuwanie z zabezpieczeniami, własne ogrody i historia; nowa regresja starego formularza i dwóch kart.                           |
| Ogrody            | Pełna karta, klient, siedem sekcji, zlecenia i dokumentacja; ochrona starszych danych adresowych i usuniętych ogrodów.                            |
| Strefy i rośliny  | Adresowane strefy, opisy roślin/wymagań/zabiegów, plany i historia; rośliny opisowe nie są osobną bazą rekordów.                                  |
| Zlecenia i wizyty | Wspólny formularz, jawne utworzenie/rozpoczęcie, chroniona edycja i usuwanie; bez rekordów tworzonych przez nawigację.                            |
| Kalendarz         | Miesiąc/tydzień/dzień, zdarzenia różnych rodzajów, data i filtry w historii/URL, powroty.                                                         |
| GM-006            | Dostępność całodniowa/godzinowa, wybór wielu dni, kolizje, świadomy wyjątek, najbliższe dni i współbieżność.                                      |
| GM-005            | Wykonanie z faktyczną datą, następny cykl, sezon, przesunięcie, pominięcie, historia i ochrona przed duplikatami. Starsze serie zachowują reguły. |
| Stoper            | Jeden pomiar, pauza/wznowienie, trwałe znaczniki, sekundy, korekty i historia; brak naliczania dojazdu i pauz.                                    |
| GM-007            | Lista wizyt, jawny START/STOP, potwierdzenia, ochrona starego STOP-u, szybka dokumentacja i osobne zakończenie.                                   |
| Materiały         | Katalog, własne pozycje wizyty, jednostki, zakup/cena klienta, atomowe dopisywanie; nowa ochrona starej edycji katalogu.                          |
| Kalkulatory       | Powierzchnie, objętość, jednostki dawek, żywopłot i koszt; dawki pochodzą z etykiety użytkownika.                                                 |
| Rozliczenia       | Dokładne sekundy, dotychczasowe zaokrąglenie robocizny, ryczałt, jawna cena i osobne materiały.                                                   |
| Płatności         | Zaliczki i wpłaty do konkretnego zlecenia, historia, korekty/potwierdzenia, zachowane zatwierdzone należności.                                    |
| Dokumentacja      | Rzeczywiste powiązania z klientem, ogrodem, strefą i wizytą; brak dopasowywania po nazwach.                                                       |
| Zdjęcia           | Aparat/wybór pliku, kategorie, miniatury, porównanie, limity, błędy IndexedDB, usuwanie i odzyskiwanie ZIP.                                       |
| Notatki i sprawy  | Ogólne i kontekstowe zapisy, przypomnienia, statusy, odroczenie, archiwum, terminy w kalendarzu.                                                  |
| Checklisty        | Szablony, plany i kopie wizyt, autosave, notatki, zdjęcia, niepełna lista bez przymusowego blokowania zakończenia.                                |
| PDF               | Publiczny snapshot, jawne opcje, polskie znaki, zdjęcia, wersje, numery i historia, błędy plików/fontów.                                          |
| Kopie             | Eksport JSON i pełny ZIP, walidacja, potwierdzenie importu, punkt odzyskiwania, dawne formaty, migracje i błędy.                                  |
| Nawigacja         | Wspólny kontroler, Wstecz/Dalej, URL, sekcje, stare linki, filtry, fokus, chronione formularze i oczekiwanie na commit.                           |
| Offline           | Produkcyjne PWA, wcześniejsze moduły oraz pełna wizyta terenowa, zdjęcia/ZIP/PDF i nowy konflikt edycji bez sieci.                                |

Zakresy te pokrywają obecne testy `tests/*.spec.ts`, `pwa-tests/*.spec.ts`
i testy domeny/komend w `src`. Nowe scenariusze GM-008 nie zastępują wcześniejszej
regresji; żadnego istniejącego testu nie usunięto ani nie pominięto.

## Potwierdzony błąd i naprawa GM-008

### Przed poprawką

1. Dwie karty otwierają formularz tego samego klienta. Druga zapisuje telefon
   `600111222`. Pierwsza zmienia tylko notatkę i zapisuje stary cały obiekt.
   Odczyt głównego IndexedDB pokazuje ponownie `500 100 200` — nowy numer zniknął.
2. Dwie karty otwierają ogród. Po zapisie adresu `Nowy adres 12, Warszawa`
   starszy formularz cofnie go do `ul. Lipowa 12, Warszawa`.

Oba scenariusze odtworzono na kodzie main przed zmianą. To rzeczywisty błąd
utraty nowszych wartości, nie niestabilny selektor ani powrót do starego
localStorage. Zapisy są szeregowane przez transakcje, lecz komenda bez warunku
zgodności może świadomie zapisać stare pola nad nowym rekordem.

Ten sam wzorzec `upsert` występował w `saveZone` i `saveCatalogMaterial`.

### Zakres poprawki

- Bieżące formularze przekazują utrwalony przy otwarciu oryginał rekordu,
  a przy tworzeniu `null`. Tryb tworzenie/edycja nie zmienia się po zniknięciu
  obiektu w drugiej karcie.
- `assertUnchanged` porównuje pola edytowanego rekordu **wewnątrz tej samej
  transakcji IndexedDB**, przed zmianą danych. Konflikt albo usunięcie odrzuca
  cały zapis i pozostawia szkic widocznego formularza oraz aktualne dane.
- Edytor ogrodu porównuje jego własne pola, nie tablicę stref. Zachowuje
  aktualne strefy; niezależna zmiana adresu i roślin w strefie nadal się łączy.
- Tworzenie z zajętym ID nie zastępuje istniejącego rekordu. Starszy szkic nie
  przywraca usuniętego obiektu ani nie zmienia zatwierdzonych zleceń/wpłat.
- Nie dodano trwałej rewizji, pola formatu ani migracji. Istniejące wywołania
  programowe bez opcjonalnego oczekiwanego rekordu zachowują swój kontrakt;
  wszystkie aktualne formularze tych czterech rodzajów przekazują warunek.
- Nie wprowadzono automatycznego scalania konfliktujących opisów. Użytkownik
  zachowuje szkic i sprawdza aktualny rekord przed ponowną edycją.

Pliki: `src/data/entity-edit.ts`, `src/data/store.ts`, `ClientForm`, `GardenForm`,
`ZoneForm`, `MaterialForm`. Testy: `src/data/entity-edit.test.ts`,
`tests/pre-release-concurrency.spec.ts`, `pwa-tests/pre-release-offline.spec.ts`.

Poprawiono też nieaktualną informację w bieżącej instrukcji README: aktualny
format to v10. Opisy wcześniejszych etapów zachowują historyczne wersje,
więc sama wzmianka o v9 lub dawne ograniczenie nie oznacza brakującej funkcji.

## Problemy wcześniejsze — już rozwiązane

| Źródło                                                                            | Dawny problem                                                               | Stan obecnej implementacji                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [PR #11](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/11) | Ogród na karcie klienta nie otwierał pełnych szczegółów; długa historia.    | Jedna karta ogrodu, przejścia i grupowanie miesięczne; starsze wiersze montowane na żądanie.                                     |
| [PR #12](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/12) | Lokalne stosy kart, odświeżenie, stare linki i ochrona szkiców.             | Jeden kontroler adresów i historii; ograniczenie adresów do trzech typów rozszerzyły kolejne etapy.                              |
| [PR #13](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/13) | Powrót ze zlecenia zamykał czynność; brak kontekstu kalendarza.             | Osobne poziomy wspólnego stosu, seria/termin, parametry kalendarza i oczekiwanie na zapis.                                       |
| [PR #14](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/14) | Duplikaty numerów PDF i utrata historii przy zapisie dwóch kart.            | Aktualny stan, numer i historia w jednej transakcji. Archiwalny `REPORT_NUMBERING_CONCURRENCY.md` nie jest otwartym zgłoszeniem. |
| [PR #15](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/15) | Dokumentacja poza wspólną nawigacją.                                        | Adresowane zdjęcia, notatki, checklisty, raporty i rzeczywiste odnośniki.                                                        |
| [PR #16](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/16) | Kwoty bez wyjaśnienia składników i kontekstu rozliczeń.                     | Wspólna historia, płatności, filtry i powroty, bez nowego naliczania.                                                            |
| [PR #17](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/17) | Brak adresowanej karty strefy i przejść do planów/dokumentacji.             | Strefę identyfikuje ogród + ID; rośliny opisowe nie dostają sztucznych rekordów.                                                 |
| [PR #18](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/18) | Sprawy/menu poza historią, gubienie filtrów i małe kontrolki.               | Wspólne URL i stan prezentacji, mobilne kontrolki, ochrona formularzy i wskaźnik zapisu.                                         |
| [PR #19](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/19) | Brak cyklu od faktycznego wykonania; stara asercja formatu i wyścig fokusu. | GM-005, v10 i kopia v9; poprawiony fokus. Dawny wynik 240/241 został zastąpiony pełnymi zielonymi regresjami.                    |
| [PR #20](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/20) | Brak nieregularnego grafiku pracy etatowej.                                 | GM-006 w istniejącym kalendarzu, z kolizjami i atomową operacją masową.                                                          |
| [PR #21](https://github.com/krzysztofbroniarek1992-source/Garden-Manager/pull/21) | Brak wspólnego mobilnego ekranu wizyty.                                     | GM-007, istniejący stoper i dokumentacja, osobne potwierdzenia STOP/zakończenia.                                                 |

## Ostrzeżenia builda — opcjonalne optymalizacje

### PDF/fontkit

Aktualny build: `pdf-fontkit` **716,72 kB** po minifikacji, szacowane gzip
**329,75 kB**. `pdf-engine` ma **428,57 kB**, gzip **177,63 kB**. Nie zwiększano
progu ostrzeżenia, żeby ukryć wynik.

W produkcyjnym Chromium z wyłączonym service workerem pulpit i wejście do
wizyty terenowej pobrały tylko `index` i `react-vendor`, bez `pdf-fontkit`
i `pdf-engine`. Generator jest wywoływany przez dynamiczny import.
To sprawdzenie rozdziela start aplikacji od instalacji cache, nie jest
benchmarkiem fizycznego telefonu.

**PWA precache obejmuje także PDF**, więc pierwsze pobranie/instalacja PWA
zapisuje te zasoby mimo odroczonego wykonania generatora. Build zawiera 19
wpisów precache, razem **2227,67 KiB** przed kompresją transportową. Nie należy
obiecywać, że moduł PDF nie wpływa w ogóle na pierwszą instalację lub zajęte miejsce.

Przy pakowaniu pliki wejdą do zasobów aplikacji. Rozmiaru APK/instalatora nie
da się ustalić z samego komunikatu Vite: zależy od runtime, kompresji i wybranej
platformy. Regresja generowania rzeczywistych PDF-ów i pierwszego użycia offline
jest zielona. Nie potwierdzono błędu stabilności spowodowanego tym ostrzeżeniem.
Optymalizację rozmiaru można zaplanować po pomiarze na docelowym urządzeniu.

### Statyczny i dynamiczny import ChecklistPanel

`RelatedCards`, biblioteka, podsumowanie i tryb terenowy używają modułu statycznie,
a część kart importuje go też przez `lazy`. Vite pozostawia go we wspólnym
pakiecie, zamiast wydzielić pozornie odroczony chunk. Nie tworzy to drugiej bazy
checklist ani dwóch instancji logiki zapisu. Aktualne testy list i offline
sprawdzają tę samą implementację.

Ujednolicenie importów jest opcjonalnym porządkiem. Samo usunięcie kilku `lazy`
nie zapewni istotnego zmniejszenia startowego pakietu. Nie wykonywano większego
refaktoringu ani usuwania funkcji w celu uciszenia ostrzeżenia.

## Zgodność funkcjonalna Androida, Windows i obecnej PWA

Obecny kod ma jeden zestaw modułów React i danych, bez osobnego zestawu Lite.
Mobilne „Więcej” otwiera materiały, kalkulatory, notatki, sprawy, szablony,
historię i ustawienia; pozostałe główne zakładki są bezpośrednio dostępne.
„Teren” jest skrótem do dodatkowego ekranu.

| Zakres                                      | Wymaganie dla Androida                                            | Wymaganie dla Windows                                                    |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Klienci, ogrody, strefy i pełne zlecenia    | Całe obecne formularze i karty, nie tylko teren.                  | Te same dane i formularze.                                               |
| Kalendarz, GM-005 i GM-006                  | Wszystkie widoki, serie, wyjątki i grafik, także offline.         | Ten sam silnik terminów i dostępności.                                   |
| Finanse, płatności, materiały i kalkulatory | Pełny obecny zakres i niezmienione obliczenia.                    | Pełny obecny zakres i niezmienione obliczenia.                           |
| Notatki, checklisty i dokumentacja          | Wszystkie edytory i powiązania.                                   | Te same moduły.                                                          |
| Zdjęcia, PDF, JSON i ZIP                    | Aparat/wybór oraz natywne zapisanie/otwarcie/udostępnienie pliku. | Wybór oraz dialogi zapisu/otwarcia plików, zdjęcia i wszystkie eksporty. |
| Stoper i teren                              | Te same trwałe znaczniki i jawne operacje.                        | Ten sam jeden pomiar, również w wielu oknach wspólnego profilu.          |

Samodzielnego importu JSON nie ma w obecnym GUI. Eksport JSON, migrator starych
formatów i odtwarzanie pełnego ZIP nie są tym samym. Testy starszych JSON-ów
dotyczą warstwy odczytu/migracji; pełne przenoszenie danych i zdjęć realizuje ZIP.
Nie dodano nowego interfejsu importu JSON w tym przeglądzie.

## Wymagane adaptery i warunki projektu instalatorów

To warunki odbioru przyszłego pakowania, a nie brakujące nowe moduły biznesowe
do dopisania w GM-008.

| Granica platformy             | Obecna implementacja                                              | Wymaganie następnego zadania                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magazyn i tożsamość aplikacji | IndexedDB rozdzielone przez origin/profil.                        | Stały bezpieczny origin WebView/WebView2/Electron i trwały profil danych. Aktualizacja nie może zmieniać identyfikatora aplikacji, katalogu profilu ani czyścić baz.                                              |
| Przeniesienie obecnych danych | Lokalne dane PWA/przeglądarki.                                    | APK i nowy profil Windows nie odczytają automatycznie bazy `localhost:5173` lub innej przeglądarki. Zapewnić świadomy transfer pełnego ZIP i sprawdzić zdjęcia, v10, raporty i numerację po imporcie.             |
| Eksport PDF/JSON/ZIP          | `Blob`, `blob:`, `a.download`, kliknięcie linku.                  | Adapter zapisu/udostępniania natywnych plików. WebView nie gwarantuje samodzielnie obsługi pobierania `blob:`. Nie zmieniać numeracji ani publikować PDF przed commitem.                                          |
| Import plików i zdjęć         | `input type=file`, `File`/`Blob`.                                 | Android: systemowy wybór i odczyt URI; Windows: dialog plików. Dostarczać obecnym serwisom bajty/Blob z walidacją i limitami, bez zapisu całych zdjęć do localStorage.                                            |
| Aparat                        | `capture=environment` jako wskazówka przeglądarki.                | Adapter Camera/Media albo sprawdzona implementacja file chooser. Uprawnienia tylko po działaniu użytkownika, anulowanie bez rekordu, test orientacji i błędu zapisu.                                              |
| Powrót i zamykanie            | `history`, `popstate`, `beforeunload`, wspólny guard.             | Androidowy Wstecz i zamknięcie okna Windows muszą respektować ten sam kontroler, szkice i pending commit. `beforeunload` nie zastępuje natywnego cyklu życia.                                                     |
| Wznowienie i czas             | `Date.now`, `startedAt`, `visibilitychange`, `focus`, `pageshow`. | Przekazać wznowienie aplikacji do odświeżenia widoku/stanu; po ubiciu procesu ponownie odczytać zapisane znaczniki. Nie dodawać drugiego stopera ani zakładać pracy JS w tle.                                     |
| Offline i zasoby              | Produkcyjny `dist` i cache PWA, fonty pod `/fonts`.               | Dołączyć kompletny build i czcionki; zweryfikować ścieżki zasobów oraz pierwszy start bez sieci. Samo otwarcie `index.html` przez `file://` nie jest planem pakowania.                                            |
| Możliwości silnika            | DOM, IndexedDB, Canvas, Blob, Web Crypto/UUID, BigInt, Web Locks. | Wybrać i przetestować minimalne wersje silnika. Brak IndexedDB blokuje zapis. Import ZIP wymaga obecnej ochrony Web Locks lub równoważnego sprawdzonego adaptera; nie wolno po cichu wyłączyć funkcji.            |
| Aktualizacja                  | Migracje danych, zachowane kopie źródłowe, v10.                   | Test rzeczywistej podpisanej aktualizacji APK i instalatora Windows: stabilny app ID/profil, stare dane i pliki, działający stoper, kopie i raporty. Nie testowano tego na nieistniejących jeszcze instalatorach. |

**Android:** wymagają urządzenia aparat, picker dokumentów, klawiatura,
systemowy Wstecz, blokada ekranu, zabicie procesu, przywrócenie oraz aktualizacja.
Ustalić docelowe wersje Android/System WebView i zakres uprawnień. Testy Chromium
nie zastępują tych prób.

**Windows:** wybrać runtime i docelowe wersje systemu; sprawdzić dialogi plików,
uprawnienia katalogu danych, aktualizację, zamykanie okna i wiele okien/procesów
ze wspólną bazą. Dane nie powinny trafiać do nadpisywanego katalogu instalacyjnego.
Nie wykonano testu natywnej aplikacji ani instalatora Windows.

## Pozostałe ograniczenia i ich priorytet

### Warunki blokujące wydanie instalatorów, nie rozpoczęcie ich projektu

- Brak jeszcze natywnych adapterów plików/aparatu i obsługi życia aplikacji.
  Nie można uznać samego opakowania strony za gotową APK z pełną funkcjonalnością.
- Brak próby rzeczywistej aktualizacji z zachowaniem profilu, origin i danych.
- Brak pełnej próby sprzętowej Android/Windows i sprawdzenia wszystkich obecnych
  funkcji. Nie wolno rozwiązywać tej luki przez usunięcie modułów z Androida.

### Znane, nadal obowiązujące granice danych

- IndexedDB musi być dostępne; aplikacja nie przechodzi na nieatomowy zapis.
  Dane i pliki są w dwóch bazach, więc nie stanowią jednej globalnej transakcji.
  Istniejący dziennik i punkt odzyskiwania zabezpieczają odtwarzanie zdjęć.
- Nie ma bezpieczeństwa mieszanej pracy starych kart sprzed protokołu atomowego
  z nową wersją. Przed aktualizacją trzeba zakończyć edycję i zamknąć stare karty.
- Pamięć przeglądarki może zostać usunięta przez użytkownika/system; pełny ZIP
  poza tą pamięcią pozostaje potrzebny. Niezapisane szkice nie są kopią danych
  i mogą zniknąć przy wymuszonym zamknięciu procesu lub zastąpieniu całego zestawu.
- Sam URL nie przenosi danych ani całej historii widoków na inne urządzenie.
  Nie ma synchronizacji. Numeracja raportów jest lokalna dla zestawu danych.
- Usunięte zdjęcie może uniemożliwić regenerację historycznego PDF ze zdjęciem;
  zachowany snapshot nie zastępuje pliku. Potrzebny jest pobrany PDF lub pełny ZIP.
- GM-006 sprawdza godzinę rozpoczęcia, bo nie istnieje prognozowany czas pracy.
  GM-005 i stare serie mają różne, świadomie wybierane reguły; nie konwertują się same.

### Opcjonalne usprawnienia poza tym PR

Rozmiar PDF/fontkit, uporządkowanie importów checklist, dalsze strojenie dużych
list, osobne URL wszystkich szkiców i szersza certyfikacja dostępności nie są
potwierdzonymi blokadami bieżącego zakresu. Etykieta demonstracyjna/package.json
nadal pokazuje 0.3.6; numer produktu, Android `versionCode` i wersję Windows
trzeba ustalić w osobnym zadaniu wydania, bez mylenia ich z formatem danych v10.
Nie dodawano ogólnych płatności bez zlecenia, rozpoznawania roślin ani innych
funkcji, których obecny model nie oferuje.

## Wyniki regresji

| Kontrola                                                                    | Wynik końcowy                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm test`                                                                  | **584/584**, 22 pliki; 18 nowych przypadków transakcyjnych.                               |
| Pełne `npm run test:e2e` (Chromium, 2 workers)                              | **312/312** w jednym przebiegu (17,1 min), bez pominięć i ponowień; 7 nowych scenariuszy. |
| Produkcyjne `playwright test --config=playwright.pwa.config.ts` po buildzie | **17/17**, bez pominięć i ponowień; nowy konflikt dwóch kart offline.                     |
| `npx tsc -b`                                                                | Zaliczone.                                                                                |
| `npm run build`                                                             | Zaliczone; tylko dwa opisane wcześniej ostrzeżenia.                                       |
| `git diff --check`                                                          | Zaliczone dla całej zmiany względem main i katalogu roboczego.                            |

Pełna regresja obejmuje współbieżny zapis/numery PDF, import i eksport ZIP,
pliki i miniatury zdjęć, migracje v9→v10 na głównym IndexedDB i zachowane kopie
źródłowe, błędy migracji/quota, zatwierdzone ceny/płatności, stoper, GM-005/006/007
oraz wcześniejszą nawigację. Sprawdzane są szerokości **320, 360, 390, 430,
768 i 1280 px**, dotyk, klawiatura oraz zmniejszenie wysokości viewportu.

Nowe przypadki sprawdzają cztery rodzaje starych formularzy, jednego zwycięzcę
równoczesnych edycji, niezależne zmiany stref i ogrodu, tworzenie z zajętym ID,
przywrócenie nowszego zestawu/usunięcie obiektu, oczekujący commit,
Wstecz, quota i zachowany szkic. Stan bazy, kwoty i historia pozostają przedmiotem
asercji; nie zastępowano kontroli danych samym sprawdzeniem komunikatu.

Kod produkcyjny i testy nie zmieniały się podczas pełnego przebiegu. Po jego
zakończeniu uzupełniono tylko ten raport i README. Nie były to testy fizycznego
Androida ani uruchomienia programu natywnego na Windows.

## Rekomendowana kolejność dalszej pracy

1. Przejrzeć i scalić GM-008 z naprawą starych formularzy, bez zmiany danych v10.
2. Rozpocząć oddzielnie Android APK: komplet modułów, adaptery i próba aktualizacji
   oraz danych na fizycznym telefonie.
3. Następnie Windows z tym samym zakresem i sprawdzeniem trwałego profilu.
4. Synchronizacja oraz pełne testy użytkowe pozostają osobnymi, późniejszymi zadaniami.

GM-008 kończy się na audycie, niewielkiej potwierdzonej poprawce i regresji.
Nie rozpoczęto implementacji żadnego z powyższych kolejnych projektów.
