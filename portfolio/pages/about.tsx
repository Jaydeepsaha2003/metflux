import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Home, ChevronRight, Users, Target, Lightbulb, Award, Calendar, MapPin, Mail, Phone } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import HumanoidSection from "@/components/HumanoidSection";
import SpecsSection from "@/components/SpecsSection";
import FeaturesSection from "@/components/reusable/FeaturesSection";
import TestimonialsSection from "@/components/reusable/TestimonialsSection";
import StatsSection from "@/components/reusable/StatsSection";
import siteData from "@/data/siteData";

const About = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 150);
            });
          }
        });
      },
      { threshold: 0.1 }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, []);

  // Extract data for components
  const aboutData = siteData.company.about;
  const featuresData = siteData.sections.features;
  const testimonialsData = siteData.sections.testimonials;
  const specsData = siteData.sections.specs;
  const reachData = siteData.sections.reach;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar navData={siteData.navigation} siteInfo={siteData.site} />
      
      {/* Hero Section with Breadcrumbs */}
      <section className="pt-20 pb-12 bg-gradient-to-br from-gray-900 via-gray-800 to-pulse-900">
        <div className="section-container">
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-sm text-gray-300 mb-8">
            <Link href="/" className="hover:text-white transition-colors flex items-center space-x-1">
              <Home className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-pulse-400">About</span>
          </nav>
          
          <div className="text-center text-white">
            <div className="pulse-chip mx-auto mb-4 bg-white/10 border-white/20">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-pulse-500 text-white mr-2">
                <Users className="w-4 h-4" />
              </span>
              <span>About Our Company</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4">
              Leading Electrical Excellence
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              We are at the forefront of transformer technology and electrical solutions, engineering reliable components that power industries worldwide.
            </p>
          </div>
        </div>
      </section>

      <main className="space-y-16" ref={sectionRef}>
        {/* Company Story Section */}
        <section className="py-16">
          <div className="section-container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center fade-in-element">
              <div className="space-y-6">
                <div className="pulse-chip">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                    <Lightbulb className="w-3 h-3" />
                  </span>
                  <span>Our Story</span>
                </div>
                <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900">
                  Engineering Excellence Since Day One
                </h2>
                <p className="text-lg text-gray-600 leading-relaxed">
                  Founded with a vision to deliver superior electrical solutions, Metflux Electrical Industries has been at the forefront of transformer technology for over two decades. Our journey began with a simple belief: quality engineering and precision manufacturing are the foundations of reliable electrical infrastructure.
                </p>
                <p className="text-lg text-gray-600 leading-relaxed">
                  Today, we're proud to be industry leaders in manufacturing high-performance transformer components, CRGO cores, and electrical solutions that power critical infrastructure across industries worldwide.
                </p>
              </div>
              
              <div className="relative">
                <div className="relative overflow-hidden rounded-2xl shadow-elegant h-96 bg-gradient-to-br from-gray-100 to-gray-200">
                  <div 
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
                    style={{ backgroundImage: `url('/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png')` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mission & Vision */}
        <section className="py-16 bg-white">
          <div className="section-container">
            <div className="text-center mb-12 fade-in-element">
              <div className="pulse-chip mx-auto mb-4">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                  <Target className="w-3 h-3" />
                </span>
                <span>Our Mission & Vision</span>
              </div>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900 mb-4">
                Powering Progress Through Engineering
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 fade-in-element">
              <div className="bg-gradient-to-br from-pulse-50 to-pulse-100 rounded-2xl p-8">
                <div className="w-12 h-12 bg-pulse-500 rounded-full flex items-center justify-center mb-6">
                  <Target className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-2xl font-display font-bold text-gray-900 mb-4">Our Mission</h3>
                <p className="text-gray-600 leading-relaxed">
                  To deliver world-class transformer components and electrical solutions that exceed industry standards, ensuring reliable power infrastructure for our customers while maintaining the highest levels of quality, safety, and performance.
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-8">
                <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center mb-6">
                  <Lightbulb className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-2xl font-display font-bold text-gray-900 mb-4">Our Vision</h3>
                <p className="text-gray-600 leading-relaxed">
                  To be the global leader in transformer technology and electrical solutions, creating innovative products that enable efficient power transmission and distribution while contributing to a more sustainable and electrified future.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Company Stats */}
        <StatsSection data={{stats: [
          { "value": "25+", "label": "Years Experience", "description": "Decades of electrical engineering expertise" },
          { "value": "1000+", "label": "Projects Completed", "description": "Successful installations worldwide" },
          { "value": "150+", "label": "Industry Partners", "description": "Trusted relationships globally" },
          { "value": "50+", "label": "Countries Served", "description": "International market presence" }
        ]}} backgroundClass="bg-gray-50" />

        {/* Core Capabilities Section */}
        <section className="py-16 bg-white">
          <div className="section-container">
            <div className="text-center mb-12 fade-in-element">
              <div className="pulse-chip mx-auto mb-4">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                  <Award className="w-3 h-3" />
                </span>
                <span>Core Capabilities</span>
              </div>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900 mb-4">
                Our Expertise in Electrical Solutions
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 fade-in-element">
              <div className="bg-gradient-to-br from-pulse-50 to-pulse-100 rounded-2xl p-6">
                <div className="w-12 h-12 bg-pulse-500 rounded-full flex items-center justify-center mb-4">
                  <span className="text-white font-bold">⚡</span>
                </div>
                <h3 className="text-xl font-display font-bold text-gray-900 mb-3">Transformer Manufacturing</h3>
                <p className="text-gray-600">Complete transformer design, manufacturing, and testing services with advanced CRGO core technology.</p>
              </div>
              
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6">
                <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center mb-4">
                  <span className="text-white font-bold">🔧</span>
                </div>
                <h3 className="text-xl font-display font-bold text-gray-900 mb-3">Custom Engineering</h3>
                <p className="text-gray-600">Tailored electrical solutions designed to meet specific customer requirements and applications.</p>
              </div>
              
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6">
                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mb-4">
                  <span className="text-white font-bold">🛡️</span>
                </div>
                <h3 className="text-xl font-display font-bold text-gray-900 mb-3">Quality Assurance</h3>
                <p className="text-gray-600">Rigorous testing and quality control processes ensuring compliance with international standards.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Industry Standards Section */}
        <section className="py-16 bg-gray-50">
          <div className="section-container">
            <div className="text-center mb-12 fade-in-element">
              <div className="pulse-chip mx-auto mb-4">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                  <Award className="w-3 h-3" />
                </span>
                <span>Standards & Certifications</span>
              </div>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900 mb-4">
                Meeting Global Standards
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Our products meet or exceed international quality and safety standards.
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 fade-in-element">
              <div className="text-center">
                <div className="w-16 h-16 bg-pulse-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-pulse-600 font-bold text-lg">IEC</span>
                </div>
                <h3 className="font-semibold text-gray-900">IEC Standards</h3>
                <p className="text-sm text-gray-600">International compliance</p>
              </div>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-pulse-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-pulse-600 font-bold text-lg">IEEE</span>
                </div>
                <h3 className="font-semibold text-gray-900">IEEE Standards</h3>
                <p className="text-sm text-gray-600">Electrical engineering excellence</p>
              </div>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-pulse-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-pulse-600 font-bold text-lg">ISO</span>
                </div>
                <h3 className="font-semibold text-gray-900">ISO 9001:2015</h3>
                <p className="text-sm text-gray-600">Quality management</p>
              </div>
              
              <div className="text-center">
                <div className="w-16 h-16 bg-pulse-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-pulse-600 font-bold text-lg">ANSI</span>
                </div>
                <h3 className="font-semibold text-gray-900">ANSI Standards</h3>
                <p className="text-sm text-gray-600">American national standards</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
};

export default About;

