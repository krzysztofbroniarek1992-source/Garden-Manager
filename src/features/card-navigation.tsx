import { createContext, useContext } from 'react';
export type RelatedCard =
  | { kind: 'garden' | 'client'; id: string }
  | { kind: 'job'; id: string; initialBilling?: boolean };
export interface CardNavigation {
  open(card: RelatedCard): void;
  back(): void;
  backLabel: string;
}
export const CardNavigationContext = createContext<CardNavigation | null>(null);
export const useCardNavigation = () => useContext(CardNavigationContext);
