'use client';
import { useState, useEffect, useCallback } from 'react';
/* eslint-disable react-hooks/exhaustive-deps */

interface SavedMovie {
  id: string; // Movie ID or Slug
  slug: string;
  name: string;
  poster_url: string;
  origin_name?: string; // Added for MovieCard compatibility
  quality?: string;      // Added for MovieCard compatibility
  timeSaved: number;
  currentEpisode?: string;
  progress?: number; // seconds
  duration?: number; // seconds
  /**
   * Enough identity to warm the resolve before the viewer presses play.
   *
   * The Continue Watching row is the most common way into a title, and it is a
   * plain link: without these the row cannot prewarm, so the viewer pays the
   * full prepare + probe before the first frame. Absent on rows written before
   * this existed, which simply keep today's behaviour.
   */
  mediaType?: string;
  tmdbId?: number;
  season?: number;
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  // State to store our value
  // Pass initial state function to useState so logic is only executed once
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  // Use useEffect to update localStorage whenever the state changes
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch (error) {
      console.log(error);
    }
  }, [key, storedValue]);

  // Return storedValue and setStoredValue. 
  // setStoredValue is stable from useState, so consumers can use it in dependency arrays.
  return [storedValue, setStoredValue] as const;
}

export const useSavedMovies = () => {
  const [savedMovies, setSavedMovies] = useLocalStorage<SavedMovie[]>('my_saved_movies', []);

  const toggleSaveMovie = useCallback((movie: Omit<SavedMovie, 'timeSaved'>) => {
    setSavedMovies((prevSavedMovies) => {
      const exists = prevSavedMovies.find(m => m.slug === movie.slug);
      if (exists) {
        return prevSavedMovies.filter(m => m.slug !== movie.slug);
      } else {
        return [{ ...movie, timeSaved: Date.now() }, ...prevSavedMovies];
      }
    });
  }, [setSavedMovies]);

  const isSaved = (slug: string) => {
    return savedMovies.some(m => m.slug === slug);
  };

  return { savedMovies, toggleSaveMovie, isSaved };
};

// Hook for Continue Watching
export const useWatchHistory = () => {
  const [history, setHistory] = useLocalStorage<SavedMovie[]>('watch_history', []);

  const addToHistory = useCallback((movie: SavedMovie) => {
    setHistory((prevHistory) => {
      // Remove old entry if exists to push new one to top
      const others = prevHistory.filter(h => h.slug !== movie.slug);
      return [movie, ...others].slice(0, 20); // Keep last 20 items
    });
  }, [setHistory]);

  const getContinueList = () => history;

  const removeFromHistory = useCallback((slug: string) => {
    setHistory((prevHistory) => prevHistory.filter(h => h.slug !== slug));
  }, [setHistory]);

  /** One-time repair: fill poster_url for rows saved before artwork was recorded. */
  const patchHistoryPosters = useCallback((patches: Record<string, string>) => {
    if (Object.keys(patches).length === 0) return;
    setHistory((prevHistory) =>
      prevHistory.map((h) =>
        !h.poster_url && patches[h.slug] ? { ...h, poster_url: patches[h.slug] } : h
      )
    );
  }, [setHistory]);

  return { history, addToHistory, removeFromHistory, patchHistoryPosters };
};
