'use client';
import { Home, Search, Heart, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BottomNav = () => {
  const pathname = usePathname();

  const navItems = [
    { icon: Home, label: 'Trang chủ', path: '/' },
    { icon: Search, label: 'Tìm kiếm', path: '/search' }, // We can create a dedicated mobile search page later
    { icon: Heart, label: 'Yêu thích', path: '/danh-sach-cua-toi' },
    // { icon: User, label: 'Tài khoản', path: '/account' }, // Future feature
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 w-full bg-zinc-950 border-t border-zinc-800 z-50 pb-safe">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link 
              key={item.path} 
              href={item.path}
              className={`flex flex-col items-center gap-1 ${isActive ? 'text-red-600' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <item.icon size={24} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default BottomNav;
