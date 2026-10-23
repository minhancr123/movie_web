import type { DeliveryState, SourceFilter } from '@/lib/source-delivery';
export function SourceDeliveryBadge({ state, recommended = false }: { state?: DeliveryState; recommended?: boolean }) {
  if (!state || !['verified','likely'].includes(state)) return null;
  return (
    <>
      {recommended && (
        <span className="rounded bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-300" title="Nguồn đã sẵn sàng, ưu tiên phát trực tiếp trên thiết bị hiện tại.">
          Đề xuất
        </span>
      )}
      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300 border border-emerald-500/20"
        title={state === 'verified' ? 'Server đã kiểm tra codec, âm thanh và khả năng tua.' : 'Phát thẳng trực tiếp từ CDN.'}>
        Phát thẳng
      </span>
    </>
  );
}
export default function SourceDeliveryFilter({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc cách phát">
    {([['all','Tất cả'],['direct','Phát thẳng'],['remux','Tiêu chuẩn']] as const).map(([key,label]) =>
      <button key={key} type="button" aria-pressed={value===key} onClick={()=>onChange(key)}
        className={`rounded-full px-3 py-1.5 text-xs font-medium ${value===key?'bg-amber-400 text-black font-semibold':'bg-white/10 text-white/70 hover:bg-white/20'}`}>{label}</button>)}
  </div>;
}
