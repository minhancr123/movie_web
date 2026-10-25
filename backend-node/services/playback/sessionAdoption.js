import fs from 'node:fs/promises';
import { completedSessionCovers } from './remuxWindow.js';

/** ENDLIST can be flushed by a killed FFmpeg, so check its interruption marker. */
export const selectAdoptableSession = async (rows, requestedStartAt, { sessionPath, isLive, readState }) => {
  for (const row of rows) {
    const origin = Number(row.startAt) || 0;
    const compatible = requestedStartAt === 0 ? origin <= 120 : Math.abs(origin - requestedStartAt) <= 120;
    if (!compatible) continue;
    try {
      if (await fs.access(sessionPath(row.sessionId, '.interrupted')).then(() => true, () => false)) continue;
      if (isLive(row.sessionId)) return row;
      const state = await readState(row.sessionId);
      if (state.ended && completedSessionCovers(origin, state.duration, requestedStartAt)) return row;
    } catch { /* unavailable producer; try another candidate */ }
  }
  return null;
};
