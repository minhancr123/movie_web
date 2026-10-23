import type { DeliveryState, SourceFilter } from '@/lib/source-delivery';
export function SourceDeliveryBadge({ state }: { state?: DeliveryState }) {
  if (!state || !['verified','likely','remux'].includes(state)) return null;
  return <span className="rounded bg-sky-500/10 px-2 py-0.5 text-sky-300"
    title={state === 'verified' ? 'Server đã kiểm tra codec, âm thanh và khả năng tua; kết quả còn tùy trình duyệt và mạng.' : undefined}>
    {state === 'verified' ? 'Phát thẳng · đã kiểm tra' : state === 'likely' ? 'Có thể phát thẳng' : 'Cần xử lý'}
  </span>;
}
export default function SourceDeliveryFilter({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc cách phát">
    {([['all','Tất cả'],['direct','Phát thẳng'],['remux','Cần xử lý']] as const).map(([key,label]) =>
      <button key={key} type="button" aria-pressed={value===key} onClick={()=>onChange(key)}
        className={`rounded-full px-3 py-1.5 text-xs ${value===key?'bg-amber-400 text-black':'bg-white/10 text-white/70 hover:bg-white/20'}`}>{label}</button>)}
  </div>;
}
