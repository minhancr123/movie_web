import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';
const report = path.resolve(process.cwd(), '../.codex-artifacts/audio-clock/samples.json');
const local = (req: NextRequest) => process.env.NODE_ENV === 'development'
    && ['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname);

export async function POST(req: NextRequest) {
    if (!local(req)) return new NextResponse(null, { status: 404 });
    const raw = await req.text();
    if (raw.length > 12000) return new NextResponse(null, { status: 413 });
    const data = JSON.parse(raw);
    // Numeric playback state only. Never persist URLs, cookies or credentials.
    const clean = (sample: Record<string, unknown>) => Object.fromEntries(
        Object.entries(sample).filter(([key, value]) =>
            /^(audioFound|audioClarity|audioWiden|audioGraph|audioFailed|audioState|t|wall|paused|ended|ready|network|total|dropped|error|width|height|hidden|ambientOff|presented|raf|sourceChanged|waiting|playing|seeking|seeked|stalled)$/.test(key)
            && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))),
    );
    const samples = [data.before, data.after].map((sample) => ({
        ...clean(sample),
        buffer: Array.isArray(sample.buffer) ? sample.buffer.slice(0, 20).filter((pair: unknown) =>
            Array.isArray(pair) && pair.length === 2 && pair.every((n) => typeof n === 'number' && Number.isFinite(n))) : [],
    }));
    await writeFile(report, JSON.stringify({ receivedAt: new Date().toISOString(), samples }, null, 2));
    return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
    if (!local(req)) return new NextResponse(null, { status: 404 });
    try { return new NextResponse(await readFile(report, 'utf8'), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    catch { return NextResponse.json({ pending: true }); }
}
