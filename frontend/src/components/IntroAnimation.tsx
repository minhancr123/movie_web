'use client';

import { useEffect, useState } from 'react';

const IntroAnimation = () => {
    const [show, setShow] = useState(true);
    const [remove, setRemove] = useState(false);

    useEffect(() => {
        // Use a versioned key so user sees the new intro immediately
        const hasShown = sessionStorage.getItem('introShown_v3');
        if (hasShown) {
            setShow(false);
            setRemove(true);
            return;
        }

        const totalDuration = 4500;

        const timer = setTimeout(() => {
            setShow(false);
            setTimeout(() => setRemove(true), 1000); // Allow fade out time
            sessionStorage.setItem('introShown_v3', 'true');
        }, totalDuration);

        return () => clearTimeout(timer);
    }, []);

    if (remove) return null;

    return (
        <div
            className={`fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden transition-opacity duration-1000 ease-out ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
        >
            <style jsx>{`
                @keyframes letter-in {
                    0% { transform: translateY(100px) scale(0.5); opacity: 0; filter: blur(20px); }
                    100% { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
                }
                @keyframes glow-pulse {
                    0%, 100% { text-shadow: 0 0 10px rgba(220, 38, 38, 0.5); }
                    50% { text-shadow: 0 0 30px rgba(220, 38, 38, 1), 0 0 60px rgba(220, 38, 38, 0.8); }
                }
                @keyframes zoom-out-fade {
                    0% { transform: scale(1); opacity: 1; }
                    20% { transform: scale(0.9); opacity: 1; } /* Anticipation */
                    100% { transform: scale(20); opacity: 0; letter-spacing: 50px; }
                }
                @keyframes line-expand {
                    0% { width: 0; opacity: 0; }
                    50% { width: 100%; opacity: 1; }
                    100% { width: 100%; opacity: 0; }
                }

                .intro-container {
                    animation: zoom-out-fade 1.5s cubic-bezier(0.7, 0, 0.3, 1) forwards;
                    animation-delay: 3s; /* Wait for letters to finish */
                }

                .letter {
                    display: inline-block;
                    animation: letter-in 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
                }
                
                .glow-text {
                    animation: glow-pulse 2s ease-in-out infinite;
                }
            `}</style>

            <div className="intro-container relative flex flex-col items-center">
                <div className="flex items-center gap-4 md:gap-8 mb-4">
                    <div className="flex glow-text">
                        {"MOVIE".split('').map((char, i) => (
                            <span
                                key={`m-${i}`}
                                className="letter text-5xl md:text-8xl font-black text-red-600 tracking-tighter"
                                style={{ animationDelay: `${i * 100}ms` }}
                            >
                                {char}
                            </span>
                        ))}
                    </div>

                    <div className="flex glow-text">
                        {"WEB".split('').map((char, i) => (
                            <span
                                key={`w-${i}`}
                                className="letter text-5xl md:text-8xl font-black text-white tracking-tighter"
                                style={{ animationDelay: `${500 + (i * 100)}ms` }} // Start after MOVIE
                            >
                                {char}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Decorative Line aka "The Remote Beam" */}
                <div
                    className="h-1 bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.8)] rounded-full"
                    style={{
                        animation: 'line-expand 2s ease-out forwards',
                        animationDelay: '1s'
                    }}
                />
            </div>
        </div>
    );
};

export default IntroAnimation;
