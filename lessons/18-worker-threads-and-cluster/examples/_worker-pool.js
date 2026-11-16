// Helper (not run by itself): a small reusable worker pool with a task queue.
// Used by examples 07 and 08.
//
//   const pool = new WorkerPool('/path/to/worker-script.js', 4);
//   const value = await pool.run({ type: 'primes', limit: 100000 });
//   await pool.close();
//
// Rules of the worker script: every message it receives is ONE task, and it must answer each task with
// exactly one message shaped like { ok: true, value } or { ok: false, error: 'text' }.

const { Worker } = require('node:worker_threads');
const os = require('node:os');

class WorkerPool {
  #file;
  #workers = new Set(); // every live worker
  #idle = []; // workers waiting for a task
  #queue = []; // jobs waiting for a worker: { task, resolve, reject }
  #running = new Map(); // worker -> the job it is working on
  #closed = false;

  constructor(file, size = os.availableParallelism()) {
    this.#file = file;
    for (let i = 0; i < size; i++) this.#spawn();
  }

  get stats() {
    return { workers: this.#workers.size, idle: this.#idle.length, running: this.#running.size, queued: this.#queue.length };
  }

  // Queue a task. The returned promise settles when a worker has answered it.
  run(task) {
    if (this.#closed) return Promise.reject(new Error('the pool is closed'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this.#dispatch();
    });
  }

  async close() {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) job.reject(new Error('the pool is closed'));
    await Promise.all([...this.#workers].map((worker) => worker.terminate()));
  }

  #spawn() {
    const worker = new Worker(this.#file);
    this.#workers.add(worker);

    worker.on('message', (reply) => {
      const job = this.#running.get(worker);
      if (!job) return;
      this.#running.delete(worker);
      if (reply.ok) job.resolve(reply.value);
      else job.reject(new Error(reply.error));
      this.#idle.push(worker); // the worker is free again
      this.#dispatch();
    });

    // A crash: the job fails now. The 'exit' event follows and takes care of the replacement.
    worker.on('error', (err) => this.#fail(worker, err));

    worker.on('exit', (code) => {
      this.#fail(worker, new Error(`worker exited with code ${code}`)); // does nothing if the job already failed
      this.#workers.delete(worker);
      this.#idle = this.#idle.filter((w) => w !== worker);
      if (!this.#closed) this.#spawn(); // keep the pool at full size
    });

    this.#idle.push(worker);
    this.#dispatch();
  }

  #fail(worker, err) {
    const job = this.#running.get(worker);
    if (!job) return;
    this.#running.delete(worker);
    job.reject(err);
  }

  // Match waiting jobs with idle workers, as long as both exist.
  #dispatch() {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.shift();
      const job = this.#queue.shift();
      this.#running.set(worker, job);
      worker.postMessage(job.task);
    }
  }
}

module.exports = { WorkerPool };
