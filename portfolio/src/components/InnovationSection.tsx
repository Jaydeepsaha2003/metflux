import React, { useEffect, useRef, useState } from "react";

const InnovationSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ticking = useRef(false);
  const lastScrollY = useRef(0);

  // Enhanced smooth timing function with longer duration
  const cardStyle = {
    height: '60vh',
    maxHeight: '600px',
    borderRadius: '20px',
    transition: 'all 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 1s cubic-bezier(0.165, 0.84, 0.44, 1), opacity 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    willChange: 'transform, opacity, filter'
  };

  useEffect(() => {
    // Create intersection observer to detect when section is in view
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold: 0.1 } // Start observing when 10% of element is visible
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    // Optimized scroll handler using requestAnimationFrame
    const handleScroll = () => {
      if (!ticking.current) {
        lastScrollY.current = window.scrollY;
        
        window.requestAnimationFrame(() => {
          if (!sectionRef.current) return;
          
          const sectionRect = sectionRef.current.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const totalScrollDistance = viewportHeight * 2;
          
          // Calculate the scroll progress
          let progress = 0;
          if (sectionRect.top <= 0) {
            progress = Math.min(1, Math.max(0, Math.abs(sectionRect.top) / totalScrollDistance));
          }
          
          // Determine which card should be visible based on progress with smoother transitions
          if (progress >= 0.7) {
            setActiveCardIndex(2);
          } else if (progress >= 0.35) {
            setActiveCardIndex(1);
          } else {
            setActiveCardIndex(0);
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
  }, []);

  // Card visibility based on active index instead of direct scroll progress
  const isFirstCardVisible = isIntersecting;
  const isSecondCardVisible = activeCardIndex >= 1;
  const isThirdCardVisible = activeCardIndex >= 2;

  return (
    <div 
      ref={sectionRef} 
      className="relative" 
      style={{ height: '300vh' }}
    >
      <section className="w-full h-screen py-10 md:py-16 sticky top-0 overflow-hidden bg-white" id="innovation">
        <div className="container px-6 lg:px-8 mx-auto h-full flex flex-col">
          <div className="mb-2 md:mb-3">
            <div className="flex items-center gap-4 mb-2 md:mb-2 pt-8 sm:pt-6 md:pt-4">
              <div className="pulse-chip opacity-0 animate-fade-in" style={{
                animationDelay: "0.1s"
              }}>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">04</span>
                <span>Innovation</span>
              </div>
            </div>
            
            <h2 className="section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-1 md:mb-2 text-gray-900">
              Future Technology
            </h2>
          </div>
          
          <div ref={cardsContainerRef} className="relative flex-1 perspective-1000">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
              {/* Left Side Cards */}
              <div className="relative h-full">
                {/* First Card - Left */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isFirstCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 10,
                    transform: `translateX(${isFirstCardVisible ? '0px' : '-100px'}) rotateY(${isFirstCardVisible ? '0deg' : '-15deg'})`,
                    opacity: isFirstCardVisible ? 1 : 0,
                    filter: `blur(${isFirstCardVisible ? '0px' : '3px'})`
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-blue-600/90 to-indigo-700/90"
                    style={{
                      backgroundImage:  "url('https://images.unsplash.com/photo-1485827404703-89b55fcc595e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">AI Systems</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Next-Gen Intelligence
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Building intelligent systems that adapt and learn from human interaction.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Second Card - Left */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isSecondCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 20,
                    transform: `translateX(${isSecondCardVisible ? '0px' : '-100px'}) rotateY(${isSecondCardVisible ? '0deg' : '-15deg'})`,
                    opacity: isSecondCardVisible ? 1 : 0,
                    pointerEvents: isSecondCardVisible ? 'auto' : 'none',
                    filter: `blur(${isSecondCardVisible ? '0px' : '3px'})`
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-purple-600/90 to-pink-700/90"
                    style={{
                      backgroundImage: "url('https://images.unsplash.com/photo-1677442136019-21780ecad995?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">Adaptive Tech</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Evolving Solutions
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Creating adaptive technology that grows with your business needs.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Third Card - Left */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isThirdCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 30,
                    transform: `translateX(${isThirdCardVisible ? '0px' : '-100px'}) rotateY(${isThirdCardVisible ? '0deg' : '-15deg'})`,
                    opacity: isThirdCardVisible ? 1 : 0,
                    pointerEvents: isThirdCardVisible ? 'auto' : 'none',
                    filter: `blur(${isThirdCardVisible ? '0px' : '3px'})`
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-emerald-600/90 to-teal-700/90"
                    style={{
                      backgroundImage: "url('https://images.unsplash.com/photo-1485827404703-89b55fcc595e?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">Future Ready</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Tomorrow's World
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Shaping the future with <span className="text-[#FC4D0A] font-semibold">innovative technology</span>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Right Side Cards */}
              <div className="relative h-full">
                {/* First Card - Right */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isFirstCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 10,
                    transform: `translateX(${isFirstCardVisible ? '0px' : '100px'}) rotateY(${isFirstCardVisible ? '0deg' : '15deg'})`,
                    opacity: isFirstCardVisible ? 1 : 0,
                    filter: `blur(${isFirstCardVisible ? '0px' : '3px'})`,
                    transitionDelay: '0.15s'
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-orange-600/90 to-red-700/90"
                    style={{
                      backgroundImage: "url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">Analytics</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Smart Analytics
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Transforming data into actionable insights for better decision making.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Second Card - Right */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isSecondCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 20,
                    transform: `translateX(${isSecondCardVisible ? '0px' : '100px'}) rotateY(${isSecondCardVisible ? '0deg' : '15deg'})`,
                    opacity: isSecondCardVisible ? 1 : 0,
                    pointerEvents: isSecondCardVisible ? 'auto' : 'none',
                    filter: `blur(${isSecondCardVisible ? '0px' : '3px'})`,
                    transitionDelay: '0.15s'
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-cyan-600/90 to-blue-700/90"
                    style={{
                      backgroundImage: "url('https://images.unsplash.com/photo-1558494949-ef010cbdcc31?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">IoT</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Connected Ecosystem
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Building interconnected systems that communicate seamlessly.
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Third Card - Right */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isThirdCardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 30,
                    transform: `translateX(${isThirdCardVisible ? '0px' : '100px'}) rotateY(${isThirdCardVisible ? '0deg' : '15deg'})`,
                    opacity: isThirdCardVisible ? 1 : 0,
                    pointerEvents: isThirdCardVisible ? 'auto' : 'none',
                    filter: `blur(${isThirdCardVisible ? '0px' : '3px'})`,
                    transitionDelay: '0.15s'
                  }}
                >
                  <div
                    className="absolute inset-0 z-0 bg-gradient-to-b from-violet-600/90 to-purple-700/90"
                    style={{
                      backgroundImage: "url('https://images.unsplash.com/photo-1507146426996-ef05306b995a?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundBlendMode: "overlay"
                    }}
                  ></div>
                  
                  <div className="absolute top-4 right-4 z-20">
                    <div className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white">
                      <span className="text-xs font-medium">ML</span>
                    </div>
                  </div>
                  
                  <div className="relative z-10 p-4 sm:p-6 h-full flex items-end">
                    <div className="w-full">
                      <h3 className="text-xl sm:text-2xl md:text-3xl font-display text-white font-bold leading-tight mb-3">
                        Machine Learning
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed">
                        Empowering systems to learn and improve <span className="text-[#FC4D0A] font-semibold">autonomously</span>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default InnovationSection;
