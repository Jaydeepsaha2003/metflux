import React, { useEffect } from "react";
import dynamic from 'next/dynamic';
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import siteData from "@/data/siteData.json";

// Dynamic imports to prevent SSR issues
const Hero = dynamic(() => import("@/components/Hero"), { ssr: false });
const HumanoidSection = dynamic(() => import("@/components/HumanoidSection"), { ssr: false });
const FeaturesSection = dynamic(() => import("@/components/Features"), { ssr: false });
const NewTestimonialsSection = dynamic(() => import("@/components/TestimonialsSection"), { ssr: false });
const Gallery = dynamic(() => import("@/components/Gallery"), { ssr: false });
const ReachSection = dynamic(() => import("@/components/ReachSection"), { ssr: false });
const Products = dynamic(() => import("@/components/Products"), { ssr: false });
const FAQ = dynamic(() => import("@/components/FAQ"), { ssr: false });
const ConnectSection = dynamic(() => import("@/components/ConnectSection"), { ssr: false });
const QualityLogosMarquee = dynamic(() => import("@/components/QualityLogosMarquee"), { ssr: false });

const Index = () => {
  // Initialize intersection observer to detect when elements enter viewport
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-fade-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    const elements = document.querySelectorAll(".animate-on-scroll");
    elements.forEach((el) => observer.observe(el));
    
    return () => {
      elements.forEach((el) => observer.unobserve(el));
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // This helps ensure smooth scrolling for the anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('href')?.substring(1);
        if (!targetId) return;
        
        const targetElement = document.getElementById(targetId);
        if (!targetElement) return;
        
        // Increased offset to account for mobile nav
        const offset = window.innerWidth < 768 ? 100 : 80;
        
        window.scrollTo({
          top: targetElement.offsetTop - offset,
          behavior: 'smooth'
        });
      });
    });
  }, []);

  // Extract data for components
  const heroData = siteData.hero;
  const specsData = siteData.sections.specs;
  const featuresData = siteData.sections.features;
  const testimonialsData = siteData.sections.testimonials;
  const reachData = siteData.sections.reach;
  const faqData = siteData.sections.faq;

  return (
    <div className="min-h-screen">
      <Navbar navData={siteData.navigation} siteInfo={siteData.site} />
      <main className="space-y-4 sm:space-y-8"> {/* Reduced space on mobile */}
        <Hero />
        
        {/* <HumanoidSection /> */}
        <FeaturesSection />
        <NewTestimonialsSection />
        <Gallery />
        <QualityLogosMarquee />
        <ReachSection />
        <Products />
        <FAQ />
        <ConnectSection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
