import { redirect } from 'next/navigation';

export default async function TimKiemRedirect({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const keyword = resolvedSearchParams.keyword ? `?keyword=${encodeURIComponent(resolvedSearchParams.keyword)}` : '';
  redirect(`/search${keyword}`);
}
