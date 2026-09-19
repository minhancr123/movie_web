import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Cake, MapPin, Clapperboard, Star } from 'lucide-react';
import { getPersonDetail } from '@/lib/catalog';

interface PageParams {
  params: { id: string };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const person = await getPersonDetail(params.id);
  if (!person) return { title: 'Không tìm thấy' };
  return {
    title: `${person.name} - Diễn viên`,
    description: person.biography.slice(0, 155) || `Phim của ${person.name}.`,
  };
}

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y ? `${d || ''}/${m || ''}/${y}`.replace(/^\/|\/$/g, '') : iso;
};

export default async function PersonPage({ params }: PageParams) {
  const person = await getPersonDetail(params.id);
  if (!person) notFound();

  const facts = [
    person.birthday && {
      icon: <Cake size={16} className="text-amber-gold" />,
      label: person.deathday ? `Mất ${formatDate(person.deathday)}` : `Sinh ${formatDate(person.birthday)}`,
    },
    person.placeOfBirth && {
      icon: <MapPin size={16} className="text-amber-gold" />,
      label: person.placeOfBirth,
    },
    person.knownFor && {
      icon: <Clapperboard size={16} className="text-amber-gold" />,
      label: person.knownFor,
    },
  ].filter(Boolean) as { icon: React.ReactNode; label: string }[];

  return (
    <div className="pb-16">
      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        <div className="mx-auto w-44 md:mx-0 md:w-full">
          <div className="relative aspect-[2/3] overflow-hidden rounded-2xl border border-white/10 shadow-glass-card">
            {person.profile ? (
              <Image
                src={person.profile}
                alt={person.name}
                fill
                sizes="240px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-container font-syne text-5xl text-cinema-subtle">
                {person.name.charAt(0)}
              </div>
            )}
          </div>
        </div>

        <div>
          <h1 className="font-syne text-display-hero-mobile text-white md:text-display-hero">
            {person.name}
          </h1>

          {facts.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-cinema-muted">
              {facts.map((fact) => (
                <span key={fact.label} className="flex items-center gap-2">
                  {fact.icon}
                  {fact.label}
                </span>
              ))}
            </div>
          )}

          {person.biography ? (
            <div className="mt-5 max-w-3xl">
              {person.biographyLang === 'en' && (
                <p className="mb-2 inline-block rounded-full border border-amber-primary/40 bg-amber-primary/10 px-3 py-1 text-xs font-semibold text-amber-gold">
                  Tiểu sử tiếng Anh — chưa có bản tiếng Việt
                </p>
              )}
              <p className="whitespace-pre-line text-sm leading-relaxed text-cinema-text">
                {person.biography}
              </p>
            </div>
          ) : (
            <p className="mt-5 text-sm text-cinema-subtle">Chưa có tiểu sử tiếng Việt.</p>
          )}
        </div>
      </div>

      {person.filmography.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-5 border-l-4 border-amber-primary pl-3 font-syne text-headline-lg uppercase text-white">
            Phim đã tham gia
          </h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
            {person.filmography.map((credit) => (
              <Link
                key={`${credit.mediaType}-${credit.tmdbId}`}
                href={`/phim/${credit.mediaType}/${credit.tmdbId}/phim`}
                className="group"
              >
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-surface-container transition-colors group-hover:border-amber-primary/40">
                  {credit.poster ? (
                    <Image
                      src={credit.poster}
                      alt={credit.title}
                      fill
                      sizes="200px"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-cinema-subtle">
                      {credit.title}
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-1 text-sm font-semibold text-white group-hover:text-amber-gold">
                  {credit.title}
                </p>
                <p className="line-clamp-1 text-xs text-cinema-subtle">
                  {credit.character}
                  {credit.year ? ` · ${credit.year}` : ''}
                  {credit.voteAverage > 0 ? ` · ★ ${credit.voteAverage.toFixed(1)}` : ''}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
