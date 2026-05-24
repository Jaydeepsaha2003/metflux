
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Timeline data
const timelineData = [
  "Jan 2023 – Company founded in Sonipat, Haryana as a manufacturer of CRGO Laminations, Toroidal Cores, Strip Laminations, and Built-Up Cores",
  "Mar 2023 – Set up modern manufacturing facility with advanced slitting, cutting, and core assembly machinery",
  "Jun 2023 – Launched official brand identity with the tagline 'Illuminating Innovation, Electrifying Excellence!'",
  "Aug 2023 – Obtained ISO 9001:2015 certification for quality management systems",
  "Oct 2023 – Achieved BIS approval enabling supply to high-voltage and government projects",
  "Dec 2023 – Exported first international shipment to Middle East markets",
  "Apr 2024 – Expanded product portfolio to include Amorphous Metal Cores for energy-efficient transformers",
  "Sep 2024 – Secured contracts with major transformer OEMs in India",
  "Feb 2025 – Reached a 100+ client base including global customers in Africa, Europe, and Asia",
  "Jul 2025 – Upgraded production lines with automation to increase capacity and precision"
];

// Particle Component
interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  baseX: number;
  baseY: number;
}

// Meteor Component
interface Meteor {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  opacity: number;
  trail: Array<{ x: number; y: number; opacity: number }>;
  life: number;
  maxLife: number;
}

// Mouse-attracted particles component
const MouseParticles = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const meteorsRef = useRef<Meteor[]>([]);
  const animationRef = useRef<number>();
  const mouseRef = useRef({ x: 0, y: 0, isInside: false });
  const lastMeteorTime = useRef<number>(0);

  // Setup canvas and initialize particles
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Set canvas size
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize particles
    const colors = ['#2cab4a', '#16a34a', '#4ade80'];
    const particles: Particle[] = [];
    
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      particles.push({
        id: i,
        x,
        y,
        baseX: x,
        baseY: y,
        size: Math.random() * 2 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: Math.random() * 0.3 + 0.5
      });
    }
    particlesRef.current = particles;

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
        mouseRef.current = { x, y, isInside: true };
      } else {
        mouseRef.current = { ...mouseRef.current, isInside: false };
      }
    };

    const handleMouseLeave = () => {
      mouseRef.current = { ...mouseRef.current, isInside: false };
    };

    // Animation loop
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = (currentTime: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Create new meteors very frequently
      if (currentTime - lastMeteorTime.current > 100 + Math.random() * 200) {
        const meteorColors = ['#2cab4a', '#16a34a', '#4ade80', '#ffffff'];
        
        // Random spawn position - either from top-right or top center
        const spawnFromTop = Math.random() > 0.5;
        let startX, startY;
        
        if (spawnFromTop) {
          // Spawn from top area (center to right)
          startX = canvas.width * 0.3 + Math.random() * canvas.width * 0.7;
          startY = -50 - Math.random() * 100;
        } else {
          // Spawn from top-right corner area
          startX = canvas.width + Math.random() * 100;
          startY = -50 - Math.random() * 100;
        }
        
        const newMeteor: Meteor = {
          id: Date.now(),
          x: startX,
          y: startY,
          vx: -(2 + Math.random() * 3),
          vy: 2 + Math.random() * 3,
          size: Math.random() * 3 + 2,
          color: meteorColors[Math.floor(Math.random() * meteorColors.length)],
          opacity: 0.8 + Math.random() * 0.2,
          trail: [],
          life: 0,
          maxLife: 100 + Math.random() * 100
        };
        meteorsRef.current.push(newMeteor);
        lastMeteorTime.current = currentTime;
      }

      // Update and draw meteors
      meteorsRef.current = meteorsRef.current.filter((meteor) => {
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life++;

        // Add current position to trail
        meteor.trail.push({ 
          x: meteor.x, 
          y: meteor.y, 
          opacity: meteor.opacity 
        });
        
        // Limit trail length
        if (meteor.trail.length > 15) {
          meteor.trail.shift();
        }

        // Draw meteor trail
        meteor.trail.forEach((point, index) => {
          const trailOpacity = (index / meteor.trail.length) * point.opacity * 0.6;
          const trailSize = meteor.size * (index / meteor.trail.length) * 0.8;
          
          ctx.save();
          ctx.globalAlpha = trailOpacity;
          ctx.fillStyle = meteor.color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, trailSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });

        // Draw meteor head with glow
        ctx.save();
        
        // Outer glow
        const gradient = ctx.createRadialGradient(
          meteor.x, meteor.y, 0,
          meteor.x, meteor.y, meteor.size * 3
        );
        gradient.addColorStop(0, meteor.color);
        gradient.addColorStop(0.3, meteor.color + '80');
        gradient.addColorStop(1, meteor.color + '00');
        
        ctx.globalAlpha = meteor.opacity * 0.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(meteor.x, meteor.y, meteor.size * 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Core meteor
        ctx.globalAlpha = meteor.opacity;
        ctx.fillStyle = meteor.color;
        ctx.beginPath();
        ctx.arc(meteor.x, meteor.y, meteor.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Remove meteors that are off screen or expired
        return meteor.x > -100 && meteor.y < canvas.height + 100 && meteor.life < meteor.maxLife;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', handleMouseMove);
    }
    container.addEventListener('mouseleave', handleMouseLeave);
    animate(0);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resizeCanvas);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousemove', handleMouseMove);
      }
      container.removeEventListener('mouseleave', handleMouseLeave);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ opacity: 0.8 }}
      />
    </div>
  );
};

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  index: number;
}

