# GM-011B — punkt 5b: bezpieczny odbiorca CSV

To dokument wewnętrznego adaptera i testów syntetycznych, nie instrukcja synchronizowania rzeczywistych danych. PR #29 pozostaje Draft. Brak natywnego biznesowego LAN oraz interfejsu zatwierdzania i rozwiązywania konfliktów.

## Granica danych i atomowości

Biznesowy model pozostaje v12. Techniczna baza IndexedDB pozostaje v2. bank.ts nie zmienia formatu Data, origin, klucza localStorage ani JSON/ZIP. Nie wprowadza tabeli zastępującej bankowe identyfikatory. Data pozostaje kanonicznym stanem w IndexedDB; lokalny dziennik i odbiorca są w tej samej transakcji.

Nowa operacja importu zawiera niepodzielną grupę expenseImports + wszystkie utworzone przez nią expenses. Nowy wydatek CSV bez własnego importu w tej samej operacji nie zostanie zastosowany, nawet jeśli sam ma poprawną strukturę. Nowy audit powtórnego importu może odwoływać się do wcześniej zastosowanego wydatku.

Źródłowe profile i kategorie muszą być udowodnione w kontekście operacji i obecne bez konfliktu, a ich obserwowane wersje zastosowane. Nowo tworzone zależności mogą należeć do tej samej grupy. Sama zgodność ID lub podobieństwo nazwy nie dowodzi zależności.

Odbiór przechowuje operacje, plan symuluje kandydat, a jawne zatwierdzenie zapisuje Data + journal + receiver + checkpoint razem. applied powstaje dopiero po zatwierdzeniu transakcji. Quota/abort nie zapisuje ani importu bez wydatków, ani wydatku bez importu. Ponowienie zatwierdzonego planu zwraca oryginalne trwałe potwierdzenie, również po restarcie. Nie jest to transakcja rozproszona dwóch urządzeń.

## Obsługiwane rekordy

| Typ | Obsługa |
| --- | --- |
| Profile CSV | Nowe rekordy i przyczynowo uporządkowane edycje nazwy, nagłówków, mapowań, opcji i archived. Pełne istniejące ograniczenia typów i limitów oraz ścisły kształt obiektu. |
| Reguły | Nowe rekordy i uporządkowane edycje, ze źródłową kategorią. Brak ponownej klasyfikacji historycznych wydatków. |
| Kategorie | Jak w 5a: tożsamość i rewizja zachowane, bez fizycznego kasowania. Konflikt kategorii wstrzymuje zależną grupę. |
| Historia importów | Nowe, kompletne audyty; istniejący audit jest niezmienny. Zachowane hash, nazwa pliku/profilu, liczniki i wszystkie decyzje wierszy. |
| Wydatki CSV | Nowe wyłącznie razem ze źródłowym importem; uporządkowane aktualizacje z pełnym prefiksem historii. |
| Powtórny odbiór | Oryginalny UUID/origin/licznik; bez nowego kosztu i bez nowej lokalnej operacji. |
| Nowy świadomy re-import pliku | Może utworzyć nowy audit duplicate/skipped/error z referencjami do oryginałów, bez kopiowania kosztów. |

Zmiany finansowe pozostają całymi rekordami. Nie scalamy pól kwoty, kategorii, statusu i historii niezależnie.

## Tożsamość i źródło

Zachowane bez przepisywania: profileId, transactionId, statementKey, identity, match, importId, line, occurrence.

- Z ID bankowym identity wynika z oryginalnego profileId i znormalizowanego transactionId.
- Bez ID bankowego obejmuje oryginalny profil, statementKey, match i occurrence.
- profileId jest przestrzenią identyfikatorów, a nie dowodem tożsamości rachunku. Dwa niezależne profile, również jednakowo nazwane, nie są automatycznie łączone.
- match opisuje datę, kwotę i teksty źródłowego wiersza. Nie jest samodzielnym kluczem transakcji.
- Różne prawidłowe bankowe ID nie są utożsamiane, nawet jeśli data/kwota/opis/kontrahent są identyczne.
- Dwa różne occurrences w tym samym wyciągu pozostają odrębne. Ordinal musi odpowiadać rzeczywistemu porządkowi pasujących wierszy źródłowego audytu.
- Ta sama identity pod innym expense.id wymaga jawnego uzgodnienia; nigdy nie tworzy drugiego kosztu automatycznie.
- Identyczny plik i wiersz z różnymi identity są wstrzymane, a nie automatycznie utożsamione.
- Wiersz bez bankowego ID podobny do wiersza innego wyciągu oraz zmiana „bez ID → z ID” wymagają review. Nie traktujemy zgodności match jako zgody na deduplikację.

W 5b nie ma jeszcze zatwierdzania powiązań rachunków/profili. Dlatego nowe wydatki z różnych, nieuzgodnionych profili są konserwatywnie blokowane, także gdy w rzeczywistości mogą dotyczyć różnych banków. Same profile mogą być zachowane jako odrębne rekordy. To jawne ograniczenie, nie zgadywanie, że rachunki są identyczne.

bankRisk chroni także nowe lokalne importy po aktywacji dziennika. Nie zmienia zwykłego importu aplikacji bez aktywowanego dziennika. Lokalny interfejs ma już świadome separate dla wiersza bez ID; brak przenośnego dowodu tej decyzji oznacza, że odbiorca nadal może ją wstrzymać. Import/restore starszej kopii nie kopiuje zaufania i nie omija restore-review.

