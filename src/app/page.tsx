import { Suspense } from "react";
import BannerSlider from "@/components/home/BannerSlider";
import Hero from "@/components/home/Hero";
import FeaturedCourses from "@/components/home/FeaturedCourses";
import WhyMediSpark from "@/components/home/WhyMediSpark";
import GlanceSection from "@/components/home/GlanceSection";
import OurSuccess from "@/components/home/OurSuccess";
import JerseyGallery from "@/components/home/JerseyGallery";
import Mentors from "@/components/home/Mentors";
import StudentReviews from "@/components/home/StudentReviews";
import FaqSection from "@/components/home/FaqSection";
import JoinWithUs from "@/components/home/JoinWithUs";
import PromotionsSection from "@/components/home/PromotionsSection";
import { BannerSkeleton, HeroSkeleton, SectionSkeleton } from "@/components/home/HomeSkeletons";
import { fetchHomepageSections } from "@/lib/homepage-sections";
import { fetchHeroSettings } from "@/lib/hero-settings";
import { fetchPublishedReviewRecords } from "@/lib/reviews-store";
import { fetchPublishedFaqs } from "@/lib/faq-store";
import { fetchActiveJerseys } from "@/lib/content-admin";
import { fetchBannerSlides } from "@/lib/banner-slides";
import type { StudentReview } from "@/lib/reviews";
import type { HomepageSection } from "@/lib/homepage-sections-constants";
import type { ReactNode } from "react";

// Always fetch live MySQL data (jerseys, sections, reviews, faqs) on each
// request so Admin Panel changes appear immediately on the home page.
// Cached at the edge; admin changes appear within 60s.


function renderSection(section: HomepageSection) {
  const textProps = {
    title: section.title ?? undefined,
    description: section.description ?? undefined,
  };

  switch (section.key) {
    case "hero":
      return <Hero key={section.key} />;
    case "featured-courses":
      return <FeaturedCourses key={section.key} {...textProps} />;
    case "why-medispark":
      return <WhyMediSpark key={section.key} {...textProps} />;
    case "glance":
      return <GlanceSection key={section.key} />;
    case "our-success":
      return <OurSuccess key={section.key} {...textProps} />;
    case "mentors":
      return <Mentors key={section.key} {...textProps} />;
    case "reviews":
      return <StudentReviews key={section.key} {...textProps} />;
    default:
      return null;
  }
}

export default async function HomePage() {
  const [sections, heroSettings, reviewRecords, publishedFaqs, activeJerseys, bannerSlides] = await Promise.all([
    fetchHomepageSections(),
    fetchHeroSettings(),
    fetchPublishedReviewRecords(),
    fetchPublishedFaqs(),
    fetchActiveJerseys(),
    fetchBannerSlides(),
  ]);
  const activeSections = sections.filter((section) => section.isActive);

  const publishedReviews: StudentReview[] = reviewRecords.map((record, index) => ({
    id: record.id,
    studentUid: record.studentUid,
    studentName: record.studentName,
    studentAvatar: record.studentAvatar ?? "/avatars/student.svg",
    courseName: record.courseName,
    batchLabel: record.batchLabel,
    rating: record.rating,
    text: record.text,
    createdAt: new Date(record.createdAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    order: index,
    status: "published",
  }));

  // Jersey visibility is driven by Admin → Content → Jersey (MySQL `jerseys`
  // table): the section renders only while an active jersey with an image
  // exists, and always sits exactly between Glance and Mentors.
  const jerseySection = sections.find((section) => section.key === "jersey");
  const showJersey = Boolean(jerseySection?.isActive) && activeJerseys.length > 0;

  function renderHomeSection(section: HomepageSection): ReactNode {
    if (section.key === "banner") {
      return (
        <Suspense key={section.key} fallback={<BannerSkeleton />}>
          <BannerSlider initialSlides={bannerSlides} />
        </Suspense>
      );
    }
    if (section.key === "hero") {
      if (!heroSettings.isActive) return null;
      return (
        <Suspense key={section.key} fallback={<HeroSkeleton />}>
          <Hero hero={heroSettings} />
        </Suspense>
      );
    }
    if (section.key === "reviews") {
      return (
        <Suspense key={section.key} fallback={<SectionSkeleton />}>
          <StudentReviews
            reviews={publishedReviews}
            title={section.title ?? undefined}
            description={section.description ?? undefined}
          />
        </Suspense>
      );
    }
    if (section.key === "faq") {
      return (
        <Suspense key={section.key} fallback={<SectionSkeleton />}>
          <FaqSection
            faqs={publishedFaqs}
            title={section.title ?? undefined}
            description={section.description ?? undefined}
          />
        </Suspense>
      );
    }
    // Below-fold sections: wrap in Suspense so they stream without blocking first paint
    const node = renderSection(section);
    if (!node) return null;
    return <Suspense key={section.key} fallback={<SectionSkeleton />}>{node}</Suspense>;
  }

  const jerseyNode: ReactNode = (
    <JerseyGallery
      key="jersey"
      jerseys={activeJerseys}
    />
  );

  const glanceActive = activeSections.some(
    (section) => section.key === "glance",
  );

  // Join With Us Now! — immediately after FAQ, before Footer (admin-managed social_links)
  // Description is admin-editable via homepage_sections (Admin → Website → Homepage); heading is fixed per design spec
  const joinSectionDef = sections.find((s) => s.key === "join-with-us");
  const joinNode = (
    <JoinWithUs
      key="join-with-us"
      title={joinSectionDef?.title ?? undefined}
      description={joinSectionDef?.description ?? undefined}
    />
  );

  return (
    <main className="flex-1 bg-dark-950">
      <PromotionsSection />
      {activeSections
        .filter((section) => section.key !== "jersey")
        .flatMap((section) => {
          const nodes = [renderHomeSection(section)];
          // Exact order: Glance → Jersey → Mentors.
          if (showJersey && section.key === "glance") {
            nodes.push(jerseyNode);
          } else if (
            showJersey &&
            !glanceActive &&
            section.key === "mentors"
          ) {
            nodes.unshift(jerseyNode);
          }
          // Required order: FAQ → Join With Us Now! → Footer
          if (section.key === "faq") {
            nodes.push(joinNode);
          }
          return nodes;
        })}
      {/* Fallback: both neighbours disabled but jersey still published. */}
      {showJersey &&
        !activeSections.some(
          (section) =>
            section.key === "glance" || section.key === "mentors",
        ) &&
        jerseyNode}
      {/* If FAQ is disabled/hidden, still show Join With Us before Footer */}
      {!activeSections.some((s) => s.key === "faq") && joinNode}
    </main>
  );
}
