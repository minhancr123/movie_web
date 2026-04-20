import { redirect } from 'next/navigation';

export default function TimKiemRedirect({
  searchParams,
}: {
  searchParams: { keyword?: string };
}) {
  const keyword = searchParams.keyword ? `?keyword=${encodeURIComponent(searchParams.keyword)}` : '';
  redirect(`/search${keyword}`);
}
