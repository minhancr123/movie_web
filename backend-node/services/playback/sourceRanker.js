/**
 * Pick the source that plays, not the source that looks best on paper.
 *
 * The whole design avoids video transcoding: a 4K HEVC re-encode needs a GPU we
 * do not have and would cost more than the rest of the stack combined. So
 * instead of downscaling a stream to fit a client, we pick a source the client
 * can already decode and only remux the container.
 *
 * Ranking therefore runs against the *client's* capabilities:
 *   - Safari / Edge with HEVC         -> prefer 2160p HEVC
 *   - Chrome / Firefox without HEVC   -> prefer 1080p H.264, never HEVC
 *   - No HDR support                  -> avoid Dolby Vision / HDR10+ (washed-out
 *                                        colours are worse than 1080p SDR)
 *
 * Bitrate targets 15-30 Mbps: below that 4K looks soft, above it REMUX sources
 * waste bandwidth for no visible gain on a consumer display.
 */

/* ---------------------------------------------------------- label parsing */

const RESOLUTION_PATTERNS = [
  [2160, /\b(2160p|4k|uhd)\b/i],
  [1440, /\b1440p\b/i],
  [1080, /\b1080p\b/i],
  [720, /\b720p\b/i],
  [480, /\b(480p|sd)\b/i],
];

const parseResolution = (label) => {
  for (const [height, pattern] of RESOLUTION_PATTERNS) {
    if (pattern.test(label)) return height;
  }
  return null;
};

const parseCodec = (label) => {
  if (/\b(hevc|h\.?265|x265)\b/i.test(label)) return 'hevc';
  if (/\b(av1)\b/i.test(label)) return 'av1';
  if (/\b(avc|h\.?264|x264)\b/i.test(label)) return 'h264';
  if (/\b(vp9)\b/i.test(label)) return 'vp9';
  return null;
};

/**
 * HDR flavour matters for compatibility, not just quality:
 * Dolby Vision profile 5 has no SDR fallback, so an SDR client shows grey mush.
 */
const parseHdr = (label) => {
  if (/\b(dolby\s*vision|dovi|dv)\b/i.test(label)) return 'dolbyvision';
  // Check the +/plus variants first, and match `hdr10` explicitly: `\bhdr\b`
  // alone never matches inside "HDR10" because r->1 is not a word boundary.
  if (/\bhdr10\s*(\+|plus)/i.test(label)) return 'hdr10plus';
  if (/\bhdr10\b/i.test(label)) return 'hdr10';
  if (/\bhlg\b/i.test(label)) return 'hlg';
  if (/\bhdr\b/i.test(label)) return 'hdr10';
  return null;
};

const parseSource = (label) => {
  if (/\bremux\b/i.test(label)) return 'remux';
  if (/\b(blu-?ray|bdrip|bd25|bd50)\b/i.test(label)) return 'bluray';
  if (/\bweb-?dl\b/i.test(label)) return 'webdl';
  if (/\bweb-?rip\b/i.test(label)) return 'webrip';
  if (/\b(hdtv|hdrip)\b/i.test(label)) return 'hdtv';
  if (/\b(dvdrip|dvd)\b/i.test(label)) return 'dvd';
  if (/\b(cam|ts|telesync|telecine|tc|hdcam)\b/i.test(label)) return 'cam';
  return null;
};

