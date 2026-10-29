import { finishWork, jobTotalCents, paidCents, startWork, stopActiveTimer, type Client, type Data, type Garden, type Job, type Payment } from '../domain';
import { validDate, type DataRepository } from './repository';

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(existing => existing.id === item.id) ? items.map(existing => existing.id === item.id ? item : existing) : [...items, item];
}

function samePayment(left: Payment, right: Payment): boolean {
  return left.id === right.id && left.jobId === right.jobId && left.amountCents === right.amountCents
    && left.receivedDate === right.receivedDate && left.method === right.method && left.note === right.note;
}

const paymentConflict = () => new Error('Płatność została zmieniona lub usunięta w innej karcie. Zamknij i otwórz ponownie szczegóły zlecenia, aby wczytać aktualne dane.');

/** Application commands live outside React and can be tested with any repository. */
export class GardenStore {
  data: Data;
  constructor(private readonly repository: DataRepository, private readonly clock = Date.now) {
    this.data = repository.load();
  }

  refresh() { this.data = this.repository.load(); }

  private commit(transform: (data: Data) => Data) {
    // Read latest snapshot for changes made by another tab before this command.
    const next = transform(this.repository.load());
    this.repository.save(next);
    this.data = next;
  }

  saveClient = (client: Client) => this.commit(data => ({ ...data, clients: upsert(data.clients, { ...client, name: client.name.trim() }) }));

  deleteClient = (id: string) => this.commit(data => {
    if (data.gardens.some(garden => garden.clientId === id)) throw new Error('Klient ma przypisane ogrody. Najpierw usuń lub przenieś jego ogrody.');
    return { ...data, clients: data.clients.filter(client => client.id !== id) };
  });

  saveGarden = (garden: Garden) => this.commit(data => {
    const existing = data.gardens.find(item => item.id === garden.id);
    if (existing && existing.clientId !== garden.clientId && data.jobs.some(job => job.gardenId === garden.id && data.payments.some(payment => payment.jobId === job.id))) {
      throw new Error('Ogród ma zlecenia z płatnościami. Nie można zmienić ich właściciela.');
    }
    return { ...data, gardens: upsert(data.gardens, { ...garden, name: garden.name.trim() }) };
  });

  deleteGarden = (id: string) => this.commit(data => {
    if (data.jobs.some(job => job.gardenId === id)) throw new Error('Ogród ma przypisane zlecenia. Najpierw usuń lub przenieś jego zlecenia.');
    return { ...data, gardens: data.gardens.filter(garden => garden.id !== id) };
  });

  saveJob = (job: Job) => this.commit(data => {
    let next = data;
    let updated = { ...job, title: job.title.trim() };
    if (data.timer?.jobId === job.id) {
      if (job.status === 'completed') {
        next = stopActiveTimer(data, this.clock());
        updated = { ...updated, seconds: next.jobs.find(item => item.id === job.id)!.seconds };
      } else {
        // An active timer owns its timing fields until it is stopped.
        updated = { ...updated, status: 'in-progress', seconds: data.jobs.find(item => item.id === job.id)!.seconds };
      }
    }
    const received = paidCents(job.id, data.payments);
    const existing = data.jobs.find(item => item.id === job.id);
    if (received > 0 && existing && existing.gardenId !== job.gardenId) {
      throw new Error('Zlecenie ma płatności. Nie można przenieść go do innego ogrodu.');
    }
    if (received > jobTotalCents(updated, this.clock(), next.timer)) {
      throw new Error('Wartość zlecenia nie może być niższa od otrzymanych płatności. Najpierw skoryguj błędną płatność.');
    }
    return { ...next, jobs: upsert(next.jobs, updated) };
  });

  deleteJob = (id: string) => this.commit(data => {
    if (data.timer?.jobId === id) throw new Error('Najpierw zatrzymaj stoper tego zlecenia.');
    if (data.payments.some(payment => payment.jobId === id)) throw new Error('Zlecenie ma płatności. Najpierw usuń błędne wpisy płatności.');
    return { ...data, jobs: data.jobs.filter(job => job.id !== id) };
  });

  savePayment = (payment: Payment, expected?: Payment | null) => this.commit(data => {
    const current = data.payments.find(item => item.id === payment.id);
    if ((expected === null && current) || (expected !== undefined && expected !== null && (!current || !samePayment(current, expected)))) {
      throw paymentConflict();
    }
    const job = data.jobs.find(item => item.id === payment.jobId);
    if (!job) throw new Error('Nie znaleziono zlecenia dla płatności.');
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error('Kwota płatności musi być dodatnia i podana w pełnych groszach.');
    if (!validDate(payment.receivedDate)) throw new Error('Podaj poprawną datę otrzymania płatności.');
    if (!['cash', 'transfer', 'blik', 'other'].includes(payment.method)) throw new Error('Wybierz poprawną metodę płatności.');
    const existing = data.payments.find(item => item.id === payment.id);
    if (existing && existing.jobId !== payment.jobId) throw new Error('Usuń błędną płatność i dodaj ją przy właściwym zleceniu.');
    const others = data.payments.filter(item => item.id !== payment.id);
    const available = jobTotalCents(job, this.clock(), data.timer) - paidCents(job.id, others);
    if (payment.amountCents > available) throw new Error('Kwota płatności przekracza należność za zlecenie.');
    return { ...data, payments: upsert(data.payments, { ...payment, note: payment.note.trim() }) };
  });

  deletePayment = (id: string, expected?: Payment) => this.commit(data => {
    const current = data.payments.find(payment => payment.id === id);
    if (expected && (!current || !samePayment(current, expected))) throw paymentConflict();
    if (!current) throw new Error('Nie znaleziono płatności.');
    return { ...data, payments: data.payments.filter(payment => payment.id !== id) };
  });

  startTimer = (jobId: string) => this.commit(data => startWork(data, jobId, this.clock()));
  stopTimer = () => this.commit(data => stopActiveTimer(data, this.clock()));
  completeJob = (jobId: string) => this.commit(data => finishWork(data, jobId, this.clock()));
  setRate = (rate: number) => this.commit(data => ({ ...data, settings: { ...data.settings, hourlyRate: rate } }));
}
