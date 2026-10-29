export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export interface Garden {
  id: string;
  clientId: string;
  name: string;
  address: string;
  area: number;
  notes: string;
}

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Job {
  id: string;
  gardenId: string;
  title: string;
  date: string;
  time: string;
  status: 'planned' | 'in-progress' | 'completed';
  billing: 'hourly' | 'fixed';
  rate: number;
  fixedPrice: number;
  seconds: number;
  materials: Material[];
  notes: string;
}

export interface Timer {
  jobId: string;
  startedAt: number;
}

export interface Data {
  clients: Client[];
  gardens: Garden[];
  jobs: Job[];
  settings: { hourlyRate: number };
  timer: Timer | null;
}

/** YYYY-MM-DD in the device's local timezone, without UTC date shifts. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function elapsedSeconds(job: Job, timer: Timer | null = null, now = Date.now()): number {
  return job.seconds + (timer?.jobId === job.id ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0);
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function jobLabor(job: Job, now = Date.now(), timer: Timer | null = null): number {
  return job.billing === 'fixed' ? job.fixedPrice : roundMoney((elapsedSeconds(job, timer, now) / 3600) * job.rate);
}

export function materialsTotal(job: Job): number {
  return roundMoney(job.materials.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
}

export function jobTotal(job: Job, now = Date.now(), timer: Timer | null = null): number {
  return roundMoney(jobLabor(job, now, timer) + materialsTotal(job));
}

export function money(value: number): string {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(value);
}

export function duration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60].map(value => String(value).padStart(2, '0')).join(':');
}

/** Stop commits elapsed wall time; no interval or open browser tab is required. */
export function stopActiveTimer(data: Data, now = Date.now()): Data {
  const timer = data.timer;
  if (!timer) return data;
  return {
    ...data,
    timer: null,
    jobs: data.jobs.map(job => job.id === timer.jobId ? { ...job, seconds: elapsedSeconds(job, timer, now) } : job),
  };
}

export function startWork(data: Data, jobId: string, now = Date.now()): Data {
  const job = data.jobs.find(item => item.id === jobId);
  if (!job) throw new Error('Nie znaleziono zlecenia.');
  if (job.status === 'completed') throw new Error('Nie można uruchomić stopera zakończonego zlecenia.');
  if (data.timer?.jobId === jobId) return data;
  if (data.timer) throw new Error('Najpierw zatrzymaj aktywny stoper.');
  return {
    ...data,
    jobs: data.jobs.map(item => item.id === jobId ? { ...item, status: 'in-progress' } : item),
    timer: { jobId, startedAt: now },
  };
}

export function finishWork(data: Data, jobId: string, now = Date.now()): Data {
  if (!data.jobs.some(job => job.id === jobId)) throw new Error('Nie znaleziono zlecenia.');
  const stopped = data.timer?.jobId === jobId ? stopActiveTimer(data, now) : data;
  return { ...stopped, jobs: stopped.jobs.map(job => job.id === jobId ? { ...job, status: 'completed' } : job) };
}
