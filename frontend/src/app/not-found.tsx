import Link from 'next/link';
import { Home, Search } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex flex-col justify-center items-center bg-[#0a0a0a] text-white overflow-hidden relative">
      <div className="absolute inset-0 bg-red-900/5 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="relative z-10 text-center px-4">
        <h1 className="text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-800 opacity-50 select-none">
          404
        </h1>
        
        <div className="space-y-4 -mt-10">
          <h2 className="text-3xl md:text-5xl font-bold">Lạc Lối Giữa Các Vũ Trụ?</h2>
          <p className="text-gray-400 max-w-md mx-auto text-lg">
            Bộ phim bạn tìm kiếm không tồn tại hoặc đã bị xóa khỏi hệ thống của chúng tôi.
          </p>

          <div className="flex justify-center gap-4 mt-8">
            <Link 
              href="/" 
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full font-bold transition-transform hover:-translate-y-1 shadow-lg shadow-red-900/30"
            >
              <Home size={20} />
              Trang Chủ
            </Link>
            
            <Link 
              href="/tim-kiem" 
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-full font-bold backdrop-blur-md border border-white/10 transition-transform hover:-translate-y-1"
            >
              <Search size={20} />
              Tìm Kiếm
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}