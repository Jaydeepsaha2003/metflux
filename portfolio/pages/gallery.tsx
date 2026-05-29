import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Home, ChevronRight, Camera, Image as ImageIcon } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Gallery from "@/components/Gallery";
import siteData from "@/data/siteData";

const GalleryPage = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  const images = [
    {
      src: "/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png",
      title: "Atlas Manufacturing",
      description: "Precision robotics in action"
    },
    {
      src: "/background-section2.png",
      title: "Healthcare Innovation",
      description: "Supporting medical professionals"
    },
    {
      src: "/background-section3.png",
      title: "Research & Development",
      description: "Advanced laboratory assistance"
    },
    {
      src: "/lovable-uploads/5663820f-6c97-4492-9210-9eaa1a8dc415.png",
      title: "Industrial Applications",
      description: "Next-generation automation"
    }
  ];

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
            <span className="text-pulse-400">Gallery</span>
          </nav>
          
          <div className="text-center text-white">
            <div className="pulse-chip mx-auto mb-4 bg-white/10 border-white/20">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-pulse-500 text-white mr-2">
                <Camera className="w-4 h-4" />
              </span>
              <span>Visual Showcase</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4">
              Gallery
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Explore our humanoid robots in action across various industries and applications. 
              See the future of robotics unfold through these captivating visuals.
            </p>
          </div>
        </div>
      </section>

      <main className="space-y-16" ref={sectionRef}>
        {/* First Gallery Component */}
        <Gallery />
        
        {/* Image Grid Section */}
        <section className="py-16">
          <div className="section-container">
            <div className="text-center mb-12 fade-in-element">
              <div className="pulse-chip mx-auto mb-4">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">
                  <ImageIcon className="w-3 h-3" />
                </span>
                <span>Featured Images</span>
              </div>
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900 mb-4">
                Robotics in Action
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                A curated collection showcasing our humanoid robots across different environments and use cases.
              </p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 fade-in-element">
              {images.map((image, index) => (
                <div 
                  key={index} 
                  className="group relative overflow-hidden rounded-2xl shadow-elegant hover:shadow-elegant-hover transition-all duration-300"
                >
                  <div className="aspect-square overflow-hidden">
                    <img
                      src={image.src}
                      alt={image.title}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                  </div>
                  
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h3 className="text-white font-semibold text-lg mb-1">
                        {image.title}
                      </h3>
                      <p className="text-white/80 text-sm">
                        {image.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        
        {/* Second Gallery Component */}
        <Gallery />
        
        {/* Call to Action */}
        <section className="py-16 bg-white">
          <div className="section-container">
            <div className="text-center fade-in-element">
              <h2 className="text-3xl lg:text-4xl font-display font-bold text-gray-900 mb-4">
                Want to See More?
              </h2>
              <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
                Explore our complete product catalog or get in touch to see how our humanoid robots 
                can transform your industry.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link 
                  href="/products" 
                  className="button-primary inline-flex items-center justify-center space-x-2"
                >
                  <span>View Products</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
                <Link 
                  href="/contact" 
                  className="button-secondary inline-flex items-center justify-center space-x-2"
                >
                  <span>Contact Us</span>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      
      <Footer />
    </div>
  );
};

export default GalleryPage;

