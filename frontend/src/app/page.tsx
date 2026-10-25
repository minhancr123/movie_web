import { connection } from 'next/server';
import { getHome, catalogHref, CatalogItem } from '@/lib/catalog';
import type { HeroMovie } from '@/components/HeroSection';
import CatalogCard from '@/components/CatalogCard';
import CatalogRow from '@/components/CatalogRow';
import ContinueWatchingRow from '@/components/ContinueWatchingRow';
import HeroSection from '@/components/HeroSection';
import HeroWithResume from '@/components/HeroWithResume';
import RecommendationsRow from '@/components/RecommendationsRow';
import SpatialShader from '@/components/SpatialShader';
import SurpriseMe from '@/components/SurpriseMe';

/**
 * HeroSection still speaks the legacy Movie shape. Rather than rewrite its
 * carousel, map the catalog DTO onto it and hand it the canonical href.
 */
const toHeroMovie = (item: CatalogItem): HeroMovie => ({
  _id: item.contentRef,
  name: item.title,
  origin_name: item.originalTitle,
  slug: item.slug,
  poster_url: item.poster,
  thumb_url: item.backdrop || item.poster,
  year: item.year ?? 0,
  href: catalogHref(item),
});

export default async function Home() {
  // Builds cannot reach the compose backend. Never publish their empty fallback
  // as the homepage; render against the running API on each incoming request.
  // `connection()` keeps the route out of build-time prerendering only — the
  // home rows themselves come from the fetch Data Cache (REVALIDATE.home,
  // 300s), so a pageview no longer pays the API/TMDB hop on every request.
  await connection();
  const { trending, popularMovies, popularTv, topRatedMovies } = await getHome();

  const heroItems = trending.filter((item) => item.backdrop).slice(0, 6);

  if (trending.length === 0) {
    return (
      <div className="glass-panel mt-8 rounded-3xl py-24 px-6 text-center">
        <h1 className="font-syne text-headline-xl text-white">Chưa tải được danh sách phim</h1>
        <p className="mt-3 text-body-lg text-cinema-muted">
          Danh sách phim đang tạm thời gián đoạn. Vui lòng thử lại sau ít giây.
        </p>
        <a href="/" className="mt-6 inline-flex rounded-xl bg-amber-primary px-5 py-3 font-semibold text-black">Thử lại</a>
      </div>
    );
  }

  return (
    <div className="relative pb-8">
      {/* Realtime WebGL cinematic shader backdrop (Stitch visionOS) */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40">
        <SpatialShader opacity={1} speed={1.4} />
      </div>

      <div className="relative z-10">
        {heroItems.length > 0 && <HeroWithResume fallback={heroItems.map(toHeroMovie)} />}

        <div className="mt-8">
          <ContinueWatchingRow />
          <RecommendationsRow />
        </div>

      <div className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="border-l-4 border-amber-primary pl-3">
          <span className="font-mono text-label-md uppercase text-amber-gold">Tuyển chọn hôm nay</span>
          <h1 className="font-syne text-headline-md md:text-headline-xl text-white">
            Thịnh hành tuần này
          </h1>
        </div>
        <SurpriseMe items={[...trending, ...popularMovies, ...popularTv]} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
        {trending.map((item, index) => (
          <CatalogCard key={item.contentRef} item={item} priority={index < 5} />
        ))}
      </div>

      <div className="mt-12 pt-8 space-y-4">
        <CatalogRow
          title="Phim lẻ phổ biến"
          items={popularMovies}
          path="/kham-pha?type=movie"
        />
        <CatalogRow title="Phim bộ phổ biến" items={popularTv} path="/kham-pha?type=tv" />
        <CatalogRow
          title="Đánh giá cao nhất"
          items={topRatedMovies}
          path="/kham-pha?type=movie&sort=top"
        />
      </div>
      </div>
    </div>
  );
}
