import siteData from "@/data/siteData";
import React from 'react';
import Badge from "./reusable/Badge";

const QualityLogosMarquee = () => {
  // List of quality logos from the public/quality-logos folder
  const logos = [
    {
      name: 'Adani Renewables',
      src: '/quality-logos/adani-renewables-logo.png',
    },
    {
      name: 'APTRANSCO',
      src: '/quality-logos/aptransco-logo.png',
    },
    {
      name: 'BHEL',
      src: '/quality-logos/bhel-logo.png',
    },
    {
      name: 'Bureau of Indian Standards',
      src: '/quality-logos/bureau-of-indian-standards-logo.png',
    },
    {
      name: 'GEM',
      src: '/quality-logos/gem-logo.png',
    },
    {
      name: 'ISO 9001:2015',
      src: '/quality-logos/iso-9001-2015-logo.png',
    },
    {
      name: 'NTPC',
      src: '/quality-logos/ntpc-logo.png',
    },
    {
      name: 'PowerGrid',
      src: '/quality-logos/powergrid-logo.png',
    },
    {
      name: 'RDSO',
      src: '/quality-logos/rdso-logo.png',
    },
    {
      name: 'ZED Silver',
      src: '/quality-logos/zed-silver-logo.png',
    },
  ];
  
  console.log('Quality Logos Array:', logos);

  const LogoItem = ({ logo }: { logo: typeof logos[0] }) => {
    const [imageError, setImageError] = React.useState(false);
    const [imageLoaded, setImageLoaded] = React.useState(false);

    React.useEffect(() => {
      // Preload image
      const img = new Image();
      img.onload = () => setImageLoaded(true);
      img.onerror = () => {
        console.warn(`Failed to preload logo: ${logo.src}`);
        setImageError(true);
      };
      img.src = logo.src;
    }, [logo.src]);

    return (
      <div className="flex-shrink-0 w-40 h-24 sm:w-48 sm:h-28 md:w-56 md:h-32 lg:w-64 lg:h-36 flex items-center justify-center mx-0.5 opacity-90 hover:opacity-100 transition-all duration-300 hover:scale-105">
        {imageError ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 border border-gray-200 rounded-lg">
            <span className="text-gray-600 font-medium text-sm text-center px-1">
              {logo.name}
            </span>
          </div>
        ) : (
          <div className="w-full h-full relative">
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50 animate-pulse rounded-lg">
                <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
            )}
            <img
              src={logo.src}
              alt={logo.name}
              title={logo.name}
              className={`w-full h-full object-contain transition-all duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              loading="eager"
              onLoad={() => setImageLoaded(true)}
              onError={(e) => {
                console.warn(`Failed to load logo: ${logo.src}`);
                setImageError(true);
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="py-16 bg-white" id="quality-approval">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <div className="mb-6">
            <Badge text="Quality Approval" />
          </div>
          
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold tracking-tight text-gray-900 mb-6">
            Quality Approval
          </h2>
          
          <p className="text-lg md:text-xl text-gray-600 max-w-4xl mx-auto leading-relaxed">
            At {siteData.site.name}, we uphold the highest standards of quality and reliability. Our Quality Approval Logos represent our commitment to excellence, ensuring that every product meets rigorous industry benchmarks. Trust our certified quality for unmatched performance and durability.
          </p>
        </div>
      
      {/* Marquee Container */}
      <div className="relative overflow-hidden py-8">
        {/* Gradient overlays for smooth fade effect */}
        <div className="absolute left-0 top-0 w-20 sm:w-32 h-full bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
        <div className="absolute right-0 top-0 w-20 sm:w-32 h-full bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
        
        {/* Marquee animation */}
        <div className="flex items-center animate-marquee-ltr hover:[animation-play-state:paused]">
          {/* Single set of logos with gap after */}
          {logos.map((logo, index) => (
            <LogoItem key={`logo-${index}`} logo={logo} />
          ))}
          
          {/* Gap before restart */}
          <div className="flex-shrink-0 w-16 h-24 sm:w-24 sm:h-28 md:w-32 md:h-32 lg:w-40 lg:h-36"></div>
          
          {/* Duplicate set for continuous animation */}
          {logos.map((logo, index) => (
            <LogoItem key={`logo-duplicate-${index}`} logo={logo} />
          ))}
        </div>
        </div>
        
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Certified and trusted by industry leaders worldwide
          </p>
        </div>
      </div>
    </section>
  );
};

export default QualityLogosMarquee;
