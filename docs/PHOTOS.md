# Dokumentacja fotograficzna 0.3.3

## Model i adaptery

`Data.photos` zawiera metadane: stałe ID zdjęcia i zasobu, kategorię, opis,
opcjonalną datę wykonania, datę dodania/aktualizacji, rewizję, powiązania
klient/ogród/strefa/zlecenie oraz nazwy historyczne. Rozmiary, wymiary i SHA-256
identyfikują przygotowany obraz i miniaturę. `photoRestoreId` jest znacznikiem
zatwierdzenia odtwarzania, zachowywanym przy pozostałych poleceniach aplikacji.

Galerie używają wspólnej hierarchii: zdjęcie zlecenia jest też widoczne przy jego
ogrodzie i kliencie. Runtime validation sprawdza spójność tej hierarchii.
Zmiana ogrodu zlecenia aktualizuje przypisanie zdjęć, a przeniesienie ogrodu
do innego klienta zachowuje relację. Dotychczasowe blokady zleceń z płatnościami
i ogrodów z harmonogramami pozostają aktywne.

Zabiegi nie mają osobnych encji — `GardenZone.treatments` jest tekstem. Nie
wprowadzono pozornych identyfikatorów zabiegów; dokumentacja używa strefy,
zlecenia i opisu zdjęcia.

`PhotoInput` przyjmuje `Blob` i nazwę, bez ścieżki systemowej. Przyszły adapter
Capacitor Camera może dostarczyć taki sam obiekt albo własny `PhotoProcessor`.
`PhotoAssetRepository` oddziela odczyt i zapis zasobów od React; obecny adapter
używa IndexedDB. ID zasobu i sumy kontrolne mogą później wskazywać odpowiednik
w chmurze, bez zmiany powiązań dokumentacji. Nie dodano Capacitor, uwierzytelniania,
wysyłania zdjęć ani zależności od konkretnego systemu operacyjnego.

## Przygotowanie obrazu

Wejście jest rozpoznawane po zawartości, a nie po rozszerzeniu lub zadeklarowanym
MIME. Dopuszczone są JPEG, PNG i WebP do 25 MiB oraz 50 megapikseli. Nagłówki są
sprawdzane przed dekodowaniem. Partie mają do 20 zdjęć; przygotowanie jest
sekwencyjne, a bitmapy są zamykane po użyciu.

`BrowserPhotoProcessor` respektuje orientację obrazu, zachowuje proporcje i nie
powiększa małych obrazów. Canvas tworzy JPEG o boku do 1920 px, jakości 0,82
(0,60 przy nadmiernym rozmiarze), oraz miniaturę do 320 px. Limity zapisu to
3 MiB dla zdjęcia i 256 KiB dla miniatury. Przezroczystość ma białe tło. Oryginalne
pliki ani EXIF/GPS nie są kopiowane do przygotowanych obrazów. Data wykonania
może zostać wpisana ręcznie; nie zakłada się obecności EXIF.

Miniatury i pełne zdjęcia są prezentowane przez tymczasowe adresy `blob:`,
zwalniane przy odmontowaniu widoku. localStorage nigdy nie otrzymuje danych
obrazu, adresów blob ani zakodowanej binarnej zawartości. Galeria początkowo
pokazuje 24 zdjęcia, kolejne ładuje na żądanie. Miniatury są ładowane leniwie.

## IndexedDB i usuwanie

Baza `garden-manager-photos`, wersja 1, ma dwa magazyny:

- `assets`: zasób z obrazem i miniaturą jako `Blob`, ID i datą zapisu.
- `control`: dziennik odtwarzania oraz poprzedni punkt odzyskiwania.

Dodanie zapisuje całą partię zasobów w transakcji IndexedDB. Dopiero po jej
sukcesie zapisuje metadane w głównym modelu. Błąd metadanych wycofuje nowe pliki.
Jeśli przeglądarka zostanie zamknięta między etapami, kolejny udany rozruch
sprząta niepowiązane zasoby. Nie czyści plików przy nieczytelnych danych głównych.

Usuwanie zapisuje najpierw `deletedAt`, następnie usuwa zasób i miniaturę, a na
końcu usuwa metadane. Przerwana operacja zachowuje trwały zamiar usunięcia,
możliwy do dokończenia po uruchomieniu lub przyciskiem ponowienia. Zasoby używane
przez punkt odzyskiwania pozostają chronione. Brak miejsca i błędy IndexedDB są
pokazywane bez zastępowania danych przykładowymi rekordami.

