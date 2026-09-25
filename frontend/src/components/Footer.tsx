import Link from 'next/link';
import Image from 'next/image';
import { Facebook, Instagram, Twitter, Github, Mail, Phone, MapPin, PlayCircle } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="relative bg-[#0d0e11] text-cinema-muted pt-20 pb-10 border-t border-white/10 overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-primary/10 rounded-full blur-[128px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-accent/5 rounded-full blur-[128px] pointer-events-none"></div>

      <div className="mx-auto w-full max-w-shell px-4 md:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">

          {/* Brand Column */}
          <div className="space-y-6">
            <Link href="/" className="group flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.3)] group-hover:scale-105 transition-all duration-300">
                <Image
                  src="/icon.png"
                  alt="CineVN"
                  width={40}
                  height={40}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="font-syne text-headline-lg bg-clip-text text-transparent bg-gradient-to-r from-amber-100 via-amber-gold to-amber-500 font-bold">
                CineVN
              </span>
            </Link>
            <p className="text-body-md leading-relaxed text-cinema-subtle max-w-xs">
              Trải nghiệm điện ảnh đỉnh cao ngay tại nhà. Hàng ngàn bộ phim bom tấn, phim bộ và show truyền hình đang chờ đón bạn.
            </p>
            <div className="flex gap-4">
              {[Facebook, Instagram, Twitter, Github].map((Icon, i) => (
                <a key={i} href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-amber-primary/15 hover:text-amber-gold hover:-translate-y-1 transition-all duration-300 group ring-1 ring-white/10 hover:ring-amber-primary/50">
                  <Icon size={18} className="group-hover:scale-110 transition-transform" />
                </a>
              ))}
            </div>
          </div>

          {/* Links Column 1 */}
          <div>
            <h3 className="font-syne text-headline-sm text-white mb-6 flex items-center gap-2">
              <span className="w-8 h-0.5 bg-amber-primary rounded-full"></span>
              Thể loại Hot
            </h3>
            <ul className="space-y-3 text-body-md">
              {[
                { name: 'Hành Động', href: '/kham-pha?genre=28' },
                { name: 'Tình Cảm', href: '/kham-pha?genre=10749' },
                { name: 'Kinh Dị', href: '/kham-pha?genre=27' },
                { name: 'Khám Phá', href: '/kham-pha' },
                { name: 'Lịch Chiếu', href: '/lich-chieu' },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center gap-2 hover:text-amber-gold hover:translate-x-1 transition-all duration-300 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/15 group-hover:bg-amber-primary transition-colors"></span>
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Links Column 2 */}
          <div>
            <h3 className="font-syne text-headline-sm text-white mb-6 flex items-center gap-2">
              <span className="w-8 h-0.5 bg-cyan-accent rounded-full"></span>
              Thông tin
            </h3>
            <ul className="space-y-3 text-body-md">
              {['Giới thiệu', 'Bản quyền', 'Liên hệ', 'Điều khoản sử dụng'].map((item) => (
                <li key={item}>
                  <a href="#" className="flex items-center gap-2 hover:text-cyan-accent hover:translate-x-1 transition-all duration-300 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/15 group-hover:bg-cyan-accent transition-colors"></span>
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Column */}
          <div>
            <h3 className="font-syne text-headline-sm text-white mb-6 flex items-center gap-2">
              <span className="w-8 h-0.5 bg-wine-accent rounded-full"></span>
              Liên hệ
            </h3>
            <ul className="space-y-4 text-body-md text-cinema-subtle">
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-amber-gold">
                  <MapPin size={16} />
                </div>
                <span className="mt-1">123 Đường Điện Ảnh, Quận 1, TP. Hồ Chí Minh</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-cyan-accent">
                  <Mail size={16} />
                </div>
                <span>contact@movieweb.com</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-wine-accent">
                  <Phone size={16} />
                </div>
                <span>+84 (0) 123 456 789</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Required by the TMDB terms of use whenever their API supplies the data. */}
        <div className="border-t border-white/10 pt-8 pb-6 flex flex-col sm:flex-row items-center gap-3 text-body-sm text-cinema-subtle">
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
            aria-label="The Movie Database"
          >
            {/* Inline so the logo is not a blocked external request. */}
            <svg width="80" height="10" viewBox="0 0 273 35" fill="none" xmlns="http://www.w3.org/2000/svg">
              <title>TMDB</title>
              <rect width="273" height="35" rx="6" fill="url(#tmdb-gradient)" />
              <text
                x="136.5"
                y="24"
                textAnchor="middle"
                fill="#0d253f"
                fontFamily="Arial, Helvetica, sans-serif"
                fontSize="17"
                fontWeight="bold"
                letterSpacing="1"
              >
                TMDB
              </text>
              <defs>
                <linearGradient id="tmdb-gradient" x1="0" y1="17.5" x2="273" y2="17.5" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#90cea1" />
                  <stop offset="0.56" stopColor="#3cbec9" />
                  <stop offset="1" stopColor="#00b3e5" />
                </linearGradient>
              </defs>
            </svg>
          </a>
          <p className="text-center sm:text-left">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>

        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center text-body-md gap-4">
          <p className="text-cinema-subtle">&copy; {new Date().getFullYear()} <span className="font-syne text-cinema-muted">CineVN</span> Inc. All rights reserved.</p>
          <div className="flex gap-6 font-mono text-label-md uppercase text-cinema-subtle">
            <a href="#" className="hover:text-amber-gold transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-amber-gold transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-amber-gold transition-colors">Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
