'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { premiereAPI } from '@/lib/api';
import Link from 'next/link';
import { Users, Send, ArrowLeft, Loader2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { io, Socket } from 'socket.io-client';
import LiveVideoPlayer from '@/components/LiveVideoPlayer';

interface Event {
  _id: string;
  movieSlug: string;
  name: string;
  posterUrl: string;
  thumbUrl: string;
  startTime: string;
  status: string;
}

interface Message {
  _id?: string;
  premiereId: string;
  userId: string;
  username: string;
  message: string;
  timestamp: string;
}

export default function LivePremierePage() {
  const { slug } = useParams();
  const { data: session } = useSession();
  const [event, setEvent] = useState<Event | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const emojis = ['😀', '😂', '❤️', '👍', '👏', '🔥', '🎉', '😍', '😢', '😮', '🤔', '💯', '👀', '🙌', '✨'];

  useEffect(() => {
    fetchEvent();
  }, []);

  useEffect(() => {
    if (!event?._id) return;
    
    // Connect to Socket.io
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5001';
    socketRef.current = io(socketUrl);
    
    socketRef.current.on('connect', () => {
      console.log('Connected to Socket.io');
      socketRef.current?.emit('join_premiere', event._id);
    });

    // Load chat history
    socketRef.current.on('chat_history', (history: Message[]) => {
      console.log('Loaded chat history:', history.length);
      setMessages(history);
    });

    // Receive new messages
    socketRef.current.on('receive_message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

    // Update real viewer count
    socketRef.current.on('viewer_count', (count: number) => {
      setViewerCount(count);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave_premiere', event._id);
        socketRef.current.disconnect();
      }
    };
  }, [event?._id]);

  useEffect(() => {
    // Auto scroll to bottom when new messages
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchEvent = async () => {
    try {
      const res = await premiereAPI.getBySlug(slug as string);
      if (res.data.success) {
        setEvent(res.data.event);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !session || !event || !socketRef.current) return;

    const messageData: Message = {
      premiereId: event._id,
      userId: session.user?.email || '',
      username: session.user?.name || 'Anonymous',
      message: newMessage,
      timestamp: new Date().toISOString()
    };

    socketRef.current.emit('send_message', messageData);
    setNewMessage('');
    setShowEmojiPicker(false);
  };

  const addEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  const formatTime = (date: string) => {
    const now = new Date();
    const time = new Date(date);
    const diff = Math.floor((now.getTime() - time.getTime()) / 1000);
    
    if (diff < 60) return 'Vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    return `${Math.floor(diff / 86400)} ngày trước`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-16 h-16 text-amber-gold animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-cinema-subtle text-xl mb-4">Không tìm thấy sự kiện</p>
          <Link href="/cong-chieu" className="text-amber-gold hover:text-amber-gold">
            ← Quay lại lịch công chiếu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-[100] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 z-[110] bg-gradient-to-b from-black/90 to-transparent p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/cong-chieu" className="flex items-center gap-1 md:gap-2 text-white hover:text-amber-gold transition-colors">
            <ArrowLeft size={18} className="md:w-5 md:h-5" />
            <span className="font-semibold text-xs md:text-sm hidden sm:inline">Lịch công chiếu</span>
            <span className="font-semibold text-xs sm:hidden">Quay lại</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-amber-primary px-2 md:px-3 py-1 md:py-1.5 rounded-full">
              <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-white rounded-full animate-pulse"></div>
              <span className="text-white font-bold text-[10px] md:text-xs">LIVE</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm px-2 md:px-3 py-1 md:py-1.5 rounded-full">
              <Users size={14} className="text-white md:w-4 md:h-4" />
              <span className="text-white font-semibold text-[10px] md:text-xs">{viewerCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Video Player */}
        <div className="flex-1 bg-black relative overflow-hidden">
          <LiveVideoPlayer 
            movieSlug={slug as string}
            premiereStartTime={event.startTime}
            movieName={event.name}
          />
          
          {/* Video Info Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-3 md:p-6 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10">
            <h1 className="text-white text-base md:text-2xl lg:text-3xl font-bold mb-1 md:mb-2 line-clamp-2">{event.name}</h1>
            <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-cinema-muted">
              <span className="hidden sm:inline">Công chiếu lúc: {new Date(event.startTime).toLocaleString('vi-VN')}</span>
              <span className="sm:hidden">{new Date(event.startTime).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
            </div>
          </div>
        </div>

        {/* Mobile Chat Button */}
        <button
          onClick={() => setShowMobileChat(true)}
          className="lg:hidden fixed bottom-20 right-4 z-40 w-14 h-14 bg-amber-primary hover:bg-amber-600 rounded-full shadow-lg flex items-center justify-center transition"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {messages.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-amber-gold text-black text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {messages.length > 99 ? '99+' : messages.length}
            </span>
          )}
        </button>

        {/* Mobile Chat Overlay */}
        {showMobileChat && (
          <div className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
            <div className="absolute bottom-0 left-0 right-0 h-[70vh] bg-surface-light rounded-t-2xl flex flex-col">
              {/* Chat Header */}
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div>
                  <h2 className="text-white text-lg font-bold">Chat trực tiếp</h2>
                  <p className="text-cinema-subtle text-xs mt-1">{messages.length} tin nhắn</p>
                </div>
                <button
                  onClick={() => setShowMobileChat(false)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Messages List */}
              <div 
                ref={chatRef}
                className="flex-1 overflow-y-auto p-4 space-y-3"
              >
                {messages.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-cinema-subtle text-sm">Chưa có tin nhắn nào</p>
                    <p className="text-cinema-subtle text-xs mt-2">Hãy là người đầu tiên chat!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div key={msg._id || idx} className="flex gap-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-amber-gold to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">
                          {msg.username[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-white font-semibold text-sm truncate">
                            {msg.username}
                          </span>
                          <span className="text-cinema-subtle text-[10px]">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-cinema-muted text-sm mt-0.5 break-words">
                          {msg.message}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Message Input */}
              <div className="p-4 border-t border-white/10 bg-surface-container">
                {session ? (
                  <div className="space-y-2">
                    {/* Emoji Picker */}
                    {showEmojiPicker && (
                      <div className="bg-surface-container-high rounded-lg p-2 grid grid-cols-8 gap-1">
                        {emojis.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => addEmoji(emoji)}
                            className="text-2xl hover:bg-surface-container-highest rounded p-1 transition"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    <form onSubmit={handleSendMessage} className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="bg-surface-container-high hover:bg-surface-container-highest text-white p-3 rounded-full transition"
                      >
                        <span className="text-xl">😀</span>
                      </button>
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Nhập tin nhắn..."
                        className="flex-1 bg-surface-container-high text-white px-4 py-3 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-primary"
                        maxLength={200}
                        autoComplete="off"
                      />
                      <button
                        type="submit"
                        disabled={!newMessage.trim()}
                        className="bg-amber-primary hover:bg-amber-600 disabled:bg-surface-bright disabled:cursor-not-allowed text-white p-3 rounded-full transition-colors"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-cinema-subtle text-sm mb-3">Đăng nhập để chat</p>
                    <Link
                      href="/auth/login"
                      className="inline-block bg-amber-primary hover:bg-amber-600 text-white px-6 py-2 rounded-full font-semibold transition-colors text-sm"
                    >
                      Đăng nhập
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Live Chat - Desktop only */}
        <div className="hidden lg:flex w-80 xl:w-96 bg-surface-light border-l border-white/10 flex-col">
          <div className="p-3 border-b border-white/10 flex-shrink-0">
            <h2 className="text-white text-lg font-bold">Chat trực tiếp</h2>
            <p className="text-cinema-subtle text-xs mt-1">
              {messages.length} tin nhắn
            </p>
          </div>

          {/* Messages List - Optimized scrolling */}
          <div 
            ref={chatRef} 
            className="flex-1 overflow-y-auto p-3 space-y-3"
            style={{ 
              scrollBehavior: 'smooth',
              overscrollBehavior: 'contain'
            }}
          >
            {messages.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-cinema-subtle text-sm">Chưa có tin nhắn nào</p>
                <p className="text-cinema-subtle text-xs mt-2">Hãy là người đầu tiên chat!</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={msg._id || idx} className="flex gap-2">
                  <div className="w-7 h-7 bg-gradient-to-br from-amber-gold to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">
                      {msg.username[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-white font-semibold text-xs truncate">
                        {msg.username}
                      </span>
                      <span className="text-cinema-subtle text-[10px]">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <p className="text-cinema-muted text-xs mt-0.5 break-words">
                      {msg.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Message Input */}
          <div className="p-3 border-t border-white/10 bg-surface-container flex-shrink-0">
            {session ? (
              <div className="space-y-2">
                {/* Emoji Picker Desktop */}
                {showEmojiPicker && (
                  <div className="bg-surface-container-high rounded-lg p-2 grid grid-cols-8 gap-1">
                    {emojis.map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => addEmoji(emoji)}
                        className="text-xl hover:bg-surface-container-highest rounded p-1 transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="bg-surface-container-high hover:bg-surface-container-highest text-white p-2 rounded-full transition flex-shrink-0"
                  >
                    <span className="text-lg">😀</span>
                  </button>
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Nhập tin nhắn..."
                    className="flex-1 bg-surface-container-high text-white px-3 py-2 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-primary"
                    maxLength={200}
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="bg-amber-primary hover:bg-amber-600 disabled:bg-surface-bright disabled:cursor-not-allowed text-white p-2 rounded-full transition-colors flex-shrink-0"
                    aria-label="Gửi"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-cinema-subtle text-sm mb-3">Đăng nhập để tham gia bình luận</p>
                <Link
                  href="/auth/login"
                  className="inline-block bg-amber-primary hover:bg-amber-600 text-white px-6 py-2 rounded-full font-semibold transition-colors"
                >
                  Đăng nhập
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Optimized CSS - Remove animations */}
      <style jsx global>{`
        /* Custom scrollbar for chat */
        .overflow-y-auto::-webkit-scrollbar {
          width: 4px;
        }
        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #4B5563;
          border-radius: 2px;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #6B7280;
        }
        
        /* Optimize rendering */
        .fixed {
          will-change: transform;
        }
      `}</style>
    </div>
  );
}
