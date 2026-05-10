
import React, { useEffect } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/reusable/HeroSection";
import HumanoidSection from "@/components/HumanoidSection";
import InnovationSection from "@/components/InnovationSection";
import StatsSection from "@/components/reusable/StatsSection";
import DetailsSection from "@/components/DetailsSection";
import ImageShowcaseSection from "@/components/ImageShowcaseSection";
import FeaturesSection from "@/components/Features";
import TestimonialsSection from "@/components/Testimonials";
import NewTestimonialsSection from "@/components/TestimonialsSection";
import TextImageSection from "@/components/TextImageSection";
import MultiTextImageSection from "@/components/MultiTextImageSection";
import ScatterCardSection from "@/components/ScatterCardSection";
import FullscreenScrollSection from "@/components/FullscreenScrollSection";
import HorizontalScrollSection from "@/components/HorizontalScrollSection";
import ScatterCarsSection from "@/components/ScatterCarsSection";
import FAQ from "@/components/FAQ";
import Gallery from "@/components/Gallery";
import Products from "@/components/Products";
import ReachSection from "@/components/ReachSection";
import Newsletter from "@/components/Newsletter";
import MadeByHumans from "@/components/MadeByHumans";
import Footer from "@/components/Footer";
import siteData from "@/data/siteData.json";
import ImageWithTextOverlay from "@/components/ImageWithTextOverlay";
import QualityLogosMarquee from "@/components/QualityLogosMarquee";
import ConnectSection from "@/components/ConnectSection";
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
        <HeroSection data={heroData} />
        <QualityLogosMarquee />
        {/* <FullscreenScrollSection 
          imageUrl="https://images.unsplash.com/photo-1518709268805-4e9042af2176?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80"
          title="Experience Innovation"
          subtitle="Scroll to discover the future of robotics"
        /> */}
        <HumanoidSection />
        {/* <InnovationSection /> */}
        {/* <StatsSection data={specsData} id="specs" /> */}
        {/* <DetailsSection /> */}
        {/* <ImageShowcaseSection /> */}
        {/* <FeaturesSection  /> */}
        {/* <TestimonialsSection /> */}
        <NewTestimonialsSection />
        {/* <TextImageSection /> */}
        {/* <MultiTextImageSection /> */}
        {/* <ScatterCardSection /> */}
        <Gallery />
        <ReachSection />
        <Products />
        {/* <HorizontalScrollSection /> */}
        {/* <ScatterCarsSection /> */}
        {/* <StatsSection data={reachData} id="reach" backgroundClass="bg-white" /> */}
      {/* <ImageWithTextOverlay /> */}
        <FAQ />
        <ConnectSection />
        {/* <Newsletter /> */}
        {/* <MadeByHumans /> */}
      </main>
      <Footer />
    </div>
  );
};

export default Index;