const parseAudio = (label) => {
  // Release names glue the layout straight onto the codec — DDP5.1, DD5.1,
  // TrueHD7.1 — so \b does not fire between the letter and the digit, and a
  // \b-anchored pattern silently misses the most common spelling of all.
  // Anchor on "not part of a longer number" instead.
  // Only a preceding digit is disqualifying (so "2015.1080p" cannot read as
  // 5.1). A dot is the usual separator — "DTS-HD.MA.5.1" must still match.
  const layout = (pattern) => new RegExp(`(?<!\\d)${pattern}(?!\\d)`).test(label);
  const channels = layout('7\\.1') ? 8 : layout('5\\.1') ? 6 : layout('2\\.0') || /\bstereo\b/i.test(label) ? 2 : null;

  // Same problem on the codec side: allow a digit to follow the token.
  const codecToken = (pattern) => new RegExp(`(?:^|[^a-z0-9])(?:${pattern})(?![a-z])`, 'i').test(label);

  const lossless = codecToken('truehd|dts-?hd|dts-?x|flac|atmos|pcm|lpcm');
  // Strictly E-AC-3 (DDP / DD+), which is what the client capability flag means.
  // Plain DD / AC-3 is a different codec and is covered by browserFriendly.
  const eac3 = codecToken('e-?ac-?3|eac3|ddp|dd\\+');
  const otherUnsupported = codecToken('ac-?3|dd|dts|mp2|vorbis');

  return {
    channels,
    // These cannot be passed through in fMP4 for a browser: they must be
    // re-encoded to AAC, which is cheap for audio but still a cost signal.
    lossless,
    eac3,
    /**
     * True only when the label positively shows audio the browser accepts
     * as-is, mirroring isBrowserAudioCodec() in remuxService: AAC-LC / MP3 /
     * Opus at stereo or less. Unknown stays false, so a missing label never
     * earns the direct-play bonus by accident.
     */
    browserFriendly:
      codecToken('aac|mp3|opus')
      && !lossless
      && !eac3
      && !otherUnsupported
      && (channels === null || channels <= 2),
  };
};

/**
 * Container, from the filename or a label that spells it out.
 *
 * This matters operationally, not for quality: an MP4 whose codecs the browser
 * accepts is served as a direct TorBox link, so not one byte crosses our
 * server. Anything else goes through ffmpeg remux and every byte is our egress.
 * MKV cannot be played by MSE at all, whatever is inside it.
 */
const parseContainer = (label) => {
  if (/\.mkv\b|\bmatroska\b/i.test(label)) return 'mkv';
  if (/\.(mp4|m4v)\b/i.test(label)) return 'mp4';
  if (/\.(avi|ts|m2ts|mov|webm)\b/i.test(label)) return 'other';
  return null;
};

/** `💾 38.2 GB`, `[24.5 GiB]`, `1500 MB` -> bytes. */
const parseSizeFromLabel = (label) => {
  const match = /(\d+(?:[.,]\d+)?)\s*(gib|gb|mib|mb)\b/i.exec(label);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'gib' ? 1024 ** 3 : unit === 'gb' ? 1e9 : unit === 'mib' ? 1024 ** 2 : 1e6;
  return Math.round(value * multiplier);
};

const parseSeeds = (label) => {
  const match = /(?:👤|seeds?|seeders?)[^\d]{0,4}(\d+)/i.exec(label);
  return match ? Number(match[1]) : null;
};

/* --------------------------------------------------------- title validation */

/**
 * Addons key purely on IMDb id, and that mapping is crowd-sourced, so a tracker
 * can and does attach an unrelated torrent to a title: tt22084616 (Spider-Man:
 * Brand New Day) currently returns an "Iron Man 2008" release. Nothing
 * downstream would catch it — ffprobe happily plays the wrong movie — so the
 * release name has to be checked against the catalog title here.
 */

/** Drop accents/punctuation so "Spider-Man" and "Spider Man" compare equal. */
const normalizeTitle = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words too common to prove anything about which film a release is. */
const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for',
  'movie', 'film', 'part', 'chapter', 'vol', 'volume',
]);

const titleTokens = (value) =>
  normalizeTitle(value)
    .split(' ')
    .filter((token) => token.length > 1 && !TITLE_STOPWORDS.has(token));

/**
 * Release names carry resolution/codec/group noise after the title, so we ask
 * only that the expected title's significant words all appear. A release whose
 * name misses them is about a different film.
 *
 * Returns `{ matched, ratio, yearConflict }`; `expected` may hold several
 * aliases (localized title + original title), any one of which is enough.
 */
