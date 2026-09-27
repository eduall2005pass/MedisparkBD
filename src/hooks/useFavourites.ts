"use client";

import useSWR from "swr";
import { useAuth } from "@/lib/auth-context";

type FavClass = {
  item_id: string;
  title: string;
  video_url: string | null;
  duration_minutes: number;
  chapter_name: string;
  subject_name: string;
  course_slug: string;
  course_name: string;
  created_at: string;
};

type FavExam = {
  item_id: string;
  title: string;
  duration_minutes: number;
  total_marks: number;
  chapter_name: string | null;
  subject_name: string | null;
  course_slug: string | null;
  course_name: string | null;
  created_at: string;
};

type FavMaterial = {
  item_id: string;
  title: string;
  material_type: string;
  file_url: string;
  chapter_name: string;
  subject_name: string;
  course_slug: string;
  course_name: string;
  created_at: string;
};

type FavQa = {
  item_id: string;
  text: string;
  status: string;
  subject_name: string | null;
  category_name: string | null;
  course_name: string | null;
  created_at: string;
  answered_at: string | null;
  has_picture: number | null;
};

type AllFavourites = {
  classes: FavClass[];
  exams: FavExam[];
  materials: FavMaterial[];
  qa: FavQa[];
};

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load");
  return res.json();
};

export function useFavourites() {
  const { user, authLoading } = useAuth();

  const { data, error, isLoading, mutate } = useSWR<AllFavourites>(
    user && !authLoading ? "/api/my/favourites/details/all" : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 30000,
    },
  );

  const toggle = async (itemType: "class" | "exam" | "material" | "qa", itemId: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/my/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemType, itemId }),
      });
      if (!res.ok) throw new Error("Failed");
      // Optimistically update cache
      mutate(
        (current) => {
          if (!current) return current;
          const key = itemType === "qa" ? "qa" : `${itemType}s`;
          return {
            ...current,
            [key]: current[key].filter((item: { item_id: string }) => item.item_id !== itemId),
          };
        },
        false,
      );
    } catch {
      // noop
    }
  };

  return {
    classes: data?.classes ?? [],
    exams: data?.exams ?? [],
    materials: data?.materials ?? [],
    qa: data?.qa ?? [],
    isLoading,
    error,
    toggle,
  };
}

export function useFavouriteClasses() {
  const { classes, isLoading, error, toggle } = useFavourites();
  return { items: classes, loading: isLoading, error, toggle: (id: string) => toggle("class", id) };
}

export function useFavouriteExams() {
  const { exams, isLoading, error, toggle } = useFavourites();
  return { items: exams, loading: isLoading, error, toggle: (id: string) => toggle("exam", id) };
}

export function useFavouriteMaterials() {
  const { materials, isLoading, error, toggle } = useFavourites();
  return { items: materials, loading: isLoading, error, toggle: (id: string) => toggle("material", id) };
}

export function useFavouriteQa() {
  const { qa, isLoading, error, toggle } = useFavourites();
  return { items: qa, loading: isLoading, error, toggle: (id: string) => toggle("qa", id) };
}