'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Search, Menu, X, ChevronDown, Loader2, PlayCircle, Bell, User, Mic } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSearchMovies } from '@/hooks/useSearchMovies';
import { useDebounce } from '@/hooks/useDebounce';
import UserMenu from '@/components/UserMenu';
import NotificationMenu from '@/components/NotificationMenu';
import { catalogHref } from '@/lib/catalog';

declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}


// TMDB genre ids. The old phimapi slugs no longer identify anything.
const GENRES = [
    { name: 'Hành Động', id: 28 },
    { name: 'Phiêu Lưu', id: 12 },
    { name: 'Hoạt Hình', id: 16 },
    { name: 'Hài Hước', id: 35 },
    { name: 'Hình Sự', id: 80 },
    { name: 'Tài Liệu', id: 99 },
    { name: 'Chính Kịch', id: 18 },
    { name: 'Gia Đình', id: 10751 },
    { name: 'Giả Tưởng', id: 14 },
    { name: 'Lịch Sử', id: 36 },
    { name: 'Kinh Dị', id: 27 },
    { name: 'Âm Nhạc', id: 10402 },
    { name: 'Bí Ẩn', id: 9648 },
    { name: 'Tình Cảm', id: 10749 },
    { name: 'Khoa Học Viễn Tưởng', id: 878 },
    { name: 'Gay Cấn', id: 53 },
    { name: 'Chiến Tranh', id: 10752 },
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

    // Active-link detection that understands query strings (pathname alone
    // can never equal '/kham-pha?type=movie'). Read from window.location on
    // navigation instead of useSearchParams to avoid a Suspense boundary.
    const [queryString, setQueryString] = useState('');
    useEffect(() => {
        setQueryString(window.location.search);
    }, [pathname]);
    const query = useMemo(() => new URLSearchParams(queryString), [queryString]);

    const isLinkActive = (path: string) => {
        if (path === '/') return pathname === '/';
        if (path.startsWith('/kham-pha')) {
            if (pathname !== '/kham-pha') return false;
            const q = new URLSearchParams(path.split('?')[1] || '');
            const type = query.get('type');
            const genre = query.get('genre');
            if (q.get('genre')) return type === q.get('type') && genre === q.get('genre');
            if (q.get('type')) return type === q.get('type') && !genre;
            return false;
        }
        return pathname === path || pathname.startsWith(path + '/');
    };
    const isGenreActive = () => pathname === '/kham-pha' && !!query.get('genre');

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
                    ? 'bg-[#121316]/80 backdrop-blur-2xl border-b border-white/10 py-3 shadow-[0_4px_30px_rgba(0,0,0,0.5)]'
                    : 'bg-gradient-to-b from-[#0d0e11] via-[#0d0e11]/50 to-transparent py-6'
                    }`}
            >
                <div className="mx-auto w-full max-w-shell px-4 md:px-8 flex justify-between items-center gap-3">
                    {/* Logo */}
                    <Link href="/" className="relative z-50 group flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-gold via-amber-primary to-amber-700 flex items-center justify-center shadow-amber-glow group-hover:scale-105 transition-all duration-300">
                            <PlayCircle className="text-black" size={20} strokeWidth={2.5} />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-syne text-2xl md:text-3xl font-black tracking-tight text-white group-hover:text-amber-gold transition-colors">
                                CineStream
                            </span>
                            <span className="hidden xl:block font-mono text-[9px] text-amber-gold tracking-[0.25em] -mt-1 uppercase font-bold">
                                Spatial Cinema 4K
                            </span>
                        </div>
                    </Link>

                    {/* Desktop Nav */}
                    <nav
                        className={`hidden xl:flex shrink-0 items-center gap-0.5 glass-panel p-1.5 rounded-full shadow-glass-card transition-all duration-500 ease-in-out transform origin-right ${isSearchOpen
                            ? 'opacity-0 scale-90 translate-x-4 pointer-events-none blur-sm'
                            : 'opacity-100 scale-100 translate-x-0 blur-0'
                            }`}
                    >
                        {[
                            { name: 'Trang Chủ', path: '/' },
                            { name: 'Phim Lẻ', path: '/kham-pha?type=movie' },
                            { name: 'Phim Bộ', path: '/kham-pha?type=tv' },
                            { name: 'Hoạt Hình', path: '/kham-pha?type=movie&genre=16' },
                            { name: 'Công Chiếu', path: '/cong-chieu' },
                            { name: 'Tải Xuống', path: '/tai-xuong' },
                        ].map((link) => (
                            <Link
                                key={link.path}
                                href={link.path}
                                className={`relative whitespace-nowrap shrink-0 px-3.5 py-2 rounded-full font-mono text-label-md uppercase transition-all duration-300 ${isLinkActive(link.path)
                                    ? 'bg-amber-primary text-black shadow-amber-button'
                                    : 'text-cinema-subtle hover:text-cinema-text hover:bg-white/10'
                                    }`}
                            >
                                {link.name}
                            </Link>
                        ))}

                        <div className="relative group px-2">
                            <button
                                className={`flex whitespace-nowrap shrink-0 items-center gap-1.5 px-2.5 py-2 font-mono text-label-md uppercase hover:text-cinema-text transition-colors ${isGenreActive() ? 'text-amber-gold' : 'text-cinema-subtle'}`}
                            >
                                Thể Loại <ChevronDown size={14} className="group-hover:rotate-180 transition-transform duration-300" />
                            </button>

                            {/* Mega Menu Dropdown */}
                            <div className="absolute top-full right-0 mt-6 w-[600px] glass-panel rounded-3xl shadow-amber-glow p-6 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 transform origin-top translate-y-4 group-hover:translate-y-0 grid grid-cols-4 gap-3 z-50">
                                <div className="absolute -top-2 right-10 w-4 h-4 glass-panel border-b-0 border-r-0 rotate-45"></div>
                                {GENRES.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        href={`/kham-pha?genre=${genre.id}`}
                                        className="text-cinema-subtle hover:text-amber-gold hover:bg-amber-primary/10 px-3 py-2.5 rounded-xl text-body-sm transition-all text-center block font-medium border border-transparent hover:border-amber-primary/30"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </nav>

                    {/* Right Actions */}
                    <div className="flex shrink-0 items-center gap-2 md:gap-3">
                        {/* Search Bar - Desktop (xl+: inline pill; below xl: full-width overlay to avoid crowding) */}
                        <div className="relative hidden xl:block" ref={searchContainerRef}>
                            <div className={`flex items-center transition-all duration-300 ${isSearchOpen ? 'w-72 glass-panel !border-amber-primary/60 shadow-amber-glow rounded-full' : 'w-10 h-10 justify-center glass-panel rounded-full cursor-pointer overflow-hidden hover:border-amber-primary/40'}`}>
                                <button
                                    onClick={() => {
                                        setIsSearchOpen(true);
                                        // Focus input logic here if needed
                                    }}
                                    className={`text-cinema-subtle hover:text-amber-gold transition-colors p-2.5 ${isSearchOpen ? 'cursor-default' : ''}`}
                                >
                                    <Search size={18} />
                                </button>

                                <form onSubmit={handleSearchSubmit} className={`flex-1 flex items-center ${isSearchOpen ? 'block mr-1' : 'hidden'}`}>
                                    <input
                                        type="text"
                                        placeholder="Tìm kiếm phim..."
                                        className="bg-transparent border-none outline-none focus:shadow-none text-body-md text-cinema-text placeholder-cinema-subtle w-full px-2 h-9"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoFocus={isSearchOpen}
                                    />
                                    <button
                                        type="button"
                                        onClick={startVoiceSearch}
                                        className={`p-2 transition-colors ${isListening ? 'text-wine-accent animate-pulse' : 'text-cinema-subtle hover:text-amber-gold'}`}
                                        title="Tìm kiếm bằng giọng nói"
                                    >
                                        <Mic size={16} />
                                    </button>
                                </form>

                                {isSearchOpen && (
                                    isSearching ? (
                                        <Loader2 size={16} className="text-amber-primary animate-spin mr-3" />
                                    ) : searchQuery && (
                                        <button onClick={() => { setSearchQuery(''); setIsSearchOpen(false) }} className="mr-3 text-cinema-subtle hover:text-cinema-text">
                                            <X size={16} />
                                        </button>
                                    )
                                )}
                            </div>

                            {/* Search Dropdown Results */}
                            {isSearchOpen && searchQuery.length >= 1 && (
                                <div className="absolute top-full right-0 mt-4 w-96 max-w-[calc(100vw-2rem)] glass-panel rounded-3xl shadow-glass-card overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="absolute -top-2 right-4 w-4 h-4 bg-[#1b1b1f] border-t border-l border-white/10 rotate-45"></div>
                                    {isSearching ? (
                                        <div className="p-8 text-center text-cinema-subtle text-body-md flex flex-col items-center gap-3">
                                            <Loader2 size={24} className="animate-spin text-amber-primary" />
                                            <span>Đang tìm kiếm phim hay...</span>
                                        </div>
                                    ) : searchResults && searchResults.length > 0 ? (
                                        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                                            <div className="p-4 font-mono text-label-sm text-amber-gold uppercase border-b border-white/10 bg-white/[0.02]">
                                                Kết quả phù hợp nhất
                                            </div>
                                            {searchResults.slice(0, 5).map((movie: any) => (
                                                <Link
                                                    key={movie.contentRef}
                                                    href={catalogHref(movie)}
                                                    className="flex items-start gap-4 p-4 hover:bg-white/5 transition-colors group border-b border-white/5 last:border-0 relative overflow-hidden"
                                                    onClick={() => setIsSearchOpen(false)}
                                                >
                                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-amber-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <div className="relative w-14 h-20 rounded-xl overflow-hidden shrink-0 shadow-lg border border-white/10 group-hover:border-amber-primary/40 transition-colors">
                                                        <Image
                                                            src={movie.poster}
                                                            alt={movie.title}
                                                            fill
                                                            className="object-cover group-hover:scale-110 transition-transform duration-700"
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0 z-10">
                                                        <h4 className="font-syne text-headline-sm text-cinema-text group-hover:text-amber-gold truncate transition-colors">{movie.title}</h4>
                                                        <p className="text-body-sm text-cinema-subtle truncate mt-0.5">{movie.originalTitle}</p>
                                                        <div className="mt-2 flex items-center gap-2">
                                                            <span className="font-mono text-label-sm uppercase bg-amber-primary/15 text-amber-gold px-2 py-0.5 rounded-md border border-amber-primary/30">{movie.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'}</span>
                                                            <span className="font-mono text-label-sm text-cinema-muted bg-white/5 px-2 py-0.5 rounded-md border border-white/10">{movie.year}</span>
                                                            <span className="font-mono text-label-sm text-amber-gold flex items-center gap-0.5">★ {movie.voteAverage ? movie.voteAverage.toFixed(1) : 'N/A'}</span>
                                                        </div>
                                                    </div>
                                                </Link>
                                            ))}
                                            <Link href={`/search?keyword=${searchQuery}`} className="block p-4 text-center font-mono text-label-md text-amber-gold hover:text-amber-primary hover:bg-white/5 transition-colors uppercase">
                                                Xem tất cả kết quả
                                            </Link>
                                        </div>
                                    ) : (
                                        <div className="p-8 text-center text-cinema-subtle text-body-md">
                                            <span className="block mb-1 text-lg">😕</span>
                                            Không tìm thấy phim nào.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Mobile/Tablet Search Button (toggles full-width overlay) */}
                        <button
                            className="xl:hidden text-cinema-subtle hover:text-amber-gold transition-colors p-2"
                            onClick={() => setIsMobileSearchVisible(!isMobileSearchVisible)}
                        >
                            <Search size={22} />
                        </button>

                        {/* Mobile Menu Button */}
                        <button
                            className="xl:hidden text-cinema-text hover:text-amber-gold transition-colors p-2"
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

                {/* Mobile/Tablet Search Bar Overlay */}
                {isMobileSearchVisible && (
                    <div className="absolute top-full left-0 w-full bg-[#121316]/95 backdrop-blur-2xl border-b border-white/10 p-4 xl:hidden animate-in slide-in-from-top-2 shadow-glass-card">
                        <form onSubmit={handleSearchSubmit} className="relative">
                            <input
                                type="text"
                                placeholder="Tìm kiếm phim..."
                                className="w-full bg-[#1b1b1f]/80 border border-white/10 rounded-2xl px-4 py-3 text-cinema-text placeholder-cinema-subtle focus:outline-none pl-11 pr-12"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />

                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                {searchQuery ? (
                                    <button
                                        type="button"
                                        onClick={() => { setSearchQuery(''); }}
                                        className="text-cinema-subtle hover:text-cinema-text"
                                    >
                                        <X size={18} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={startVoiceSearch}
                                        className={`${isListening ? 'text-wine-accent animate-pulse' : 'text-cinema-subtle'}`}
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
            <div className={`fixed inset-0 z-[60] xl:hidden transition-all duration-300 ${isMobileMenuOpen ? 'visible' : 'invisible'}`}>
                {/* Backdrop */}
                <div
                    className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
                    onClick={() => setIsMobileMenuOpen(false)}
                />

                {/* Menu Content */}
                <div className={`absolute top-0 right-0 w-[85%] max-w-sm h-full bg-[#0d0e11] border-l border-white/10 shadow-glass-card p-6 transition-transform duration-300 transform ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <div className="flex justify-between items-center mb-8">
                        <span className="font-syne text-headline-lg text-white">Điều<span className="text-amber-gold"> Hướng</span></span>
                        <button
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="text-cinema-subtle hover:text-black bg-white/5 hover:bg-amber-primary hover:rotate-90 transition-all duration-300 p-2 rounded-full"
                        >
                            <X size={20} />
                        </button>
                    </div>



                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        <Link href="/" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-primary"></span> Trang Chủ
                        </Link>

                        <div className="space-y-1">
                            <button
                                onClick={() => setIsGenreOpen(!isGenreOpen)}
                                className={`w-full flex justify-between items-center px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all border border-transparent ${isGenreOpen ? 'bg-white/5 text-amber-gold border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 hover:pl-6 hover:border-amber-primary/20'}`}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent"></span> Thể Loại
                                </div>
                                <ChevronDown size={18} className={`transition-transform duration-300 ${isGenreOpen ? 'rotate-180 text-amber-gold' : 'text-cinema-subtle'}`} />
                            </button>

                            <div className={`grid grid-cols-2 gap-2 overflow-hidden transition-all duration-300 ${isGenreOpen ? 'max-h-[500px] mt-2 mb-2 p-1' : 'max-h-0'}`}>
                                {GENRES.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        href={`/kham-pha?genre=${genre.id}`}
                                        className="text-body-sm font-medium text-cinema-subtle hover:text-amber-gold hover:bg-amber-primary/10 py-2.5 px-3 bg-white/[0.03] rounded-xl text-center border border-white/5 hover:border-amber-primary/30 transition-all"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <Link href="/kham-pha?type=movie" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/kham-pha?type=movie') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-gold"></span> Phim Lẻ
                        </Link>
                        <Link href="/kham-pha?type=tv" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/kham-pha?type=tv') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-accent"></span> Phim Bộ
                        </Link>
                        <Link href="/cong-chieu" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/cong-chieu') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-wine-accent"></span> Công Chiếu
                        </Link>
                        <Link href="/kham-pha?type=movie&genre=16" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/kham-pha?type=movie&genre=16') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-primary"></span> Hoạt Hình
                        </Link>
                        <Link href="/tai-xuong" className={`flex items-center gap-3 px-4 py-3.5 font-syne text-headline-sm rounded-2xl transition-all hover:pl-6 border ${isLinkActive('/tai-xuong') ? 'text-amber-gold bg-white/5 border-amber-primary/20' : 'text-cinema-muted hover:text-amber-gold hover:bg-white/5 border-transparent hover:border-amber-primary/20'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-primary"></span> Tải Xuống
                        </Link>
                    </div>


                </div>
            </div>
        </>
    );
};

export default Header;
