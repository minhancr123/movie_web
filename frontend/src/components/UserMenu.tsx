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
      <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
    );
  }

  if (!session) {
    return (
      <Link
        href="/auth/login"
        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-full font-semibold transition-all transform hover:scale-105"
      >
        <User size={18} />
        <span className="hidden md:inline">Đăng nhập</span>
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
        <div className="relative w-10 h-10 rounded-full border-2 border-red-600 overflow-hidden bg-gray-800 flex items-center justify-center shrink-0">
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
        <span className="hidden md:inline font-medium truncate max-w-[150px] text-left">
          {session.user.name}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-gray-700">
            <p className="font-semibold text-white">{session.user.name}</p>
            <p className="text-sm text-gray-400">{session.user.email}</p>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            <Link
              href="/favorites"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-gray-800 transition-colors"
            >
              <Heart size={18} className="text-red-500" />
              <span>Phim yêu thích</span>
            </Link>

            <Link
              href="/history"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-gray-800 transition-colors"
            >
              <History size={18} className="text-blue-500" />
              <span>Lịch sử xem</span>
            </Link>

            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-gray-800 transition-colors"
            >
              <Settings size={18} className="text-gray-400" />
              <span>Cài đặt</span>
            </Link>
          </div>

          {/* Logout */}
          <div className="border-t border-gray-700">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-600 transition-colors text-left"
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
