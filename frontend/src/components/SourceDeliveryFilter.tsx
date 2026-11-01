import type { DeliveryState, SourceFilter } from '@/lib/source-delivery';
export function SourceDeliveryBadge({ state, recommended = false, qualityLabel }: { state?: DeliveryState; recommended?: boolean; qualityLabel?: string | null }) {
  return <>
    {recommended && <span className="rounded bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-300" title="Đề xuất cân nhắc độ nét, mức nén, nguồn sẵn sàng và khả năng thiết bị.">Đề xuất</span>}
    {qualityLabel && <span className={`rounded px-2 py-0.5 ${qualityLabel==='Nén mạnh'?'bg-orange-500/15 text-orange-300':'bg-white/10 text-white/70'}`} title="Ước tính từ thông tin bản phim và bitrate; chất lượng thực tế còn phụ thuộc cách mã hóa.">{qualityLabel}</span>}
    {state && ['verified','likely'].includes(state) && <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300" title="Cách phát trực tiếp trên thiết bị; chất lượng phụ thuộc bản phim đã chọn.">Phát thẳng</span>}
    {state === 'remux' && <span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-300">Qua máy chủ</span>}
  </>;
}
export default function SourceDeliveryFilter({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc cách phát">
    {([['all','Tất cả'],['direct','Phát thẳng'],['remux','Qua máy chủ']] as const).map(([key,label]) =>
      <button key={key} type="button" aria-pressed={value===key} onClick={()=>onChange(key)}
        className={`rounded-full px-3 py-1.5 text-xs font-medium ${value===key?'bg-amber-400 text-black font-semibold':'bg-white/10 text-white/70 hover:bg-white/20'}`}>{label}</button>)}
  </div>;
}