## Kontrola wzajemnych odwołań i historii

Każdy zatwierdzony/wykluczony wiersz musi wskazywać rzeczywisty wydatek z tego samego profilu, importu i linii. Oryginalny match i statementKey muszą odpowiadać źródłu. Pierwsza pozycja historii musi zachować pierwotną datę utworzenia, kwotę i decyzję importu. Wpływ bankowy jest wykluczony z kosztów.

Duplicate wskazuje oryginał tego samego profilu i źródłowej treści. Powtórzenie w obrębie pliku może mieć expenseId=null, zgodnie z dotychczasową komendą importu; nie tworzy kosztu. Skipped/error nie mogą tworzyć wydatków.

Aktualizacja wydatku zachowuje source, direction, origin i createdAt, rosnącą revision oraz pełny prefiks historii. Ostatnia decyzja odpowiada aktualnej kwocie/statusowi/kategorii i updatedAt. Aktualne korekty nie przepisują dawnych decyzji importu.

Archiwizacja profilu/kategorii nie usuwa historycznej tożsamości i nie reaktywuje rekordu. Historyczny import z udowodnionym zarchiwizowanym rodzicem może zostać odtworzony. Niezależny, sprzeczny korzeń domyślnej kategorii wymaga onboardingu; nie nadpisujemy go.

## Konflikty, blokady i starszy inbox

Równoległe zmiany profilu, reguły, kategorii, kwoty lub approved/excluded tworzą trwałe konflikty całych rekordów. Warianty, wspólna baza (wyłącznie udowodniona), operacje i status są zachowane po restarcie. API ogólnego wyboru wariantu finansowego nadal odmawia zapisu, dopóki nie ma bezpiecznych decyzji zachowujących oba audyty.

Ryzyko semantyczne między różnymi ID zapisuje się jako trwałe blocked z kodem przyczyny; nie podszywa się pod konflikt jednego pola:
- CSV_PROFILE_SCOPE — nieuzgodnione przestrzenie profili.
- CSV_DUPLICATE_IDENTITY — bankowa identity pod innym ID.
- CSV_FILE_ROW — ten sam plik/wiersz o różnej tożsamości.
- CSV_AMBIGUOUS_ROW — niejednoznaczność wiersza bez pełnej tożsamości.
- CSV_ATOMIC_GROUP — wydatek oderwany od źródłowej operacji.
- CSV_AUDIT_IMMUTABLE / CSV_HISTORY / CSV_LINK / CSV_OCCURRENCE — naruszenie audytu, historii lub źródła.

Wcześniejszy 5a mógł znać opaque payload, który nowa walidacja CSV odrzuci. FINANCE_INVALID pozostawia go blocked bez zmiany Data i bez abortowania niezależnych bezpiecznych operacji. Nowe nieprawidłowe wejścia nadal są rejected przed known. Nie przepisujemy dawnych operacji ani nie udajemy ich zastosowania; zależne zmiany czekają na uzgodnienie historii.

Fizyczne usuwanie profili, reguł, importów i wydatków pozostaje zablokowane. Wymaga późniejszego świadomego uzgodnienia; nie usuwamy historycznych powiązań.

## Bootstrap, zgodność i odtwarzanie

Tylko NOWE aktywacje dziennika grupują import z należącymi do niego CSV expenses. Profile/kategorie występują wcześniej, zakupy później. Zależności audytów powtórnych importów są porządkowane topologicznie. Nie używamy dat do wyboru kolejności lub zwycięzcy.

Dawne rozdzielone seedy nie są przepisywane na inne UUID. Jeśli nie dają dowodu niepodzielnej grupy, pozostają wstrzymane do onboardingu. Cykl między importami lub przekroczenie limitu blokuje aktywację, zachowując kanoniczny Data i źródłowy checkpoint. Nie jest to migracja biznesowa v12→v13.

JSON/ZIP nadal zawierają biznesowe rekordy v12 i istniejące lokalne zdjęcia. Dziennik, tożsamości instalacji, certyfikaty i zaufanie nie są kopiowane. Starszy restore nadal uruchamia restore-review, zamiast cicho cofać historię innych replik. Kreator odzyskiwania i przenośne archiwum synchronizacji pozostają dalszym zadaniem.

## Testy i granice dalszego etapu

bank.test.ts używa trzech odrębnych fabryk i trwałych baz IndexedDB; sync-receiver.spec.ts ma trzy rzeczywiste bazy Chromium i kodek SHA256. Obieg A↔B↔C nie zawiera połączenia A–C. Testy obejmują wszystkie 16 scenariuszy zlecenia 5b, dodatkowe próby źródłowej integralności, archiwizację, dawny opaque inbox i deterministyczne sekwencje z kontrolą sum groszy. E2E sprawdza też reload, utracone potwierdzenie, rzeczywisty abort transakcji oraz zachowanie wcześniej zapisanej płatności.

Wyniki konkretnych HEAD: GM011B_PROGRESS.md i checks/opis PR #29. Nie utożsamiamy tych testów z natywnym biznesowym LAN lub fizycznym odbiorem.

Następny punkt kontrolny: pełne wizyty/rozliczenia, historia czasu i korekt, ochrona aktywnego pomiaru i polityka numeracji raportów offline. Nadal potrzebne później są onboarding, świadome decyzje finansowe i uzgodnienie profili, restore/retencja, natywny transport oraz GUI. Nie rozpoczynamy GM-011C.
