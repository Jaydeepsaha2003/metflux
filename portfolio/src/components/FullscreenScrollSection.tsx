import React, { useEffect, useRef, useState } from 'react';

interface FullscreenScrollSectionProps {
  imageUrl: string;
  title?: string;
  subtitle?: string;
  className?: string;
}

const FullscreenScrollSection: React.FC<FullscreenScrollSectionProps> = ({
  imageUrl,
  title = "Scroll Experience",
  subtitle = "Watch the image expand as you scroll",
  className = ""
}) => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState('scale(1)');

  useEffect(() => {
    const handleScroll = () => {
      if (!sectionRef.current) return;

      const section = sectionRef.current;
      const rect = section.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Calculate scroll progress based on section position
      const sectionTop = rect.top;
      const sectionHeight = rect.height;
      
      // Determine if section is in view and calculate progress
      if (sectionTop <= windowHeight && sectionTop + sectionHeight >= 0) {
        // Section is visible
        const scrolled = windowHeight - sectionTop;
        const progress = Math.min(Math.max(scrolled / (windowHeight + sectionHeight), 0), 1);
        
        // Create scaling effect based on scroll progress
        let scale = 1;
        
        if (progress < 0.25) {
          // Start scaling up
          scale = 1 + (progress / 0.25) * 1.5; // Scale from 1 to 2.5
        } else if (progress < 0.75) {
          // Stay at max scale
          scale = 2.5;
        } else {
          // Scale back down
          const exitProgress = (progress - 0.75) / 0.25;
          scale = 2.5 - exitProgress * 1.5; // Scale from 2.5 to 1
        }
        
        setTransform(`scale(${scale})`);
      } else {
        // Section not in view, reset scale
        setTransform('scale(1)');
      }
    };

    // Add scroll listener
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Call once to set initial state
    
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  return (
    <section 
      ref={sectionRef}
      className={`relative min-h-[300vh] flex items-center justify-center bg-black ${className}`}
      style={{ zIndex: 10 }}
    >
      {/* Text content - positioned above the image */}
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 text-center z-20 text-white">
        <h2 className="text-4xl md:text-6xl font-bold mb-4 opacity-90">
          {title}
        </h2>
        <p className="text-lg md:text-xl opacity-70 max-w-2xl mx-auto px-4">
          {subtitle}
        </p>
      </div>

      {/* Fullscreen image container */}
      <div 
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{
          transform: transform,
          transition: 'transform 0.2s ease-out',
          zIndex: transform.includes('2.') ? 50 : 10, // Higher z-index when scaled up
        }}
      >
        <div 
          className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {/* Optional overlay for better text visibility */}
          <div className="absolute inset-0 bg-black bg-opacity-20"></div>
        </div>
      </div>

      {/* Bottom spacer to ensure smooth transition to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white to-transparent z-30"></div>
    </section>
  );
};

export default FullscreenScrollSection;
