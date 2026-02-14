'use client';
import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, User } from 'lucide-react';
import { useSession } from 'next-auth/react'; // Assuming next-auth is used, or just localStorage

// Use the Node.js backend URL for socket
const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5001';

interface Message {
    _id?: string;
    userId: string;
    username: string;
    message: string;
    timestamp: string;
}

interface PremiereChatProps {
    premiereId: string;
    initialMessages: Message[];
}

export default function PremiereChat({ premiereId, initialMessages }: PremiereChatProps) {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [input, setInput] = useState('');
    const [socket, setSocket] = useState<Socket | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    // Mock user for now if auth not fully integrated in this component context
    // Ideally use session.
    const [user, setUser] = useState({ id: 'guest-' + Math.floor(Math.random() * 1000), name: 'Khách ' + Math.floor(Math.random() * 1000) });

    useEffect(() => {
        // Connect to socket
        const newSocket = io(SOCKET_URL, {
            withCredentials: true,
        });

        newSocket.on('connect', () => {
            console.log('Connected to chat server');
            newSocket.emit('join_premiere', premiereId);
        });

        newSocket.on('receive_message', (msg: Message) => {
            setMessages(prev => [...prev, msg]);
            scrollToBottom();
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [premiereId]);

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || !socket) return;

        const msgData = {
            premiereId,
            userId: user.id,
            username: user.name, // In real app, get from session
            message: input.trim()
        };

        socket.emit('send_message', msgData);
        setInput('');
    };

    return (
        <div className="flex flex-col h-full bg-[#111] border-l border-white/10">
            <div className="p-4 border-b border-white/10 bg-[#0a0a0a]">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    Trò chuyện trực tiếp
                </h3>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/50"
            >
                {messages.map((msg, idx) => (
                    <div key={idx} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                            <User size={14} className="text-gray-400" />
                        </div>
                        <div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-sm font-bold text-gray-300">{msg.username}</span>
                                <span className="text-[10px] text-gray-600">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-sm text-white break-words">{msg.message}</p>
                        </div>
                    </div>
                ))}
            </div>

            <form onSubmit={handleSend} className="p-4 border-t border-white/10 bg-[#0a0a0a]">
                <div className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Nhập tin nhắn..."
                        className="w-full bg-gray-800 text-white rounded-full px-4 py-2.5 pr-10 border border-gray-700 focus:border-red-500 focus:outline-none text-sm"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim()}
                        className="absolute right-1.5 top-1.5 p-1.5 bg-red-600 rounded-full text-white hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 transition-colors"
                    >
                        <Send size={14} />
                    </button>
                </div>
            </form>
        </div>
    );
}
