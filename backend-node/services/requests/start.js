import { getDB } from '../../config/database.js';
import { createRequestWorker } from './worker.js';
import { createRuntimeRequestAdapter } from './adapter.js';
export function startMovieRequestWorker() {
  if (process.env.MOVIE_REQUEST_AUTOMATION_ENABLED !== 'true') return;
  const db = getDB(), worker = createRequestWorker({ db, adapter: createRuntimeRequestAdapter(db) });
  const run = () => worker.tick().catch(error => console.warn('[movie-requests] scheduler deferred', error.name));
  const initial = setTimeout(run, 15000); initial.unref();
  const timer = setInterval(run, 15000); timer.unref();
  console.log('[movie-requests] background automation enabled');
  return () => { clearTimeout(initial); clearInterval(timer); };
}
