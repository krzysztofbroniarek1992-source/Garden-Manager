# Garden Manager na Windows (GM-010)

Pierwsza samodzielna wersja testowa Windows 10/11 x64: Electron 45.2.3, electron-builder 26.18.0 i NSIS. Program zawiera cały istniejący interfejs React/TypeScript, Chromium i środowisko wykonawcze. Użytkownik nie instaluje Node.js, nie otwiera terminala ani przeglądarki i nie uruchamia Vite/localhost.

## Instalacja i uruchamianie

1. Pobierz artefakt `GardenManager-Windows-test` ze wskazanego w PR przebiegu GitHub Actions i rozpakuj archiwum. Zawiera instalator EXE, `SHA256SUMS.txt` i `WINDOWS-METADATA.json`.
2. Sprawdź sumę SHA256 względem metadanych i opisu PR. To instalator testowy **bez Authenticode**; Windows SmartScreen może pokazać ostrzeżenie o nierozpoznanym wydawcy. Nie wyłączaj SmartScreen, antywirusa ani innych zabezpieczeń. Jeśli polityka komputera blokuje plik, skonsultuj instalację z administratorem.
3. Uruchom EXE i zainstaluj dla bieżącego użytkownika. Uprawnienia administratora nie są wymagane. Wskaż folder instalacyjny; skrót menu Start powstaje automatycznie. Na końcu można zaznaczyć opcjonalny skrót pulpitu.
4. Uruchom „Garden Manager” z menu Start lub skrótu. Wszystkie zasoby są w pakiecie; internet nie jest potrzebny.

Pierwsze uruchomienie używa dotychczasowej bazy demonstracyjnej. Wersja Windows nie ma dostępu do lokalnej bazy Chrome/Edge, PWA ani Androida. Nie skanuje ani nie przejmuje profili przeglądarek.

## Przeniesienie istniejących danych

W poprzedniej aplikacji wykonaj **pełną kopię ZIP ze zdjęciami** i zachowaj ją poza folderem programu. Zwykły JSON zawiera metadane zdjęć, bez plików. W Windows otwórz Ustawienia → Wczytaj pełną kopię ZIP, sprawdź podgląd, zaznacz świadome zastąpienie danych i wpisz ODTWÓRZ. Import **zastępuje zestaw danych**, nie scala baz. Zachowane są istniejące zabezpieczenia: zatrzymanie bieżącego pomiaru przed odtwarzaniem, walidacja plików, CAS i punkt odzyskiwania.

Nie ma synchronizacji: Windows i Android/przeglądarka prowadzą osobne bazy. Nie edytuj dwóch niezależnych kopii z założeniem automatycznego scalenia. Kopię źródłową zachowaj również do ewentualnego powrotu do starszej wersji.

## Profil i aktualizacje

Stały identyfikator: `pl.broniarek.gardenmanager.windows`. Stały origin: **`app://garden-manager/`**. Profil produkcyjny: **`%APPDATA%\GardenManager`**. Zawiera standardową pamięć Chromium (IndexedDB i localStorage), oddzielną bazę zdjęć i mały plik `desktop-window.json` z położeniem okna oraz adresem ostatniego widoku. To inny folder niż katalog instalacji EXE.

Źródłem prawdy pozostaje atomowy IndexedDB `garden-manager-state`, dane v11. `garden-manager:v1` jest kopią zgodności. Zdjęcia i miniatury pozostają w istniejącej bazie IndexedDB zdjęć. Ta funkcja nie wprowadza migracji v11 ani drugiego modelu danych. Starsze migracje i JSON/ZIP pozostają wspólne z web/Android.

Aktualizacja: wykonaj i sprawdź pełny ZIP, zamknij program po zakończeniu zapisów i uruchom nowy instalator. Użyj tej samej tożsamości aplikacji/profilu; zmiana folderu instalacji nie powinna zmieniać bazy. Instalator nie czyści profilu. Standardowa deinstalacja usuwa program i skróty, ale nie usuwa celowo katalogu danych. Profilu nie kasuj ręcznie bez zweryfikowanej kopii ZIP. Nie ma aktualizatora internetowego.

Test A (`0.5.0-test.1`) → B (`0.5.0-test.2`) instaluje dwa rzeczywiste instalatory NSIS na runnerze Windows, tworzy dane klienta, zdjęcie, wydatek i aktywny pomiar, zamyka A, instaluje B i porównuje cały rekord oraz skróty plików zdjęć. Test używa kontrolowanego profilu tymczasowego, nie rzeczywistej bazy użytkownika. Wyniki i ewentualne ograniczenia są w PR.

## Funkcje

Wspólny kod udostępnia: pulpit, klientów, ogrody/strefy/rośliny, zlecenia i historię, formularze klienta/ogrodu/materiału w zleceniu, kalendarz, dostępność GM-006, harmonogramy GM-005, tryb terenowy, START/PAUZA/WZNÓW/STOP, notatki/sprawy/checklisty, materiały/kalkulatory, galerie i porównania PRZED/PO, raporty PDF, rozliczenia/płatności, wydatki GM-009B, bankowy CSV, finanse miesiąca/roku i kopie danych.

Zamknięcie, minimalizacja ani blokada ekranu nie wykonują STOP. Po ponownym uruchomieniu czas wynika z zapisanych znaczników dotychczasowego stopera. Nie ma osobnego stopera Electron ani procesu naliczającego należności w tle.

