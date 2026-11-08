# Etap 5 — nawigacja stref, roślin i zabiegów

Zakres opiera się na main po scaleniu PR #16 (`b97c462`). Pozostawia wcześniejsze
przejścia klient–ogród–zlecenie, dokumentację, rozliczenia i kalendarz.

## Model i rzeczywiste relacje

Strefa jest elementem `Garden.zones`. Jej ID jest rozpatrywane razem z ID ogrodu:
ten sam identyfikator strefy może istnieć w dwóch różnych ogrodach. Rośliny,
wymagania pielęgnacyjne i wykonane zabiegi pozostają tekstami `plants`,
`requirements`, `treatments`. Nie otrzymują nowych identyfikatorów ani katalogów.

Harmonogramy są przypisane przez `gardenId` i `zoneId`. Historia zleceń strefy
wykorzystuje wyłącznie zapisane relacje we właściwym ogrodzie:

- `visitDetails.zoneId` zlecenia;
- strefę wystąpienia, jeżeli jego `jobId` i `job.taskOccurrenceId` wskazują na siebie;
- `zoneId` checklisty wizyty powiązanej przez `jobId` i `gardenId`.

Zbieżność nazw, opisy zabiegów, notatki, zdjęcia i samo przypisanie do ogrodu
nie tworzą relacji zlecenie–strefa. Brakujące strefy nie zostają zastąpione innymi.
Historyczne opisy czynności są zachowane.

## Przejścia i wspólne komponenty

Karta ogrodu nadal jest jedną istniejącą kartą. Nazwa strefy i przyciski
„Otwórz strefę” oraz „Czynności i harmonogramy” otwierają adresowalny widok strefy.
Dotychczasowe dodawanie, edycja, usuwanie, kalkulator i dokumentacja pozostają.

Widok strefy ma sekcje: przegląd i rośliny, czynności i harmonogramy, zlecenia
i historia, galeria oraz notatki. Korzysta z `ZoneFacts`, wspólnego `ZoneForm`
(wydzielonego z karty ogrodu), `GardenSchedule`, `ChecklistPanel`,
`GroupedJobHistory`, `PhotoGallery` i `ContextNotes`. Nie powiela formularzy ani
silnika planowania. Historia zachowuje domenowe podsumowania finansowe.

Strefa prowadzi do klienta, ogrodu, przypisanej serii, jej terminu w kalendarzu,
zlecenia i jego rozliczenia. Linki z harmonogramu, czynności, dokumentacji,
zlecenia i podsumowania wizyty otwierają właściwą strefę. Czynność i zlecenie
nadal wykorzystują istniejące odnośniki do źródłowego terminu i serii.

Terminy przesunięte nadal identyfikuje para `scheduleId`–`originalDate`.
Data kalendarza może być inna. Podgląd nie zapisuje wirtualnego wystąpienia,
nie tworzy cyklu ani zlecenia, nie uruchamia stopera i nie zmienia należności.
Nie wdrożono GM-005 ani etapu 6.

## Adresy, historia i ochrona zapisu

Przykłady adresów na niezmienionym `http://localhost:5173/`:

- `#gardens?zone=zone-doc&zoneGarden=garden-1&section=overview`
- `#gardens?zone=zone-doc&zoneGarden=garden-1&section=plans`
- `#gardens?zone=zone-doc&zoneGarden=garden-1&section=history`

Sekcje `gallery` i `notes` również mają adres. Klucz karty obejmuje ogród i strefę.
Dawny adres `#gardens?garden=garden-1&section=zones&zone=zone-doc` nadal otwiera
kartę ogrodu z wyróżnioną strefą. Błędne parametry są odrzucane, a brakujący ogród
lub strefa mają komunikat i bezpieczny powrót.

Wszystkie karty używają dotychczasowego kontrolera z PR #12–13. Wstecz/Dalej,
powroty w aplikacji, odświeżenie i ponowne otwarcie korzystają ze wspólnej historii.
Stan widoku zachowuje filtry, odwiedzone sekcje, rozwinięte miesiące, przewinięcie
i fokus zgodnie z istniejącymi mechanizmami. Filtry nie stają się danymi firmy.

Formularz strefy używa istniejącej ochrony niezapisanych zmian i oczekuje na
atomowy commit. Błąd pozostawia szkic do poprawienia lub ponowienia. Nawigacja
podczas zapisu jest blokowana. Jeśli strefa zostanie usunięta w innej karcie,
otwarty szkic pozostaje widoczny, a zapis jest wyłączony.

## Zgodność i ograniczenia

Nie zmieniono modelu v9, migracji, źródła danych IndexedDB, klucza localStorage,
formatów JSON/ZIP, magazynu zdjęć, numeracji PDF, finansów ani reguł harmonogramów.
Eksport i odtworzenie używają dotychczasowych modułów. Rośliny i opisane zabiegi
nie mają oddzielnych kart, ponieważ obecny model nie zawiera takich rekordów.
Nie ma sztucznych powiązań zleceń bez strefy.

## Walidacja

Testy obejmują rzeczywiste relacje i brak domyślnych relacji, strefy o tym samym ID
w różnych ogrodach, URL i starsze adresy, klient–ogród–strefa, serię i przesunięty
termin, pominięcia, zlecenie i jego źródło, dokumentację, rozliczenie i zapisany
raport. Sprawdzają brak zapisów podczas nawigacji, ochronę szkicu przy błędzie
IndexedDB, oczekiwanie na commit, usunięcie w drugiej karcie, odtworzenie ZIP ze
zdjęciem, restart offline oraz telefony 360, 390 i 430 px.

Pełna regresja: **433/433 jednostkowych**, **203/203 E2E Chromium** w jednym
przebiegu i **12/12 PWA offline** na buildzie produkcyjnym. TypeScript,
`npm run build` i `git diff --check` przeszły. Dodatkowo obejrzano układ na
komputerze i szerokościach 360, 390 i 430 px; nie występuje przewijanie w poziomie.
Pozostają wcześniejsze ostrzeżenia Vite o rozmiarze pakietu fontkit i mieszanym
statycznym/dynamicznym imporcie `ChecklistPanel`.
