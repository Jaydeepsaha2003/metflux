import React, { useEffect, useRef, useState } from "react";

const ScatterCarsSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isScattered, setIsScattered] = useState(false);
  const ticking = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          // Delay scatter animation slightly after visibility
          setTimeout(() => setIsScattered(true), 200);
        } else {
          setIsVisible(false);
          setIsScattered(false);
        }
      },
      { threshold: 0.2, rootMargin: '-10% 0px' }
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

  const cars = [
    {
      id: 1,
      image: "https://images.unsplash.com/photo-1542362567-b07e54358753?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
      title: "Sports Car",
      finalX: -220,
      finalY: -120,
      delay: 0,
      rotation: -15
    },
    {
      id: 2,
      image: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
      title: "SUV",
      finalX: 0,
      finalY: -180,
      delay: 0.3,
      rotation: 0
    },
    {
      id: 3,
      image: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
      title: "Sedan",
      finalX: 220,
      finalY: -120,
      delay: 0.6,
      rotation: 15
    },
    {
      id: 4,
      image: "https://images.unsplash.com/photo-1580273916550-e323be2ae537?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
      title: "Coupe",
      finalX: -160,
      finalY: 140,
      delay: 0.9,
      rotation: -10
    },
    {
      id: 5,
      image: "https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
      title: "Truck",
      finalX: 160,
      finalY: 140,
      delay: 1.2,
      rotation: 10
    }
  ];

  return (
    <div 
      ref={sectionRef} 
      className="relative h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 overflow-hidden flex items-center justify-center"
    >
      {/* Background grid pattern */}
      <div className="absolute inset-0 opacity-20">
        <div className="grid grid-cols-12 grid-rows-8 h-full w-full">
          {Array.from({ length: 96 }).map((_, i) => (
            <div key={i} className="border border-white/10" />
          ))}
        </div>
      </div>

      {/* Title */}
      <div className="absolute top-16 left-1/2 transform -translate-x-1/2 text-center z-20">
        <div className="pulse-chip mb-4">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">04</span>
          <span>Vehicle Collection</span>
        </div>
        <h2 className="text-4xl md:text-6xl font-display font-bold text-white mb-4">
          Cars in Motion
        </h2>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto px-4">
          Watch as vehicles scatter into view with dynamic animations
        </p>
      </div>

      {/* Cars Container */}
      <div className="absolute inset-0 flex items-center justify-center">
        {cars.map((car) => (
          <div
            key={car.id}
            className={`absolute transition-all duration-1000 ease-out ${
              isVisible ? 'car-scattered' : 'car-initial'
            }`}
            style={{
              transitionDelay: `${car.delay}s`,
              transform: isVisible 
                ? `translate(${car.finalX}px, ${car.finalY}px) rotate(${car.rotation}deg) scale(1)` 
                : 'translate(0px, 0px) rotate(0deg) scale(0.5)',
              opacity: isVisible ? 1 : 0,
            }}
          >
            {/* Car Card */}
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20 shadow-2xl hover:scale-105 transition-transform duration-300">
              <div className="relative overflow-hidden rounded-xl mb-3">
                <img 
                  src={car.image} 
                  alt={car.title} 
                  className="w-32 h-20 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              </div>
              <h3 className="text-white font-semibold text-sm text-center">
                {car.title}
              </h3>
            </div>

            {/* Glow effect */}
            <div className="absolute inset-0 bg-white/5 rounded-2xl blur-xl scale-110 -z-10" />
          </div>
        ))}
      </div>

      {/* Center focal point */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`w-4 h-4 rounded-full bg-white transition-all duration-1000 ${
          isVisible ? 'scale-100 opacity-20' : 'scale-0 opacity-0'
        }`} />
        <div className={`absolute w-8 h-8 rounded-full border-2 border-white/30 transition-all duration-1500 ${
          isVisible ? 'scale-100 opacity-10' : 'scale-0 opacity-0'
        }`} />
        <div className={`absolute w-16 h-16 rounded-full border border-white/20 transition-all duration-2000 ${
          isVisible ? 'scale-100 opacity-5' : 'scale-0 opacity-0'
        }`} />
      </div>

      {/* Particle effects */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={`absolute w-1 h-1 bg-white rounded-full transition-all duration-2000 ${
              isVisible ? 'opacity-30' : 'opacity-0'
            }`}
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              transitionDelay: `${Math.random() * 2}s`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default ScatterCarsSection;

