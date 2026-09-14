'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';
import { User, Heart, History, LogOut, Settings } from 'lucide-react';

export default function UserMenu() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    signOut({ callbackUrl: '/' });
  };

  if (status === 'loading') {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-container-high animate-pulse" />
    );
  }

  if (!session) {
    return (
      <Link
        href="/auth/login"
        className="flex items-center gap-2 px-4 py-2 bg-amber-primary hover:bg-amber-600 rounded-full font-semibold transition-all transform hover:scale-105"
      >
        <User size={18} />
        <span className="hidden xl:inline">Đăng nhập</span>
      </Link>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <div className="relative w-10 h-10 rounded-full border-2 border-amber-primary overflow-hidden bg-surface-container flex items-center justify-center shrink-0">
          {!imageError && session.user.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name || 'User'}
              fill
              className="object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <span className="text-sm font-bold text-white uppercase transform scale-110">
              {session.user.name ? session.user.name.charAt(0) : <User size={20} />}
            </span>
          )}
        </div>
        <span className="hidden xl:inline font-medium truncate max-w-[120px] text-left">
          {session.user.name}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-surface-light border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-white/10">
            <p className="font-semibold text-white">{session.user.name}</p>
            <p className="text-sm text-cinema-subtle">{session.user.email}</p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            <Link
              href="/favorites"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors"
            >
              <Heart size={18} className="text-amber-gold" />
              <span>Phim yêu thích</span>
            </Link>

            <Link
              href="/history"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors"
            >
              <History size={18} className="text-blue-500" />
              <span>Lịch sử xem</span>
            </Link>

            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-surface-container transition-colors"
            >
              <Settings size={18} className="text-cinema-subtle" />
              <span>Cài đặt</span>
            </Link>
          </div>

          {/* Logout */}
          <div className="border-t border-white/10">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-primary transition-colors text-left"
            >
              <LogOut size={18} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
