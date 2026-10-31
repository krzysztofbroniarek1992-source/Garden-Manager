import type { WorkTemplate } from './model';
/** Stable seed IDs. Only used when the collection is absent, never when empty. */
export function starterTemplates(now = 0): WorkTemplate[] {
  const examples = [
    [
      'lawn',
      'Koszenie trawnika',
      'Trawniki',
      [
        'Kontrola terenu i przeszkód',
        'Przygotowanie kosiarki',
        'Koszenie',
        'Podkaszanie krawędzi',
        'Oczyszczenie nawierzchni',
        'Spakowanie sprzętu',
      ],
    ],
    [
      'hedge',
      'Cięcie żywopłotu',
      'Żywopłoty',
      [
        'Ocena zakresu prac',
        'Zabezpieczenie otoczenia',
        'Cięcie żywopłotu',
        'Zebranie odpadów',
        'Rozdrobnienie lub załadunek odpadów, jeśli przewidziano',
        'Oczyszczenie terenu',
        'Spakowanie sprzętu',
      ],
    ],
    [
      'trees',
      'Pielęgnacja drzew i krzewów',
      'Drzewa i krzewy',
      [
        'Ocena stanu roślin',
        'Kontrola bezpieczeństwa',
        'Wykonanie cięć',
        'Uprzątnięcie odpadów',
        'Dokumentacja fotograficzna',
        'Spakowanie sprzętu',
      ],
    ],
    [
      'protection',
      'Zabieg ochrony roślin',
      'Ochrona roślin',
      [
        'Identyfikacja problemu',
        'Sprawdzenie etykiety preparatu i warunków zabiegu',
        'Ocena pogody i bezpieczeństwa otoczenia',
        'Przygotowanie środków ochrony osobistej',
        'Wykonanie zabiegu zgodnie z etykietą',
        'Zapis preparatu, dawki, daty i warunków',
        'Oczyszczenie sprzętu zgodnie z wymaganiami',
      ],
    ],
  ] as const;
  return examples.map(([key, name, category, items]) => ({
    id: `starter-${key}-v1`,
    name,
    category,
    description:
      key === 'protection'
        ? 'Dawkę i warunki zabiegu przepisz z aktualnej etykiety konkretnego preparatu. Lista nie określa dawek ani mieszanin.'
        : 'Przykładowa lista do dostosowania do zakresu wizyty.',
    items: items.map((title, i) => ({ id: `starter-${key}-${i + 1}`, title })),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    archivedAt: null,
  }));
}