export const matchesTitle = (text, expectedTitles = [], expectedYear = null) => {
  const haystack = normalizeTitle(text);
  if (!haystack) return { matched: false, ratio: 0, yearConflict: false };

  const aliases = (Array.isArray(expectedTitles) ? expectedTitles : [expectedTitles])
    .map(titleTokens)
    .filter((tokens) => tokens.length > 0);

  // No usable title to compare against: do not block playback on a guess.
  if (!aliases.length) return { matched: true, ratio: 1, yearConflict: false };

  let bestRatio = 0;
  for (const tokens of aliases) {
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    bestRatio = Math.max(bestRatio, hits / tokens.length);
  }

  // A release naming a different year than the catalog is a strong mismatch
  // signal, but only when it disagrees: many pre-release names omit the year.
  let yearConflict = false;
  if (Number.isInteger(expectedYear) && expectedYear > 1900) {
    const years = (haystack.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    if (years.length && !years.some((year) => Math.abs(year - expectedYear) <= 1)) {
      yearConflict = true;
    }
  }

  return { matched: bestRatio >= 0.7 && !yearConflict, ratio: bestRatio, yearConflict };
};

/** Releases that routinely fail to play or look terrible. */
const isJunk = (label) =>
  /\b(cam|hdcam|telesync|telecine|\bts\b|\btc\b|screener|\bscr\b)\b/i.test(label) ||
  /\b(sample|trailer)\b/i.test(label) ||
  /\b(hc|hardcoded)\s*sub/i.test(label);

/** Pull every usable signal out of a free-form addon label. */
export const parseCandidate = (candidate, { expectedTitles = [], expectedYear = null } = {}) => {
  const label = String(candidate.label || '');
  const filename = String(candidate.filename || '');
  const text = `${label}\n${filename}`;

  const sizeBytes = candidate.sizeBytes || parseSizeFromLabel(text);
  const title = matchesTitle(text, expectedTitles, expectedYear);

  return {
    ...candidate,
    resolution: parseResolution(text),
    // A codec ffprobe actually saw beats anything the release name claims.
    codec: candidate.probedCodec || parseCodec(text),
    hdr: parseHdr(text),
    container: parseContainer(text),
    releaseSource: parseSource(text),
    audio: parseAudio(text),
    sizeBytes,
    seeds: candidate.seeds ?? parseSeeds(text),
    junk: isJunk(text),
    titleMatched: title.matched,
    titleRatio: title.ratio,
    yearConflict: title.yearConflict,
  };
};

/* ------------------------------------------------------- client capabilities */

/**
 * Normalize what the browser told us it can do.
 * Defaults are deliberately conservative: an unknown client gets H.264 1080p SDR,
 * which plays essentially everywhere.
 */
export const normalizeCapabilities = (caps = {}) => ({
  hevc: Boolean(caps.hevc),
  av1: Boolean(caps.av1),
  hdr: Boolean(caps.hdr),
  maxHeight: Number(caps.maxHeight) > 0 ? Number(caps.maxHeight) : 1080,
  // Mbps the client says it can sustain; 0 means "unknown, do not filter".
  maxBitrateMbps: Number(caps.maxBitrateMbps) > 0 ? Number(caps.maxBitrateMbps) : 0,
  eac3: Boolean(caps.eac3),
});

/* --------------------------------------------------------------- estimation */

/** Bitrate in Mbps from size and runtime; null when either is unknown. */
export const estimateBitrateMbps = (sizeBytes, runtimeMinutes) => {
  if (!sizeBytes || !runtimeMinutes || runtimeMinutes <= 0) return null;
  return (sizeBytes * 8) / (runtimeMinutes * 60) / 1e6;
};

/** Ideal window per resolution: enough for transparency, not wasteful. */
const BITRATE_TARGET = {
  2160: { min: 15, ideal: 25, max: 60 },
  1440: { min: 8, ideal: 14, max: 35 },
  1080: { min: 4, ideal: 10, max: 25 },
  720: { min: 2, ideal: 5, max: 12 },
  480: { min: 1, ideal: 2, max: 6 },
};

const SOURCE_SCORE = {
  remux: 28, // untouched disc stream, but often 50-80 Mbps
  bluray: 30,
  webdl: 34, // best bitrate-per-byte, our preferred tier
  webrip: 22,
  hdtv: 12,
  dvd: 4,
  cam: -1000,
};

/* ------------------------------------------------------------------ scoring */

/**
 * Score one candidate for one client. Returns `{ score, playable, reasons }`.
 * `playable: false` means "do not offer this at all" rather than "rank last".
 *
 * `videoTranscode` (`{ allowed, hardware }`) marks sources the server can
 * re-encode: a codec the browser cannot decode stays playable via an
 * on-the-fly AVC transcode instead of being rejected. Mirrors the realtime
 * rule in remuxService.planCodecTranscode — software transcode above 1080p
 * never reaches realtime, so those stay rejected.
 */
export const scoreCandidate = (candidate, caps, { runtimeMinutes = null, videoTranscode = null, expectedTitles = [] } = {}) => {
  const reasons = [];
  let score = 0;

  if (candidate.junk) {
    return { score: -1000, playable: false, reasons: ['bản cam/sample/hardsub'] };
  }

  // Wrong film entirely: addons map by IMDb id and that mapping can be wrong,
  // so a mismatched release name is fatal no matter how good the quality looks.
  if (candidate.titleMatched === false) {
    return {
      score: -1000,
      playable: false,
      reasons: [
        candidate.yearConflict
          ? 'tên/năm bản phát hành không khớp phim đang xem'
          : 'tên bản phát hành không khớp phim đang xem',
      ],
    };
  }

  // MediaSource reporting HEVC support says nothing about throughput. The
  // frozen real-world source was 1080p Main10 at 143.98 fps: supported on
  // paper, but far beyond a normal movie decode path. Once ffprobe exposes
  // that fact, never rank the release as playable again.
  const probedFrameRate = Number(candidate.probedFrameRate);
  if (Number.isFinite(probedFrameRate) && probedFrameRate > 60.01) {
    return {
      score: -1000,
      playable: false,
      reasons: [`${probedFrameRate.toFixed(2)} fps vượt ngưỡng phát ổn định 60 fps`],
    };
  }

  // --- codec: the hard gate, unless the server can re-encode. Serving a raw
  // HEVC stream to a Chrome user means a black screen, but a server-side
  // AVC transcode of the same release plays fine — worse than native, so it
  // ranks below directly-playable sources, but far better than unwatchable.
  for (const { codec, label } of [
    { codec: 'hevc', label: 'HEVC' },
    { codec: 'av1', label: 'AV1' },
  ]) {
    if (candidate.codec === codec && !caps[codec]) {
      const vt = videoTranscode || { allowed: false, hardware: false };
      const srcH = Number(candidate.resolution) || 0;
      const capH = Number(caps.maxHeight) > 0 ? Number(caps.maxHeight) : 1080;
      const targetH = srcH ? Math.min(srcH, capH) : capH;
      const realtime = targetH <= 1080 || vt.hardware;
      if (vt.allowed && realtime) {
        score -= 30;
        reasons.push(`server transcode ${label}→AVC ${targetH}p`);
        break;
      }
      return {
        score: -1000,
        playable: false,
        reasons: [
          targetH > 1080 && vt.allowed && !vt.hardware
            ? `${label} 4K cần GPU transcode, server hiện không có`
            : `client không giải mã được ${label}`,
        ],
      };
    }
  }

  if (candidate.codec === 'hevc') {
    // Roughly half the bytes of H.264 at equal quality.
    score += 22;
    reasons.push('HEVC (hiệu quả gấp ~2× H.264)');
  } else if (candidate.codec === 'h264') {
    score += 14;
    reasons.push('H.264 (tương thích rộng nhất)');
  } else if (candidate.codec === 'av1') {
    score += 18;
  } else {
    // Unknown codec: ffprobe will tell us the truth later, so don't exclude it.
    score += 6;
    reasons.push('codec chưa rõ, sẽ xác nhận bằng ffprobe');
  }

  // --- resolution: capped by what the client can display.
  const height = candidate.resolution;
  if (height) {
    if (height > caps.maxHeight) {
      // Not fatal, just wasteful: penalise heavily but keep as a fallback.
      score -= 25;
      reasons.push(`${height}p vượt quá ${caps.maxHeight}p của client`);
    } else {
      score += Math.min(height / 60, 36); // 2160p -> 36, 1080p -> 18
      reasons.push(`${height}p`);
    }
  }

  // --- HDR: a mismatch looks actively broken, so treat it as near-fatal.
  if (candidate.hdr && !caps.hdr) {
    if (candidate.hdr === 'dolbyvision') {
      // DV profile 5 has no SDR base layer: colours come out grey-green.
      return { score: -1000, playable: false, reasons: ['Dolby Vision không có bản SDR dự phòng'] };
    }
    score -= 18;
    reasons.push('HDR trên màn SDR sẽ bị bạc màu');
  } else if (candidate.hdr && caps.hdr) {
    score += 8;
    reasons.push(candidate.hdr.toUpperCase());
  }

  // --- container: purely an egress lever, so it must not outrank quality.
  //
  // Direct play needs BOTH an MP4 container AND audio the browser takes as-is.
  // MP4 + AAC stereo is served as a TorBox link and costs us nothing; MP4 with
  // EAC3/DTS still goes through remux, so it earns nothing over an MKV. In
  // practice almost every 2160p release is MKV, so treat this as a tie-breaker
  // between otherwise comparable sources, never a reason to take a worse one.
  if (candidate.container === 'mp4') {
    if (candidate.audio?.browserFriendly) {
      score += 12;
      reasons.push('MP4 + audio tương thích: phát thẳng, không tốn băng thông server');
    } else {
      score += 2;
      reasons.push('MP4 nhưng audio phải encode lại nên vẫn cần remux');
    }
  }

  // --- release source
  if (candidate.releaseSource) {
    score += SOURCE_SCORE[candidate.releaseSource] ?? 0;
    reasons.push(candidate.releaseSource);
  }

  // --- bitrate: the single best predictor of both quality and stall risk.
  const bitrate = estimateBitrateMbps(candidate.sizeBytes, runtimeMinutes);
  if (bitrate && height) {
    const target = BITRATE_TARGET[height] || BITRATE_TARGET[1080];
    if (bitrate < target.min) {
      score -= 20;
      reasons.push(`chỉ ${bitrate.toFixed(1)} Mbps, thấp hơn ngưỡng ${target.min} cho ${height}p`);
    } else if (bitrate > target.max) {
      score -= 12;
      reasons.push(`${bitrate.toFixed(1)} Mbps quá cao, tốn băng thông vô ích`);
    } else {
      // Closer to ideal is better; full marks at the ideal point.
      const distance = Math.abs(bitrate - target.ideal) / target.ideal;
      score += Math.max(0, 20 * (1 - distance));
      reasons.push(`${bitrate.toFixed(1)} Mbps`);
    }

    if (caps.maxBitrateMbps && bitrate > caps.maxBitrateMbps) {
      score -= 30;
      reasons.push(`vượt băng thông client (${caps.maxBitrateMbps} Mbps)`);
    }
  } else if (candidate.sizeBytes && !runtimeMinutes) {
    // No runtime: fall back to raw size as a weak proxy.
    score += Math.min(candidate.sizeBytes / 1e9, 10);
  }

  // --- audio: lossless tracks must be re-encoded to AAC for fMP4.
  if (candidate.audio?.lossless) {
    score -= 4;
    reasons.push('audio lossless, phải encode lại sang AAC');
  }
  if (candidate.audio?.eac3 && !caps.eac3) {
    score -= 2;
  }
  if (candidate.audio?.channels >= 6) {
    score += 3;
  }

  // --- availability: a torrent with no seeds never finishes downloading.
  if (typeof candidate.seeds === 'number') {
    if (candidate.seeds === 0) {
      score -= 40;
      reasons.push('0 seed');
    } else {
      score += Math.min(Math.log2(candidate.seeds + 1) * 2, 12);
    }
  }

  // --- already on the debrid box: seconds to first frame instead of minutes.
  if (candidate.cached) {
    score += 45;
    reasons.push('đã có sẵn trên TorBox (phát ngay)');
  }

  return { score: Math.round(score * 10) / 10, playable: true, reasons };
};

/**
 * Rank every candidate for this client and return them best-first.
 * Unplayable entries are kept but flagged, so the UI can explain *why* a 4K
 * release is not being offered instead of silently hiding it.
 */
export const rankCandidates = (
  candidates,
  rawCaps,
  { runtimeMinutes = null, expectedTitles = [], expectedYear = null, videoTranscode = null } = {},
) => {
  const caps = normalizeCapabilities(rawCaps);

  const ranked = (candidates || [])
    .map((candidate) => {
      const parsed = parseCandidate(candidate, { expectedTitles, expectedYear });
      const { score, playable, reasons } = scoreCandidate(parsed, caps, { runtimeMinutes, videoTranscode, expectedTitles });
      return { ...parsed, score, playable, reasons };
    })
    .sort((a, b) => {
      if (a.playable !== b.playable) return a.playable ? -1 : 1;
      return b.score - a.score;
    });

  return {
    caps,
    best: ranked.find((candidate) => candidate.playable) || null,
    playable: ranked.filter((candidate) => candidate.playable),
    rejected: ranked.filter((candidate) => !candidate.playable),
  };
};

export default {
  parseCandidate,
  normalizeCapabilities,
  scoreCandidate,
  rankCandidates,
  estimateBitrateMbps,
  matchesTitle,
};
