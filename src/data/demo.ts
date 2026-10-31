import { legacySettlement, localDate, type Data, type Job } from '../domain';

const dateAt = (offset: number, now: Date) => {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  return localDate(date);
};

export function createDemoData(now = new Date()): Data {
  const clients = [
    { id: 'client-1', name: 'Anna Kowalska', phone: '500 100 200', email: 'anna@example.com', notes: 'Dane testowe. Proszę zamknąć furtkę po wizycie.' },
    { id: 'client-2', name: 'Piotr Nowak', phone: '500 200 300', email: 'piotr@example.com', notes: 'Dane testowe. Kontakt przed przyjazdem.' },
    { id: 'client-3', name: 'Zielona Przystań', phone: '500 300 400', email: 'biuro@example.com', notes: 'Dane testowe. Obsługa terenu wspólnego.' },
    { id: 'client-4', name: 'Maria Wiśniewska', phone: '500 400 500', email: 'maria@example.com', notes: 'Dane testowe. Podlewanie po nawożeniu.' },
    { id: 'client-5', name: 'Tomasz Zieliński', phone: '500 500 600', email: 'tomasz@example.com', notes: 'Dane testowe. Ogród przy domu.' },
  ];
  const gardens = [
    { id: 'garden-1', clientId: 'client-1', name: 'Ogród przy Lipowej', address: 'ul. Lipowa 12, Warszawa', area: 650, notes: 'Dane testowe. Trawnik, rabaty i żywopłot.' },
    { id: 'garden-2', clientId: 'client-2', name: 'Ogród na Zaciszu', address: 'ul. Zaciszna 8, Warszawa', area: 1200, notes: 'Dane testowe. Duży trawnik i drzewa owocowe.' },
    { id: 'garden-3', clientId: 'client-3', name: 'Teren osiedla', address: 'ul. Ogrodowa 24, Warszawa', area: 2400, notes: 'Dane testowe. Teren wspólny osiedla.' },
    { id: 'garden-4', clientId: 'client-4', name: 'Różany zakątek', address: 'ul. Różana 5, Warszawa', area: 420, notes: 'Dane testowe. Róże i rabaty bylinowe.' },
    { id: 'garden-5', clientId: 'client-5', name: 'Ogród pod lasem', address: 'ul. Leśna 31, Warszawa', area: 900, notes: 'Dane testowe. Nasadzenia i system nawadniania.' },
    { id: 'garden-6', clientId: 'client-1', name: 'Działka weekendowa', address: 'ul. Polna 4, Łomianki', area: 800, notes: 'Dane testowe. Drugi obiekt klientki.' },
  ];
  const makeJob = (overrides: Partial<Job> & Pick<Job, 'id' | 'gardenId' | 'title'>): Job => ({
    date: dateAt(0, now), time: '09:00', status: 'planned', billing: 'hourly', rate: 120,
    fixedPrice: 0, seconds: 0, materials: [], activities: [overrides.title], settlement: null, notes: 'Zlecenie testowe — dane demonstracyjne.', ...overrides,
  });
  return {
    notes: [],
    todos: [],
    deskTombstones: [],
    photos: [],
    photoRestoreId: null,
    taskSchedules: [],
    taskOccurrences: [],
    clients,
    gardens: gardens.map(garden => ({ ...garden, zones: [] })),
    materialCatalog: [],
    jobs: [
      makeJob({ id: 'job-1', gardenId: 'garden-1', title: 'Pielęgnacja ogrodu', time: '09:00' }),
      makeJob({ id: 'job-2', gardenId: 'garden-2', title: 'Koszenie i porządkowanie', time: '13:00', billing: 'fixed', fixedPrice: 450 }),
      makeJob({ id: 'job-3', gardenId: 'garden-3', title: 'Przycinanie żywopłotu', date: dateAt(1, now), time: '08:30' }),
      makeJob({ id: 'job-4', gardenId: 'garden-4', title: 'Pielęgnacja rabat', date: dateAt(2, now), time: '10:00' }),
      makeJob({ id: 'job-5', gardenId: 'garden-5', title: 'Przygotowanie ogrodu do sezonu', date: dateAt(-1, now), status: 'completed', seconds: 14400, materials: [{ id: 'material-1', name: 'Kora sosnowa 80 l', quantity: 4, unitPrice: 24.5 }] }),
      makeJob({ id: 'job-6', gardenId: 'garden-6', title: 'Koszenie trawnika', date: dateAt(-2, now), status: 'completed', seconds: 9000 }),
      makeJob({ id: 'job-7', gardenId: 'garden-3', title: 'Porządkowanie terenu', date: dateAt(-3, now), status: 'completed', billing: 'fixed', fixedPrice: 780, seconds: 18000, materials: [{ id: 'material-2', name: 'Worki na odpady zielone', quantity: 10, unitPrice: 3 }] }),
    ].map(job => job.status === 'completed' ? { ...job, settlement: legacySettlement(job, now.getTime()) } : job),
    payments: [],
    settings: { hourlyRate: 120 },
    timer: null,
  };
}
