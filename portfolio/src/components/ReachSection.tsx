import React, { useState, useEffect, useRef } from 'react';
import { Leaf, Recycle, Shield, Award, Target, Factory } from 'lucide-react';
import { BRAND_PALETTES, BRAND } from '@/brand/brand.config';

const palette = BRAND_PALETTES[BRAND];

const ReachSection: React.FC = () => {
  const [showContent, setShowContent] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  // Intersection Observer to show content when section is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !showContent) {
            // Show content when section comes into view
            setShowContent(true);
          }
        });
      },
      { 
        threshold: 0.2,
        rootMargin: '50px 0px'
      }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, [showContent]);

  const reachStats = [
    {
      icon: Leaf,
      title: "Energy Efficiency",
      value: "40%",
      label: "Reduced Energy Loss",
      description: "Our energy-efficient transformers significantly reduce power losses, contributing to a more sustainable grid infrastructure."
    },
    {
      icon: Recycle,
      title: "Sustainable Materials",
      value: "95%",
      label: "Recyclable Components",
      description: "Manufacturing with recyclable materials and implementing circular economy principles in our production processes."
    },
    {
      icon: Factory,
      title: "Green Manufacturing",
      value: "60%",
      label: "Carbon Footprint Reduction",
      description: "State-of-the-art manufacturing facilities with renewable energy sources and optimized production processes."
    },
    {
      icon: Shield,
      title: "Environmental Compliance",
      value: "100%",
      label: "ISO 14001 Certified",
      description: "Full compliance with international environmental standards and continuous improvement in environmental performance."
    },
    {
      icon: Target,
      title: "Zero Waste Initiative",
      value: "85%",
      label: "Waste Reduction",
      description: "Comprehensive waste management program achieving significant reduction in manufacturing waste through innovative processes."
    },
    {
      icon: Award,
      title: "Sustainability Awards",
      value: "12+",
      label: "Green Excellence Recognition",
      description: "Industry recognition for our commitment to sustainable manufacturing practices and environmental stewardship."
    }
  ];

  return (
    <section 
      ref={sectionRef}
      className="py-20 bg-gray-50 text-gray-900 overflow-hidden"
    >
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center justify-center relative">
          
          {/* Simple Header Circle */}
          <div className="relative flex items-center justify-center mb-16">
            {/* Outer glow effect */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-pulse-500/20 to-pulse-400/20 blur-xl scale-150"></div>
            
            {/* Simple Circle */}
            <div className="relative flex items-center justify-center w-80 h-80">
              <svg
                className="w-full h-full transform -rotate-90"
                viewBox="0 0 100 100"
              >
                {/* Background circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="rgba(0,0,0,0.08)"
                  strokeWidth="2"
                  fill="none"
                />
                
                {/* Complete circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="url(#progressGradient)"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 45}`}
                  strokeDashoffset={0}
                  style={{
                    filter: `drop-shadow(0 0 8px ${palette[500]}99)`
                  }}
                />

                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%"   stopColor={palette[600]} />
                    <stop offset="50%"  stopColor={palette[500]} />
                    <stop offset="100%" stopColor={palette[700]} />
                  </linearGradient>
                </defs>
              </svg>
              
              {/* Center content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                <div className="text-center">
                  <h2 className="text-4xl font-bold bg-gradient-to-r from-pulse-300 to-pulse-400 bg-clip-text text-transparent mb-2 tracking-wider">
                    SERVE & CONSERVE
                  </h2>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    Sustainability Commitment
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Content Section */}
          <div className={`transition-all duration-1000 ${showContent ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            
            {/* Header */}
            <div className="text-center mb-16">
              <h3 className="text-4xl md:text-5xl font-bold mb-6">
                Responsible <span className="bg-gradient-to-r from-pulse-300 to-pulse-400 bg-clip-text text-transparent">Manufacturing</span>
              </h3>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Our commitment to sustainability drives every aspect of our operations. From energy-efficient production processes to recyclable materials, we're building a greener future through responsible manufacturing practices and environmental stewardship.
              </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
            {reachStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div
                  key={stat.title}
                  className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm"
                  style={{
                    animationDelay: `${index * 200}ms`
                  }}
                >
                  <div>
                    {/* Icon */}
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-pulse-500 to-pulse-400 mb-6">
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                    
                    {/* Content */}
                    <h4 className="text-xl font-bold text-gray-900 mb-2">
                      {stat.title}
                    </h4>
                    
                    <div className="mb-4">
                      <div className="text-3xl font-bold bg-gradient-to-r from-pulse-300 to-pulse-400 bg-clip-text text-transparent mb-1">
                        {stat.value}
                      </div>
                      <div className="text-gray-500 text-sm font-medium uppercase tracking-wide">
                        {stat.label}
                      </div>
                    </div>
                    
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {stat.description}
                    </p>
                  </div>
                </div>
              );
            })}
            </div>

          </div>

          {/* Background particles effect */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 bg-pulse-400 rounded-full animate-pulse"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${2 + Math.random() * 3}s`
                }}
              ></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ReachSection;
