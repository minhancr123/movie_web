import Link from 'next/link';
import { Facebook, Instagram, Twitter, Github, Mail, Phone, MapPin, PlayCircle } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="relative bg-[#0a0a0a] text-gray-400 pt-20 pb-10 border-t border-white/5 overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-600/5 rounded-full blur-[128px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-[128px] pointer-events-none"></div>

      <div className="container mx-auto px-4 md:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">

          {/* Brand Column */}
          <div className="space-y-6">
            <Link href="/" className="group flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-rose-900 flex items-center justify-center shadow-lg shadow-red-900/20 group-hover:scale-110 transition-transform duration-300">
                <PlayCircle className="text-white fill-white/20" size={24} />
              </div>
              <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 tracking-tighter">
                MOVIE<span className="text-red-500">WEB</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-gray-500 max-w-xs">
              Trải nghiệm điện ảnh đỉnh cao ngay tại nhà. Hàng ngàn bộ phim bom tấn, phim bộ và show truyền hình đang chờ đón bạn.
            </p>
            <div className="flex gap-4">
              {[Facebook, Instagram, Twitter, Github].map((Icon, i) => (
                <a key={i} href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 hover:text-white hover:-translate-y-1 transition-all duration-300 group ring-1 ring-white/5 hover:ring-red-500">
                  <Icon size={18} className="group-hover:scale-110 transition-transform" />
                </a>
              ))}
            </div>
          </div>

          {/* Links Column 1 */}
          <div>
            <h3 className="text-white font-bold mb-6 text-base tracking-wide flex items-center gap-2">
              <span className="w-8 h-0.5 bg-red-600 rounded-full"></span>
              Thể loại Hot
            </h3>
            <ul className="space-y-3 text-sm">
              {[
                { name: 'Hành Động', href: '/the-loai/hanh-dong' },
                { name: 'Tình Cảm', href: '/the-loai/tinh-cam' },
                { name: 'Cổ Trang', href: '/the-loai/co-trang' },
                { name: 'Khám Phá', href: '/kham-pha' },
                { name: 'Lịch Chiếu', href: '/lich-chieu' },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center gap-2 hover:text-white hover:translate-x-1 transition-all duration-300 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/10 group-hover:bg-red-500 transition-colors"></span>
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Links Column 2 */}
          <div>
            <h3 className="text-white font-bold mb-6 text-base tracking-wide flex items-center gap-2">
              <span className="w-8 h-0.5 bg-blue-600 rounded-full"></span>
              Thông tin
            </h3>
            <ul className="space-y-3 text-sm">
              {['Giới thiệu', 'Bản quyền', 'Liên hệ', 'Điều khoản sử dụng'].map((item) => (
                <li key={item}>
                  <a href="#" className="flex items-center gap-2 hover:text-white hover:translate-x-1 transition-all duration-300 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/10 group-hover:bg-blue-500 transition-colors"></span>
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Column */}
          <div>
            <h3 className="text-white font-bold mb-6 text-base tracking-wide flex items-center gap-2">
              <span className="w-8 h-0.5 bg-green-600 rounded-full"></span>
              Liên hệ
            </h3>
            <ul className="space-y-4 text-sm text-gray-500">
              <li className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-red-500">
                  <MapPin size={16} />
                </div>
                <span className="mt-1">123 Đường Điện Ảnh, Quận 1, TP. Hồ Chí Minh</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-blue-500">
                  <Mail size={16} />
                </div>
                <span>contact@movieweb.com</span>
              </li>
              <li className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 text-green-500">
                  <Phone size={16} />
                </div>
                <span>+84 (0) 123 456 789</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center text-sm gap-4">
          <p className="text-gray-600">&copy; {new Date().getFullYear()} <span className="text-gray-400 font-bold">MovieWeb</span> Inc. All rights reserved.</p>
          <div className="flex gap-6 text-xs font-bold uppercase tracking-wider text-gray-600">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
