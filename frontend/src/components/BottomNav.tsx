'use client';
import { Home, Search, Heart, Download } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BottomNav = () => {
  const pathname = usePathname();

  const navItems = [
    { icon: Home, label: 'Trang chủ', path: '/' },
    { icon: Search, label: 'Tìm kiếm', path: '/search' }, // We can create a dedicated mobile search page later
    { icon: Heart, label: 'Yêu thích', path: '/danh-sach-cua-toi' },
    { icon: Download, label: 'Tải xuống', path: '/tai-xuong' },
    // { icon: User, label: 'Tài khoản', path: '/account' }, // Future feature
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 w-full bg-[#121316]/85 backdrop-blur-2xl border-t border-white/10 z-50 pb-safe shadow-[0_-8px_32px_rgba(0,0,0,0.5)]">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all duration-300 ${isActive ? 'text-amber-gold' : 'text-cinema-subtle hover:text-cinema-text'}`}
            >
              {isActive && (
                <span className="absolute -top-px left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-amber-primary shadow-amber-glow" />
              )}
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="font-mono text-label-sm uppercase">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNav;
