import React from "react";
import { ArrowRight, Play } from "lucide-react";
import Badge from "./Badge";

interface HeroData {
  badge?: {
    icon?: string;
    text: string;
  };
  title: string;
  subtitle?: string;
  description: string;
  backgroundImage?: string;
  cta?: {
    primary?: {
      text: string;
      href: string;
    };
    secondary?: {
      text: string;
      href: string;
    };
  };
}

interface HeroSectionProps {
  data: HeroData;
  className?: string;
}

const HeroSection: React.FC<HeroSectionProps> = ({ data, className = "" }) => {
  const handleScrollTo = (href: string) => {
    if (typeof window !== 'undefined') {
      if (href.startsWith('#')) {
        const element = document.querySelector(href);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        window.location.href = href;
      }
    }
  };

  return (
    <section 
      className={`relative min-h-screen flex items-center justify-center overflow-hidden ${className}`}
      style={{
        backgroundImage: data.backgroundImage ? `url('${data.backgroundImage}')` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900/80 via-gray-800/70 to-pulse-900/80" />
      
      {/* Content */}
      <div className="relative z-10 text-center text-white px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        {data.badge && (
          <div className="mb-6">
            <Badge 
              icon={data.badge.icon} 
              text={data.badge.text} 
              className="bg-white/10 border-white/20 text-white"
            />
          </div>
        )}
        
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-6 leading-tight">
          {data.title}
          {data.subtitle && (
            <>
              <br />
              <span className="text-pulse-400">{data.subtitle}</span>
            </>
          )}
        </h1>
        
        <p className="text-xl sm:text-2xl text-gray-300 mb-10 max-w-3xl mx-auto leading-relaxed">
          {data.description}
        </p>
        
        {data.cta && (
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            {data.cta.primary && (
              <button
                onClick={() => handleScrollTo(data.cta.primary!.href)}
                className="bg-pulse-500 hover:bg-pulse-600 text-white px-8 py-4 rounded-full font-medium text-lg transition-all duration-200 flex items-center space-x-2 shadow-lg hover:shadow-xl hover:scale-105"
              >
                <span>{data.cta.primary.text}</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
            
            {data.cta.secondary && (
              <button
                onClick={() => handleScrollTo(data.cta.secondary!.href)}
                className="border-2 border-white/30 text-white hover:bg-white/10 px-8 py-4 rounded-full font-medium text-lg transition-all duration-200 flex items-center space-x-2 backdrop-blur-sm"
              >
                <Play className="w-5 h-5" />
                <span>{data.cta.secondary.text}</span>
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-white/60">
        <div className="flex flex-col items-center space-y-2 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center">
            <div className="w-1 h-3 bg-white/60 rounded-full mt-2"></div>
          </div>
          <span className="text-sm">Scroll to explore</span>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
