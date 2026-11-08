import { zonesData, zonesClock } from "./zones-fixture";
import { newTodo } from "../src/desk/model";
export { zonesClock as finalClock };
export function finalData() {
  const d = zonesData();
  d.todos = [
    {
      ...newTodo(d, {
        clientId: "client-1",
        gardenId: "garden-1",
        zoneId: "zone-doc",
        jobId: "job-1",
      }),
      id: "todo-final",
      revision: 1,
      createdAt: zonesClock.getTime(),
      updatedAt: zonesClock.getTime(),
      title: "Zamówić korę do rabaty",
      description: "Sprawa powiązana z rabatą",
      priority: "high",
      dueDate: "2026-11-17",
      dueTime: "10:00",
    },
  ];
  d.materialCatalog = [
    {
      id: "material-final",
      name: "Kora sosnowa",
      category: "Podłoża",
      unit: "l",
      purchaseUnitPrice: 2,
      packageName: "worek",
      packageQuantity: 50,
      notes: "Materiał do rabaty",
    },
  ];
  return d;
}
