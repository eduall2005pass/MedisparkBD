import Link from "next/link";
import Image from "next/image";
import type { HeroSettings } from "@/lib/hero-constants";
import { DEFAULT_HERO_SETTINGS } from "@/lib/hero-constants";
import InstallAppButton from "@/components/pwa/InstallAppButton";

export default function Hero({
  hero = DEFAULT_HERO_SETTINGS,
}: {
  hero?: HeroSettings;
}) {
  return (
    <section className="relative overflow-hidden bg-dark-950">
      {hero.backgroundImageUrl && (
        <div className="absolute inset-0">
          <Image
            src={hero.backgroundImageUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-dark-950/80" />
        </div>
      )}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-primary-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 h-[30rem] w-[30rem] rounded-full bg-primary-900/40 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 hidden h-full w-32 opacity-60 lg:block bg-dna" />

      <div className="relative mx-auto max-w-3xl px-4 pb-14 pt-8 text-center sm:px-6 sm:pb-20 sm:pt-12">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-heading sm:text-5xl xl:text-6xl">
            {hero.headline
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line, index) => (
                <span key={index} className="block">
                  {line}
                </span>
              ))}
          </h1>
          {hero.description && (
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-neutral-400 whitespace-pre-line">
              {hero.description}
            </p>
          )}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {hero.buttonText && hero.buttonLink && (
              <Link
                href={hero.buttonLink}
                className="rounded-xl bg-primary-600 px-6 py-3.5 text-center font-semibold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 active:scale-[0.98]"
              >
                {hero.buttonText}
              </Link>
            )}
            <InstallAppButton />
          </div>
        </div>
      </div>
    </section>
  );
}
