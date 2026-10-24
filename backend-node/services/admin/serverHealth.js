import os from "node:os";
import { getDB } from "../../config/database.js";

const cpuSample = () => {
  const cpus = os.cpus().map(c => ({ ...c.times }));
  return { cpus, total: cpus.reduce((a, c) => a + c.user + c.nice + c.sys + c.idle + c.irq, 0), busy: cpus.reduce((a, c) => a + c.user + c.nice + c.sys + c.irq, 0) };
};

export const getServerHealth = async (_req, res) => {
  try {
    let writersActive = 0;
    const writersMax = Number(process.env.REMUX_MAX_WRITERS) || 4;
    try {
      const { execSync } = await import("node:child_process");
      writersActive = parseInt(execSync("ps aux | grep \"[f]fmpeg\" | wc -l", { encoding: "utf8" }).trim()) || 0;
    } catch { /* best-effort */ }

    const s1 = cpuSample();
    await new Promise(r => setTimeout(r, 100));
    const s2 = cpuSample();
    const cpuPercent = s2.total > s1.total ? Math.round(((s2.busy - s1.busy) / (s2.total - s1.total)) * 100) : 0;

    let diskFreeGB = 0;
    try {
      const fsMod = await import("node:fs");
      const st = fsMod.statfsSync("/");
      diskFreeGB = Math.round(st.bavail * st.bsize / (1024 ** 3));
    } catch { /* best-effort */ }

    let activeViewers = 0;
    try {
      activeViewers = await getDB().collection("playback_sessions").countDocuments({
        expiresAt: { $gt: new Date() }, mode: { $in: ["remux", "direct"] },
      });
    } catch { /* best-effort */ }

    let sourceErrors = 0;
    try {
      sourceErrors = await getDB().collection("playback_sessions").countDocuments({
        mode: "failed", failedAt: { $gt: new Date(Date.now() - 3600000) },
      });
    } catch { /* best-effort */ }

    const totalMem = os.totalmem() / (1024 ** 3);
    const memPercent = Math.round(((totalMem - os.freemem() / (1024 ** 3)) / totalMem) * 100);

    const alerts = [];
    if (writersActive >= writersMax) alerts.push({ level: "warning", msg: "Writers đầy — cần R2 storage" });
    if (sourceErrors > 5) alerts.push({ level: "warning", msg: sourceErrors + " lỗi nguồn trong 1h — cần multi-debrid" });
    if (cpuPercent > 80) alerts.push({ level: "critical", msg: "CPU " + cpuPercent + "% — cần server remux riêng" });
    if (memPercent > 80) alerts.push({ level: "warning", msg: "RAM " + memPercent + "%" });
    if (diskFreeGB > 0 && diskFreeGB < 20) alerts.push({ level: "critical", msg: "Disk còn " + diskFreeGB + "GB" });

    return res.json({
      success: true,
      data: {
        writers: { active: writersActive, max: writersMax },
        cpu: { percent: cpuPercent, cores: os.cpus().length },
        memory: { percent: memPercent, totalGB: Math.round(totalMem) },
        disk: { freeGB: diskFreeGB },
        activeViewers, sourceErrorsLastHour: sourceErrors,
        egressMbps: Number(process.env.PLAYBACK_EGRESS_BUDGET_KBPS || 100000) / 1000,
        alerts, status: alerts.some(a => a.level === "critical") ? "critical" : alerts.length > 0 ? "warning" : "healthy",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