Usunięcie strefy lub zlecenia odłącza tylko odpowiednie powiązanie, zachowując
zdjęcie w galerii ogrodu i nazwę historyczną. Usunięcie ogrodu odłącza go od zdjęć,
które pozostają przy kliencie. Usunięcie klienta oznacza jego zdjęcia do usunięcia
w tym samym zapisie danych, a potem dokańcza usuwanie plików. Nie pozostają
zdjęcia bez galerii i bez zamiaru usunięcia.

Operacje na zdjęciach są serializowane przez Web Locks. Starsze przeglądarki bez
tego API mają kolejkę lokalną; automatyczne sprzątanie niepowiązanych, świeżych
plików czeka wtedy 10 minut, aby nie usunąć równoległego zapisu innej karty.
Zmiany głównych danych przed potwierdzeniem importu są wykrywane przez porównanie
snapshotu. Nie jest to mechanizm synchronizacji rozproszonej wielu urządzeń.

## ZIP i walidacja

Pełna kopia zawiera `data.json` (wersjonowany snapshot), `manifest.json` (format
`garden-manager-backup`, wersja 1, czas utworzenia i sumy kontrolne) oraz
`photos/<assetId>/image.jpg` i `photos/<assetId>/thumbnail.jpg`.

Parser dopuszcza wyłącznie te ścieżki. Blokuje duplikaty, dodatkowe pliki,
przekroczenie liczby wpisów i deklarowanych rozmiarów przed dekompresją.
Limit archiwum to 200 MiB, rozwiniętych wpisów 250 MiB, danych JSON 10 MiB,
zdjęć 5000. Walidacja obejmuje model danych, powiązania, komplet plików,
rzeczywiste rozmiary, SHA-256 i wymiary obrazów. W przeglądarce zdjęcia są również
dekodowane przed przyjęciem. Nie ma ekstrakcji na systemowy dysk ani renderowania
SVG/HTML pochodzących z archiwum. Sumy kontrolne wykrywają uszkodzenia; kopia
nie jest podpisana ani szyfrowana.

Eksport odmawia utworzenia „pełnej” kopii, jeśli brakuje choćby jednego pliku
lub sumy się nie zgadzają. JSON pozostaje eksportem danych i metadanych, bez
plików; samodzielny import JSON nie jest udostępniany.

## Odtwarzanie z ochroną poprzedniego zestawu

Wczytanie ZIP tylko przygotowuje podgląd. Zastąpienie wymaga zaznaczenia zgody
i wpisania `ODTWÓRZ`. Aktywny lub zapauzowany pomiar na bieżącym urządzeniu
musi zostać zakończony przyciskiem STOP. Wizyta aktywna w kopii jest pauzowana
na czas utworzenia kopii, aby nie naliczyć nieodbytej pracy.

1. Aplikacja sprawdza, czy bieżący snapshot zgadza się z podglądem.
2. Nowe pliki dostają nowe ID, aby nie nadpisywać istniejących zasobów.
3. Transakcja IndexedDB zapisuje pliki i dziennik z poprzednim snapshotem.
4. Jeden zapis localStorage zastępuje model i ustawia znacznik `photoRestoreId`.
5. Finalizacja dziennika zachowuje poprzedni snapshot jako punkt odzyskiwania.

Po awarii przed krokiem 4 dziennik wycofuje nowe pliki. Po kroku 4 znacznik
pozwala dokończyć finalizację, zachowując już odtworzone dane i starszy zestaw.
Brak miejsca podczas etapu 3 nie zmienia źródła. Błąd zapisu głównego modelu
wycofuje staging, a nie poprzednie pliki.

Punkt odzyskiwania odnosi się do zachowanych plików, bez ich ponownego kopiowania.
Można wyeksportować go do ZIP albo przywrócić poprzedni zestaw. Przywrócenie
zamienia zestawy, nadal zachowując punkt powrotu. Kolejny zwykły import wymaga
wcześniejszego uporządkowania punktu. Usunięcie punktu ma osobne potwierdzenie
i zwalnia tylko pliki, których nie potrzebuje bieżący model.

localStorage i IndexedDB nie oferują wspólnej transakcji. Dziennik, znaczniki,
wycofywanie i powtarzalne sprzątanie zabezpieczają opisane przerwania. Lokalny
punkt jest ochroną przed pomyłką w aplikacji; pełną kopię ZIP trzeba zachować
poza pamięcią tej witryny, by przetrwała jej wyczyszczenie lub utratę urządzenia.
