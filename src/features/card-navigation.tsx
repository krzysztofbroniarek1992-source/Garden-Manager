import { createContext, useContext } from "react";
import type { Card } from "../navigation/routes";
export type RelatedCard = Card;
export interface CardNavigation {
  open(card: RelatedCard): void;
  back(): void;
  backLabel: string;
  section?: string;
  zoneId?: string;
  setSection(value: string): void;
  active: boolean;
}
export const CardNavigationContext = createContext<CardNavigation | null>(null);
export const useCardNavigation = () => useContext(CardNavigationContext);
