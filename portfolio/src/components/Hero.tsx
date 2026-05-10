
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import LottieAnimation from "./LottieAnimation";


const Hero = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [lottieData, setLottieData] = useState<object | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Background images for slideshow
  const backgroundImages = [
    {
      url: "/images/h1.png",
      title: "Powering Progress with Precision",
      subtitle: "High-performance transformer components and electrical solutions engineered for reliability and efficiency."
    },
    {
      url: "/images/h2.png",
      title: "Advanced Manufacturing Excellence",
      subtitle: "State-of-the-art facilities producing CRGO laminations and toroidal cores with unmatched quality standards."
    },
    {
      url: "/images/h3.png",
      title: "Innovation in Energy Solutions",
      subtitle: "Leading the industry with cutting-edge amorphous metal cores and energy-efficient transformer technologies."
    },
    
   
  ];

  // Current slide content
  const currentSlideData = backgroundImages[currentSlide];

  // Slideshow auto-advance
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentSlide((prev) => (prev + 1) % backgroundImages.length);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 500);
      }, 300);
    }, 5000); // Change slide every 5 seconds

    return () => clearInterval(interval);
  }, [backgroundImages.length]);

  // Manual slide navigation
  const goToSlide = (index: number) => {
    if (index !== currentSlide && !isTransitioning) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentSlide(index);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 500);
      }, 300);
    }
  };

  const nextSlide = () => {
    const next = (currentSlide + 1) % backgroundImages.length;
    goToSlide(next);
  };

  const prevSlide = () => {
    const prev = currentSlide === 0 ? backgroundImages.length - 1 : currentSlide - 1;
    goToSlide(prev);
  };

  useEffect(() => {
    // Check if mobile on mount and when window resizes
    const checkMobile = () => {
      if (typeof window !== 'undefined') {
        setIsMobile(window.innerWidth < 768);
      }
    };
    
    checkMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkMobile);
    }
    
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', checkMobile);
      }
    };
  }, []);

  // Removed Lottie animation loading due to file format issues
  // useEffect(() => {
  //   fetch('/loop-header.lottie')
  //     .then(response => response.json())
  //     .then(data => setLottieData(data))
  //     .catch(error => console.error("Error loading Lottie animation:", error));
  // }, []);

  useEffect(() => {
    // Skip effect on mobile
    if (isMobile) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || !imageRef.current) return;
      
      const {
        left,
        top,
        width,
        height
      } = containerRef.current.getBoundingClientRect();
      const x = (e.clientX - left) / width - 0.5;
      const y = (e.clientY - top) / height - 0.5;

      imageRef.current.style.transform = `perspective(1000px) rotateY(${x * 2.5}deg) rotateX(${-y * 2.5}deg) scale3d(1.02, 1.02, 1.02)`;
    };
    
    const handleMouseLeave = () => {
      if (!imageRef.current) return;
      imageRef.current.style.transform = `perspective(1000px) rotateY(0deg) rotateX(0deg) scale3d(1, 1, 1)`;
    };
    
    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", handleMouseLeave);
    }
    
    return () => {
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseleave", handleMouseLeave);
      }
    };
  }, [isMobile]);
  
  useEffect(() => {
    // Skip parallax on mobile or during SSR
    if (isMobile || typeof window === 'undefined') return;
    
    const handleScroll = () => {
      if (typeof window === 'undefined') return;
      const scrollY = window.scrollY;
      const elements = document.querySelectorAll('.parallax');
      elements.forEach(el => {
        const element = el as HTMLElement;
        const speed = parseFloat(element.dataset.speed || '0.1');
        const yPos = -scrollY * speed;
        element.style.setProperty('--parallax-y', `${yPos}px`);
      });
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('scroll', handleScroll);
      }
    };
  }, [isMobile]);
  
  return (
    <section 
      className="overflow-hidden relative bg-cover transition-all duration-1000 ease-in-out min-h-screen" 
      id="hero" 
      style={{
        backgroundImage: `url("${currentSlideData.url}")`,
        backgroundPosition: 'center 30%', 
        padding: isMobile ? '120px 12px 60px' : '150px 20px 80px'
      }}
    >
      {/* Background overlay for smooth transitions */}
      <div className="absolute inset-0 bg-black bg-opacity-50 transition-opacity duration-1000"></div>
      {/* Dark gradient overlay for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60"></div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40"></div>
      
      <div className="absolute -top-[10%] -right-[5%] w-1/2 h-[70%] bg-pulse-gradient opacity-20 blur-3xl rounded-full"></div>
      
      <div className="container px-4 sm:px-6 lg:px-8" ref={containerRef}>
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-12 items-center">
          <div className="w-full lg:w-1/2">
            
            <h1 className={`section-title text-white text-3xl sm:text-4xl lg:text-5xl xl:text-6xl leading-tight transition-all duration-500 ${
              isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
            }`}>
              {currentSlideData.title}
            </h1>
            
            <p className={`section-subtitle mt-3 sm:mt-6 mb-4 sm:mb-8 leading-relaxed text-white font-normal text-base sm:text-lg text-left transition-all duration-500 delay-100 ${
              isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
            }`}>
              {currentSlideData.subtitle}
            </p>
            
            <div className={`flex flex-col sm:flex-row gap-4 transition-all duration-500 delay-200 ${
              isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
            }`}>
              <a 
                href="#products" 
                className="flex items-center justify-center group w-full sm:w-auto text-center" 
                style={{
                  backgroundColor: '#2cab4a',
                  borderRadius: '1440px',
                  boxSizing: 'border-box',
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: '20px',
                  padding: '16px 24px',
                  border: '1px solid white',
                }}
              >
                Explore Products
                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a 
                href="#connect" 
                className="flex items-center justify-center group w-full sm:w-auto text-center" 
                style={{
                  backgroundColor: 'transparent',
                  borderRadius: '1440px',
                  boxSizing: 'border-box',
                  color: '#2cab4a',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: '20px',
                  padding: '16px 24px',
                  border: '2px solid #2cab4a',
                }}
              >
                Get in Touch
                <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </div>
          
          <div className="w-full lg:w-1/2 relative mt-6 lg:mt-0">
            {lottieData ? (
              <div className="relative z-10 animate-fade-in" style={{ animationDelay: "0.9s" }}>
                <LottieAnimation 
                  animationPath={lottieData} 
                  className="w-full h-auto max-w-lg mx-auto"
                  loop={true}
                  autoplay={true}
                />
              </div>
            ) : (
              <>
              <div className="absolute inset-0 bg-dark-900 rounded-2xl sm:rounded-3xl -z-10 shadow-xl"></div>
              <div className="relative transition-all duration-500 ease-out overflow-hidden rounded-2xl sm:rounded-3xl shadow-2xl">
               
                <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.4) 100%)', mixBlendMode: 'overlay' }}></div>
              </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Slideshow Navigation */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20">
        <div className="flex items-center space-x-4">
          {/* Previous Button */}
          <button
            onClick={prevSlide}
            className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center hover:bg-white/30 transition-all duration-300 text-white"
            disabled={isTransitioning}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Slide Indicators */}
          <div className="flex space-x-2">
            {backgroundImages.map((_, index) => (
              <button
                key={index}
                onClick={() => goToSlide(index)}
                className={cn(
                  "w-3 h-3 rounded-full transition-all duration-300",
                  index === currentSlide
                    ? "bg-white scale-125"
                    : "bg-white/50 hover:bg-white/75"
                )}
                disabled={isTransitioning}
              >
                <span className="sr-only">Go to slide {index + 1}</span>
              </button>
            ))}
          </div>

          {/* Next Button */}
          <button
            onClick={nextSlide}
            className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center hover:bg-white/30 transition-all duration-300 text-white"
            disabled={isTransitioning}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 w-32 h-1 bg-white/20 rounded-full mx-auto overflow-hidden">
          <div 
            className="h-full bg-white transition-all duration-300 rounded-full"
            style={{ width: `${((currentSlide + 1) / backgroundImages.length) * 100}%` }}
          ></div>
        </div>
      </div>
      
      <div className="hidden lg:block absolute bottom-0 left-1/4 w-64 h-64 bg-pulse-100/30 rounded-full blur-3xl -z-10 parallax" data-speed="0.05"></div>
    </section>
  );
};

export default Hero;
