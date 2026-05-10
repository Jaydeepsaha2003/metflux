import React, { useEffect, useRef, useState } from "react";

const ImageWithTextOverlay = () => {
  // Single section with both sides
  const sectionRef = useRef<HTMLDivElement>(null);
  const cards1ContainerRef = useRef<HTMLDivElement>(null);
  const cards2ContainerRef = useRef<HTMLDivElement>(null);
  const [activeCard1Index, setActiveCard1Index] = useState(0);
  const [activeCard2Index, setActiveCard2Index] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);
  
  const ticking = useRef(false);
  const lastScrollY = useRef(0);

  // Card styling
  const cardStyle = {
    height: '60vh',
    maxHeight: '600px',
    borderRadius: '20px',
    transition: 'transform 0.5s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.5s cubic-bezier(0.19, 1, 0.22, 1)',
    willChange: 'transform, opacity'
  };

  useEffect(() => {
    // Single observer for the section
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    // Optimized scroll handler
    const handleScroll = () => {
      if (!ticking.current) {
        lastScrollY.current = window.scrollY;
        
        window.requestAnimationFrame(() => {
          // Handle the single section for both card sets
          if (sectionRef.current) {
            const sectionRect = sectionRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const totalScrollDistance = viewportHeight * 2;
            
            let progress = 0;
            if (sectionRect.top <= 0 && sectionRect.bottom > 0) {
              progress = Math.min(1, Math.max(0, Math.abs(sectionRect.top) / totalScrollDistance));
            }
            
            // Both card sets use the same progress
            if (progress >= 0.66) {
              setActiveCard1Index(2);
              setActiveCard2Index(2);
            } else if (progress >= 0.33) {
              setActiveCard1Index(1);
              setActiveCard2Index(1);
            } else {
              setActiveCard1Index(0);
              setActiveCard2Index(0);
            }
          }
          
          ticking.current = false;
        });
        
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (sectionRef.current) observer.unobserve(sectionRef.current);
    };
  }, []);

  // Card visibility for both sides (using same intersection state)
  const isFirst1CardVisible = isIntersecting;
  const isSecond1CardVisible = activeCard1Index >= 1;
  const isThird1CardVisible = activeCard1Index >= 2;

  const isFirst2CardVisible = isIntersecting;
  const isSecond2CardVisible = activeCard2Index >= 1;
  const isThird2CardVisible = activeCard2Index >= 2;

return (
    <>
      {/* Single Section with Both Sides */}
      <div 
        ref={sectionRef} 
        className="relative" 
        style={{ height: '300vh' }}
      >
        <section className="w-full h-screen py-10 md:py-16 sticky top-0 overflow-hidden bg-gray-50" id="technology-showcase">
          <div className="container px-6 lg:px-8 mx-auto h-full flex">
            {/* Left Side - First Set of Cards */}
            <div className="w-1/2 pr-4">
              <div ref={cards1ContainerRef} className="relative h-full perspective-1000">
                {/* Card 1.1 - AI Technology */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isFirst1CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 10,
                    transform: `translateY(${isFirst1CardVisible ? '90px' : '200px'}) scale(0.9)`,
                    opacity: isFirst1CardVisible ? 0.9 : 0
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">AI Core</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Advanced AI Processing Powers Every Decision
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Machine learning algorithms that adapt and improve performance over time.
                    </p>
                  </div>
                </div>
              </div>
              
                {/* Card 1.2 - Neural Networks */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isSecond1CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 20,
                    transform: `translateY(${isSecond1CardVisible ? activeCard1Index === 1 ? '55px' : '45px' : '200px'}) scale(0.95)`,
                    opacity: isSecond1CardVisible ? 1 : 0,
                    pointerEvents: isSecond1CardVisible ? 'auto' : 'none'
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay",
                    filter: "hue-rotate(30deg) saturate(1.2)"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">Neural Network</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Deep Neural Networks Drive Intelligent Behavior
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Complex neural architectures enable sophisticated decision-making and learning.
                    </p>
                  </div>
                </div>
              </div>
              
                {/* Card 1.3 - Quantum Computing */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isThird1CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 30,
                    transform: `translateY(${isThird1CardVisible ? activeCard1Index === 2 ? '15px' : '0' : '200px'}) scale(1)`,
                    opacity: isThird1CardVisible ? 1 : 0,
                    pointerEvents: isThird1CardVisible ? 'auto' : 'none'
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay",
                    filter: "hue-rotate(60deg) saturate(1.1)"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">Quantum</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Quantum Computing Unleashes <span className="text-[#FC4D0A]">Unlimited Potential</span>
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Revolutionary quantum processors solve complex problems in seconds.
                    </p>
                  </div>
                </div>
              </div>
              </div>
            </div>
            
            {/* Right Side - Second Set of Cards */}
            <div className="w-1/2 pl-4">
              <div ref={cards2ContainerRef} className="relative h-full perspective-1000">
                {/* Card 2.1 - Precision Engineering */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isFirst2CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 10,
                    transform: `translateY(${isFirst2CardVisible ? '90px' : '200px'}) scale(0.9)`,
                    opacity: isFirst2CardVisible ? 0.9 : 0
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay",
                    filter: "hue-rotate(120deg) saturate(1.3)"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">Precision</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Sub-millimeter Accuracy in Every Movement
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Precision engineering delivers unmatched performance for demanding applications.
                    </p>
                  </div>
                </div>
              </div>
              
                {/* Card 2.2 - Advanced Materials */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isSecond2CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 20,
                    transform: `translateY(${isSecond2CardVisible ? activeCard2Index === 1 ? '55px' : '45px' : '200px'}) scale(0.95)`,
                    opacity: isSecond2CardVisible ? 1 : 0,
                    pointerEvents: isSecond2CardVisible ? 'auto' : 'none'
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay",
                    filter: "hue-rotate(180deg) saturate(1.4)"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">Materials</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Revolutionary Materials Science Innovation
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Advanced composites and smart materials enable unprecedented capabilities.
                    </p>
                  </div>
                </div>
              </div>
              
                {/* Card 2.3 - System Integration */}
                <div 
                  className={`absolute inset-0 overflow-hidden shadow-xl ${isThird2CardVisible ? 'animate-card-enter' : ''}`} 
                  style={{
                    ...cardStyle,
                    zIndex: 30,
                    transform: `translateY(${isThird2CardVisible ? activeCard2Index === 2 ? '15px' : '0' : '200px'}) scale(1)`,
                    opacity: isThird2CardVisible ? 1 : 0,
                    pointerEvents: isThird2CardVisible ? 'auto' : 'none'
                  }}
                >
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/20"
                  style={{
                    backgroundImage: "url('/lovable-uploads/c3d5522b-6886-4b75-8ffc-d020016bb9c2.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundBlendMode: "overlay",
                    filter: "hue-rotate(240deg) saturate(1.2)"
                  }}
                ></div>
                
                <div className="absolute top-4 right-4 z-20">
                  <div className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm text-white">
                    <span className="text-sm font-medium">Integration</span>
                  </div>
                </div>
                
                <div className="relative z-10 p-5 sm:p-6 md:p-8 h-full flex items-center">
                  <div className="max-w-lg">
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-display text-white font-bold leading-tight mb-4">
                      Seamless System Integration <span className="text-[#FC4D0A]">Everywhere</span>
                    </h3>
                    <p className="text-white/90 text-base md:text-lg leading-relaxed">
                      Perfect integration with existing workflows for maximum efficiency and productivity.
                    </p>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
</section>
      </div>
    </>
  );
};

export default ImageWithTextOverlay;