Przy zamykaniu/odświeżaniu program korzysta ze wspólnej ochrony szkiców. Trwający zapis blokuje zamknięcie; poczekaj i zamknij ponownie. Niezapisany formularz wymaga decyzji o porzuceniu. Nie obiecujemy zachowania niezapisanych szkiców po wymuszonym zabiciu procesu lub wymuszonym zamknięciu systemu.

## Pliki i zdjęcia

PDF, JSON i ZIP używają „Zapisz jako…”, z wyborem folderu/nazwy i możliwością anulowania. Eksport zapisuje najpierw plik tymczasowy w wybranym folderze i dopiero po zakończeniu zastępuje plik docelowy. Błąd dostępu, brak miejsca lub odłączony dysk pozostawiają poprzedni plik docelowy; aplikacja pokazuje błąd. Zapisany PDF można otworzyć standardowym czytnikiem z dysku.

CSV i ZIP otwierają systemowe okno wyboru pliku, również dla folderów użytkownika lub podłączonych nośników. Obowiązują dotychczasowe limity: CSV 5 MB/2000 operacji; pełny ZIP 200 MB i limity rozpakowania/walidacji; JSON w ZIP do 10 MB. Przekazywanie przez IPC jest porcjowane (192 KB), bez base64 i bez udostępniania dowolnych ścieżek rendererowi.

Galeria korzysta z systemowego wyboru wielu JPG/PNG/WebP przez Chromium, wspólnego przetwarzania obrazów i istniejącego magazynu. Windows nie uruchamia `GardenCamera`; Android zachowuje dotychczasową obsługę aparatu. Przycisk aparatu telefonu jest ukryty w galerii Windows, a szybka czynność wizyty wybiera zdjęcie z komputera.

## Architektura i bezpieczeństwo

- `desktop/main.cts`: stały profil, pojedyncza instancja/okno, protokół, menu, dialogi/uchwyty plików, zamykanie i geometria.
- `desktop/preload.cts`: ograniczony, zamrożony interfejs `gardenDesktop`. Brak eksportu `ipcRenderer`, Node.js lub ścieżek.
- `src/platform/desktop.ts`: adapter `deliverFile`/`pickBackup`; istniejące usługi PDF, CSV, zdjęć i kopii pozostają wspólne.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. Walidacja nadawcy IPC (wyłącznie własna główna ramka), kluczy/typów/limitów i losowych tokenów plików. Tokeny nie są ścieżkami.
- Protokół jest rejestrowany przed startem jako standardowy/bezpieczny. Zasoby są czytane tylko spod `dist-windows`, z kontrolą kanonicznej ścieżki. Brak ukrytego HTTP, `file://` jako origin i odczytu dowolnego dysku przez renderer.
- CSP, blokowanie zewnętrznych żądań/nawigacji, nowych okien i webview. Uprawnienia kamery/mikrofonu/odczytu schowka są odrzucane; dozwolony jest zapis tekstu do schowka własnej aplikacji.
- W pakiecie Windows nie ma PWA Service Workera, CDN ani drugiego mechanizmu pobierania zasobów. Brak automatycznego uruchamiania plików importowanych, synchronizacji i kont.

## Budowanie dla programisty

Node.js >=22.12 (CI: 24), Windows x64:

```powershell
npm ci
npm run build:windows
npm run test:desktop:unit
npm run test:desktop
npm run windows:installer
```

`desktop:dev` uruchamia rzeczywisty Electron ze zbudowanych plików, bez Vite. `build:windows` używa oddzielnego `dist-windows`; zwykłe `build`, web/PWA na localhost:5173 i Android pozostają dostępne. Workflow Windows uruchamia testy rzeczywistego Electron oraz rzeczywistej aktualizacji NSIS, weryfikuje ASAR, EXE i sumę SHA256. Artefakt ma nazwę `GardenManager-Windows-test`. Zmienna testowa `GM_DESKTOP_TEST_PROFILE` jest używana wyłącznie z `GM_DESKTOP_TEST=1` w automatyzacji do izolacji danych.

## Ręczny odbiór Windows 10/11

- Instalacja EXE na komputerze bez Node.js; skróty Start/pulpit, ikona, zwykły użytkownik i deinstalacja bez usuwania profilu.
- Pierwszy start bez internetu; przeniesienie pełnego ZIP z dotychczasowej aplikacji, zdjęcia i komplet rekordów.
- Wszystkie moduły, formularze zagnieżdżone, galerie/porównania, PDF z polskimi znakami, CSV w używanym kodowaniu i podsumowania firmy.
- Zapis i anulowanie PDF/JSON/ZIP, uszkodzony/duży plik, brak miejsca/uprawnień oraz plik z dysku USB lub innego używanego dostawcy.
- START, PAUZA, WZNÓW, STOP; minimalizacja; blokada i odblokowanie Windows; normalne zamknięcie i restart systemu; długi odstęp między uruchomieniami. Windows nie jest usypiany ani blokowany w sposób, który pozbawia runner CI dostępu do sesji.
- Aktualizacja do B z zachowaniem profilu i kopii; cały rekord, zdjęcia, wydatki, historia i dalszy pomiar.
- Skale 100/125/150/200%, laptop, drugi monitor, odłączenie monitora i ponowne otwarcie, maksymalizacja/przywrócenie oraz klawiatura i fokus modali.
- Ochrona brudnego formularza i zamknięcie podczas zapisu; po wymuszonym zakończeniu procesu sprawdzenie ostatnio zatwierdzonego stanu, bez zakładania zachowania szkicu.

Automatyczne testy na Windows nie zastępują odbioru na fizycznych komputerach, różnych monitorach i dostawcach nośników. Ostateczne wyniki automatyzacji, link do EXE, SHA256 i status podpisu są w PR GM-010.
