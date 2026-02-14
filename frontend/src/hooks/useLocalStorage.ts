'use client';
import { useState, useEffect } from 'react';
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

  // Return a wrapped version of useState's setter function that ...
  // ... persists the new value to localStorage.
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue] as const;
}

export const useSavedMovies = () => {
  const [savedMovies, setSavedMovies] = useLocalStorage<SavedMovie[]>('my_saved_movies', []);

  const toggleSaveMovie = (movie: Omit<SavedMovie, 'timeSaved'>) => {
    const exists = savedMovies.find(m => m.slug === movie.slug);
    if (exists) {
      setSavedMovies(savedMovies.filter(m => m.slug !== movie.slug));
    } else {
      setSavedMovies([{ ...movie, timeSaved: Date.now() }, ...savedMovies]);
    }
  };

  const isSaved = (slug: string) => {
    return savedMovies.some(m => m.slug === slug);
  };

  return { savedMovies, toggleSaveMovie, isSaved };
};

// Hook for Continue Watching
export const useWatchHistory = () => {
  const [history, setHistory] = useLocalStorage<SavedMovie[]>('watch_history', []);

  const addToHistory = (movie: SavedMovie) => {
    // Remove old entry if exists to push new one to top
    const others = history.filter(h => h.slug !== movie.slug);
    setHistory([movie, ...others].slice(0, 20)); // Keep last 20 items
  };

  const getContinueList = () => history;

  const removeFromHistory = (slug: string) => {
    setHistory(history.filter(h => h.slug !== slug));
  };

  return { history, addToHistory, removeFromHistory };
};
