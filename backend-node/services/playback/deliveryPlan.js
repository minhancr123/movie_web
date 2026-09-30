/**
 * How much stream a viewer gets, and whether there is room to give it.
 *
 * Two decisions live here, both pure so the rules stay regression-testable:
 * which rung of the ladder a client should be served, and whether the uplink
 * can afford another session at that rung.
 */

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Rungs, widest first. Heights are the cap, not a promise: a 720p source is
 * never upscaled, it is simply passed through at its own size.
 */
export const LADDER = [
  { height: 1080, kbps: 6000 },
  { height: 720, kbps: 3200 },
  { height: 480, kbps: 1600 },
];

/**
 * What the uplink may spend on remote viewers, in kbps.
 *
 * Only remote sessions are counted against it. A LAN viewer never touches the
 * uplink, so charging them for it would turn watching at home into a reason
 * someone outside cannot watch at all.
 */
export const EGRESS_BUDGET_KBPS = positiveNumber(process.env.PLAYBACK_EGRESS_BUDGET_KBPS, 25000);

/** Assumed cost of a direct 4K remux, used only to describe LAN sessions. */
const REMUX_NOMINAL_KBPS = 25000;

/**
 * Chooses how to deliver one source.
 *
 * On the LAN the source is passed through untouched: transcoding there would
 * burn a GPU to make a stream worse over a link that never needed the help.
 *
 * Remote, the source is capped to a rung. Transcoding is only worth it when it
 * actually buys something — a source already inside both the height and the
 * bitrate of its rung is remuxed, because re-encoding it would spend a GPU to
 * lose a generation of quality and save nothing.
 */
export const planDelivery = ({
  lan = false,
  sourceHeight = null,
  sourceKbps = null,
  ladder = LADDER,
  maxRung = null,
  // False when the operator policy forbids video encoding: the ladder must
  // never promise a transcode it is not allowed to run. Defaults true so
  // existing callers keep the old behaviour until they pass the capability.
  canTranscode = true,
} = {}) => {
  if (lan) {
    return {
      mode: 'remux',
      reason: 'Client trong LAN — giữ nguyên chất lượng nguồn',
      height: sourceHeight,
      kbps: sourceKbps || REMUX_NOMINAL_KBPS,
      lan: true,
    };
  }

  if (!canTranscode) {
    // No narrower rung exists without an encoder: serve the source as-is
    // (remux shape) and let admission decide honestly whether the uplink
    // affords it, instead of dangling a transcode that can never run.
    return {
      mode: 'remux',
      reason: 'Chính sách tắt chuyển mã video — giữ nguyên chất lượng nguồn',
      height: sourceHeight,
      kbps: sourceKbps || REMUX_NOMINAL_KBPS,
      lan: false,
    };
  }

  const rungs = maxRung
    ? ladder.filter((r) => r.height <= maxRung)
    : ladder;
  const rung = rungs[0] || ladder[ladder.length - 1];

  const heightFits = Number.isFinite(sourceHeight) && sourceHeight > 0 && sourceHeight <= rung.height;
  const bitrateFits = Number.isFinite(sourceKbps) && sourceKbps > 0 && sourceKbps <= rung.kbps;

  if (heightFits && bitrateFits) {
    return {
      mode: 'remux',
      reason: `Nguồn ${sourceHeight}p ~${Math.round(sourceKbps)}kbps đã nằm trong hạn mức`,
      height: sourceHeight,
      kbps: sourceKbps,
      lan: false,
    };
  }

  return {
    mode: 'transcode',
    reason: `Ngoài LAN — hạ xuống ${rung.height}p @ ${rung.kbps}kbps`,
    // Never upscale: a 720p source served on the 1080p rung stays 720p.
    height: Number.isFinite(sourceHeight) && sourceHeight > 0
      ? Math.min(sourceHeight, rung.height)
      : rung.height,
    kbps: rung.kbps,
    lan: false,
  };
};

/**
 * Whether the uplink can take another remote session, and at which rung.
 *
 * Returning a narrower rung rather than a refusal is deliberate: someone who
 * asked for a film would rather have it at 720p than be told the server is
 * busy, and the alternative — admitting everyone at full rate — is how every
 * session ends up stuttering instead of one being asked to compromise.
 */
export const planAdmission = ({
  activeKbps = 0,
  lan = false,
  sourceHeight = null,
  sourceKbps = null,
  budgetKbps = EGRESS_BUDGET_KBPS,
  ladder = LADDER,
  canTranscode = true,
} = {}) => {
  if (lan) {
    const plan = planDelivery({ lan: true, sourceHeight, sourceKbps, ladder });
    // LAN traffic never crosses the uplink, so it is admitted regardless of
    // what remote viewers are already using.
    return { admitted: true, ...plan };
  }

  if (!canTranscode) {
    // One honest check at the source's own rate: no rung to squeeze into
    // without an encoder, so over budget means refused, not transcoded.
    const spent = Math.max(0, Number(activeKbps) || 0);
    const need = Number(sourceKbps) > 0 ? Number(sourceKbps) : REMUX_NOMINAL_KBPS;
    if (spent + need <= budgetKbps) {
      return {
        admitted: true,
        mode: 'remux',
        reason: `Nguồn ${sourceHeight || '?'}p ~${Math.round(need)}kbps vừa uplink (không chuyển mã)`,
        height: sourceHeight,
        kbps: need,
        lan: false,
      };
    }
    const narrowest = ladder[ladder.length - 1];
    return {
      admitted: false,
      mode: 'reject',
      reason: `Uplink đã dùng ${spent}/${budgetKbps}kbps, không đủ cho nguồn ~${Math.round(need)}kbps và chính sách tắt chuyển mã (bậc thấp nhất ${narrowest.kbps}kbps cũng cần encode)`,
      height: null,
      kbps: 0,
      lan: false,
    };
  }

  const spent = Math.max(0, Number(activeKbps) || 0);
  for (const rung of ladder) {
    const plan = planDelivery({ lan: false, sourceHeight, sourceKbps, ladder, maxRung: rung.height });
    if (spent + plan.kbps <= budgetKbps) {
      const squeezed = rung.height < ladder[0].height;
      return {
        admitted: true,
        ...plan,
        reason: squeezed
          ? `${plan.reason} (hạ bậc: uplink còn ${Math.max(0, budgetKbps - spent)}kbps)`
          : plan.reason,
      };
    }
  }

  const narrowest = ladder[ladder.length - 1];
  return {
    admitted: false,
    mode: 'reject',
    reason: `Uplink đã dùng ${spent}/${budgetKbps}kbps, không đủ cho cả bậc thấp nhất (${narrowest.kbps}kbps)`,
    height: null,
    kbps: 0,
    lan: false,
  };
};
