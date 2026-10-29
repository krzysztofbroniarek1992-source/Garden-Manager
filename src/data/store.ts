import { finishWork, startWork, stopActiveTimer, type Client, type Data, type Garden, type Job } from '../domain';
import type { DataRepository } from './repository';

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(existing => existing.id === item.id) ? items.map(existing => existing.id === item.id ? item : existing) : [...items, item];
}

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

  saveGarden = (garden: Garden) => this.commit(data => ({ ...data, gardens: upsert(data.gardens, { ...garden, name: garden.name.trim() }) }));

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
    return { ...next, jobs: upsert(next.jobs, updated) };
  });

  deleteJob = (id: string) => this.commit(data => {
    if (data.timer?.jobId === id) throw new Error('Najpierw zatrzymaj stoper tego zlecenia.');
    return { ...data, jobs: data.jobs.filter(job => job.id !== id) };
  });

  startTimer = (jobId: string) => this.commit(data => startWork(data, jobId, this.clock()));
  stopTimer = () => this.commit(data => stopActiveTimer(data, this.clock()));
  completeJob = (jobId: string) => this.commit(data => finishWork(data, jobId, this.clock()));
  setRate = (rate: number) => this.commit(data => ({ ...data, settings: { ...data.settings, hourlyRate: rate } }));
}