// Timeline Item Component
interface TimelineItemProps {
  date: string;
  description: string;
  index: number;
}

const TimelineItem = ({ date, description, index }: TimelineItemProps) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setIsVisible(true);
            }, index * 60); // Staggered animation delay — kept snappy
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    
    if (itemRef.current) {
      observer.observe(itemRef.current);
    }
    
    return () => {
      if (itemRef.current) {
        observer.unobserve(itemRef.current);
      }
    };
  }, [index]);

  const isEven = index % 2 === 0;
  
  return (
    <div
      ref={itemRef}
      className={cn(
        "timeline-item flex items-center gap-4 sm:gap-6 mb-8 sm:mb-12 transition-all duration-300 ease-out",
        isEven ? "flex-row" : "flex-row-reverse",
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4"
      )}
    >
      {/* Content */}
      <div className={cn(
        "flex-1 glass-card p-4 sm:p-6 transition-all duration-300 ease-out transform",
        "hover:bg-gradient-to-br hover:from-white hover:to-pulse-50",
        "hover:scale-105 hover:shadow-xl",
        isVisible
          ? "translate-x-0 opacity-100"
          : isEven
            ? "-translate-x-6 opacity-0"
            : "translate-x-6 opacity-0"
      )}>
        <div className={cn(
          "text-pulse-600 font-semibold text-sm sm:text-base mb-2 transition-all duration-200",
          isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}>
          {date}
        </div>
        <p className={cn(
          "text-gray-700 text-sm sm:text-base leading-relaxed transition-all duration-200 delay-75",
          isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}>
          {description}
        </p>
      </div>

      {/* Timeline dot */}
      <div className="flex-shrink-0 relative">
        <div className={cn(
          "w-4 h-4 bg-pulse-500 rounded-full border-4 border-white shadow-lg z-10 relative transition-all duration-200 transform",
          isVisible
            ? "scale-100 opacity-100"
            : "scale-0 opacity-0"
        )}></div>
        {index < timelineData.length - 1 && (
          <div className={cn(
            "absolute top-4 left-1/2 transform -translate-x-1/2 w-0.5 bg-gradient-to-b from-pulse-300 to-pulse-100 transition-all duration-300 delay-75",
            isVisible ? "h-16 sm:h-20 opacity-100" : "h-0 opacity-0"
          )}></div>
        )}
      </div>
      
      {/* Empty space for alternating layout */}
      <div className="flex-1"></div>
    </div>
  );
};

const FeatureCard = ({ icon, title, description, index }: FeatureCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
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
    
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }
    
    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, []);
  
  return (
    <div 
      ref={cardRef}
      className={cn(
        "feature-card glass-card opacity-0 p-4 sm:p-6",
        "lg:hover:bg-gradient-to-br lg:hover:from-white lg:hover:to-pulse-50",
        "transition-all duration-300"
      )}
      style={{ animationDelay: `${0.1 * index}s` }}
    >
      <div className="rounded-full bg-pulse-50 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-pulse-500 mb-4 sm:mb-5">
        {icon}
      </div>
      <h3 className="text-lg sm:text-xl font-semibold mb-2 sm:mb-3">{title}</h3>
      <p className="text-gray-600 text-sm sm:text-base">{description}</p>
    </div>
  );
};

// Simple Card Component for Mobile
const SimpleCard = ({ date, description, index }: { date: string; description: string; index: number }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setIsVisible(true);
            }, index * 100);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );
    
    if (cardRef.current) {
      observer.observe(cardRef.current);
    }
    
    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, [index]);
  
  return (
    <div 
      ref={cardRef}
      className={cn(
        "bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-4 transition-all duration-500 transform",
        "hover:shadow-md hover:border-pulse-200",
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4"
      )}
    >
      <div className="text-pulse-600 font-semibold text-sm mb-2">
        {date}
      </div>
      <p className="text-gray-700 text-sm leading-relaxed">
        {description}
      </p>
    </div>
  );
};

const Features = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 100);
            });
            observer.unobserve(entry.target);
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
    <section className="py-12 sm:py-16 md:py-20 pb-0 relative bg-gray-50 overflow-hidden" id="features" ref={sectionRef}>
      {/* Mouse-Attracted Particles Background - Desktop Only */}
      <div className="hidden md:block">
        <MouseParticles />
      </div>
      
      <div className="section-container relative z-10">
        <div className="text-center mb-8 sm:mb-16">
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            From Vision to Reality, <br className="hidden sm:block" />Building Excellence
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            Discover the milestones that shaped our journey from a startup in Sonipat to a leading manufacturer of CRGO Laminations and Transformer Cores.
          </p>
        </div>
        
        {/* Mobile Cards View */}
        <div className="md:hidden max-w-2xl mx-auto">
          {timelineData.map((item, index) => {
            const [date, ...descriptionParts] = item.split(' – ');
            const description = descriptionParts.join(' – ');
            return (
              <SimpleCard
                key={index}
                date={date}
                description={description}
                index={index}
              />
            );
          })}
        </div>
        
        {/* Desktop Timeline View */}
        <div className="hidden md:block max-w-4xl mx-auto">
          {timelineData.map((item, index) => {
            const [date, ...descriptionParts] = item.split(' – ');
            const description = descriptionParts.join(' – ');
            return (
              <TimelineItem
                key={index}
                date={date}
                description={description}
                index={index}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Features;
