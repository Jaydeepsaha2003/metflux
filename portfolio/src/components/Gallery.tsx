import React, { useEffect, useRef } from "react";

const Gallery = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const images = [
    {
      id: 1,
      src: "/images/environment.png",
      alt: "Environmental Responsibility",
      title: "Environment",
      description: "Committed to reducing our carbon footprint through energy-efficient manufacturing processes and sustainable material sourcing for a greener tomorrow."
    },
    {
      id: 2,
      src: "/images/empowement.png",
      alt: "Community Empowerment",
      title: "Empowerment",
      description: "Empowering local communities through skill development programs, employment opportunities, and supporting educational initiatives in our region."
    },
    {
      id: 3,
      src: "/images/sustainabiliy.png",
      alt: "Sustainable Innovation",
      title: "Sustainability",
      description: "Building a sustainable future through innovative technologies, responsible resource management, and creating products that contribute to long-term environmental health."
    }
  ];

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
    <section className="py-12 sm:py-16 md:py-20 bg-gray-50" id="gallery" ref={sectionRef}>
      <div className="section-container">
        {/* Header */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            Beyond <br className="hidden sm:block" />Business
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            We are growing fast. But besides our strong financial performance and energy-efficient solutions, we are consciously contributing our share in shaping a sustainable ecosystem that continues to flourish over generations.
          </p>
        </div>
        
        {/* Gallery Images */}
        <div className="gallery-container flex h-96 sm:h-[500px] gap-2 sm:gap-4 rounded-2xl overflow-hidden shadow-elegant opacity-0 fade-in-element" style={{ animationDelay: "0.4s" }}>
          {images.map((image, index) => (
            <div
              key={image.id}
              className={`gallery-item relative cursor-pointer transition-all duration-700 ease-out overflow-hidden ${
                index === 0 ? 'flex-[1.2]' : 'flex-1'
              } hover:flex-[2.5] group`}
            >
              {/* Background Image */}
              <div 
                className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                style={{
                  backgroundImage: `url('${image.src}')`,
                }}
              />
              
              {/* Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity duration-500" />
              
              {/* Dimming overlay for non-hovered items */}
              <div className="gallery-overlay absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-500" />
              
              {/* Content Container */}
              <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 lg:p-8">
                <div className="transform transition-all duration-500 group-hover:translate-y-0 translate-y-2">
                  <h3 className="text-white font-display font-bold text-lg sm:text-xl lg:text-2xl mb-2 opacity-90 group-hover:opacity-100 transition-opacity duration-300">
                    {image.title}
                  </h3>
                  <p className="text-white/80 text-sm sm:text-base leading-relaxed opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 transition-all duration-500 delay-100">
                    {image.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <style jsx>{`
        .gallery-container:hover .gallery-item:not(:hover) {
          flex: 0.7;
        }
        
        .gallery-container:hover .gallery-item:not(:hover) .gallery-overlay {
          opacity: 1;
        }
        
        .gallery-container .gallery-item:hover {
          flex: 2.5;
        }
      `}</style>
    </section>
  );
};

export default Gallery;

