'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Search, Menu, X, ChevronDown, Loader2, PlayCircle, Bell, User, Mic } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSearchMovies } from '@/hooks/useSearchMovies';
import { useDebounce } from '@/hooks/useDebounce';
import { IMAGE_PREFIX } from '@/lib/api';
import UserMenu from '@/components/UserMenu';
import NotificationMenu from '@/components/NotificationMenu';

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}


const GENRES = [
    // ...existing code...
    { name: 'Hành Động', slug: 'hanh-dong' },
    { name: 'Tình Cảm', slug: 'tinh-cam' },
    { name: 'Hài Hước', slug: 'hai-huoc' },
    { name: 'Cổ Trang', slug: 'co-trang' },
    { name: 'Tâm Lý', slug: 'tam-ly' },
    { name: 'Hình Sự', slug: 'hinh-su' },
    { name: 'Chiến Tranh', slug: 'chien-tranh' },
    { name: 'Thể Thao', slug: 'the-thao' },
    { name: 'Võ Thuật', slug: 'vo-thuat' },
    { name: 'Viễn Tưởng', slug: 'vien-tuong' },
    { name: 'Phiêu Lưu', slug: 'phieu-luu' },
    { name: 'Khoa Học', slug: 'khoa-hoc' },
    { name: 'Kinh Dị', slug: 'kinh-di' },
    { name: 'Âm Nhạc', slug: 'am-nhac' },
    { name: 'Thần Thoại', slug: 'than-thoai' },
    { name: 'Tài Liệu', slug: 'tai-lieu' },
    { name: 'Gia Đình', slug: 'gia-dinh' },
];

