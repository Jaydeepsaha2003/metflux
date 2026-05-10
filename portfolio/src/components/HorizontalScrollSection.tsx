import React, { useEffect, useRef, useState } from "react";

const HorizontalScrollSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ticking = useRef(false);

  const slideStyle = {
    minWidth: '100vw',
    height: '100vh',
    transition: 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    willChange: 'transform'
  };

  useEffect(() => {
    // Create intersection observer to detect when section is in view
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    // Optimized scroll handler using requestAnimationFrame
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          if (!sectionRef.current || !isIntersecting) {
            ticking.current = false;
            return;
          }
          
          const sectionRect = sectionRef.current.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const totalScrollDistance = viewportHeight * 2;
          
          // Calculate the scroll progress
          let progress = 0;
          if (sectionRect.top <= 0) {
            progress = Math.min(1, Math.max(0, Math.abs(sectionRect.top) / totalScrollDistance));
          }
          
          // Determine which slide should be active based on progress
          if (progress >= 0.66) {
            setActiveSlideIndex(2);
          } else if (progress >= 0.33) {
            setActiveSlideIndex(1);
          } else {
            setActiveSlideIndex(0);
          }
          
          // Apply horizontal transform to container
          if (containerRef.current) {
            const translateX = -progress * 200; // Move container horizontally
            containerRef.current.style.transform = `translateX(${translateX}vw)`;
          }
          
          ticking.current = false;
        });
        
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, [isIntersecting]);

  const slides = [
    {
      id: 1,
      title: "Revolutionary Design",
      subtitle: "Innovation in Motion",
      description: "Experience the next generation of robotics with our cutting-edge humanoid technology.",
      bgImage: "https://images.unsplash.com/photo-1518709268805-4e9042af2176?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80",
      accent: "#FC4D0A"
    },
    {
      id: 2,
      title: "Intelligent Automation",
      subtitle: "Smart Solutions",
      description: "Advanced AI algorithms that adapt and learn from every interaction and environment.",
      bgImage: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80",
      accent: "#00D4FF"
    },
    {
      id: 3,
      title: "Future Integration",
      subtitle: "Seamless Collaboration",
      description: "Designed to work alongside humans, enhancing productivity and creating new possibilities.",
      bgImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=2000&q=80",
      accent: "#7C3AED"
    }
  ];

  return (
    <div 
      ref={sectionRef} 
      className="relative" 
      style={{ height: '300vh' }}
    >
      <section className="w-full h-screen sticky top-0 overflow-hidden bg-gray-900">
        <div className="absolute inset-0">
          {/* Header */}
          <div className="absolute top-8 left-8 z-50">
            <div className="pulse-chip">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">03</span>
              <span>Horizontal Experience</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-display font-bold text-white mt-4">
              Scroll to Explore
            </h2>
          </div>

          {/* Progress Indicator */}
          <div className="absolute top-8 right-8 z-50">
            <div className="flex space-x-2">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    activeSlideIndex === index ? 'bg-white' : 'bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Slides Container */}
          <div 
            ref={containerRef}
            className="flex h-full transition-transform duration-700 ease-out"
            style={{ width: '300vw' }}
          >
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                className="relative"
                style={slideStyle}
              >
                {/* Background Image */}
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${slide.bgImage})`,
                    filter: 'brightness(0.4)'
                  }}
                />
                
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
                
                {/* Content */}
                <div className="relative z-10 h-full flex items-center px-8 md:px-16">
                  <div className="max-w-2xl">
                    <div 
                      className="inline-block px-4 py-2 rounded-full text-sm font-medium mb-6"
                      style={{ 
                        backgroundColor: `${slide.accent}20`,
                        color: slide.accent,
                        border: `1px solid ${slide.accent}30`
                      }}
                    >
                      {slide.subtitle}
                    </div>
                    
                    <h3 className="text-4xl md:text-6xl font-display font-bold text-white mb-6 leading-tight">
                      {slide.title}
                    </h3>
                    
                    <p className="text-xl text-gray-300 leading-relaxed mb-8">
                      {slide.description}
                    </p>
                    
                    <button 
                      className="inline-flex items-center px-8 py-4 rounded-full font-medium transition-all duration-300 hover:scale-105"
                      style={{
                        backgroundColor: slide.accent,
                        color: 'white'
                      }}
                    >
                      Learn More
                      <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default HorizontalScrollSection;

