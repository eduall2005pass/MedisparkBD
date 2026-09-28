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

export function useFavourites() {
  const { user, authLoading } = useAuth();

  const fetcher = async (url: string) => {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to load");
    return res.json();
  };

  const { data, error, isLoading, mutate } = useSWR<AllFavourites>(
    user && !authLoading ? "/api/my/favourites/details/all" : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // Slow/offline network users come back with a stale favourites list
      // (possibly referencing deleted courses) — refetch on reconnect so
      // deletions disappear instead of sticking.
      revalidateOnReconnect: true,
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
      // Optimistically update cache (branch per key so strict TS indexing stays happy)
      mutate(
        (current) => {
          if (!current) return current;
          if (itemType === "qa") {
            return { ...current, qa: current.qa.filter((item) => item.item_id !== itemId) };
          }
          if (itemType === "class") {
            return { ...current, classes: current.classes.filter((item) => item.item_id !== itemId) };
          }
          if (itemType === "exam") {
            return { ...current, exams: current.exams.filter((item) => item.item_id !== itemId) };
          }
          return { ...current, materials: current.materials.filter((item) => item.item_id !== itemId) };
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