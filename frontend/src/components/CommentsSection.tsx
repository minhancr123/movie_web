'use client';
import { useState, useEffect } from 'react';
import { User, Send, Clock, Trash2, Edit2, X, AlertCircle } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { commentsAPI } from '@/lib/api';
import Link from 'next/link';
import Image from 'next/image';

interface Comment {
    _id: string;
    userId: string;
    movieSlug: string;
    content: string;
    parentId: string | null;
    user: {
        username: string;
        avatar: string;
        fullName: string;
    };
    likes: number;
    replies: any[]; // Recursive structure in MongoDB
    repliesData?: Comment[]; // Populated by backend
    createdAt: string;
    updatedAt: string;
}

interface CommentsSectionProps {
    slug: string;
}

export default function CommentsSection({ slug }: CommentsSectionProps) {
    const { data: session } = useSession();
    const [comments, setComments] = useState<Comment[]>([]);
    const [content, setContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');

    useEffect(() => {
        fetchComments();
    }, [slug]);

    const fetchComments = async () => {
        try {
            const response = await commentsAPI.getAll(slug);
            if (response.data.success) {
                setComments(response.data.comments);
            }
        } catch (err) {
            console.error('Failed to fetch comments', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!content.trim()) return;

        if (!session) {
            setError('Bạn cần đăng nhập để bình luận.');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            const response = await commentsAPI.add({
                movieSlug: slug,
                content: content.trim(),
            });

            if (response.data.success) {
                // Add new comment to top or re-fetch
                // Since we want realtime feel, let's prepend. 
                // Note: The object structure must match
                const newComment = response.data.comment;
                setComments([newComment, ...comments]);
                setContent('');
            }
        } catch (err) {
            console.error(err);
            setError('Có lỗi xảy ra khi gửi bình luận.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (commentId: string) => {
        if (!confirm('Bạn có chắc muốn xóa bình luận này?')) return;

        try {
            await commentsAPI.delete(commentId);
            setComments(comments.filter(c => c._id !== commentId));
        } catch (err) {
            console.error(err);
            alert('Không thể xóa bình luận.');
        }
    };

    const handleEdit = (comment: Comment) => {
        setEditingId(comment._id);
        setEditContent(comment.content);
    };

    const submitEdit = async (commentId: string) => {
        if (!editContent.trim()) return;

        try {
            await commentsAPI.update(commentId, { content: editContent });
            setComments(comments.map(c =>
                c._id === commentId ? { ...c, content: editContent } : c
            ));
            setEditingId(null);
        } catch (err) {
            console.error(err);
            alert('Không thể sửa bình luận.');
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="mt-12 max-w-5xl mx-auto px-4">
            <h3 className="text-xl font-bold border-l-4 border-red-600 pl-3 uppercase mb-6 flex items-center gap-2 text-white">
                Bình luận <span className="text-sm font-normal text-gray-400 normal-case">({comments.length})</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Comment Form */}
                <div className="md:col-span-1">
                    <div className="bg-[#111] p-6 rounded-xl border border-gray-800 sticky top-24">
                        <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                            <MessageIcon /> Để lại bình luận
                        </h4>

                        {!session ? (
                            <div className="text-center py-6">
                                <p className="text-gray-400 mb-4 text-sm">Vui lòng đăng nhập để tham gia bình luận.</p>
                                <Link
                                    href="/auth/login"
                                    className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full transition-colors text-sm"
                                >
                                    Đăng nhập ngay
                                </Link>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-700">
                                            {session.user?.image ? (
                                                <Image src={session.user.image} alt="Avatar" width={32} height={32} />
                                            ) : (
                                                <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                                                    <User size={16} className="text-gray-400" />
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-white font-medium text-sm">{session.user?.name}</span>
                                    </div>
                                    <textarea
                                        value={content}
                                        onChange={(e) => setContent(e.target.value)}
                                        placeholder="Chia sẻ cảm nghĩ của bạn về phim..."
                                        rows={4}
                                        required
                                        className="w-full bg-black/50 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-red-600 focus:outline-none transition-colors text-sm resize-none"
                                    />
                                </div>
                                {error && (
                                    <p className="text-red-500 text-xs flex items-center gap-1">
                                        <AlertCircle size={12} /> {error}
                                    </p>
                                )}
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !content.trim()}
                                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? 'Đang gửi...' : <><Send size={16} /> Gửi bình luận</>}
                                </button>
                            </form>
                        )}
                    </div>
                </div>

                {/* Comments List */}
                <div className="md:col-span-2 space-y-4">
                    {isLoading ? (
                        <div className="text-center py-10">
                            <div className="inline-block w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    ) : comments.length === 0 ? (
                        <div className="bg-[#111] p-8 rounded-xl border border-gray-800 text-center flex flex-col items-center justify-center min-h-[200px]">
                            <div className="bg-gray-800/50 p-4 rounded-full mb-4">
                                <MessageIcon size={32} className="text-gray-500" />
                            </div>
                            <p className="text-gray-300 font-medium">Chưa có bình luận nào.</p>
                            <p className="text-gray-500 text-sm mt-1">Hãy là người đầu tiên chia sẻ cảm nghĩ!</p>
                        </div>
                    ) : (
                        comments.map((comment) => (
                            <div key={comment._id} className="bg-[#111] p-5 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors group">
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-full border border-gray-700 overflow-hidden shrink-0">
                                        {comment.user?.avatar ? (
                                            <Image
                                                src={comment.user.avatar}
                                                alt={comment.user.username}
                                                width={40}
                                                height={40}
                                                className="object-cover w-full h-full"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                                                <User size={20} className="text-gray-400" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                            <h5 className="font-bold text-gray-200 text-sm">{comment.user?.fullName || 'Người dùng'}</h5>
                                            <span className="text-xs text-gray-500 flex items-center gap-1">
                                                <Clock size={12} /> {formatDate(comment.createdAt)}
                                            </span>
                                        </div>

                                        {editingId === comment._id ? (
                                            <div className="mt-2">
                                                <textarea
                                                    value={editContent}
                                                    onChange={(e) => setEditContent(e.target.value)}
                                                    className="w-full bg-black/50 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
                                                    rows={3}
                                                />
                                                <div className="flex gap-2 mt-2 justify-end">
                                                    <button
                                                        onClick={() => setEditingId(null)}
                                                        className="text-xs text-gray-400 hover:text-white px-3 py-1"
                                                    >
                                                        Hủy
                                                    </button>
                                                    <button
                                                        onClick={() => submitEdit(comment._id)}
                                                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                                                    >
                                                        Lưu
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words">
                                                {comment.content}
                                            </p>
                                        )}

                                        {/* Actions */}
                                        {session?.user?.username === comment.user?.username && !editingId && (
                                            <div className="flex gap-4 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleEdit(comment)}
                                                    className="text-gray-500 hover:text-blue-400 text-xs flex items-center gap-1"
                                                >
                                                    <Edit2 size={12} /> Sửa
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(comment._id)}
                                                    className="text-gray-500 hover:text-red-400 text-xs flex items-center gap-1"
                                                >
                                                    <Trash2 size={12} /> Xóa
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

const MessageIcon = ({ size = 20, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
)

