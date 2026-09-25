'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { authAPI } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import SpatialShader from '@/components/SpatialShader';

const REMEMBER_KEY = 'cine_remember_email';

export default function AuthPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(true);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    username: '',
    fullName: '',
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) setFormData((prev) => ({ ...prev, email: saved }));
    } catch {
      // storage unavailable — ignore
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await signIn('google', { callbackUrl: '/' });
    } catch (err) {
      console.error('Google login error:', err);
      setError('Đăng nhập Google thất bại');
      setGoogleLoading(false);
    }
  };

  const handleAppleLogin = () => {
    setError('Đăng nhập Apple chưa được hỗ trợ — vui lòng dùng Google hoặc email.');
  };

  const handleForgotPassword = () => {
    setError('Chức năng đặt lại mật khẩu đang phát triển — vui lòng liên hệ hỗ trợ.');
  };

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setError('');
    setFormData({ email: formData.email, password: '', username: '', fullName: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        // Login
        const result = await signIn('credentials', {
          redirect: false,
          email: formData.email,
          password: formData.password,
        });

        if (result?.error) {
          setError('Email hoặc mật khẩu không đúng');
        } else {
          // Sync with local storage for legacy support if needed, though NextAuth handles session
          try {
            const response = await authAPI.login({
              email: formData.email,
              password: formData.password,
            });

            if (response.data.token) {
              localStorage.setItem('token', response.data.token);
              localStorage.setItem('user', JSON.stringify(response.data.user));
            }
          } catch (err) {
            console.error('API login sync failed', err);
          }

          try {
            if (remember) localStorage.setItem(REMEMBER_KEY, formData.email);
            else localStorage.removeItem(REMEMBER_KEY);
          } catch {
            // storage unavailable — ignore
          }

          router.push('/');
          router.refresh();
        }
      } else {
        // Register
        const response = await authAPI.register({
          email: formData.email,
          password: formData.password,
          username: formData.username,
          fullName: formData.fullName || formData.username,
        });

        if (response.data.success) {
          // Auto login after register
          localStorage.setItem('token', response.data.token);
          localStorage.setItem('user', JSON.stringify(response.data.user));

          await signIn('credentials', {
            redirect: false,
            email: formData.email,
            password: formData.password,
          });

          router.push('/');
          router.refresh();
        }
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message ||
        (err as { message?: string })?.message ||
        'Đã có lỗi xảy ra';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const tabActive =
    'py-3 text-center rounded-xl bg-gradient-to-r from-amber-gold/20 via-amber-primary/20 to-amber-gold/10 border border-amber-primary/40 text-amber-gold font-mono text-label-lg font-bold shadow-amber-glow transition-all';
  const tabInactive =
    'py-3 text-center rounded-xl text-cinema-muted hover:text-cinema-text font-mono text-label-lg transition-colors';

  return (
    <div className="relative -mx-4 -mt-20 px-6 pb-12 pt-28 md:-mx-8 lg:px-12">
      {/* Ambient Full Canvas Aurora & Cosmic Grain (Stitch) + realtime shader */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <SpatialShader opacity={0.8} speed={1.8} />
      </div>
      <div className="aurora-gradient pointer-events-none fixed inset-0 z-0"></div>
      <div className="stardust pointer-events-none fixed inset-0 z-0 opacity-40"></div>

      {/* Top Minimal Floating Header */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] items-center justify-between pb-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="group flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.35)] group-hover:scale-105 transition-all duration-300">
              <Image
                src="/icon.png"
                alt="CineVN"
                width={36}
                height={36}
                className="w-full h-full object-cover"
              />
            </div>
            <span className="font-syne text-headline-md font-extrabold tracking-tight bg-gradient-to-r from-amber-100 via-amber-gold to-amber-500 bg-clip-text text-transparent">
              CineVN
            </span>
          </Link>
          <span className="rounded-full border border-white/10 bg-surface-container-high/80 px-2.5 py-0.5 font-mono text-label-sm tracking-widest text-cyan-accent">
            SPATIAL 3D CINEMA
          </span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 font-mono text-label-md text-cinema-muted transition-colors hover:text-amber-gold"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Quay lại trang chủ</span>
        </Link>
      </div>

      {/* Main 2-Column Cinematic Layout */}
      <div className="relative z-10 mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
        {/* COLUMN 1: CINEMATIC AMBIANCE & IMMERSIVE BRANDING */}
        <div className="relative flex min-h-[540px] flex-col justify-center overflow-hidden rounded-3xl p-8 lg:col-span-6 lg:min-h-[680px] lg:p-12 xl:col-span-7">
          {/* Shader backdrop with deep OLED fade */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            <SpatialShader opacity={1} speed={1.8} />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-dark via-surface-dark/45 to-transparent"></div>
            <div className="absolute inset-0 bg-gradient-to-r from-surface-dark/60 via-transparent to-surface-dark/60"></div>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#0d0e11_100%)]"></div>
            <div className="pointer-events-none absolute -left-10 top-1/4 h-72 w-72 rounded-full bg-amber-primary/20 blur-[90px]"></div>
            <div className="pointer-events-none absolute bottom-10 right-10 h-80 w-80 rounded-full bg-cyan-accent/15 blur-[100px]"></div>
            <div className="pointer-events-none absolute right-1/3 top-20 h-60 w-60 rounded-full bg-wine-accent/15 blur-[90px]"></div>
          </div>

          {/* Foreground Content Layer */}
          <div className="relative z-10 flex max-w-xl flex-col space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-primary/40 bg-surface-dark/70 px-3 py-1 font-mono text-label-sm tracking-widest text-amber-gold shadow-amber-glow backdrop-blur-md">
                <span
                  className="material-symbols-outlined text-[14px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  theater_comedy
                </span>
                DỮ LIỆU TMDB
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-accent/30 bg-surface-dark/70 px-3 py-1 font-mono text-label-sm tracking-widest text-cyan-accent backdrop-blur-md">
                <span className="material-symbols-outlined text-[14px]">graphic_eq</span>
                NGUỒN 4K CACHED
              </span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-surface-dark/70 px-2.5 py-1 font-mono text-label-sm tracking-widest text-cinema-muted backdrop-blur-md">
                HLS REMUX
              </span>
            </div>

            <div className="space-y-3">
              <h1 className="font-syne text-display-hero-mobile font-extrabold leading-tight tracking-tight text-white lg:text-display-hero">
                ĐẮM CHÌM TRONG KHÔNG GIAN <br />
                <span className="bg-gradient-to-r from-amber-gold via-amber-primary to-cyan-accent bg-clip-text text-transparent drop-shadow-[0_4px_24px_rgba(245,158,11,0.35)]">
                  ĐIỆN ẢNH VÔ TẬN
                </span>
              </h1>
              <p className="text-body-lg font-light leading-relaxed text-cinema-muted/90">
                Tổng hợp metadata phim từ TMDB, tự động chấm điểm và chọn nguồn
                4K/HD đã lưu sẵn (cached) để phát mượt — lưu tiến độ, danh sách
                xem sau và tùy chọn ngay trên thiết bị của bạn.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3.5 pt-2">
              <div className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-surface-light/60 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 hover:translate-x-1 hover:border-amber-primary/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-primary/30 bg-amber-primary/10 text-amber-gold shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all duration-300 group-hover:bg-amber-primary group-hover:text-surface-dark">
                  <span className="material-symbols-outlined text-[24px]">movie_filter</span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-headline-sm font-semibold text-white">
                      Tự chọn nguồn ngon nhất
                    </h2>
                    <span className="rounded bg-amber-primary/20 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-amber-gold">
                      AUTO SCORE
                    </span>
                  </div>
                  <p className="text-body-sm text-cinema-muted/80">
                    Chấm điểm từng nguồn theo độ phân giải, seed và cache rồi tự
                    phát bản tốt nhất — đổi nguồn 4K thủ công lúc nào cũng được.
                  </p>
                </div>
              </div>

              <div className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-surface-light/60 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 hover:translate-x-1 hover:border-cyan-accent/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-accent/30 bg-cyan-accent/10 text-cyan-accent shadow-[0_0_15px_rgba(84,221,252,0.2)] transition-all duration-300 group-hover:bg-cyan-accent group-hover:text-surface-dark">
                  <span className="material-symbols-outlined text-[24px]">history</span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-headline-sm font-semibold text-white">
                      Xem dở, mở lại xem tiếp
                    </h2>
                    <span className="rounded bg-cyan-accent/20 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-cyan-accent">
                      RESUME
                    </span>
                  </div>
                  <p className="text-body-sm text-cinema-muted/80">
                    Tiến độ từng tập được lưu tự động — thoát ra giữa chừng, hôm
                    sau mở lại phát đúng chỗ đang xem.
                  </p>
                </div>
              </div>

              <div className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-surface-light/60 p-4 shadow-lg backdrop-blur-xl transition-all duration-300 hover:translate-x-1 hover:border-wine-accent/40">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-wine-accent/30 bg-wine-accent/20 text-rose-200 shadow-[0_0_15px_rgba(204,0,60,0.2)] transition-all duration-300 group-hover:bg-wine-accent group-hover:text-white">
                  <span className="material-symbols-outlined text-[24px]">verified</span>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-headline-sm font-semibold text-white">
                      Không quảng cáo 100%
                    </h2>
                    <span className="rounded bg-wine-accent/30 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-200">
                      UNINTERRUPTED
                    </span>
                  </div>
                  <p className="text-body-sm text-cinema-muted/80">
                    Trải nghiệm liền mạch, đắm chìm trọn vẹn từng khung hình mà
                    không bị ngắt quãng bất kỳ giây nào.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-3 font-mono text-label-md text-cinema-muted">
              <span
                className="material-symbols-outlined text-[18px] text-amber-gold"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                stars
              </span>
              <span>
                Miễn phí · Không quảng cáo · Lịch chiếu, công chiếu và thư viện
                tải xuống đầy đủ
              </span>
            </div>
          </div>
        </div>

        {/* COLUMN 2: AUTH FROSTED GLASS FORM CONTAINER */}
        <div className="flex justify-center lg:col-span-6 xl:col-span-5">
          <div className="glass-specular-card relative z-20 w-full max-w-[490px] rounded-3xl p-8 sm:p-10">
            <div className="flex items-center justify-between border-b border-white/10 pb-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-primary/40 bg-amber-primary/20 text-amber-gold">
                  <span className="material-symbols-outlined text-[20px]">verified_user</span>
                </div>
                <span className="font-mono text-label-sm uppercase tracking-widest text-cinema-muted">
                  XÁC THỰC THÀNH VIÊN CINESTREAM
                </span>
              </div>
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-emerald-400">
                256-BIT SSL
              </span>
            </div>

            {/* Dual Mode Toggle Tabs */}
            <div className="mt-6 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-surface-dark/80 p-1.5 backdrop-blur-md">
              <button
                type="button"
                onClick={() => switchMode(true)}
                className={isLogin ? tabActive : tabInactive}
              >
                Đăng Nhập
              </button>
              <button
                type="button"
                onClick={() => switchMode(false)}
                className={!isLogin ? tabActive : tabInactive}
              >
                Đăng Ký
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              {!isLogin && (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor="username"
                      className="block font-mono text-label-sm uppercase tracking-widest text-cinema-muted"
                    >
                      TÊN ĐĂNG NHẬP
                    </label>
                    <div className="relative flex items-center rounded-xl border border-white/10 bg-surface-container/60 transition-all duration-200 hover:border-amber-primary/40 focus-within:border-amber-primary focus-within:ring-2 focus-within:ring-amber-primary/20">
                      <span className="material-symbols-outlined pl-4 text-[20px] text-amber-gold">
                        person
                      </span>
                      <input
                        id="username"
                        name="username"
                        type="text"
                        required={!isLogin}
                        value={formData.username}
                        onChange={handleChange}
                        placeholder="cinephile_vn"
                        className="w-full border-0 bg-transparent px-3.5 py-3.5 text-body-md text-white placeholder-cinema-subtle/40 focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="fullName"
                      className="block font-mono text-label-sm uppercase tracking-widest text-cinema-muted"
                    >
                      HỌ VÀ TÊN
                    </label>
                    <div className="relative flex items-center rounded-xl border border-white/10 bg-surface-container/60 transition-all duration-200 hover:border-amber-primary/40 focus-within:border-amber-primary focus-within:ring-2 focus-within:ring-amber-primary/20">
                      <span className="material-symbols-outlined pl-4 text-[20px] text-amber-gold">
                        badge
                      </span>
                      <input
                        id="fullName"
                        name="fullName"
                        type="text"
                        value={formData.fullName}
                        onChange={handleChange}
                        placeholder="Nguyễn Văn A"
                        className="w-full border-0 bg-transparent px-3.5 py-3.5 text-body-md text-white placeholder-cinema-subtle/40 focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="block font-mono text-label-sm uppercase tracking-widest text-cinema-muted"
                >
                  ĐỊA CHỈ EMAIL
                </label>
                <div className="relative flex items-center rounded-xl border border-white/10 bg-surface-container/60 transition-all duration-200 hover:border-amber-primary/40 focus-within:border-amber-primary focus-within:ring-2 focus-within:ring-amber-primary/20">
                  <span className="material-symbols-outlined pl-4 text-[20px] text-amber-gold">
                    mail
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="tenban@cinestream.vn"
                    className="w-full border-0 bg-transparent px-3.5 py-3.5 text-body-md text-white placeholder-cinema-subtle/40 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block font-mono text-label-sm uppercase tracking-widest text-cinema-muted"
                  >
                    MẬT KHẨU
                  </label>
                  <span className="font-mono text-[11px] text-cyan-accent/90">
                    YÊU CẦU 6+ KÝ TỰ
                  </span>
                </div>
                <div className="relative flex items-center rounded-xl border border-white/10 bg-surface-container/60 transition-all duration-200 hover:border-amber-primary/40 focus-within:border-amber-primary focus-within:ring-2 focus-within:ring-amber-primary/20">
                  <span className="material-symbols-outlined pl-4 text-[20px] text-amber-gold">
                    lock
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••••••"
                    className="w-full border-0 bg-transparent px-3.5 py-3.5 text-body-md tracking-wider text-white placeholder-cinema-subtle/40 focus:outline-none focus:ring-0"
                  />
                  <button
                    type="button"
                    aria-label="Ẩn hoặc hiện mật khẩu"
                    onClick={() => setShowPassword(!showPassword)}
                    className="flex items-center justify-center pr-4 text-cinema-muted transition-colors hover:text-amber-gold"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="group flex cursor-pointer select-none items-center gap-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={remember}
                    onClick={() => setRemember(!remember)}
                    className={`flex h-4 w-4 items-center justify-center rounded border shadow-sm transition-colors ${
                      remember
                        ? 'border-amber-primary bg-amber-primary'
                        : 'border-white/20 bg-surface-container'
                    }`}
                  >
                    {remember && (
                      <span
                        className="material-symbols-outlined text-[14px] font-bold text-surface-dark"
                      >
                        check
                      </span>
                    )}
                  </button>
                  <span className="text-body-sm text-cinema-muted transition-colors group-hover:text-white">
                    Ghi nhớ tôi trên thiết bị này
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="font-mono text-label-md text-amber-gold transition-all hover:text-amber-primary hover:underline"
                >
                  Quên mật khẩu?
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-primary/20 bg-amber-primary/10 px-4 py-3 text-sm text-amber-gold">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-gold"></div>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-primary to-amber-gold px-6 py-4 text-headline-sm font-bold uppercase tracking-tight text-surface-dark shadow-[0_0_25px_rgba(245,158,11,0.45)] transition-all duration-200 hover:scale-[1.01] hover:shadow-[0_0_40px_rgba(245,158,11,0.7)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <>
                    <span
                      className="material-symbols-outlined text-[22px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      play_circle
                    </span>
                    <span>{isLogin ? 'ĐĂNG NHẬP VÀO CINESTREAM' : 'TẠO TÀI KHOẢN VIP CINESTREAM'}</span>
                  </>
                )}
              </button>

              <div className="relative flex items-center justify-center py-2">
                <div className="w-full border-t border-white/10"></div>
                <span className="absolute rounded-full border border-white/5 bg-surface-dark/90 px-4 font-mono text-label-sm uppercase tracking-widest text-cinema-muted backdrop-blur-md">
                  HOẶC TIẾP TỤC VỚI
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={googleLoading || loading}
                  className="group flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-surface-container/40 px-4 py-3 transition-all hover:border-white/20 hover:bg-surface-container-high/60 disabled:opacity-50"
                >
                  {googleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cinema-muted" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z"
                        fill="#EA4335"
                      ></path>
                      <path
                        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                        fill="#4285F4"
                      ></path>
                      <path
                        d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4L1.6 7c-.8 1.6-1.3 3.4-1.3 5.3s.5 3.7 1.3 5.3l3.7-2.9z"
                        fill="#FBBC05"
                      ></path>
                      <path
                        d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 6.4 10.4 6.4z"
                        fill="#34A853"
                      ></path>
                    </svg>
                  )}
                  <span className="font-mono text-label-lg text-white transition-colors group-hover:text-amber-gold">
                    Google
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleAppleLogin}
                  disabled={googleLoading || loading}
                  className="group flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-surface-container/40 px-4 py-3 transition-all hover:border-white/20 hover:bg-surface-container-high/60 disabled:opacity-50"
                >
                  <svg
                    className="h-4 w-4 fill-current text-white transition-colors group-hover:text-amber-gold"
                    viewBox="0 0 170 170"
                  >
                    <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.74 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.69-3.04-7.69-7.86-12-14.47-6.09-9.35-10.8-19.86-14.15-31.54-3.35-11.68-5.03-22.95-5.03-33.81 0-14.36 3.63-26.43 10.88-36.21 7.26-9.78 16.55-14.77 27.87-14.98 5.66 0 11.96 1.54 18.9 4.62 6.94 3.08 11.07 4.67 12.39 4.77 1.8 0 6.28-1.74 13.43-5.22 7.15-3.48 13.43-4.99 18.84-4.52 14.15 1.16 25.13 6.94 32.94 17.34-11.5 6.94-17.15 16.63-16.94 29.07.21 10.15 4.17 18.59 11.88 25.33 7.71 6.74 17.06 10.51 28.05 11.31-2.22 6.94-5.08 14.4-8.58 22.38zM119.22 33.14c0-7.38 2.65-14.39 7.95-21.03 5.3-6.64 12.06-11.01 20.27-13.11-.21 1.06-.32 2.01-.32 2.86 0 7.39-2.81 14.48-8.44 21.27-5.63 6.79-12.57 11.19-20.82 13.2-.1-.85-.15-1.7-.15-2.55z"></path>
                  </svg>
                  <span className="font-mono text-label-lg text-white transition-colors group-hover:text-amber-gold">
                    Apple
                  </span>
                </button>
              </div>
            </form>

            <div className="mt-8 border-t border-white/10 pt-6 text-center">
              <p className="text-body-md text-cinema-muted">
                {isLogin ? 'Chưa có tài khoản CineVN?' : 'Đã có tài khoản CineVN?'}
                <button
                  type="button"
                  onClick={() => switchMode(!isLogin)}
                  className="ml-1 inline-block font-semibold text-amber-gold underline decoration-amber-primary/50 underline-offset-4 transition-all hover:text-amber-primary hover:decoration-amber-primary"
                >
                  {isLogin ? 'Đăng ký thành viên VIP ngay' : 'Đăng nhập ngay'}
                </button>
              </p>
            </div>

            <div className="absolute -bottom-px left-12 right-12 h-px bg-gradient-to-r from-transparent via-amber-primary/50 to-transparent"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
