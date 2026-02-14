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
  const chatRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    fetchEvent();
  }, []);

  useEffect(() => {
    if (!event?._id) return;
    
    socketRef.current = io('http://localhost:5001');
    
    socketRef.current.on('connect', () => {
      console.log('Connected to Socket.io');
      socketRef.current?.emit('join_premiere', event._id);
    });

    socketRef.current.on('chat_history', (history: Message[]) => {
      console.log('Loaded chat history:', history.length);
      setMessages(history);
    });

    socketRef.current.on('receive_message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
    });

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
        <Loader2 className="w-16 h-16 text-red-600 animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 text-xl mb-4">Không tìm thấy sự kiện</p>
          <Link href="/cong-chieu" className="text-red-500 hover:text-red-400">
            ← Quay lại lịch công chiếu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-[100] overflow-hidden flex flex-col">
      {/* Header - Responsive */}
      <div className="flex-shrink-0 z-[110] bg-gradient-to-b from-black/90 to-transparent p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/cong-chieu" className="flex items-center gap-1 md:gap-2 text-white hover:text-red-500 transition-colors">
            <ArrowLeft size={18} className="md:w-5 md:h-5" />
            <span className="font-semibold text-xs md:text-sm">Quay lại</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-red-600 px-2 md:px-3 py-1 md:py-1.5 rounded-full">
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

      {/* Main Content - Responsive Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Video Player - Full on mobile, 70% on desktop */}
        <div className="flex-1 bg-black relative overflow-hidden">
          <LiveVideoPlayer 
            movieSlug={slug as string}
            premiereStartTime={event.startTime}
            movieName={event.name}
          />
          
          {/* Video Info Overlay - Responsive text sizes */}
          <div className="absolute bottom-0 left-0 right-0 p-3 md:p-6 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
            <h1 className="text-white text-base md:text-2xl lg:text-3xl font-bold mb-1 md:mb-2 line-clamp-2">{event.name}</h1>
            <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-300">
              <span className="hidden sm:inline">Công chiếu lúc: {new Date(event.startTime).toLocaleString('vi-VN')}</span>
              <span className="sm:hidden">{new Date(event.startTime).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
            </div>
          </div>
        </div>

        {/* Live Chat - Hidden on mobile, visible on desktop */}
        <div className="hidden lg:flex w-80 xl:w-96 bg-gray-900 border-l border-white/10 flex-col">
          <div className="p-3 border-b border-white/10 flex-shrink-0">
            <h2 className="text-white text-lg font-bold">Chat trực tiếp</h2>
            <p className="text-gray-400 text-xs mt-1">
              {messages.length} tin nhắn
            </p>
          </div>

          {/* Messages List */}
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
                <p className="text-gray-500 text-sm">Chưa có tin nhắn nào</p>
                <p className="text-gray-600 text-xs mt-2">Hãy là người đầu tiên chat!</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={msg._id || idx} className="flex gap-2">
                  <div className="w-7 h-7 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">
                      {msg.username[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-white font-semibold text-xs truncate">
                        {msg.username}
                      </span>
                      <span className="text-gray-500 text-[10px]">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                    <p className="text-gray-300 text-xs mt-0.5 break-words">
                      {msg.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Message Input */}
          <div className="p-3 border-t border-white/10 bg-gray-800 flex-shrink-0">
            {session ? (
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Nhập tin nhắn..."
                  className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  maxLength={200}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white p-2 rounded-full transition-colors flex-shrink-0"
                  aria-label="Gửi"
                >
                  <Send size={16} />
                </button>
              </form>
            ) : (
              <div className="text-center">
                <p className="text-gray-400 text-sm mb-3">Đăng nhập để chat</p>
                <Link
                  href="/auth/login"
                  className="inline-block bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-semibold transition-colors text-sm"
                >
                  Đăng nhập
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Scrollbar CSS */}
      <style jsx global>{`
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
      `}</style>
    </div>
  );
}