const Header = () => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isGenreOpen, setIsGenreOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isMobileSearchVisible, setIsMobileSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchContainerRef = useRef<HTMLDivElement>(null);

    const pathname = usePathname();
    const router = useRouter();

    // SWR + Debounce Search Logic
    const debouncedSearchQuery = useDebounce(searchQuery, 500);
    const { movies: searchResults, isLoading: isSearching } = useSearchMovies(debouncedSearchQuery);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10);
        };

        const handleClickOutside = (event: MouseEvent) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
                if (!searchQuery) setIsSearchOpen(false);
            }
        };

        window.addEventListener('scroll', handleScroll);
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            window.removeEventListener('scroll', handleScroll);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [searchQuery]);

    useEffect(() => {
        setIsMobileMenuOpen(false);
        setIsGenreOpen(false);
        setIsSearchOpen(false);
    }, [pathname]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            router.push(`/search?keyword=${encodeURIComponent(searchQuery)}`);
            setIsSearchOpen(false);
            setIsMobileMenuOpen(false);
            setIsMobileSearchVisible(false);
        }
    };

    const [isListening, setIsListening] = useState(false);

    const startVoiceSearch = () => {
        if (typeof window === 'undefined') return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Trình duyệt không hỗ trợ tìm kiếm giọng nói');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'vi-VN';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setSearchQuery(transcript);
            router.push(`/search?keyword=${encodeURIComponent(transcript)}`);
            setIsSearchOpen(false);
            setIsMobileSearchVisible(false);
        };

        recognition.start();
    };

    return (
        <>
            <header
                className={`fixed w-full z-50 transition-all duration-500 ease-out ${isScrolled
                    ? 'bg-black/80 backdrop-blur-xl border-b border-white/5 py-3 shadow-2xl'
                    : 'bg-gradient-to-b from-black/90 via-black/50 to-transparent py-6'
                    }`}
            >
                <div className="container mx-auto px-4 md:px-8 flex justify-between items-center">
                    {/* Logo */}
                    <Link href="/" className="relative z-50 group flex items-center gap-2">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-rose-900 flex items-center justify-center shadow-lg shadow-red-900/20 group-hover:scale-110 transition-transform duration-300">
                            <PlayCircle className="text-white fill-white/20" size={24} />
                        </div>
                        <span className="text-2xl md:text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 tracking-tighter group-hover:to-white transition-all">
                            MOVIE<span className="text-red-500">WEB</span>
                        </span>
                    </Link>

                    {/* Desktop Nav */}
                    <nav
                        className={`hidden lg:flex items-center gap-1 bg-white/5 p-1.5 rounded-full border border-white/5 backdrop-blur-md transition-all duration-500 ease-in-out transform origin-right ${isSearchOpen
                            ? 'opacity-0 scale-90 translate-x-4 pointer-events-none blur-sm'
                            : 'opacity-100 scale-100 translate-x-0 blur-0'
                            }`}
                    >
                        {[
                            { name: 'Trang Chủ', path: '/' },
                            { name: 'Phim Lẻ', path: '/danh-sach/phim-le' },
                            { name: 'Phim Bộ', path: '/danh-sach/phim-bo' },
                            { name: 'Hoạt Hình', path: '/danh-sach/hoat-hinh' },
                            { name: 'Công Chiếu', path: '/cong-chieu' },
                        ].map((link) => (
                            <Link
                                key={link.path}
                                href={link.path}
                                className={`relative px-5 py-2 rounded-full text-sm font-bold uppercase tracking-wide transition-all duration-300 ${pathname === link.path
                                    ? 'bg-red-600 text-white shadow-lg shadow-red-900/20'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {link.name}
                            </Link>
                        ))}

                        <div className="relative group px-2">
                            <button
                                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-bold uppercase tracking-wide hover:text-white transition-colors ${pathname.startsWith('/the-loai') ? 'text-red-500' : 'text-gray-400'}`}
                            >
                                Thể Loại <ChevronDown size={14} className="group-hover:rotate-180 transition-transform duration-300" />
                            </button>

                            {/* Mega Menu Dropdown */}
                            <div className="absolute top-full right-0 mt-6 w-[600px] bg-[#0a0a0a]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl p-6 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top translate-y-4 group-hover:translate-y-0 grid grid-cols-4 gap-3 z-50">
                                <div className="absolute -top-2 right-10 w-4 h-4 bg-[#0a0a0a]/95 border-t border-l border-white/10 rotate-45"></div>
                                {GENRES.map((genre) => (
                                    <Link
                                        key={genre.slug}
                                        href={`/the-loai/${genre.slug}`}
                                        className="text-gray-400 hover:text-white hover:bg-white/10 px-3 py-2.5 rounded-xl text-sm transition-all text-center block font-medium"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </nav>

                    {/* Right Actions */}
                    <div className="flex items-center gap-3">
                        {/* Search Bar - Desktop */}
                        <div className="relative hidden md:block" ref={searchContainerRef}>
                            <div className={`flex items-center bg-black/40 border border-white/10 rounded-full transition-all duration-300 ${isSearchOpen ? 'w-72 bg-black/80 border-red-500/50 shadow-lg shadow-red-900/10' : 'w-10 h-10 justify-center hover:bg-white/10 cursor-pointer overflow-hidden'}`}>
                                <button
                                    onClick={() => {
                                        setIsSearchOpen(true);
                                        // Focus input logic here if needed
                                    }}
                                    className={`text-gray-400 hover:text-white transition-colors p-2.5 ${isSearchOpen ? 'cursor-default' : ''}`}
                                >
                                    <Search size={18} />
                                </button>

                                <form onSubmit={handleSearchSubmit} className={`flex-1 flex items-center ${isSearchOpen ? 'block mr-1' : 'hidden'}`}>
                                    <input
                                        type="text"
                                        placeholder="Tìm kiếm phim..."
                                        className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full px-2 h-9"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoFocus={isSearchOpen}
                                    />
                                    <button
                                        type="button"
                                        onClick={startVoiceSearch}
                                        className={`p-2 transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-white'}`}
                                        title="Tìm kiếm bằng giọng nói"
                                    >
                                        <Mic size={16} />
                                    </button>
                                </form>

                                {isSearchOpen && (
                                    isSearching ? (
                                        <Loader2 size={16} className="text-red-500 animate-spin mr-3" />
                                    ) : searchQuery && (
                                        <button onClick={() => { setSearchQuery(''); setIsSearchOpen(false) }} className="mr-3 text-gray-500 hover:text-white">
                                            <X size={16} />
                                        </button>
                                    )
                                )}
                            </div>

                            {/* Search Dropdown Results */}
                            {isSearchOpen && searchQuery.length >= 1 && (
                                <div className="absolute top-full right-0 mt-4 w-96 bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="absolute -top-2 right-4 w-4 h-4 bg-[#111] border-t border-l border-white/10 rotate-45"></div>
                                    {isSearching ? (
                                        <div className="p-8 text-center text-gray-500 text-sm flex flex-col items-center gap-3">
                                            <Loader2 size={24} className="animate-spin text-red-500" />
                                            <span>Đang tìm kiếm phim hay...</span>
                                        </div>
                                    ) : searchResults && searchResults.length > 0 ? (
                                        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                                            <div className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                                                Kết quả phù hợp nhất
                                            </div>
                                            {searchResults.slice(0, 5).map((movie: any) => (
                                                <Link
                                                    key={movie._id}
                                                    href={`/phim/${movie.slug}`}
                                                    className="flex items-start gap-4 p-4 hover:bg-white/5 transition-colors group border-b border-white/5 last:border-0 relative overflow-hidden"
                                                    onClick={() => setIsSearchOpen(false)}
                                                >
                                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-red-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <div className="relative w-14 h-20 rounded-lg overflow-hidden shrink-0 shadow-lg border border-white/10 group-hover:border-red-500/30 transition-colors">
                                                        <Image
                                                            src={movie.poster_url.startsWith('http') ? movie.poster_url : `${IMAGE_PREFIX}${movie.poster_url}`}
                                                            alt={movie.name}
                                                            fill
                                                            className="object-cover group-hover:scale-110 transition-transform duration-700"
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0 z-10">
                                                        <h4 className="text-sm font-bold text-gray-200 group-hover:text-red-500 truncate transition-colors">{movie.name}</h4>
                                                        <p className="text-xs text-gray-500 truncate mt-0.5">{movie.origin_name}</p>
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded border border-red-500/20 font-medium">{movie.quality}</span>
                                                            <span className="text-[10px] text-gray-500 font-medium bg-white/5 px-2 py-0.5 rounded border border-white/5">{movie.year}</span>
                                                            <span className="text-[10px] text-yellow-500 flex items-center gap-0.5">★ {movie.vote_average || 'N/A'}</span>
                                                        </div>
                                                    </div>
                                                </Link>
                                            ))}
                                            <Link href={`/search?keyword=${searchQuery}`} className="block p-4 text-center text-xs font-bold text-red-500 hover:text-red-400 hover:bg-white/5 transition-colors uppercase tracking-widest">
                                                Xem tất cả kết quả
                                            </Link>
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center text-gray-500 text-sm">
                                            <span className="block mb-1 text-lg">😕</span>
                                            Không tìm thấy phim nào.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Mobile Search Button */}
                        <button
                            className="md:hidden text-gray-400 hover:text-white transition-colors p-2"
                            onClick={() => setIsMobileSearchVisible(!isMobileSearchVisible)}
                        >
                            <Search size={22} />
                        </button>

                        {/* Mobile Menu Button */}
                        <button
                            className="lg:hidden text-white hover:text-red-500 transition-colors p-2"
                            onClick={() => setIsMobileMenuOpen(true)}
                        >
                            <Menu size={28} strokeWidth={2.5} />
                        </button>

                        {/* Profile Actions */}
                        <div className="flex items-center gap-3 pl-2 border-l border-white/10">
                            <div className="hidden sm:block">
                                <NotificationMenu />
                            </div>
                            <UserMenu />
                        </div>
                    </div>
                </div>

                {/* Mobile Search Bar Overlay */}
                {isMobileSearchVisible && (
                    <div className="absolute top-full left-0 w-full bg-[#111] border-b border-white/10 p-4 md:hidden animate-in slide-in-from-top-2 shadow-2xl">
                        <form onSubmit={handleSearchSubmit} className="relative">
                            <input
                                type="text"
                                placeholder="Tìm kiếm phim..."
                                className="w-full bg-black border border-gray-800 rounded-xl px-4 py-3 text-white focus:border-red-500 focus:outline-none pl-11 pr-12"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />

                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                {searchQuery ? (
                                    <button
                                        type="button"
                                        onClick={() => { setSearchQuery(''); }}
                                        className="text-gray-500"
                                    >
                                        <X size={18} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={startVoiceSearch}
                                        className={`${isListening ? 'text-red-500 animate-pulse' : 'text-gray-500'}`}
                                    >
                                        <Mic size={20} />
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}
            </header>

            {/* Mobile Menu Overlay */}
            <div className={`fixed inset-0 z-[60] lg:hidden transition-all duration-300 ${isMobileMenuOpen ? 'visible' : 'invisible'}`}>
                {/* Backdrop */}
                <div
                    className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
                    onClick={() => setIsMobileMenuOpen(false)}
                />

                {/* Menu Content */}
                <div className={`absolute top-0 right-0 w-[85%] max-w-sm h-full bg-[#0a0a0a] border-l border-white/10 shadow-2xl p-6 transition-transform duration-300 transform ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <div className="flex justify-between items-center mb-8">
                        <span className="text-xl font-black text-white tracking-tighter">NAV<span className="text-red-600">IGATION</span></span>
                        <button
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="text-gray-400 hover:text-white bg-white/5 hover:bg-red-500 hover:rotate-90 transition-all duration-300 p-2 rounded-full"
                        >
                            <X size={20} />
                        </button>
                    </div>



                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        <Link href="/" className="flex items-center gap-3 px-4 py-3.5 text-base font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-all hover:pl-6 border border-transparent hover:border-white/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Trang Chủ
                        </Link>

                        <div className="space-y-1">
                            <button
                                onClick={() => setIsGenreOpen(!isGenreOpen)}
                                className={`w-full flex justify-between items-center px-4 py-3.5 text-base font-bold rounded-xl transition-all border border-transparent ${isGenreOpen ? 'bg-white/5 text-white border-white/5' : 'text-gray-300 hover:text-white hover:bg-white/5 hover:pl-6 hover:border-white/5'}`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Thể Loại
                                </div>
                                <ChevronDown size={18} className={`transition-transform duration-300 ${isGenreOpen ? 'rotate-180 text-white' : 'text-gray-500'}`} />
                            </button>

                            <div className={`grid grid-cols-2 gap-2 overflow-hidden transition-all duration-300 ${isGenreOpen ? 'max-h-[500px] mt-2 mb-2 p-1' : 'max-h-0'}`}>
                                {GENRES.map((genre) => (
                                    <Link
                                        key={genre.slug}
                                        href={`/the-loai/${genre.slug}`}
                                        className="text-xs font-medium text-gray-400 hover:text-white hover:bg-white/10 py-2.5 px-3 bg-white/[0.02] rounded-lg text-center border border-white/[0.02]"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <Link href="/danh-sach/phim-le" className="flex items-center gap-3 px-4 py-3.5 text-base font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-all hover:pl-6 border border-transparent hover:border-white/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Phim Lẻ
                        </Link>
                        <Link href="/danh-sach/phim-bo" className="flex items-center gap-3 px-4 py-3.5 text-base font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-all hover:pl-6 border border-transparent hover:border-white/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Phim Bộ
                        </Link>
                        <Link href="/cong-chieu" className="flex items-center gap-3 px-4 py-3.5 text-base font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-all hover:pl-6 border border-transparent hover:border-white/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Công Chiếu
                        </Link>
                        <Link href="/danh-sach/hoat-hinh" className="flex items-center gap-3 px-4 py-3.5 text-base font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-xl transition-all hover:pl-6 border border-transparent hover:border-white/5">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span> Hoạt Hình
                        </Link>
                    </div>


                </div>
            </div>
        </>
    );
};

export default Header;
